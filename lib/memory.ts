/**
 * "Remember this page": which saved pages to keep, and which to hand to "show me" on another page.
 * Pure, so it is tested; storage is lib/memory-store.ts. Notes live only in this browser.
 */
import type { ExplainMemory, PageNote } from "./api-types";

/** How many pages to keep, how long, and how many go with one question. */
export const MAX_NOTES = 30;
export const NOTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_PICKED = 3;

const age = (n: PageNote, now: number) => now - (Date.parse(n.savedAt) || 0);

/** Drop expired notes, keep one per URL (the newest), newest first, at most MAX_NOTES. */
export function prune(notes: PageNote[], now = Date.now()): PageNote[] {
  const seen = new Set<string>();
  return [...notes]
    .filter((n) => age(n, now) < NOTE_TTL_MS)
    .sort((a, b) => age(a, now) - age(b, now))
    .filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)))
    .slice(0, MAX_NOTES);
}

/** Add a note, replacing an older one of the same page. */
export function upsert(notes: PageNote[], note: PageNote, now = Date.now()): PageNote[] {
  return prune([note, ...notes.filter((n) => n.url !== note.url)], now);
}

/** Words in a question that point back at something read before ("the article I saved", "compare"). */
const BACK_REFERENCE = /\b(?:earlier|before|previous(?:ly)?|last (?:page|article|story|one|report)|other (?:page|article|tab|story)|saved|remember(?:ed)?|that (?:article|page|story|report|post|video|analyst|note)|compare|compared|same as|matches?|according to)\b/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The saved pages worth sending with a question on this page: those about a company on this page,
 * those about a company the question names, and, when the question points back ("the article I
 * saved"), the most recent ones. Never the page itself. Nothing when none of that holds, so an
 * ordinary question costs no extra tokens.
 */
export function pickNotes(notes: PageNote[], at: { url: string; companyIds: string[]; question: string }, now = Date.now(), max = MAX_PICKED): PageNote[] {
  const q = at.question.toLowerCase();
  const here = new Set(at.companyIds);
  const backRef = BACK_REFERENCE.test(q);
  const named = (c: PageNote["companies"][number]) =>
    new RegExp(`\\b${escapeRe(c.name.toLowerCase())}\\b`).test(q) || (c.ticker.length >= 2 && new RegExp(`\\b${escapeRe(c.ticker.toLowerCase())}\\b`).test(q));
  return prune(notes, now)
    .filter((n) => n.url !== at.url)
    .map((n) => ({
      n,
      score: (n.companies.some((c) => here.has(c.companyId)) ? 3 : 0) + (n.companies.some(named) ? 2 : 0) + (backRef ? 1 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || age(a.n, now) - age(b.n, now))
    .slice(0, max)
    .map((x) => x.n);
}

/** What "show me" is sent for a note: no ids or company lists, just the page and its facts. */
export function toExplainMemory(n: PageNote): ExplainMemory {
  return { title: n.title.slice(0, 300), url: n.url, savedAt: n.savedAt, publishedAt: n.publishedAt, summary: n.summary.slice(0, 400), facts: n.facts.slice(0, 10).map((f) => f.slice(0, 240)) };
}
