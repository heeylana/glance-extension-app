import { describe, expect, it } from "vitest";
import { Matcher, decide } from "../dictionary";
import type { DictionaryCompany } from "../api-types";

const companies: DictionaryCompany[] = [
  { id: "aapl", name: "Apple", ticker: "AAPL", aliases: ["apple inc"], products: ["iphone", "macbook"], execs: ["tim cook"], tokenized: true },
  { id: "nvo", name: "Novo Nordisk", ticker: "NVO", aliases: ["novo"], products: ["ozempic", "wegovy"], execs: [], tokenized: true },
  { id: "meta", name: "Meta", ticker: "META", aliases: ["facebook"], products: ["instagram"], execs: ["zuckerberg"], tokenized: true },
  { id: "tsla", name: "Tesla", ticker: "TSLA", aliases: [], products: ["cybertruck"], execs: ["elon musk"], tokenized: true },
  { id: "rivn", name: "Rivian", ticker: "RIVN", aliases: [], products: ["r1t"], execs: [], tokenized: false },
];
const m = new Matcher(companies);
const top = (s: string) => m.candidates(s)[0];

describe("extension matcher (mirrors backend scoring)", () => {
  it("iPhone review → Apple", () => {
    expect(top("Hands-on with the new iPhone camera")?.company.ticker).toBe("AAPL");
  });
  it("the Ozempic company → Novo Nordisk, disambiguate range", () => {
    const c = top("the Ozempic company just crushed earnings");
    expect(c?.company.ticker).toBe("NVO");
    expect(decide(m.candidates("the Ozempic company just crushed earnings")).kind).toBe("disambiguate");
  });
  it("possessive: Apple's iPhone counts name + product", () => {
    const c = top("Tim Cook says Apple's iPhone demand is fine");
    expect(c?.company.ticker).toBe("AAPL");
    expect(c!.confidence).toBeGreaterThan(0.95);
  });
  it("cashtag near-certain; bare META alone weak", () => {
    expect(top("$META rips after hours")!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(top("META analysis meeting")!.confidence).toBeLessThan(0.5);
  });
  it("fruit stays quiet", () => {
    expect(top("I ate an apple")!.confidence).toBeLessThan(0.8);
  });
  it("hits carry offsets into the original text", () => {
    const hits = m.hits("Buy Tesla now");
    const t = hits.find((h) => h.company.ticker === "TSLA")!;
    expect("Buy Tesla now".slice(t.start, t.end)).toBe("Tesla");
  });
  it("no false hits inside words", () => {
    expect(m.hits("pineapple metadata").filter((h) => h.kind !== "product")).toHaveLength(0);
  });
  it("multiple strong companies → multiple", () => {
    expect(decide(m.candidates("Apple Inc and Tesla both fell after Elon Musk spoke")).kind).toBe("multiple");
  });
});

describe("extension matcher: dominance and ambiguity (mirrors the backend rules)", () => {
  const withCircle = new Matcher([
    ...companies,
    { id: "crcl", name: "Circle", ticker: "CRCL", aliases: ["circle internet"], products: ["usdc", "arc"], execs: [], tokenized: true },
    { id: "googl", name: "Alphabet", ticker: "GOOGL", aliases: ["google"], products: ["waymo"], execs: [], tokenized: true },
  ]);
  it("a company alone in the title beats a strong passing mention", () => {
    const title = "Tesla's stock drops 6% as Cybertruck update underwhelms";
    const text = `${title}\nTesla shares fell. Analysts compared it with Alphabet's Waymo, which already runs in five cities. Elon Musk disagreed.`;
    const v = decide(withCircle.candidates(text, 5, { titleLength: title.length }));
    expect(v.kind).toBe("confident");
    expect(v.kind === "confident" && v.top.company.ticker).toBe("TSLA");
  });
  it("named three times as often wins without a title", () => {
    const v = decide(withCircle.candidates("Tesla said the Cybertruck recall is voluntary. Tesla added that Tesla service centres will call owners, and Tesla's app will show the status; Google was not affected."));
    expect(v.kind).toBe("confident");
    expect(v.kind === "confident" && v.top.company.ticker).toBe("TSLA");
  });
  it("a weak product never corroborates an ambiguous name (geometry is not Circle Internet)", () => {
    const c = withCircle.candidates("A circle is a shape. The arc of a circle is part of its circumference; every circle has an arc.").find((x) => x.company.ticker === "CRCL");
    expect(c?.confidence ?? 0).toBeLessThan(0.8);
  });
  it("a capitalised ambiguous name alone is a question, not a buy card", () => {
    const v = decide(m.candidates("Meta will change how its apps work for teens. Meta said the rollout starts next month."));
    expect(v.kind).toBe("disambiguate");
    expect(v.kind === "disambiguate" && v.candidates[0]!.company.ticker).toBe("META");
  });
  it("lower-case 'apple' with only finance words stays below confident", () => {
    expect(top("apple shares getting hammered premarket after that guidance cut")!.confidence).toBeLessThan(0.8);
  });
});

describe("extension matcher: another outlet's name is not the company (mirrors the backend)", () => {
  const news: DictionaryCompany = { id: "nws", name: "News", ticker: "NWS", aliases: ["news corp"], products: [], execs: ["rupert murdoch"], tokenized: true, ambiguousName: true };
  const mm = new Matcher([...companies, news]);
  it("CBS News is not News Corp, even in a finance story", () => {
    const c = mm.candidates("Nvidia's CEO told CBS News that shares would rally").find((x) => x.company.id === "nws");
    expect(c === undefined || c.confidence < 0.8).toBe(true);
  });
  it("still News Corp with other evidence", () => {
    expect(mm.candidates("Rupert Murdoch's News said earnings rose").find((x) => x.company.id === "nws")!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
