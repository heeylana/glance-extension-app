/**
 * The page as the explain model reads it: the visible elements, each with an id, a kind, its text and
 * its box in the screenshot's pixels. Ids live only in the `nodes` map (the page DOM is never
 * touched), so a mark anchored to "e12" can follow that element as the page scrolls.
 */
import type { ExplainElement } from "./api-types";

/** Screenshots wider than this are scaled down; the model reads coordinates best at around this size. */
export const MAP_MAX_WIDTH = 1280;
const MAX_ELEMENTS = 200;
/** Off-screen things worth scrolling to or opening: their boxes lie outside the screenshot. */
const MAX_OFFSCREEN = 60;
const LANDMARKS = "h1,h2,h3,h4,table,canvas,video,figure,[role=tab],[role=tablist],summary,[aria-expanded],button,a[href]";

const TEXT_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,blockquote,figcaption,caption,label,button,a,summary,[role=button],[role=link],[role=heading],[role=cell]";
const MEDIA_AND_CONTROLS = "img,svg,canvas,video,iframe,input,select,textarea,[role=img]";

export interface PageMap {
  elements: ExplainElement[];
  nodes: Map<string, Element>;
  /** Screenshot pixels per CSS pixel. */
  scale: number;
  size: { w: number; h: number };
  /** Scroll position when the map was taken: pixel marks are pinned to the page from here. */
  scroll: { x: number; y: number };
}

function kindOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  if (/^h[1-6]$/.test(tag) || role === "heading") return "heading";
  if (tag === "a" || role === "link") return "link";
  if (tag === "button" || tag === "summary" || role === "button") return "button";
  if (tag === "li") return "item";
  if (tag === "td" || tag === "th" || role === "cell") return "cell";
  if (tag === "input" || tag === "select" || tag === "textarea") return "input";
  if (tag === "img" || tag === "svg" || role === "img") return "image";
  if (tag === "canvas") return "canvas";
  if (tag === "video") return "video";
  if (tag === "iframe") return "frame";
  return "text";
}

function textOf(el: Element): string {
  if (el instanceof HTMLImageElement) return el.alt || el.title || "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value || el.placeholder || "";
  const label = el.getAttribute("aria-label");
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return (t || label || el.getAttribute("title") || "").slice(0, 160);
}

export function mapPage(): PageMap {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.min(1, MAP_MAX_WIDTH / vw);
  const found = new Map<Element, DOMRect>();

  const consider = (el: Element | null) => {
    if (!el || found.has(el) || el.closest("glance-bubble,script,style,noscript,template")) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return;
    found.set(el, r);
  };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.nodeValue ?? "").trim().length >= 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (parent) consider(parent.closest(TEXT_BLOCKS) ?? parent);
  }
  for (const el of document.querySelectorAll(MEDIA_AND_CONTROLS)) consider(el);

  const visible = [...found.entries()].sort(([, a], [, b]) => a.top - b.top || a.left - b.left).slice(0, MAX_ELEMENTS);

  // Beyond the viewport: headings, tables, charts and controls first, then links, nearest first.
  const rank = (el: Element) => (/^(H[1-4]|TABLE|CANVAS|VIDEO|FIGURE)$/.test(el.tagName) ? 0 : el.matches("[role=tab],[role=tablist],summary,[aria-expanded]") ? 1 : el.tagName === "BUTTON" ? 2 : 3);
  const offscreen: [Element, DOMRect][] = [];
  for (const el of document.querySelectorAll(LANDMARKS)) {
    if (found.has(el) || el.closest("glance-bubble,nav,footer,[aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || (r.bottom > 0 && r.top < vh)) continue;
    if (!textOf(el) && !/^(TABLE|CANVAS|VIDEO|FIGURE)$/.test(el.tagName)) continue;
    offscreen.push([el, r]);
  }
  const distance = (r: DOMRect) => (r.top >= vh ? r.top - vh : -r.bottom);
  offscreen.sort(([a, ra], [b, rb]) => rank(a) - rank(b) || distance(ra) - distance(rb));
  const ordered = [...visible, ...offscreen.slice(0, MAX_OFFSCREEN).sort(([, a], [, b]) => a.top - b.top)];
  const nodes = new Map<string, Element>();
  const elements = ordered.map(([el, r], i) => {
    const id = `e${i + 1}`;
    nodes.set(id, el);
    // On-screen boxes are clipped to the viewport; off-screen ones keep their real position (y < 0 or > height).
    const onScreen = r.bottom > 0 && r.top < vh;
    const x = Math.max(0, r.left);
    const y = onScreen ? Math.max(0, r.top) : r.top;
    const w = Math.min(vw, r.right) - x;
    const h = onScreen ? Math.min(vh, r.bottom) - y : r.height;
    const box: [number, number, number, number] = [Math.round(x * scale), Math.round(y * scale), Math.round(w * scale), Math.round(h * scale)];
    return { id, kind: kindOf(el), text: textOf(el), box };
  });
  return { elements, nodes, scale, size: { w: Math.round(vw * scale), h: Math.round(vh * scale) }, scroll: { x: window.scrollX, y: window.scrollY } };
}

/** The visible screenshot, scaled to the map's size so pixel marks and element boxes share one space. */
export async function shrinkScreenshot(dataUrl: string, size: { w: number; h: number }): Promise<string> {
  const comma = dataUrl.indexOf(",");
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(";")) }), { resizeWidth: size.w, resizeHeight: size.h, resizeQuality: "high" });
  const canvas = new OffscreenCanvas(size.w, size.h);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
