/**
 * What Glance may click when it acts on a page for "show me" (entrypoints/content/act.ts does the
 * clicking). The model is told the same rules; this check is the one that counts, because it runs on
 * the real element. It lets through what moves around a page (links, tabs, "show more", expanders)
 * and refuses anything that could spend, submit, sign in, post, delete or download on the user's
 * behalf, anything to type into, and controls whose purpose it cannot read.
 */
export interface ClickCandidate {
  tag: string;
  role: string | null;
  /** The `type` attribute of a button or input. */
  type: string | null;
  /** What a person would read: visible text, aria-label, title, or an input's value. */
  label: string;
  /** Absolute href of a link, if any. */
  href: string | null;
  download: boolean;
  inForm: boolean;
  editable: boolean;
}

const RISKY =
  /\b(?:buy|sell|trade|swap|orders?|pay(?:ment)?|checkout|check out|purchase|subscribe|donate|tip|transfer|send|withdraw|deposit|confirm|submit|delete|remove|erase|sign ?(?:in|out|up)|log ?(?:in|out)|register|install|download|allow|accept|agree|approve|authori[sz]e|connect|unsubscribe|cancel|place|bid|book|reserve|apply|save|publish|post|report|block|mute|follow|like|share|reply|repost|retweet|add to (?:cart|bag|basket|watchlist)|enrol+|claim|redeem|verify|reset|upgrade|trial|start)\b/i;

const NAVIGATING_ROLES = new Set(["link", "tab", "menuitem", "option", "treeitem"]);

/** Why Glance will not click this, as the end of a spoken sentence; null when the click is fine. */
export function clickRefusal(c: ClickCandidate): string | null {
  if ((c.tag === "input" && (c.type === "submit" || c.type === "image")) || (c.inForm && c.tag === "button" && (c.type ?? "submit") === "submit")) {
    return "it would submit a form.";
  }
  if (c.editable || c.tag === "textarea" || c.tag === "select" || (c.tag === "input" && !["button", "checkbox", "radio"].includes(c.type ?? "text"))) {
    return "typing and filling in forms is up to you.";
  }
  if (c.tag === "iframe" || c.tag === "object" || c.tag === "embed") return "it's inside another site's frame.";
  if (c.download) return "it would download a file.";
  if (c.href !== null && !/^https?:/i.test(c.href)) return "that link doesn't open a web page.";
  if (RISKY.test(c.label)) return "it could do something on your behalf.";
  const isLink = c.tag === "a" || (c.role !== null && NAVIGATING_ROLES.has(c.role));
  if (!c.label.trim() && !isLink) return "I can't tell what it does.";
  return null;
}
