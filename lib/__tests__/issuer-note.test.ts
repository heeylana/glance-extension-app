import { describe, expect, it } from "vitest";
import { bigUsd, issuerNote } from "../issuer-note";
import type { EntityListing } from "../api-types";

const listing = (over: Partial<EntityListing> = {}): EntityListing => ({
  mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ",
  symbol: "T-OpenAI",
  issuer: "Tessera",
  kind: "pre-ipo",
  tokenUsd: 860,
  markUsd: 812.79,
  premiumPct: 5.8,
  liquidityUsd: 120_000,
  markSource: "tessera",
  holders: 14_693,
  markValuation: 950_000_000_000,
  ...over,
});

describe("the issuer's own line", () => {
  it("names the issuer, the mark, the holders and the valuation", () => {
    expect(issuerNote(listing())).toBe("Tessera marks it at $813 · 14,693 holders · $950B valuation");
  });

  it("says nothing for a token marked by the generic feed", () => {
    expect(issuerNote(listing({ markSource: "jupiter" }))).toBeNull();
    expect(issuerNote(listing({ markSource: null }))).toBeNull();
    expect(issuerNote(listing({ markSource: undefined }))).toBeNull();
  });

  it("says nothing when there is no mark to attribute", () => {
    expect(issuerNote(listing({ markUsd: null }))).toBeNull();
  });

  it("drops the parts the issuer did not publish rather than printing a blank", () => {
    expect(issuerNote(listing({ holders: null, markValuation: null }))).toBe("Tessera marks it at $813");
    expect(issuerNote(listing({ holders: undefined, markValuation: undefined }))).toBe("Tessera marks it at $813");
    expect(issuerNote(listing({ holders: 3_070 }))).toBe("Tessera marks it at $813 · 3,070 holders · $950B valuation");
  });

  it("keeps cents on a small mark and drops them on a large one", () => {
    expect(issuerNote(listing({ markUsd: 4.5, holders: null, markValuation: null }))).toBe("Tessera marks it at $4.50");
    expect(issuerNote(listing({ markUsd: 1234.56, holders: null, markValuation: null }))).toBe("Tessera marks it at $1,235");
  });

  it("zero holders is a fact, not a missing value", () => {
    expect(issuerNote(listing({ holders: 0, markValuation: null }))).toBe("Tessera marks it at $813 · 0 holders");
  });
});

describe("valuations at the precision people say them", () => {
  it.each([
    [950_000_000_000, "$950B"],
    [14_000_000_000, "$14.0B"],
    [800_000_000_000, "$800B"],
    [1_200_000_000_000, "$1.2T"],
    [2_500_000, "$2.5M"],
    [950_000, "$950,000"],
  ])("%i reads as %s", (v, want) => {
    expect(bigUsd(v)).toBe(want);
  });
});
