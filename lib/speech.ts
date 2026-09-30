/**
 * Glance speaks in the backend's voice (MP3) or not at all. A line the backend cannot voice is silent; the answer is on
 * the card either way.
 *
 * Why a line is spoken in chunks, shortest first. Synthesis time scales with length: measured from Lagos against
 * Deepgram, a line costs about half a second plus 30ms a character, so the 245-character answer the model likes to
 * write takes over eight seconds to come back and the panel sits mute for all of it. Speech runs at about 65ms a
 * character, roughly twice as slow as generation, so once something is playing every later chunk arrives before the one
 * before it finishes. Cutting the opening chunk to a clause brings the first word in at about two seconds instead of
 * eight, and costs nothing after that.
 *
 * Two chunks are requested at once rather than one. The opening chunk is short, so it is also short to listen to: with
 * a single request in flight the next chunk would still be generating when the first stopped playing, which is a
 * silence in the middle of a sentence. Two in flight covers the handoff, and from there the pipeline stays ahead on its
 * own. The cap lives here rather than in the prompt because the model is asked for short segments and cannot be relied
 * on to give them.
 */
export interface SpeechClip {
  audio: string;
  mime: string;
}

/** Backend synthesis of one chunk; null when it declined, failed or timed out. */
export type Synth = (text: string) => Promise<SpeechClip | null>;

/** How one line is heard, and whether it is still wanted (a newer line or a new take cancels it). */
export interface LineOut {
  current: () => boolean;
  /** Resolves once heard; false if the clip could not be played. */
  play: (clip: SpeechClip) => Promise<boolean>;
}

/** The opening chunk: one clause, so the first word lands in about two seconds. */
export const OPENING_CHARS = 70;
/**
 * Every chunk after it. Long enough to keep most sentences whole, short enough that it is generated well before the
 * chunk in front of it stops playing (150 characters is about 5s to generate against 10s to say).
 */
export const LATER_CHARS = 150;
/** Chunks requested before the first one is back. Two covers the handoff from the short opening chunk. */
const IN_FLIGHT = 2;

/** Sentence ends, keeping the punctuation with the sentence it closes. */
const SENTENCES = /(?<=[.!?])\s+/;
/** Punctuation a chunk may end on: the cut lands after it, so the chunk keeps its comma. */
const AFTER_MARKS = [/,\s+/g, /;\s+/g, /:\s+/g];
/** Joining words a chunk may end before. Cutting after one would leave the chunk hanging on "and". */
const BEFORE_WORDS = [/\s+(?:and|but|so|because)\s+/g];

/** The last clause boundary at or before `max`, or 0 when the sentence has none that early. */
function clauseCut(text: string, max: number): number {
  let best = 0;
  const scan = (res: readonly RegExp[], at: (m: RegExpExecArray) => number) => {
    for (const re of res) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const cut = at(m);
        if (cut > max) break;
        if (cut > best) best = cut;
      }
    }
  };
  scan(AFTER_MARKS, (m) => m.index + m[0].length);
  scan(BEFORE_WORDS, (m) => m.index);
  return best;
}

/**
 * One piece of at most `max` characters, cut at a clause, else between words. A single word longer than the cap is kept
 * whole and overruns it: half a word is not speech.
 */
function takeOne(text: string, max: number): [string, string] {
  if (text.length <= max) return [text, ""];
  const clause = clauseCut(text, max);
  if (clause) return [text.slice(0, clause).trim(), text.slice(clause).trim()];
  let cut = text.lastIndexOf(" ", max);
  if (cut <= 0) {
    const next = text.indexOf(" ", max);
    if (next === -1) return [text, ""];
    cut = next;
  }
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

/**
 * One line as the chunks it will be spoken in: `firstMax` caps the opening one, `restMax` the others. Whole sentences
 * are kept together while they fit; a sentence longer than its cap is cut at a clause.
 */
export function chunkLine(text: string, firstMax = OPENING_CHARS, restMax = LATER_CHARS): string[] {
  const line = text.trim();
  if (!line) return [];
  const sentences = line.split(SENTENCES).filter(Boolean);
  const chunks: string[] = [];
  let held = "";
  const cap = () => (chunks.length === 0 ? firstMax : restMax);
  const flush = () => {
    if (held) chunks.push(held);
    held = "";
  };
  for (const sentence of sentences) {
    let rest = sentence;
    // A sentence that fits beside what is already held rides along; otherwise what is held goes out first.
    if (held && `${held} ${rest}`.length <= cap()) {
      held = `${held} ${rest}`;
      continue;
    }
    flush();
    while (rest.length > cap()) {
      const [piece, tail] = takeOne(rest, cap());
      chunks.push(piece);
      rest = tail;
    }
    held = rest;
  }
  flush();
  return chunks.filter(Boolean);
}

export class Answer {
  private clips = new Map<string, Promise<SpeechClip | null>>();
  /** Each line as the chunks it will be spoken in, so say() and prepare() never disagree about the split. */
  private split = new Map<string, string[]>();
  /** How many chunks have been requested ahead of the first answer coming back. */
  private started = 0;
  /** Chunks known before the first is back, fetched once it is, so a long answer does not open ten requests at once. */
  private queued: string[] | null = [];

  constructor(private synth: Synth) {}

  /** Chunks this answer will say, in order: starts fetching them now, so nothing waits later. */
  prepare(lines: string[]): void {
    for (const line of lines) {
      for (const text of this.chunksOf(line)) {
        if (this.clips.has(text) || this.queued?.includes(text)) continue;
        if (this.started < IN_FLIGHT) {
          const opening = this.started === 0;
          this.started++;
          const p = this.fetch(text);
          // The rest wait on the opening chunk, not on its companion: whichever of the two is slower must not hold them.
          if (opening) void p.then(() => this.fetchQueued());
        } else if (this.queued) this.queued.push(text);
        else void this.fetch(text);
      }
    }
  }

  /**
   * Say one line, a chunk at a time. Resolves true once any of it was heard; false when silent (the backend could not
   * voice it) or no longer current.
   */
  async say(text: string, out: LineOut): Promise<boolean> {
    this.prepare([text]);
    let heard = false;
    for (const part of this.chunksOf(text)) {
      const clip = await this.fetch(part);
      if (!out.current()) return heard;
      if (!clip) {
        console.debug("[glance] the backend could not voice this chunk; staying silent", { chars: part.length });
        continue;
      }
      heard = (await out.play(clip)) || heard;
    }
    return heard;
  }

  /**
   * The line's chunks, decided once and remembered. The answer's opening chunk is the short one; a line prepared later
   * is already playing behind something, so it keeps whole sentences instead.
   */
  private chunksOf(line: string): string[] {
    let parts = this.split.get(line);
    if (!parts) {
      const opening = this.split.size === 0;
      parts = chunkLine(line, opening ? OPENING_CHARS : LATER_CHARS, LATER_CHARS);
      this.split.set(line, parts);
    }
    return parts;
  }

  private fetchQueued() {
    const chunks = this.queued ?? [];
    this.queued = null;
    for (const text of chunks) void this.fetch(text);
  }

  private fetch(text: string): Promise<SpeechClip | null> {
    let p = this.clips.get(text);
    if (!p) {
      p = this.synth(text).catch(() => null);
      this.clips.set(text, p);
    }
    return p;
  }
}
