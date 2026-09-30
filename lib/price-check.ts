/**
 * What the buy card says about the price check behind a trade.
 *
 * Every trade is checked against a reference price before it is signed: guards/price.ts compares the fill's implied
 * price per share with the feed's, and rejects the trade when the gap is wider than the allowed band (a wider one
 * off-hours, when an equity feed stops publishing). That check has always run and has never been visible, so the user
 * had no way to know their price had been vouched for at all.
 *
 * The claim is deliberately narrow. With no Pyth key the reference falls back to Jupiter, and Jupiter prices the same
 * venue Glance trades on, so it is not an independent check. Saying "checked against Pyth" in that case would be
 * telling the user something that did not happen, so this says nothing at all rather than something untrue.
 */
import type { BuyResult } from "./api-types";

/**
 * The deviation as a percentage, always rounded UP: the card says "within", so the number has to be a true upper
 * bound. Rounding to nearest would have printed "within 0.3%" for a fill 0.35% away, which is simply false. The floor
 * of 0.01% is for a fill closer than the second decimal can show, where the bound is still true and "within 0.00%"
 * would read as a claim of an exact match.
 */
export function deviationPct(bps: number): string {
  return Math.max(Math.ceil(Math.abs(bps)) / 100, 0.01).toFixed(2);
}

/**
 * "Checked against Pyth · within 0.03%", or null when there is nothing honest to say: no Pyth reference, or no usable
 * deviation. An off-hours feed is named, because the band it was judged against was the wider one.
 */
export function priceCheckLine(r: Pick<BuyResult, "priceSource" | "deviationBps" | "priceStale">): string | null {
  if (r.priceSource !== "pyth") return null;
  if (typeof r.deviationBps !== "number" || !Number.isFinite(r.deviationBps)) return null;
  const within = `Checked against Pyth · within ${deviationPct(r.deviationBps)}%`;
  return r.priceStale ? `${within} · off-hours feed` : within;
}
