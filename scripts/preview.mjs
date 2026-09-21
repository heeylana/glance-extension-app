import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
/**
 * Screenshot the built extension without loading it into Chrome (Google Chrome no longer honours
 * --load-extension). Serves dist/chrome-mv3, shims the extension APIs so the side panel and the
 * content script talk to the real backend with a dev session, and photographs every screen.
 *
 *   pnpm build && pnpm preview <owner pubkey>      # backend must run with DEV_LOGIN=1
 *
 * Output: scripts/out/*.png. The bubble is exercised on scripts/preview/article.html.
 */
import { mkdirSync } from "node:fs";
const ROOT = new URL("../", import.meta.url).pathname;
const DIST = ROOT + "dist/chrome-mv3";
const PREVIEW = new URL("./preview/", import.meta.url).pathname;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BACKEND = process.env.WXT_BACKEND_URL ?? "http://localhost:8787";
const OWNER = process.argv[2] ?? "11111111111111111111111111111111";
const CHROME_BIN = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTTP = 8090, CDP = 9340;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = url.pathname.startsWith("/preview/") ? join(PREVIEW, url.pathname.slice(9)) : join(DIST, url.pathname === "/" ? "/sidepanel.html" : url.pathname);
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
  res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(HTTP, r));
const token = (await (await fetch(`${BACKEND}/auth/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: OWNER }) })).json()).token;

const shim = (signedIn) => `(() => {
  const BACKEND = ${JSON.stringify(BACKEND)}; const TOKEN = ${signedIn ? JSON.stringify(token) : "null"};
  const storage = { local: ${signedIn ? `{ "glance:session": ${JSON.stringify(token)}, "glance:onboarding": { done: true, step: "tryit" } }` : "{}"}, session: {} };
  const api = async (method, path, body) => { const r = await fetch(BACKEND + path, { method, headers: { "content-type": "application/json", ...(TOKEN ? { authorization: "Bearer " + TOKEN } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
  const handle = async (m) => { switch (m.type) {
    case "dictionary": return api("GET", "/dictionary");
    case "glance": return api("POST", "/glance", m.input);
    case "prices": return api("GET", "/prices?tickers=" + m.tickers.join(","));
    case "counter-view": return api("POST", "/counter-view", { ticker: m.ticker });
    case "why": return api("POST", "/why", { ticker: m.ticker });
    case "company": return api("POST", "/company", { companyId: m.companyId, ticker: m.ticker });
    case "company-history": return api("POST", "/company/history", { mint: m.mint });
    case "advice": return api("POST", "/advice", { companyId: m.companyId, ticker: m.ticker });
    case "auth-status": return { signedIn: !!TOKEN };
    case "tts": return { ok: false, code: "TTS_UNAVAILABLE", message: "preview" };
    case "buy": return { ok: false, code: "PREVIEW", message: "Preview only. Nothing was spent." };
    case "watch": return { ok: true, message: "Added to Waiting." };
    default: return { ok: true }; } };
  const area = (a) => ({ get: async (k) => { const keys = Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(k ?? storage[a]); const o = {}; for (const key of keys) if (key in storage[a]) o[key] = storage[a][key]; return o; }, set: async (o) => { Object.assign(storage[a], o); }, remove: async (k) => { delete storage[a][k]; } });
  window.chrome = { runtime: { id: "preview", sendMessage: (m, cb) => { const p = handle(m); if (typeof cb === "function") p.then(cb); return p; }, getURL: (p) => location.origin + p, onMessage: { addListener() {}, removeListener() {} }, onInstalled: { addListener() {} } },
    storage: { local: area("local"), session: area("session"), onChanged: { addListener() {}, removeListener() {} } }, tabs: { create: async () => ({}), query: async () => [] }, sidePanel: { open: async () => {} } };
})();`;

const chrome = spawn(CHROME_BIN, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "glance-prev-"))}`, "--window-size=1280,900", "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let wsUrl; for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } }
const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else if (m.method === "Runtime.exceptionThrown") logs.push(m.params.exceptionDetails?.exception?.description?.slice(0, 160)); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
async function open(url, width, height, signedIn) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: shim(signedIn) }, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}
const evaluate = async (sessionId, expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
const shot = async (sessionId, name, clip) => { const s = await send("Page.captureScreenshot", { format: "png", clip: { scale: 1, ...clip } }, sessionId); writeFileSync(join(OUT, name), Buffer.from(s.data, "base64")); console.log("wrote", name); };

// Side panel, signed out.
{ const p = await open(`http://localhost:${HTTP}/sidepanel.html`, 404, 720, false); await sleep(2000); await shot(p.sessionId, "panel-signin.png", { x: 0, y: 0, width: 404, height: 720 }); await send("Target.closeTarget", { targetId: p.targetId }); }
// Side panel, signed in: each tab (waits for the chain read on Portfolio).
{ const p = await open(`http://localhost:${HTTP}/sidepanel.html`, 404, 720, true);
  for (let i = 0; i < 20; i++) { await sleep(1000); if (!(await evaluate(p.sessionId, "!!document.querySelector('main [aria-busy]')"))) break; }
  await shot(p.sessionId, "panel-portfolio.png", { x: 0, y: 0, width: 404, height: 720 });
  for (const [i, name] of [[2, "headlines"], [3, "waiting"], [4, "settings"]]) {
    await evaluate(p.sessionId, `document.querySelector('nav button:nth-child(${i})').click()`); await sleep(1800);
    if (name === "settings") { await evaluate(p.sessionId, `[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Advanced'))?.click()`); await sleep(1500); await evaluate(p.sessionId, "document.querySelector('main').scrollTop = 0"); }
    await shot(p.sessionId, `panel-${name}.png`, { x: 0, y: 0, width: 404, height: 720 });
    if (name === "settings") { await evaluate(p.sessionId, "document.querySelector('main').scrollTop = 520"); await sleep(300); await shot(p.sessionId, "panel-settings-2.png", { x: 0, y: 0, width: 404, height: 720 }); }
  }
  await send("Target.closeTarget", { targetId: p.targetId }); }
// The bubble on the sample article: orb + underlines, hover card, ⌥G, then the first chip's buy card.
{ const p = await open(`http://localhost:${HTTP}/preview/article.html`, 1180, 780, true); await sleep(4500);
  console.log("bubble mounted:", await evaluate(p.sessionId, "!!document.querySelector('glance-bubble')"), "| underlines:", await evaluate(p.sessionId, "CSS.highlights?.get('glance-entity')?.size ?? 0"));
  await shot(p.sessionId, "page-orb.png", { x: 0, y: 0, width: 1180, height: 780 });
  const rect = await evaluate(p.sessionId, `(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.data.indexOf('Nvidia'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } return null; })()`);
  if (rect) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y }, p.sessionId); await sleep(1500); await shot(p.sessionId, "page-mini.png", { x: Math.max(0, rect.x - 120), y: Math.max(0, rect.y - 40), width: 420, height: 130 }); }
  await evaluate(p.sessionId, "window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyG', key: 'g', bubbles: true }))"); await sleep(6000);
  await shot(p.sessionId, "page-card.png", { x: 700, y: 300, width: 480, height: 480 });
  await evaluate(p.sessionId, "document.querySelector('glance-bubble').shadowRoot.querySelector('.chips .chip')?.click()"); await sleep(7000);
  console.log("card:", JSON.stringify(await evaluate(p.sessionId, "document.querySelector('glance-bubble')?.shadowRoot?.querySelector('.card')?.innerText ?? '(no card)'")).slice(0, 160));
  await shot(p.sessionId, "page-buycard.png", { x: 700, y: 260, width: 480, height: 520 });
  // The hotkey hint beside the orb (bubble.css .tip), shown by hovering it with the card closed.
  await evaluate(p.sessionId, "document.querySelector('glance-bubble').shadowRoot.querySelector('.close')?.click()"); await sleep(600);
  await evaluate(p.sessionId, "document.querySelector('glance-bubble').shadowRoot.querySelector('.avatar').dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))"); await sleep(600);
  await shot(p.sessionId, "page-hotkeys.png", { x: 700, y: 620, width: 480, height: 160 });
  // A read: what Glance makes of the company, both sides, with its disclaimer.
  const read = await evaluate(p.sessionId, `(async () => {
    const b = document.querySelector('glance-bubble');
    const r = await chrome.runtime.sendMessage({ type: 'advice', ticker: 'AAPL' });
    if (!r?.ok) return 'advice failed: ' + JSON.stringify(r).slice(0, 120);
    const inst = window.__glanceBubble;
    return r.lines.length + ' lines';
  })()`);
  console.log("advice:", read);
  await send("Target.closeTarget", { targetId: p.targetId }); }
if (logs.length) console.log("page exceptions:", logs.slice(0, 5));
ws.close(); chrome.kill(); server.close();
