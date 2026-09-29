/**
 * Glance speaks in the backend's voice (Fish Audio, MP3) or not at all. A line the backend cannot voice is silent; the
 * answer is on the card either way. To bring the first word forward, an answer fetches its first line as soon as it is
 * known and the rest while that one plays.
 */
export interface SpeechClip {
  audio: string;
  mime: string;
}

/** Backend synthesis of one line; null when it declined, failed or timed out. */
export type Synth = (text: string) => Promise<SpeechClip | null>;

/** How one line is heard, and whether it is still wanted (a newer line or a new take cancels it). */
export interface LineOut {
  current: () => boolean;
  /** Resolves once heard; false if the clip could not be played. */
  play: (clip: SpeechClip) => Promise<boolean>;
}

export class Answer {
  private clips = new Map<string, Promise<SpeechClip | null>>();
  private first: string | null = null;
  /** Lines known before the first is back, fetched once it is: the first request has the connection to itself. */
  private queued: string[] | null = [];

  constructor(private synth: Synth) {}

  /** Lines this answer will say, in order: starts fetching them now, so nothing waits later. */
  prepare(lines: string[]): void {
    for (const text of lines) {
      if (this.clips.has(text) || this.queued?.includes(text)) continue;
      if (this.first === null) {
        this.first = text;
        void this.fetch(text).then(() => this.fetchQueued());
      } else if (this.queued) this.queued.push(text);
      else void this.fetch(text);
    }
  }

  /** Say one line. Resolves true once heard; false when silent (the backend could not voice it) or no longer current. */
  async say(text: string, out: LineOut): Promise<boolean> {
    this.prepare([text]);
    const clip = await this.fetch(text);
    if (!out.current()) return false;
    if (!clip) {
      console.debug("[glance] the backend could not voice this line; staying silent", { chars: text.length });
      return false;
    }
    return out.play(clip);
  }

  private fetchQueued() {
    const lines = this.queued ?? [];
    this.queued = null;
    for (const text of lines) void this.fetch(text);
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
