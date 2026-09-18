import { describe, expect, it } from "vitest";
import { concat, downsample, encodeWav, peak, toBase64 } from "../audio";

describe("downsample", () => {
  it("averages 48 kHz down to 16 kHz", () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1, 0.5]);
    const out = downsample(input, 48_000);
    expect(out.length).toBe(3);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(1);
    expect(out[2]).toBeCloseTo(-1);
  });
  it("passes 16 kHz through and refuses to upsample", () => {
    const input = new Float32Array(4);
    expect(downsample(input, 16_000)).toBe(input);
    expect(() => downsample(input, 8_000)).toThrow();
  });
  it("handles a non-integer ratio (44.1 kHz)", () => {
    expect(downsample(new Float32Array(44_100).fill(0.5), 44_100).length).toBe(16_000);
  });
});

describe("encodeWav", () => {
  it("writes a mono 16-bit PCM header and clamps samples", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 2]));
    const v = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(wav.length).toBe(44 + 8);
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("helpers", () => {
  it("concatenates, measures peak, and base64-encodes", () => {
    expect(Array.from(concat([Float32Array.from([1]), Float32Array.from([2, 3])]))).toEqual([1, 2, 3]);
    expect(peak(Float32Array.from([0.1, -0.7, 0.2]))).toBeCloseTo(0.7);
    expect(toBase64(Uint8Array.from([82, 73, 70, 70]))).toBe("UklGRg==");
    expect(toBase64(Uint8Array.from([1, 2, 3]).buffer)).toBe("AQID");
  });
});
