import { describe, expect, it } from "vitest";
import { clickRefusal, type ClickCandidate } from "../act";

const base: ClickCandidate = { tag: "button", role: null, type: "button", label: "Show more", href: null, download: false, inForm: false, editable: false };
const c = (over: Partial<ClickCandidate>): ClickCandidate => ({ ...base, ...over });

describe("clickRefusal", () => {
  it("lets through what moves around a page", () => {
    expect(clickRefusal(base)).toBeNull();
    expect(clickRefusal(c({ tag: "a", type: null, label: "Q3 earnings: what changed", href: "https://example.com/q3" }))).toBeNull();
    expect(clickRefusal(c({ tag: "div", role: "tab", type: null, label: "1Y" }))).toBeNull();
    expect(clickRefusal(c({ tag: "summary", type: null, label: "Read more" }))).toBeNull();
    expect(clickRefusal(c({ tag: "a", type: null, label: "", href: "https://example.com/story" }))).toBeNull();
  });

  it("refuses anything that could act for the user", () => {
    for (const label of ["Buy AAPL", "Place order", "Sell", "Sign in", "Log out", "Subscribe now", "Delete", "Confirm", "Follow", "Like", "Add to watchlist", "Connect wallet", "Accept all cookies", "Start free trial"]) {
      expect(clickRefusal(c({ label })), label).toBe("it could do something on your behalf.");
    }
  });

  it("refuses typing, submitting, downloading, frames and odd links", () => {
    expect(clickRefusal(c({ tag: "input", type: "text", label: "Search" }))).toBe("typing and filling in forms is up to you.");
    expect(clickRefusal(c({ tag: "div", editable: true, label: "Write a reply" }))).toBe("typing and filling in forms is up to you.");
    expect(clickRefusal(c({ type: null, inForm: true, label: "Go" }))).toBe("it would submit a form.");
    expect(clickRefusal(c({ tag: "input", type: "submit", inForm: true, label: "Go" }))).toBe("it would submit a form.");
    expect(clickRefusal(c({ tag: "a", type: null, label: "Annual report", href: "https://example.com/r.pdf", download: true }))).toBe("it would download a file.");
    expect(clickRefusal(c({ tag: "a", type: null, label: "Email us", href: "mailto:hi@example.com" }))).toBe("that link doesn't open a web page.");
    expect(clickRefusal(c({ tag: "iframe", type: null, label: "chart" }))).toBe("it's inside another site's frame.");
  });

  it("refuses a control it cannot read, but not a plain link", () => {
    expect(clickRefusal(c({ label: "" }))).toBe("I can't tell what it does.");
  });

  it("does not trip on words that merely contain a risky one", () => {
    expect(clickRefusal(c({ label: "Blocked shipments" }))).toBeNull();
    expect(clickRefusal(c({ label: "Buyback history" }))).toBeNull();
    expect(clickRefusal(c({ label: "Posted 3h ago" }))).toBeNull();
  });
});
