/**
 * The little price chart on the buy card: a day of hourly prices from Birdeye, drawn as one line
 * with a wash under it (entrypoints/content/bubble.ts renders it). Pure geometry in the chart's own
 * pixels, so it can be tested without a DOM.
 *
 * It is a sparkline, not a trading chart: no axes, no grid, no candles. It answers "which way has
 * this been going today?" at a glance, and the card prints the numbers beside it.
 */
export interface SparkPoint {
  /** Seconds since the epoch. */
  t: number;
  usd: number;
}

export interface Spark {
  /** The price line, as an SVG path. */
  line: string;
  /** The same line closed along the bottom, for the wash under it. */
  area: string;
  /** Where the line ends, for the dot Glance puts there. */
  end: { x: number; y: number };
  low: number;
  high: number;
  first: number;
  last: number;
  /** Move across the whole window, in percent; 0 when the price never moved. */
  changePct: number;
  /** Down days are drawn in the warning colour, not the accent. */
  down: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Map points to a `w`×`h` box, `pad` pixels in from the top and bottom so the stroke is never
 * clipped. Null when there is nothing to draw: fewer than two points, or no spread in time.
 */
export function spark(points: SparkPoint[], w: number, h: number, pad = 3): Spark | null {
  const usable = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.usd) && p.usd > 0).sort((a, b) => a.t - b.t);
  if (usable.length < 2) return null;
  const t0 = usable[0]!.t;
  const tSpan = usable[usable.length - 1]!.t - t0;
  if (tSpan <= 0) return null;

  const prices = usable.map((p) => p.usd);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  // A flat day would divide by zero; draw it down the middle instead.
  const span = high - low;
  const top = pad;
  const bottom = h - pad;
  const x = (p: SparkPoint) => ((p.t - t0) / tSpan) * w;
  const y = (p: SparkPoint) => (span === 0 ? h / 2 : bottom - ((p.usd - low) / span) * (bottom - top));

  const steps = usable.map((p) => `${r1(x(p))},${r1(y(p))}`);
  const line = `M${steps.join("L")}`;
  const area = `${line}L${r1(w)},${r1(h)}L0,${r1(h)}Z`;
  const first = usable[0]!.usd;
  const last = usable[usable.length - 1]!.usd;
  return {
    line,
    area,
    end: { x: r1(x(usable[usable.length - 1]!)), y: r1(y(usable[usable.length - 1]!)) },
    low,
    high,
    first,
    last,
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    down: last < first,
  };
}
