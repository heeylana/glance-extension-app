/**
 * Site adapters (spec §7.3): what to send the backend for X, YouTube, and a
 * generic article. Text is ~4k characters around the viewport; an article then adds the rest of
 * its text in reading order, up to 8k, so every company it names can be offered.
 */
import type { GlanceInput } from "./api-types";

export type Site = NonNullable<GlanceInput["site"]>;

export function detectSite(url = location.href): Site {
  const h = new URL(url).hostname.replace(/^www\./, "");
  if (h === "x.com" || h === "twitter.com" || h === "mobile.twitter.com") return "x";
  if (h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be") return "youtube";
  if (document.querySelector("article, [itemtype*='Article'], meta[property='article:published_time']")) return "article";
  return "generic";
}

const TEXT_CAP = 4000;
/** Articles: the viewport's text, then the rest of the article, up to what the backend reads (8,000). */
const ARTICLE_CAP = 8000;

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2 && r.width > 0 && r.height > 0;
}

/** Text of block elements intersecting (or near) the viewport, nearest first, capped. */
export function visibleText(root: ParentNode = document.body, cap = TEXT_CAP): string {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,p,li,blockquote,figcaption,[data-testid='tweetText'],yt-formatted-string,span[dir]"));
  const mid = window.innerHeight / 2;
  const scored = blocks
    .filter((el) => isVisible(el) && !el.closest("nav,footer,aside,[role='navigation'],[aria-hidden='true'],glance-bubble"))
    .map((el) => ({ el, d: Math.abs(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - mid) }))
    .sort((a, b) => a.d - b.d);
  const seen = new Set<string>();
  let out = "";
  for (const { el } of scored) {
    const t = clean(el.innerText);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    if (out.length + t.length + 1 > cap) break;
    out += (out ? "\n" : "") + t;
  }
  if (!out) out = clean(document.body.innerText).slice(0, cap);
  return out;
}

/**
 * The whole readable text of the page in document order, not just what is near the viewport: for
 * "remember this page", which should keep the article's facts wherever they sit, and for a glance at
 * an article, after the text near the viewport (`seed`), so a company named further down still counts.
 * The main article when there is one, capped.
 */
export function readableText(cap = 12_000, root: ParentNode = document.querySelector("article, main, [role='main']") ?? document.body, seed = ""): string {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,p,li,blockquote,figcaption,td,[data-testid='tweetText'],yt-formatted-string,span[dir]"));
  const seen = new Set<string>(seed ? seed.split("\n") : []);
  let out = seed;
  for (const el of blocks) {
    if (el.closest("nav,footer,aside,[role='navigation'],[aria-hidden='true'],glance-bubble")) continue;
    const t = clean(el.innerText);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    if (out.length + t.length + 1 > cap) break;
    out += (out ? "\n" : "") + t;
  }
  return out || clean(document.body.innerText).slice(0, cap);
}

function meta(name: string): string | undefined {
  const el = document.querySelector<HTMLMetaElement>(`meta[property='${name}'], meta[name='${name}'], meta[itemprop='${name}']`);
  return el?.content || undefined;
}

/** Status id in an X href or pathname (`/user/status/123` → "123"), or null. */
export function statusIdOf(href: string | null | undefined): string | null {
  const m = href?.match(/\/status\/(\d+)/);
  return m ? m[1]! : null;
}

/**
 * Which tweet a glance is about. On a status page it is the tweet the URL names, wherever it
 * has scrolled to; on a timeline it is the tweet whose centre is nearest the viewport centre.
 * Pure so it can be unit-tested; the DOM version below feeds it rects.
 */
export function pickFocalTweet<T extends { statusId: string | null; top: number; height: number; visible: boolean }>(
  tweets: T[],
  mid: number,
  pageStatusId: string | null,
): T | undefined {
  if (pageStatusId) {
    const focal = tweets.find((t) => t.statusId === pageStatusId);
    if (focal) return focal;
  }
  return tweets
    .filter((t) => t.visible)
    .sort((a, b) => Math.abs(a.top + a.height / 2 - mid) - Math.abs(b.top + b.height / 2 - mid))[0];
}

function xAdapter(): Partial<GlanceInput> {
  // Sorting by top edge alone picked the first reply on status pages: the focal tweet sits
  // just under the sticky header, so a reply's top edge is always nearer the viewport centre.
  const tweets = Array.from(document.querySelectorAll<HTMLElement>("article[data-testid='tweet']")).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, statusId: statusIdOf(el.querySelector<HTMLAnchorElement>("a[href*='/status/']")?.getAttribute("href")), top: r.top, height: r.height, visible: isVisible(el) };
  });
  const t = pickFocalTweet(tweets, window.innerHeight / 2, statusIdOf(location.pathname))?.el;
  if (!t) return {};
  const text = clean(t.querySelector<HTMLElement>("[data-testid='tweetText']")?.innerText);
  const time = t.querySelector<HTMLTimeElement>("time")?.dateTime;
  const link = t.querySelector<HTMLAnchorElement>("a[href*='/status/']")?.href;
  return { text, publishedAt: time, url: link ?? location.href, title: text.slice(0, 120) };
}

/** Rolling caption buffer for YouTube: keep ~90 seconds of caption segments. */
const captionBuf: { t: number; s: string }[] = [];
let captionObserver: MutationObserver | null = null;
function watchCaptions() {
  if (captionObserver) return;
  const push = () => {
    const seg = clean(Array.from(document.querySelectorAll(".ytp-caption-segment")).map((e) => e.textContent).join(" "));
    if (!seg) return;
    const last = captionBuf[captionBuf.length - 1];
    if (last?.s === seg) return;
    captionBuf.push({ t: Date.now(), s: seg });
    const cutoff = Date.now() - 90_000;
    while (captionBuf.length && captionBuf[0]!.t < cutoff) captionBuf.shift();
  };
  captionObserver = new MutationObserver(push);
  captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function youtubeAdapter(): Partial<GlanceInput> {
  watchCaptions();
  const title = clean(document.querySelector<HTMLElement>("h1.ytd-watch-metadata, h1.title, #title h1")?.innerText) || clean(document.title.replace(/ - YouTube$/, ""));
  const description = clean(document.querySelector<HTMLElement>("#description-inline-expander, #description")?.innerText).slice(0, 1500);
  const published = meta("datePublished") ?? meta("uploadDate") ?? undefined;
  const captions = captionBuf.map((c) => c.s).join(" ").slice(-2000) || undefined;
  return { title, text: [title, description].filter(Boolean).join("\n"), captions, publishedAt: published };
}

function articleAdapter(): Partial<GlanceInput> {
  const title = meta("og:title") ?? clean(document.querySelector("h1")?.textContent) ?? document.title;
  const published = meta("article:published_time") ?? meta("datePublished") ?? document.querySelector<HTMLTimeElement>("article time[datetime], time[datetime]")?.dateTime;
  const root = document.querySelector("article, main, [role='main']") ?? document.body;
  // What the reader is looking at first, then the rest of the article: a story about Google that names
  // Nvidia and OpenAI further down should offer them too.
  return { title, text: readableText(ARTICLE_CAP, root, visibleText(root)), publishedAt: published, url: document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href ?? location.href };
}

export function collectContext(): GlanceInput {
  const site = detectSite();
  const base: GlanceInput = { url: location.href, title: document.title, site, text: "" };
  const part = site === "x" ? xAdapter() : site === "youtube" ? youtubeAdapter() : articleAdapter();
  const merged = { ...base, ...part } as GlanceInput;
  if (!merged.text || merged.text.length < 20) merged.text = visibleText();
  merged.context = { url: merged.url, title: merged.title, site };
  return merged;
}

/** Prime site-specific observers early (YouTube captions) so the first glance has data. */
export function primeAdapters() {
  if (detectSite() === "youtube") watchCaptions();
}
