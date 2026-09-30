/**
 * What the issuer itself says about a pre-IPO token.
 *
 * A private company has no listed share, so the generic price feed has nothing to mark its token against and the buy
 * card read "no mark" for every Tessera token. Tessera publishes the mark itself, along with how many wallets hold the
 * token and the valuation behind it, so the backend asks the issuer (services/tessera.ts) and the card says whose
 * number it is showing. It matters that it is attributed: a premium is only meaningful next to the mark it is measured
 * against, and on a private company that mark is the issuer's opinion rather than a market price.
 */
import type { EntityListing } from "./api-types";

/** "$950B", "$14B", "$800M": a valuation at the precision anyone actually says it. */
export function bigUsd(v: number): string {
  const [unit, size] = v >= 1e12 ? (["T", 1e12] as const) : v >= 1e9 ? (["B", 1e9] as const) : v >= 1e6 ? (["M", 1e6] as const) : (["", 1] as const);
  const n = v / size;
  // Below a million there is no unit to shorten to, so it is written out with separators rather than as a bare run of
  // digits: "$950,000", not "$950000".
  if (!unit) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n >= 100 ? Math.round(n) : n.toFixed(1)}${unit}`;
}

/** Price as the card writes it elsewhere: whole dollars above a hundred, cents below. */
const price = (v: number): string => `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}`;

/**
 * The issuer's own line for this token, or null when the mark came from the generic feed, which is every xStock.
 * "Tessera marks it at $813 · 14,693 holders · $950B valuation"
 */
export function issuerNote(l: EntityListing): string | null {
  if (l.markSource !== "tessera" || l.markUsd === null || l.markUsd === undefined) return null;
  const parts = [`Tessera marks it at ${price(l.markUsd)}`];
  if (typeof l.holders === "number") parts.push(`${l.holders.toLocaleString("en-US")} holders`);
  if (typeof l.markValuation === "number") parts.push(`${bigUsd(l.markValuation)} valuation`);
  return parts.join(" · ");
}
