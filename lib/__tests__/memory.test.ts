import { describe, expect, it } from "vitest";
import type { PageNote } from "../api-types";
import { MAX_NOTES, NOTE_TTL_MS, pickNotes, prune, toExplainMemory, upsert } from "../memory";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const nvda = { companyId: "nvda", name: "Nvidia", ticker: "NVDA" };
const aapl = { companyId: "aapl", name: "Apple", ticker: "AAPL" };
const note = (id: string, over: Partial<PageNote> = {}): PageNote => ({
  id,
  url: `https://example.com/${id}`,
  title: `Page ${id}`,
  site: "article",
  publishedAt: null,
  savedAt: new Date(NOW - 60_000).toISOString(),
  summary: "A page.",
  facts: [],
  companies: [],
  ...over,
});
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("prune and upsert", () => {
  it("drops expired notes, keeps the newest first, one per page", () => {
    const old = note("old", { savedAt: new Date(NOW - NOTE_TTL_MS - 1).toISOString() });
    const a1 = note("a", { savedAt: hoursAgo(5) });
    const a2 = note("a2", { url: a1.url, savedAt: hoursAgo(1) });
    const b = note("b", { savedAt: hoursAgo(3) });
    expect(prune([old, a1, b, a2], NOW).map((n) => n.id)).toEqual(["a2", "b"]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: MAX_NOTES + 5 }, (_, i) => note(`n${i}`, { savedAt: hoursAgo(i + 1) }));
    expect(prune(many, NOW)).toHaveLength(MAX_NOTES);
  });
  it("replaces a page saved again", () => {
    const first = note("x", { savedAt: hoursAgo(2), summary: "old" });
    const again = note("y", { url: first.url, savedAt: hoursAgo(0), summary: "new" });
    expect(upsert([first], again, NOW).map((n) => n.summary)).toEqual(["new"]);
  });
});

describe("pickNotes", () => {
  const ubs = note("ubs", { companies: [nvda], savedAt: hoursAgo(2), facts: ["UBS: price target $250"] });
  const iphone = note("iphone", { companies: [aapl], savedAt: hoursAgo(1) });
  const macro = note("macro", { savedAt: hoursAgo(3) });
  const all = [ubs, iphone, macro];

  it("sends notes about a company on this page", () => {
    expect(pickNotes(all, { url: "https://chart/nvda", companyIds: ["nvda"], question: "where is support?" }, NOW).map((n) => n.id)).toEqual(["ubs"]);
  });
  it("sends notes about a company the question names", () => {
    expect(pickNotes(all, { url: "https://x", companyIds: [], question: "how does this compare with apple" }, NOW)[0]?.id).toBe("iphone");
  });
  it("falls back to the most recent when the question points back", () => {
    expect(pickNotes(all, { url: "https://x", companyIds: [], question: "draw the target from the article I saved" }, NOW).map((n) => n.id)).toEqual(["iphone", "ubs", "macro"]);
  });
  it("sends nothing for an ordinary question with no link to a saved page", () => {
    expect(pickNotes(all, { url: "https://x", companyIds: ["msft"], question: "what does this chart show?" }, NOW)).toEqual([]);
  });
  it("never sends the page itself", () => {
    expect(pickNotes(all, { url: ubs.url, companyIds: ["nvda"], question: "summarise this" }, NOW)).toEqual([]);
  });
  it("does not match a one-letter ticker inside words", () => {
    const ford = note("ford", { companies: [{ companyId: "f", name: "Ford", ticker: "F" }] });
    expect(pickNotes([ford], { url: "https://x", companyIds: [], question: "find the forecast" }, NOW)).toEqual([]);
  });
});

describe("toExplainMemory", () => {
  it("sends the page and its facts, nothing else", () => {
    expect(toExplainMemory(note("n", { facts: ["a", "b"], companies: [nvda] }))).toEqual({ title: "Page n", url: "https://example.com/n", savedAt: new Date(NOW - 60_000).toISOString(), publishedAt: null, summary: "A page.", facts: ["a", "b"] });
  });
});
