/**
 * Local dictionary matcher for passive mode (spec §7.3). Same scoring rules as
 * glance-backend/src/resolver/match.ts so the bubble's first guess agrees with
 * the backend; change both. No network: the dictionary is fetched once by the
 * background worker and cached in extension storage.
 */
import type { DictionaryCompany } from "./api-types";

export type Kind = "cashtag" | "ticker" | "name" | "alias" | "product" | "exec";

export interface Hit {
  company: DictionaryCompany;
  kind: Kind;
  text: string;
  /** offsets in the ORIGINAL text */
  start: number;
  end: number;
}

export interface Candidate {
  company: DictionaryCompany;
  confidence: number;
  kinds: Kind[];
  hits: Hit[];
  /** Total hits: a company named ten times outranks one named once. */
  mentions: number;
  /** Some hit sits inside the title prefix (needs `titleLength`). */
  inTitle: boolean;
}

const WEIGHTS: Record<Kind, number> = { cashtag: 0.95, name: 0.9, alias: 0.85, ticker: 0.6, product: 0.55, exec: 0.6 };
const AMBIGUOUS_TICKERS = new Set(["META", "SNAP", "COIN", "APP", "MA", "V", "F", "GM", "BA", "COST", "DIS", "SPOT", "HOOD", "NKE", "HIMS", "MARA", "GOLD"]);
const AMBIGUOUS_NAMES = new Set(["apple", "meta", "snap", "strategy", "circle", "gold", "oracle", "uber", "target", "visa", "nike", "ford", "shop"]);
/** Products that are also ordinary words: enough to ask, never enough to corroborate an ambiguous name. */
const WEAK_PRODUCTS = new Set([
  "arc", "cruise", "quest", "threads", "llama", "windows", "teams", "surface", "copilot", "slack", "java", "hopper", "rubin",
  "instinct", "foundry", "gotham", "axon", "falcon", "gaudi", "n2", "n3", "18a", "oci", "aip", "high na", "spectacles",
  "mustang", "bronco", "tensor", "r2", "r3", "optimus", "twitch", "kindle",
]);
/** Index funds are named in passing on most finance pages; they count only when the page is about them. */
const INCIDENTAL_IDS = new Set(["spy", "qqq", "gld", "tlt"]);
const WEAK_PRODUCT_WEIGHT = 0.5;
const FINANCE_CONTEXT =
  /(?<![a-z])(shares?|stocks?|earnings|revenue|ceo|cfo|quarter|q[1-4]|guidance|nasdaq|nyse|market cap|ipo|analysts?|price target|upgrade|downgrade|dividend|buyback|valuation|investors?|profit|margins?|rally|sell ?off|premarket|after hours|wall street)(?![a-z])/i;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Term {
  company: DictionaryCompany;
  kind: Kind;
  re: RegExp;
  text: string;
  /** The term's first word: a page without it cannot match, so its regex is skipped. */
  first: string;
}

export class Matcher {
  private terms: Term[] = [];
  private tickers: { company: DictionaryCompany; cash: RegExp; bare: RegExp | null }[] = [];
  constructor(public readonly companies: DictionaryCompany[]) {
    for (const c of companies) {
      const add = (kind: Kind, term: string) => {
        const t = term.trim();
        if (t.length < 2) return;
        // Match on original text, case-insensitively, tolerating possessives and apostrophes.
        const pattern = escapeRe(t).replace(/\\ /g, "[\\s\\-]+");
        const first = t.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? "";
        this.terms.push({ company: c, kind, text: t.toLowerCase(), first, re: new RegExp(`(?<![A-Za-z0-9])${pattern}(?:['’]s)?(?![A-Za-z0-9])`, "gi") });
      };
      add("name", c.name);
      c.aliases.forEach((a) => add("alias", a));
      c.products.forEach((p) => add("product", p));
      c.execs.forEach((e) => add("exec", e));
      const sym = escapeRe(c.ticker);
      this.tickers.push({
        company: c,
        cash: new RegExp(`\\$${sym}(?![A-Za-z0-9])`, "g"),
        bare: c.ticker.length >= 3 ? new RegExp(`(?<![A-Za-z0-9$])${sym}(?![A-Za-z0-9])`, "g") : null,
      });
    }
  }

  /** All hits with offsets; used for underlining and for scoring. */
  hits(text: string): Hit[] {
    const out: Hit[] = [];
    // ~930 companies are ~4,000 regexes; the words actually on the page decide which of them can match,
    // so a long feed costs its own length, not the dictionary's.
    const words = new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const capitals = new Set((text.match(/[A-Z][A-Z0-9.]*/g) ?? []).map((w) => w.replace(/\.+$/, "")));
    for (const t of this.terms) {
      if (t.first && !words.has(t.first)) continue;
      t.re.lastIndex = 0;
      for (let n = 0; n < 50; n++) {
        const m = t.re.exec(text);
        if (!m) break;
        out.push({ company: t.company, kind: t.kind, text: t.text, start: m.index, end: m.index + m[0].length });
      }
    }
    for (const t of this.tickers) {
      if (!capitals.has(t.company.ticker)) continue;
      t.cash.lastIndex = 0;
      let any = false;
      for (;;) {
        const m = t.cash.exec(text);
        if (!m) break;
        any = true;
        out.push({ company: t.company, kind: "cashtag", text: m[0], start: m.index, end: m.index + m[0].length });
      }
      if (!any && t.bare) {
        t.bare.lastIndex = 0;
        for (;;) {
          const m = t.bare.exec(text);
          if (!m) break;
          const word = m[0].toLowerCase();
          const sameAsName = t.company.name.toLowerCase() === word || t.company.aliases.some((a) => a.toLowerCase() === word);
          if (sameAsName) continue;
          out.push({ company: t.company, kind: "ticker", text: m[0], start: m.index, end: m.index + m[0].length });
        }
      }
    }
    return out;
  }

  /** @param opts.titleLength length of the title prefix of `text`, when the caller joined the title first. */
  candidates(text: string, max = 5, opts: { titleLength?: number } = {}): Candidate[] {
    const hits = this.hits(text);
    const finance = FINANCE_CONTEXT.test(text);
    const titleLength = opts.titleLength ?? 0;
    const byId = new Map<string, Candidate>();
    for (const h of hits) {
      const c = byId.get(h.company.id) ?? { company: h.company, confidence: 0, kinds: [], hits: [], mentions: 0, inTitle: false };
      c.hits.push(h);
      c.mentions++;
      c.inTitle ||= h.start < titleLength;
      if (!c.kinds.includes(h.kind)) c.kinds.push(h.kind);
      byId.set(h.company.id, c);
    }
    const out = [...byId.values()].map((c) => ({ ...c, confidence: score(c, finance, text) }));
    out.sort((a, b) => b.confidence - a.confidence || a.hits[0]!.start - b.hits[0]!.start);
    return out.slice(0, max);
  }
}

const isWeakProduct = (h: Hit) => h.kind === "product" && WEAK_PRODUCTS.has(h.text);

/** "Apple" → proper, "APPLE" → caps, "apple" → common. */
export function wordCase(word: string): "proper" | "caps" | "common" {
  const first = word[0] ?? "";
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return "common";
  const rest = word.slice(1).replace(/[^A-Za-z]/g, "");
  return rest.length > 0 && rest === rest.toUpperCase() ? "caps" : "proper";
}

function score(c: Candidate, finance: boolean, text: string): number {
  const kinds = new Map<Kind, number>();
  const strongKinds = new Set(c.hits.filter((h) => !isWeakProduct(h)).map((h) => h.kind));
  const corroborated = strongKinds.size >= 2 || finance;
  // "Apple" mid-sentence is the company; "an apple a day" is fruit; "META analysis" in caps says nothing
  // either way. Majority case over this company's ambiguous-name hits.
  const ambiguousName = (h: Hit) => AMBIGUOUS_NAMES.has(h.text) || (!!c.company.ambiguousName && h.text === c.company.name.toLowerCase());
  const nameHits = c.hits.filter((h) => (h.kind === "name" || h.kind === "alias") && ambiguousName(h));
  const cases = nameHits.map((h) => wordCase(text.slice(h.start, h.end)));
  const n = (k: string) => cases.filter((x) => x === k).length;
  const cs = cases.length === 0 ? "absent" : n("common") > n("proper") + n("caps") ? "common" : n("proper") >= n("caps") ? "proper" : "caps";
  for (const h of c.hits) {
    let w = WEIGHTS[h.kind];
    if (isWeakProduct(h)) w = WEAK_PRODUCT_WEIGHT;
    if (h.kind === "ticker" && (AMBIGUOUS_TICKERS.has(h.text) || c.company.ambiguousTicker)) w = corroborated ? 0.6 : 0.35;
    if ((h.kind === "name" || h.kind === "alias") && ambiguousName(h)) {
      if (strongKinds.size >= 2) w = 0.9;
      else if (cs === "proper") w = finance ? 0.9 : 0.75;
      else if (cs === "caps") w = finance ? 0.9 : 0.45;
      else w = finance ? 0.6 : 0.45;
    }
    if ((h.kind === "name" || h.kind === "alias") && INCIDENTAL_IDS.has(c.company.id) && !c.inTitle && c.mentions < 3) w = 0.6;
    kinds.set(h.kind, Math.max(kinds.get(h.kind) ?? 0, w));
  }
  let notP = 1;
  for (const w of kinds.values()) notP *= 1 - w;
  return Math.min(0.98, Math.round((1 - notP) * 1000) / 1000);
}

export type Verdict =
  | { kind: "confident"; top: Candidate }
  | { kind: "multiple"; candidates: Candidate[] }
  | { kind: "disambiguate"; candidates: Candidate[] }
  | { kind: "ask_user"; candidates: Candidate[] }
  | { kind: "none" };

/** Among several strong candidates: alone in the title, or named ≥ 3 times and ≥ 3× any other. */
function dominant(strong: Candidate[]): Candidate | undefined {
  const titled = strong.filter((c) => c.inTitle);
  if (titled.length === 1) return titled[0];
  if (titled.length > 1) return undefined;
  const [a, b] = [...strong].sort((x, y) => y.mentions - x.mentions);
  if (a && b && a.mentions >= 3 && a.mentions >= 3 * b.mentions) return a;
  return undefined;
}

export function decide(cands: Candidate[]): Verdict {
  if (cands.length === 0) return { kind: "none" };
  const strong = cands.filter((c) => c.confidence >= 0.8);
  if (strong.length > 1) {
    const primary = dominant(strong);
    return primary ? { kind: "confident", top: primary } : { kind: "multiple", candidates: strong };
  }
  const top = cands[0]!;
  if (top.confidence >= 0.8) return { kind: "confident", top };
  if (top.confidence >= 0.5) return { kind: "disambiguate", candidates: cands.slice(0, 3) };
  return { kind: "ask_user", candidates: cands.slice(0, 3) };
}
