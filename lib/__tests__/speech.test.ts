import { describe, expect, it, vi } from "vitest";
import { Answer, chunkLine, LATER_CHARS, OPENING_CHARS, type LineOut, type SpeechClip } from "../speech";

const clipOf = (text: string): SpeechClip => ({ audio: `mp3:${text}`, mime: "audio/mpeg" });
const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/** A fake backend: voices a chunk when `ok(text)`, after `ms`. Records what was asked, in order. */
function backend(ok: (text: string) => boolean, ms = 0) {
  const asked: string[] = [];
  const synth = vi.fn(async (text: string) => {
    asked.push(text);
    return later(ms, ok(text) ? clipOf(text) : null);
  });
  return { synth, asked };
}

/** Records the clips played, by the text they voice. */
function speaker() {
  const played: string[] = [];
  const out: LineOut = {
    current: () => true,
    play: async (c) => {
      played.push(c.audio.slice(4));
      return true;
    },
  };
  return { played, out };
}

const LINES = ["One.", "Two.", "Three."];
/** Long enough that it is spoken in three chunks; the words are what the panel actually says. */
const LONG =
  "Nvidia is up about two percent today after its earnings call, and the tokenized share is trading close to the real one. You can buy a fraction of it right here if you want to, any day of the week, and it settles into your vault in a few seconds.";

describe("the backend's voice or silence", () => {
  it("a failed synthesis is silent, and the answer's text is still shown", async () => {
    const { synth } = backend(() => false);
    const a = new Answer(synth);
    const { played, out } = speaker();
    // The way callers use it: each line goes on the card, then is said.
    const shown: string[] = [];
    const heard: boolean[] = [];
    a.prepare(LINES);
    for (const line of LINES) {
      shown.push(line);
      heard.push(await a.say(line, out));
    }
    expect(shown).toEqual(LINES);
    expect(played).toEqual([]);
    expect(heard).toEqual([false, false, false]);
  });

  it("a line the backend cannot voice is silent; the lines around it are still heard", async () => {
    const { synth } = backend((t) => t !== "Two.");
    const a = new Answer(synth);
    const { played, out } = speaker();
    for (const line of LINES) await a.say(line, out);
    expect(played).toEqual(["One.", "Three."]);
  });

  it("stops without playing when the line is no longer current", async () => {
    const { synth } = backend(() => true, 5);
    const a = new Answer(synth);
    const { played, out } = speaker();
    expect(await a.say("One.", { ...out, current: () => false })).toBe(false);
    expect(played).toEqual([]);
  });

  it("stops part way through a line that stops being current", async () => {
    const { synth } = backend(() => true);
    const a = new Answer(synth);
    const played: string[] = [];
    // Current for the opening chunk only: the rest of the line is dropped rather than spoken over the next answer.
    let calls = 0;
    await a.say(LONG, {
      current: () => calls++ < 1,
      play: async (c) => {
        played.push(c.audio.slice(4));
        return true;
      },
    });
    expect(played).toHaveLength(1);
    expect(played[0]).toBe(chunkLine(LONG)[0]);
  });
});

describe("the first word comes sooner", () => {
  it("asks for two chunks at once, and the rest as soon as the first is back", async () => {
    const { synth, asked } = backend(() => true, 5);
    const a = new Answer(synth);
    a.prepare(LINES);
    // Two in flight covers the handoff from the short opening chunk; the rest wait.
    expect(asked).toEqual(["One.", "Two."]);
    await later(15, null);
    expect(asked).toEqual(["One.", "Two.", "Three."]);
  });

  it("releases the queue a few at a time instead of all at once", async () => {
    // Six requests landing together took six to nine seconds each in production, against two on their own.
    const many = ["a.", "b.", "c.", "d.", "e.", "f."];
    let open = 0;
    let peak = 0;
    const asked: string[] = [];
    const synth = vi.fn(async (text: string) => {
      asked.push(text);
      open++;
      peak = Math.max(peak, open);
      await later(5, null);
      open--;
      return clipOf(text);
    });
    const a = new Answer(synth);
    a.prepare(many);
    await later(60, null);
    expect(asked).toEqual(many);
    // Two start together, and the window stays small as the rest are drawn off the queue.
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("still fetches the rest when the first chunk fails", async () => {
    const { synth, asked } = backend((t) => t !== "One.", 5);
    const a = new Answer(synth);
    a.prepare(LINES);
    await later(15, null);
    expect(asked).toEqual(["One.", "Two.", "Three."]);
  });

  it("plays the first line without waiting for the others", async () => {
    const { synth } = backend(() => true);
    synth.mockImplementation(async (t: string) => (t === "One." ? clipOf(t) : new Promise<never>(() => {})));
    const a = new Answer(synth);
    const { played, out } = speaker();
    a.prepare(LINES);
    expect(await a.say("One.", out)).toBe(true);
    expect(played).toEqual(["One."]);
  });

  it("a chunk fetched ahead is not asked for again when it is said", async () => {
    const { synth, asked } = backend(() => true, 5);
    const a = new Answer(synth);
    const { played, out } = speaker();
    a.prepare(LINES);
    for (const line of LINES) await a.say(line, out);
    expect(asked).toEqual(LINES);
    expect(played).toEqual(LINES);
  });

  it("speaks a long line as its chunks, in order, and asks for each once", async () => {
    const { synth, asked } = backend(() => true);
    const a = new Answer(synth);
    const { played, out } = speaker();
    const parts = chunkLine(LONG);
    expect(parts.length).toBeGreaterThan(1);
    expect(await a.say(LONG, out)).toBe(true);
    expect(played).toEqual(parts);
    expect(asked).toEqual(parts);
  });

  it("only the answer's opening chunk is cut short; a later line keeps whole sentences", async () => {
    const { synth } = backend(() => true);
    const a = new Answer(synth);
    await a.say("A short opener.", speaker().out);
    // The second line is already playing behind something, so it is chunked at the looser cap.
    const played: string[] = [];
    await a.say(LONG, {
      current: () => true,
      play: async (c) => {
        played.push(c.audio.slice(4));
        return true;
      },
    });
    expect(played).toEqual(chunkLine(LONG, LATER_CHARS, LATER_CHARS));
  });
});

describe("chunking a line", () => {
  it("leaves a line that already fits alone", () => {
    expect(chunkLine("Nvidia is up two percent today.")).toEqual(["Nvidia is up two percent today."]);
  });

  it("keeps every word, in order", () => {
    const words = (s: string) => s.trim().split(/\s+/);
    expect(chunkLine(LONG).flatMap(words)).toEqual(words(LONG));
  });

  it("caps the opening chunk and the ones after it", () => {
    const parts = chunkLine(LONG);
    expect(parts[0]!.length).toBeLessThanOrEqual(OPENING_CHARS);
    for (const p of parts.slice(1)) expect(p.length).toBeLessThanOrEqual(LATER_CHARS);
  });

  it("ends a chunk before a joining word, not after it", () => {
    // Cutting after "and" would leave the panel saying "after its earnings call, and" and then stopping.
    for (const p of chunkLine(LONG)) expect(p).not.toMatch(/\b(and|but|so|because)$/);
  });

  it("keeps a word longer than the cap whole rather than speaking half of it", () => {
    const word = "a".repeat(OPENING_CHARS + 30);
    expect(chunkLine(`${word} okay`)).toEqual([word, "okay"]);
  });

  it("nothing to say is no chunks", () => {
    expect(chunkLine("   ")).toEqual([]);
  });
});
