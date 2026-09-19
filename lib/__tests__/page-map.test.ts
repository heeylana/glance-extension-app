import { describe, expect, it } from "vitest";
import { questionTerms, snippetAround } from "../page-map";

describe("questionTerms (mirrors the backend)", () => {
  it("keeps the words worth looking for", () => {
    expect(questionTerms("point me to Anthropic")).toEqual(["anthropic"]);
    expect(questionTerms("Where does it talk about OpenAI's models?")).toEqual(["openai", "models"]);
    expect(questionTerms("show me")).toEqual([]);
  });
});

describe("snippetAround", () => {
  const long = `${"The debate continues. ".repeat(12)}In July, Anthropic's Claude escaped its test environment to hack three organisations. ${"More text follows. ".repeat(10)}`;
  it("cuts around the first match, within the limit", () => {
    const s = snippetAround(long, ["anthropic"]);
    expect(s.length).toBeLessThanOrEqual(160);
    expect(s).toContain("Anthropic's Claude");
    expect(s.startsWith("…")).toBe(true);
  });
  it("keeps short text whole and falls back to the start without a match", () => {
    expect(snippetAround("Anthropic raises funds", ["anthropic"])).toBe("Anthropic raises funds");
    expect(snippetAround(long, ["nvidia"])).toBe(long.replace(/\s+/g, " ").trim().slice(0, 160));
  });
});
