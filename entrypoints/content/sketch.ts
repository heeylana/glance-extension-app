/**
 * The layer Glance draws on while it explains a page, after Clicky's pointer
 * (github.com/farzaa/clicky): rings, boxes, underlines, highlights, arrows, lines, free sketches and
 * handwritten notes, in one SVG over the viewport inside the bubble's shadow root (the page DOM is
 * never touched). A mark anchored to an element follows it as the page scrolls; a mark placed in
 * screenshot pixels stays pinned to the spot of the page where it was seen. Strokes draw themselves
 * in: every path has a unit length and its dash offset runs from 1 to 0.
 */
import type { ExplainChart, SketchMark } from "../../lib/api-types";
import type { PageMap } from "../../lib/page-map";
import { arrowPaths, arrowStart, boxPoints, edgePoint, extendAcross, notePlacement, polylinePath, priceToY, ringPoints, smoothPath, underlinePoints, type Pt, type Rect } from "../../lib/sketch";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Gap between a two-part mark's strokes (an arrow's shaft, then its head). */
const HEAD_DELAY_MS = 520;

interface LiveMark {
  g: SVGGElement;
  place: () => void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Client rects merged into one box per line of text. */
function lineRects(rects: Iterable<DOMRect>): Rect[] {
  const lines: Rect[] = [];
  for (const r of rects) {
    if (r.width < 1 || r.height < 1) continue;
    const line = lines.find((l) => Math.abs(l.y - r.top) < 4);
    if (line) Object.assign(line, union([line, toRect(r)]));
    else lines.push(toRect(r));
  }
  return lines;
}

/** The lines an element's own content occupies: a heading's words, not the full-width block around them. */
function contentRects(el: Element): Rect[] | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines = lineRects(range.getClientRects());
  return lines.length ? lines : null;
}

/** The line boxes of the first run of `words` inside one text node of `el`, spacing and case ignored. */
function findWords(el: Element, words: string[]): Rect[] | null {
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const m = pattern.exec(n.nodeValue ?? "");
    if (!m) continue;
    const range = document.createRange();
    range.setStart(n, m.index);
    range.setEnd(n, m.index + m[0].length);
    const lines = lineRects(range.getClientRects());
    if (lines.length) return lines;
  }
  return null;
}

/**
 * Where `quote` sits inside `el`. Models quote loosely (a comma for a semicolon, a trailing full stop),
 * so trailing punctuation is dropped and, failing the whole quote, its longest leading run of at least
 * three words is used: the start of the right sentence beats highlighting the whole paragraph.
 */
function quoteRects(el: Element, quote: string): Rect[] | null {
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.,;:!?"'“”‘’)]+$/, "")).filter(Boolean);
  for (let n = words.length; n >= Math.min(3, words.length) && n > 0; n--) {
    const found = findWords(el, words.slice(0, n));
    if (found) return found;
  }
  return null;
}

export class Sketch {
  private svg: SVGSVGElement;
  private marks: LiveMark[] = [];
  private frame = 0;
  private seed = 1;

  /** `keepOut`: screen areas notes must not cover, such as the bubble's card and orb. */
  constructor(
    parent: Node,
    private keepOut: () => Rect[] = () => [],
  ) {
    this.svg = svgEl("svg", { class: "sketch", "aria-hidden": "true" });
    parent.insertBefore(this.svg, parent.firstChild);
    const schedule = () => {
      if (!this.marks.length || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        for (const m of this.marks) m.place();
      });
    };
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    void document.fonts?.ready.then(schedule);
  }

  get isEmpty() {
    return this.marks.length === 0;
  }

  /** Fade every mark out, or drop them at once (before a screenshot, so old marks are not in it). */
  clear(now = false) {
    const old = this.marks;
    this.marks = [];
    for (const m of old) {
      if (now) {
        m.g.remove();
        continue;
      }
      m.g.classList.add("fading");
      window.setTimeout(() => m.g.remove(), 320);
    }
  }

  /** A ripple where Glance clicks, so a click on the page is never a surprise. */
  tap(x: number, y: number) {
    const g = svgEl("g", { class: "tap" });
    g.append(svgEl("circle", { cx: String(x), cy: String(y), r: "14" }), svgEl("circle", { class: "dot", cx: String(x), cy: String(y), r: "4" }));
    this.svg.append(g);
    window.setTimeout(() => g.remove(), 900);
  }

  /** `chart`: the price axis the model read, for marks placed at a price (level, zone). */
  draw(mark: SketchMark, map: PageMap, delayMs: number, chart: ExplainChart | null = null) {
    const g = svgEl("g", { class: `mark mark-${mark.kind}` });
    g.style.setProperty("--delay", `${delayMs}ms`);
    this.svg.append(g);
    const seed = this.seed++ * 7919;

    // Screenshot pixels → where that spot of the page is in the viewport now.
    const fromShot = (p: Pt): Pt => ({ x: p.x / map.scale + map.scroll.x - window.scrollX, y: p.y / map.scale + map.scroll.y - window.scrollY });
    const view = () => ({ w: window.innerWidth, h: window.innerHeight });
    /** The chart's plot area in the viewport now, and a price's height on it. */
    const plot = (): Rect | null => {
      if (!chart) return null;
      const a = fromShot({ x: chart.plot.x, y: chart.plot.y });
      return { x: a.x, y: a.y, w: chart.plot.w / map.scale, h: chart.plot.h / map.scale };
    };
    const yAt = (price: number | null | undefined): number | null => {
      if (!chart || price === null || price === undefined) return null;
      const shotY = priceToY(price, chart.ticks);
      return shotY === null ? null : fromShot({ x: 0, y: shotY }).y;
    };
    /** Where a label goes at the end of a chart line: just above it, inside the plot's right edge. */
    const labelAt = (label: SVGTextElement, x: number, y: number) => {
      const b = label.getBBox();
      label.setAttribute("x", String(x - b.width - 6));
      label.setAttribute("y", String(y - 7));
    };
    /** The rects the mark is about, live: the quote's lines, the element, or the pinned box. */
    const target = (): Rect[] | null => {
      const node = mark.element ? map.nodes.get(mark.element) : undefined;
      if (node) {
        if (!node.isConnected) return null;
        if (mark.quote) {
          const lines = quoteRects(node, mark.quote);
          if (lines) return lines;
          // Marking a whole paragraph for words that are not there would point at the wrong thing.
          if (mark.kind === "highlight" || mark.kind === "underline") return null;
        }
        return contentRects(node) || [toRect(node.getBoundingClientRect())];
      }
      if (mark.box) {
        const a = fromShot({ x: mark.box.x, y: mark.box.y });
        return [{ x: a.x, y: a.y, w: mark.box.w / map.scale, h: mark.box.h / map.scale }];
      }
      return null;
    };
    /** A halo under the ink keeps the stroke readable on light and dark pages. */
    const stroke = (cls = "", extraDelay = 0) => {
      const halo = svgEl("path", { class: `halo ${cls}`, pathLength: "1" });
      const ink = svgEl("path", { class: `ink ${cls}`, pathLength: "1" });
      if (extraDelay) for (const p of [halo, ink]) p.style.setProperty("--delay", `${delayMs + extraDelay}ms`);
      g.append(halo, ink);
      return (d: string) => {
        halo.setAttribute("d", d);
        ink.setAttribute("d", d);
      };
    };
    const note = (cls: string, extraDelay = 0) => {
      const t = svgEl("text", { class: cls });
      t.textContent = mark.text ?? "";
      if (extraDelay) t.style.setProperty("--delay", `${delayMs + extraDelay}ms`);
      g.append(t);
      return t;
    };

    let place: () => void;
    switch (mark.kind) {
      case "circle":
      case "box": {
        const set = stroke();
        place = () => {
          const rects = target();
          g.style.display = rects ? "" : "none";
          if (rects) set(mark.kind === "circle" ? smoothPath(ringPoints(union(rects), seed)) : polylinePath(boxPoints(union(rects), seed)));
        };
        break;
      }
      case "underline": {
        const set = stroke();
        place = () => {
          const rects = target();
          g.style.display = rects ? "" : "none";
          if (rects) set(rects.map((r, i) => smoothPath(underlinePoints(r, seed + i))).join(" "));
        };
        break;
      }
      case "highlight": {
        const ink = svgEl("path", { class: "ink marker", pathLength: "1" });
        g.append(ink);
        place = () => {
          const rects = target();
          g.style.display = rects ? "" : "none";
          if (!rects) return;
          const lineH = Math.min(...rects.map((r) => r.h));
          ink.style.strokeWidth = `${Math.max(8, lineH * 0.9)}px`;
          ink.setAttribute("d", rects.map((r) => `M${r.x - 2},${r.y + r.h / 2} L${r.x + r.w + 2},${r.y + r.h / 2}`).join(" "));
        };
        break;
      }
      case "arrow": {
        const shaft = stroke();
        const head = stroke("", HEAD_DELAY_MS);
        const label = mark.text ? note("note-text arrow-label", HEAD_DELAY_MS) : null;
        place = () => {
          const rects = target();
          // With no thing to point at, an arrow runs from points[0] to points[1] (a spot on a chart).
          const between = !rects && (mark.points?.length ?? 0) >= 2 ? [fromShot(mark.points![0]!), fromShot(mark.points![1]!)] : null;
          g.style.display = rects || between ? "" : "none";
          if (!rects && !between) return;
          const tail = between ? between[0]! : mark.points?.[0] ? fromShot(mark.points[0]) : arrowStart(union(rects!), view());
          const tip = between ? between[1]! : edgePoint(tail, union(rects!));
          const paths = arrowPaths(tail, tip, seed);
          shaft(paths.shaft);
          head(paths.head);
          if (label) {
            const b = label.getBBox();
            label.setAttribute("x", String(tail.x - b.width / 2));
            label.setAttribute("y", String(tail.y + (tail.y < tip.y ? -10 : b.height + 4)));
          }
        };
        break;
      }
      case "line":
      case "path": {
        const set = stroke();
        place = () => {
          const pts = mark.points?.map(fromShot);
          if (pts && pts.length >= 2) {
            set(smoothPath(mark.kind === "line" ? [pts[0]!, pts.at(-1)!] : pts));
            return;
          }
          const rects = target();
          g.style.display = rects ? "" : "none";
          if (rects) set(smoothPath(underlinePoints(union(rects), seed)));
        };
        break;
      }
      case "note": {
        const text = note("note-text");
        place = () => {
          // Beside a thing, or at a spot (points[0]) such as a candle on a chart.
          const spot = mark.points?.[0] ? fromShot(mark.points[0]) : null;
          const rects = target() ?? (spot ? [{ x: spot.x - 3, y: spot.y - 3, w: 6, h: 6 }] : null);
          g.style.display = rects ? "" : "none";
          if (!rects) return;
          const b = text.getBBox();
          // Clear of the bubble and of the notes placed before this one.
          const others = this.marks.filter((m) => m.g !== g && m.g.classList.contains("mark-note")).map((m) => toRect(m.g.getBoundingClientRect()));
          const at = notePlacement(union(rects), { w: b.width, h: b.height }, view(), [...this.keepOut(), ...others]);
          // SVG text sits on its baseline; place its box, not its baseline, at the spot.
          text.setAttribute("x", String(at.x));
          text.setAttribute("y", String(at.y + b.height * 0.78));
        };
        break;
      }
      case "level": {
        const set = stroke();
        const label = mark.text || mark.price !== null ? note("note-text chart-label", 420) : null;
        if (label && !mark.text && mark.price != null) label.textContent = `$${mark.price}`;
        place = () => {
          const area = plot() ?? (target() ? union(target()!) : null);
          const y = yAt(mark.price) ?? (mark.points?.[0] ? fromShot(mark.points[0]).y : null);
          g.style.display = area && y !== null ? "" : "none";
          if (!area || y === null) return;
          set(polylinePath([{ x: area.x, y }, { x: area.x + area.w * 0.5, y: y + 0.6 }, { x: area.x + area.w, y }]));
          if (label) labelAt(label, area.x + area.w, y);
        };
        break;
      }
      case "zone": {
        const band = svgEl("rect", { class: "band" });
        const set = stroke();
        const label = mark.text ? note("note-text chart-label", 420) : null;
        g.prepend(band);
        place = () => {
          const area = plot();
          const y1 = yAt(mark.price);
          const y2 = yAt(mark.price2);
          const r = area && y1 !== null && y2 !== null ? { x: area.x, y: Math.min(y1, y2), w: area.w, h: Math.abs(y2 - y1) } : target() ? union(target()!) : null;
          g.style.display = r ? "" : "none";
          if (!r) return;
          for (const [k, v] of Object.entries({ x: r.x, y: r.y, width: r.w, height: Math.max(2, r.h) })) band.setAttribute(k, String(v));
          set(`${polylinePath([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }])} ${polylinePath([{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }])}`);
          if (label) labelAt(label, r.x + r.w, r.y);
        };
        break;
      }
      case "trend": {
        const set = stroke();
        const label = mark.text ? note("note-text chart-label", 520) : null;
        place = () => {
          const pts = mark.points?.map(fromShot);
          if (!pts || pts.length < 2) {
            g.style.display = "none";
            return;
          }
          const area = plot();
          const [a, b] = area ? extendAcross(pts[0]!, pts.at(-1)!, area) : [pts[0]!, pts.at(-1)!];
          set(polylinePath([a!, b!]));
          if (label) labelAt(label, b!.x, b!.y);
        };
        break;
      }
    }
    const live = { g, place };
    this.marks.push(live);
    place();
  }
}
