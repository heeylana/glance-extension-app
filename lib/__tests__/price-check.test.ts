import { describe, expect, it } from "vitest";
import { deviationPct, priceCheckLine } from "../price-check";

const checked = (over: Partial<Parameters<typeof priceCheckLine>[0]> = {}) => ({
  priceSource: "pyth" as const,
  deviationBps: 3,
  priceStale: false,
  ...over,
});

describe("what the card says about the price check", () => {
  it("names Pyth and how close the fill landed", () => {
    expect(priceCheckLine(checked())).toBe("Checked against Pyth · within 0.03%");
    expect(priceCheckLine(checked({ deviationBps: 35 }))).toBe("Checked against Pyth · within 0.35%");
  });

  it("says nothing when the reference was not Pyth", () => {
    // Jupiter prices the same venue Glance trades on, so it is not an independent check and must not be sold as one.
    expect(priceCheckLine(checked({ priceSource: "jupiter" }))).toBeNull();
    expect(priceCheckLine(checked({ priceSource: "history" }))).toBeNull();
    expect(priceCheckLine(checked({ priceSource: undefined }))).toBeNull();
  });

  it("says nothing when there is no usable deviation", () => {
    expect(priceCheckLine(checked({ deviationBps: undefined }))).toBeNull();
    expect(priceCheckLine(checked({ deviationBps: Number.NaN }))).toBeNull();
    expect(priceCheckLine(checked({ deviationBps: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it("names an off-hours feed, because the band it was judged against was the wider one", () => {
    expect(priceCheckLine(checked({ priceStale: true }))).toBe("Checked against Pyth · within 0.03% · off-hours feed");
  });

  it("a fill on the wrong side of the reference is still a distance", () => {
    expect(priceCheckLine(checked({ deviationBps: -12 }))).toBe("Checked against Pyth · within 0.12%");
  });

  it('always rounds up, because the card says "within"', () => {
    // Rounding to nearest printed "0.3" for a fill 0.35% away. "Within" has to be a bound the fill actually met.
    expect(deviationPct(35)).toBe("0.35");
    expect(deviationPct(3.2)).toBe("0.04");
    expect(deviationPct(12)).toBe("0.12");
    expect(deviationPct(250)).toBe("2.50");
  });

  it("never claims an exact match for a fill too close to show", () => {
    expect(deviationPct(0)).toBe("0.01");
    expect(deviationPct(0.4)).toBe("0.01");
  });
});
