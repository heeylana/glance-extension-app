/**
 * Passive underlining without touching the DOM (spec §7.3): the CSS Custom
 * Highlight API paints a dotted underline over Ranges, so React-driven pages
 * (X, YouTube) never see a mutated tree. Hover detection tests the pointer
 * against the highlighted ranges' client rects.
 */
import type { Matcher, Hit } from "./dictionary";
import type { DictionaryCompany } from "./api-types";

export interface Underline {
  range: Range;
  company: DictionaryCompany;
  hit: Hit;
}

const HIGHLIGHT_NAME = "glance-entity";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "GLANCE-BUBBLE"]);
const MAX_NODES = 6000;

export function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

export class Underliner {
  private underlines: Underline[] = [];
  private highlight: Highlight | null = null;
  private styleEl: HTMLStyleElement | null = null;

  constructor(private matcher: Matcher, private accent = "#5b8cff") {}

  install() {
    if (!highlightsSupported()) return;
    this.highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, this.highlight);
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(91,140,255,0.13);text-decoration:underline dotted ${this.accent};text-underline-offset:3px;text-decoration-thickness:1.5px}`;
    document.documentElement.appendChild(this.styleEl);
  }

  uninstall() {
    CSS.highlights?.delete(HIGHLIGHT_NAME);
    this.styleEl?.remove();
    this.underlines = [];
  }

  /** Rescan the document. Only names, aliases, tickers and cashtags are underlined; products/execs feed the bubble, not the page. */
  scan(root: Node = document.body): number {
    if (!this.highlight) return 0;
    this.highlight.clear();
    this.underlines = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || SKIP.has(p.tagName) || p.closest("[contenteditable='true'],glance-bubble")) return NodeFilter.FILTER_REJECT;
        if (!n.nodeValue || n.nodeValue.length < 3 || !/[A-Za-z$]/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let count = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) && count++ < MAX_NODES) {
      const text = node.nodeValue!;
      for (const h of this.matcher.hits(text)) {
        if (h.kind === "product" || h.kind === "exec") continue;
        // Bare ambiguous words ("apple", "meta") stay quiet unless they look like a company mention.
        if ((h.kind === "name" || h.kind === "alias") && /^[a-z]/.test(text.slice(h.start, h.start + 1)) && h.text.length <= 6) continue;
        const range = document.createRange();
        range.setStart(node, h.start);
        range.setEnd(node, h.end);
        this.highlight.add(range);
        this.underlines.push({ range, company: h.company, hit: h });
      }
    }
    return this.underlines.length;
  }

  get count() {
    return this.underlines.length;
  }

  /** Which underline (if any) is under the pointer. */
  at(x: number, y: number): Underline | null {
    for (const u of this.underlines) {
      for (const r of u.range.getClientRects()) {
        if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 4 && y <= r.bottom + 4) return u;
      }
    }
    return null;
  }

  /** Distinct companies currently underlined, for the idle pulse and the "multiple" chips. */
  companies(): DictionaryCompany[] {
    const seen = new Map<string, DictionaryCompany>();
    for (const u of this.underlines) seen.set(u.company.id, u.company);
    return [...seen.values()];
  }
}
