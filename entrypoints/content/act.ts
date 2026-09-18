/**
 * Scrolling and clicking for "show me". Every click is checked by `clickRefusal` (lib/act.ts) on the
 * real element first; a click is the sequence of pointer and mouse events a person's click makes,
 * then `click()`. After an action the page is given a moment to settle before Glance looks again.
 */
import { clickRefusal, type ClickCandidate } from "../../lib/act";
import { CONSOLE_URL } from "../../lib/config";

const CLICKABLE =
  "a[href],button,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],[role=radio],[role=treeitem],[aria-expanded],input[type=button],input[type=checkbox],input[type=radio],input[type=submit],input[type=image]";

const smooth = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** The control a click on `el` would really press: the nearest clickable ancestor, else the element. */
export function clickTarget(el: Element): HTMLElement | null {
  const hit = el.closest(CLICKABLE) ?? el;
  return hit instanceof HTMLElement ? hit : null;
}

export function labelOf(el: Element): string {
  const input = el instanceof HTMLInputElement ? el.value : "";
  return ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("title") || input || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function candidate(el: HTMLElement): ClickCandidate {
  const tag = el.tagName.toLowerCase();
  return {
    tag,
    role: el.getAttribute("role"),
    type: el.getAttribute("type")?.toLowerCase() ?? (tag === "input" ? "text" : null),
    label: labelOf(el),
    href: el instanceof HTMLAnchorElement && el.hasAttribute("href") ? el.href : null,
    download: el instanceof HTMLAnchorElement && el.hasAttribute("download"),
    inForm: !!el.closest("form"),
    editable: el.isContentEditable,
  };
}

/** Why Glance will not click `el` (the end of a spoken sentence), or null. */
export function refusal(el: HTMLElement): string | null {
  // Glance's own console is where money moves with the wallet; it is never driven by voice.
  if (location.origin === new URL(CONSOLE_URL).origin) return "that's your Glance account page.";
  return clickRefusal(candidate(el));
}

/** A link that opens a new tab: a script click without a fresh user gesture would be blocked as a popup. */
export function newTabHref(el: HTMLElement): string | null {
  const a = el.closest("a");
  return a && a.target === "_blank" && /^https?:/i.test(a.href) ? a.href : null;
}

/** Resolves once scrolling has stopped (scrollend, a quiet spell, or a cap). */
function scrollSettled(maxMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let quiet = 0;
    const done = () => {
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("scrollend", done, true);
      resolve();
    };
    const onScroll = () => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(done, 150);
    };
    const cap = window.setTimeout(done, maxMs);
    quiet = window.setTimeout(done, 250); // nothing moved at all
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("scrollend", done, { capture: true });
  });
}

export function inView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

export async function scrollToElement(el: Element): Promise<void> {
  el.scrollIntoView({ behavior: smooth(), block: "center", inline: "nearest" });
  await scrollSettled();
}

export async function scrollScreen(direction: "up" | "down" | "top" | "bottom"): Promise<void> {
  if (direction === "top") window.scrollTo({ top: 0, behavior: smooth() });
  else if (direction === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth() });
  else window.scrollBy({ top: (direction === "down" ? 1 : -1) * window.innerHeight * 0.8, behavior: smooth() });
  await scrollSettled();
}

/**
 * Press `el` the way a person would and wait for the page to react. Resolves true when something
 * changed (the DOM, the URL, or the scroll position), false when the page ignored the click.
 */
export async function clickLikeAPerson(el: HTMLElement): Promise<boolean> {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
  const url = location.href;
  const scrollY = window.scrollY;
  let mutated = false;
  const mo = new MutationObserver((records) => {
    if (records.some((rec) => !(rec.target instanceof Element && rec.target.closest("glance-bubble")))) mutated = true;
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  el.dispatchEvent(new PointerEvent("pointerdown", pointer));
  el.dispatchEvent(new MouseEvent("mousedown", at));
  el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", pointer));
  el.dispatchEvent(new MouseEvent("mouseup", at));
  el.click();
  // Give the page time to fetch and render what the click asked for; stop early once it goes quiet.
  await new Promise<void>((resolve) => {
    let quiet = window.setTimeout(finish, 900);
    const cap = window.setTimeout(finish, 3000);
    const watch = new MutationObserver(() => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(finish, 400);
    });
    watch.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    function finish() {
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      watch.disconnect();
      resolve();
    }
  });
  mo.disconnect();
  return mutated || location.href !== url || window.scrollY !== scrollY;
}
