import { describe, expect, it, vi } from "vitest";
import { Answer, type LineOut, type SpeechClip } from "../speech";

const clipOf = (text: string): SpeechClip => ({ audio: `mp3:${text}`, mime: "audio/mpeg" });
const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

/** A fake backend: voices a line when `ok(text)`, after `ms`. Records what was asked, in order. */
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
});

describe("the first word comes sooner", () => {
  it("fetches only the first line at once, and the rest as soon as it is back", async () => {
    const { synth, asked } = backend(() => true, 5);
    const a = new Answer(synth);
    a.prepare(LINES);
    expect(asked).toEqual(["One."]);
    await later(15, null);
    expect(asked).toEqual(["One.", "Two.", "Three."]);
  });

  it("still fetches the rest when the first line fails", async () => {
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

  it("a line fetched ahead is not asked for again when it is said", async () => {
    const { synth, asked } = backend(() => true, 5);
    const a = new Answer(synth);
    const { played, out } = speaker();
    a.prepare(LINES);
    for (const line of LINES) await a.say(line, out);
    expect(asked).toEqual(LINES);
    expect(played).toEqual(LINES);
  });
});
