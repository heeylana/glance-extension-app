import { describe, expect, it } from "vitest";
import { spark, type SparkPoint } from "../spark";

/** A rising day: four hourly points from $100 to $130. */
const rising: SparkPoint[] = [
  { t: 1_000, usd: 100 },
  { t: 2_000, usd: 110 },
  { t: 3_000, usd: 90 },
  { t: 4_000, usd: 130 },
];

describe("spark", () => {
  it("spans the box, with the first point at the left and the last at the right", () => {
    const s = spark(rising, 100, 40)!;
    expect(s.line.startsWith("M0,")).toBe(true);
    expect(s.end.x).toBe(100);
    expect(s.low).toBe(90);
    expect(s.high).toBe(130);
    expect(s.first).toBe(100);
    expect(s.last).toBe(130);
    expect(s.changePct).toBeCloseTo(30);
    expect(s.down).toBe(false);
  });

  it("puts the high at the top and the low at the bottom, inside the padding", () => {
    const s = spark(rising, 100, 40, 3)!;
    const ys = s.line.slice(1).split("L").map((p) => Number(p.split(",")[1]));
    expect(Math.min(...ys)).toBe(3); // the $130 point, at the top
    expect(Math.max(...ys)).toBe(37); // the $90 point, at the bottom
  });

  it("closes the wash along the bottom of the box", () => {
    const s = spark(rising, 100, 40)!;
    expect(s.area.endsWith("L100,40L0,40Z")).toBe(true);
  });

  it("marks a down day", () => {
    const s = spark([{ t: 1, usd: 50 }, { t: 2, usd: 40 }], 60, 20)!;
    expect(s.down).toBe(true);
    expect(s.changePct).toBeCloseTo(-20);
  });

  it("draws a flat day down the middle instead of dividing by zero", () => {
    const s = spark([{ t: 1, usd: 7 }, { t: 2, usd: 7 }], 60, 20)!;
    expect(s.line).toBe("M0,10L60,10");
    expect(s.changePct).toBe(0);
    expect(s.down).toBe(false);
  });

  it("orders points by time and ignores ones with no price", () => {
    const s = spark(
      [
        { t: 3_000, usd: 130 },
        { t: 1_000, usd: 100 },
        { t: 2_000, usd: Number.NaN },
        { t: 2_500, usd: 0 },
      ],
      100,
      40,
    )!;
    expect(s.first).toBe(100);
    expect(s.last).toBe(130);
    expect(s.line).toBe("M0,37L100,3");
  });

  it("has nothing to draw with fewer than two points, or no time between them", () => {
    expect(spark([], 100, 40)).toBeNull();
    expect(spark([{ t: 1, usd: 5 }], 100, 40)).toBeNull();
    expect(spark([{ t: 5, usd: 5 }, { t: 5, usd: 6 }], 100, 40)).toBeNull();
  });
});
