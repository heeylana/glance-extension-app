/**
 * The bubble (spec §7.4): a small avatar bottom-right, draggable, remembers
 * its position per site. States: idle → listening → thinking → showing →
 * confirming → done. Plain DOM inside a shadow root; no framework.
 *
 * Look: the avatar is a thinking orb (breathing at rest, a different motion
 * for each kind of work), both the orb and the card are liquid glass, and the
 * card's border carries a beam while Glance is working.
 */
import type { EntityListing, GlanceResult, GlanceEntity, BuyResult, ApiError, WhyResult, CounterViewResult, Holding, VoiceCompany, VoiceContext, VoiceView } from "../../lib/api-types";
import { AMOUNT_CHIPS } from "../../lib/config";
import { usd } from "../../lib/format";
import { browser } from "wxt/browser";
import { Orb, type OrbState } from "./orb";
import { liquidGlass } from "./glass";
import { BEAM_PROPERTIES } from "./beam.generated";

/** `@property` rules inside a shadow root are ignored, and without them the beam jumps instead of turning. Once per page. */
function registerBeamProperties() {
  for (const p of BEAM_PROPERTIES) {
    try {
      CSS.registerProperty({ name: p.name, syntax: p.syntax, initialValue: p.initialValue, inherits: p.inherits });
    } catch {
      /* already registered by an earlier mount */
    }
  }
}

/** Bundled fonts, registered on the shadow root (a shadow stylesheet cannot use the extension-id placeholder). */
function fontFaces(): string {
  const getURL = browser.runtime.getURL as unknown as (path: string) => string; // public/ paths are typed only after `wxt prepare`
  const u = (f: string) => getURL(`/fonts/${f}`);
  return `@font-face{font-family:"Space Grotesk";font-weight:300 700;font-display:swap;src:url("${u("SpaceGrotesk-300_700.woff2")}") format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-weight:400;font-display:swap;src:url("${u("IBMPlexMono-400.woff2")}") format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-weight:500;font-display:swap;src:url("${u("IBMPlexMono-500.woff2")}") format("woff2")}
@font-face{font-family:"IBM Plex Mono";font-weight:600;font-display:swap;src:url("${u("IBMPlexMono-600.woff2")}") format("woff2")}
@font-face{font-family:"Caveat";font-weight:500 700;font-display:swap;src:url("${u("Caveat-500_700.woff2")}") format("woff2")}`;
}

export type BubbleState = "idle" | "listening" | "thinking" | "showing" | "confirming" | "done" | "error";

export interface BubbleHandlers {
  onGlance: () => void;
  onBuy: (entity: GlanceEntity, usdAmount: number) => Promise<BuyResult | ApiError>;
  onWhy: (entity: GlanceEntity) => Promise<WhyResult | ApiError>;
  /** Spec §7.5 counter-view: the bear case under the amount. Optional so tests and older hosts can omit it. */
  onCounterView?: (entity: GlanceEntity) => Promise<CounterViewResult | ApiError>;
  onWatch: (entity: GlanceEntity) => Promise<{ ok: true; message: string } | ApiError>;
  onOpenPanel: () => void;
  onPick?: (entity: GlanceEntity) => void;
  speak: (text: string) => void;
  /** Push-to-talk on the orb (spec §7.4): press and hold to talk. False when talking is off, so the press stays a click. */
  onListenStart?: () => boolean;
  onListenStop?: () => void;
  /** "Show me": the explanation card went away (closed or replaced), so its drawings and narration should too. */
  onExplainEnd?: () => void;
  onClearSketch?: () => void;
  /** Sell from a position: dollars, or every share. */
  onSell?: (holding: Holding, amount: { usd: number } | { all: true }) => Promise<BuyResult | ApiError>;
  /** "Remember this page" for questions on other pages; true once it is saved. */
  onRemember?: () => Promise<boolean>;
}

/** How long the orb must be held before it listens instead of glancing. */
const HOLD_MS = 350;

const POS_KEY = () => `glance:bubble-pos:${location.hostname}`;
const CV_DISMISS_KEY = (ticker: string) => `glance:counter-view-dismissed:${ticker}`;
const CV_DISMISS_MS = 24 * 60 * 60 * 1000;

function counterViewDismissed(ticker: string): boolean {
  try {
    const at = Number(localStorage.getItem(CV_DISMISS_KEY(ticker)) ?? 0);
    return at > 0 && Date.now() - at < CV_DISMISS_MS;
  } catch {
    return false;
  }
}

export class Bubble {
  private root: HTMLDivElement;
  private avatar: HTMLButtonElement;
  /** Glass and beam around the card; the card itself is re-rendered with innerHTML. */
  private panel: HTMLDivElement;
  private card: HTMLDivElement;
  private orb: Orb;
  /** Work that runs while a card stays up ("Why did it move?", "Tell me when"). */
  private busy: OrbState | null = null;
  /** What kind of thinking: reading the page, or making sense of what was said. */
  private thinkingAs: OrbState = "searching";
  private speaking = false;
  private state: BubbleState = "idle";
  private result: GlanceResult | null = null;
  private entityRef: GlanceEntity | null = null;
  private amount = 10;
  private hasEntities = false;
  /** What the card shows, in the terms a spoken command is read against. */
  private shown: VoiceView = "closed";
  private lastBuy: BuyResult | null = null;
  /** The buy card's amount setter while one is showing. */
  private applyAmount: ((usd: number) => void) | null = null;
  /** The card was opened just to listen, so the voice lines go in its headline. */
  private voiceCard = false;
  private listenFrom: BubbleState = "idle";

  constructor(container: HTMLElement, private h: BubbleHandlers) {
    try {
      const fonts = document.createElement("style");
      fonts.textContent = fontFaces();
      (container.getRootNode() as ShadowRoot | Document).appendChild(fonts);
      // @font-face inside a shadow root only registers on the document; add it there too, once.
      if (!document.getElementById("glance-fonts")) {
        const docFonts = fonts.cloneNode(true) as HTMLStyleElement;
        docFonts.id = "glance-fonts";
        document.head.appendChild(docFonts);
      }
    } catch {
      /* fonts fall back to the system stack */
    }
    registerBeamProperties();
    this.root = document.createElement("div");
    this.root.className = "root";
    this.card = document.createElement("div");
    this.card.className = "card";
    this.card.hidden = true;
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-label", "Glance");
    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.dataset.beam = "glance";
    const bloom = document.createElement("div");
    bloom.setAttribute("data-beam-bloom", "");
    this.panel.append(this.card, bloom);
    this.panel.addEventListener("animationend", (ev) => {
      if (ev.target === this.panel && ev.animationName.startsWith("beam-fade-out")) delete this.panel.dataset.fading;
    });
    liquidGlass(this.panel, { displacement: 28, aberration: 2, blurPx: 22, saturatePct: 150, elasticity: 0 });
    this.avatar = document.createElement("button");
    this.avatar.className = "avatar";
    this.avatar.type = "button";
    this.avatar.setAttribute("aria-label", "Glance this page (Alt+G). Hold to talk (Alt+V)");
    this.orb = new Orb(40);
    this.avatar.append(this.orb.canvas);
    liquidGlass(this.avatar, { displacement: 20, aberration: 2, blurPx: 4, saturatePct: 140, elasticity: 0.35 });
    this.root.append(this.panel, this.avatar);
    container.append(this.root);
    this.wireAvatar();
    this.restorePosition();
    this.setState("idle");
  }

  /** Where the card and the orb are on screen, for marks to keep clear of. */
  occupiedRects(): { x: number; y: number; w: number; h: number }[] {
    return [this.panel, this.avatar]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 }));
  }

  /** Run `fn` with the bubble invisible, so a screenshot of the page does not include it. */
  async withHidden<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.root.style.visibility;
    this.root.style.visibility = "hidden";
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return await fn();
    } finally {
      this.root.style.visibility = prev;
    }
  }

  setHasEntities(v: boolean) {
    this.hasEntities = v;
    this.avatar.dataset.hasEntities = String(v);
  }

  setState(s: BubbleState) {
    this.state = s;
    this.avatar.dataset.state = s;
    this.avatar.setAttribute("aria-busy", String(s === "thinking" || s === "confirming"));
    this.syncMotion();
  }

  /** Glance's voice is playing: the orb composes while it talks. */
  setSpeaking(on: boolean) {
    this.speaking = on;
    this.syncMotion();
  }

  /** Work on an open card; null when it is done. */
  private work(kind: OrbState | null) {
    this.busy = kind;
    this.syncMotion();
  }

  /** The orb's motion and the card's beam follow what Glance is doing. */
  private syncMotion() {
    const s = this.state;
    const motion: OrbState =
      s === "listening" ? "listening" : s === "thinking" ? this.thinkingAs : s === "confirming" ? "connecting" : (this.busy ?? (this.speaking ? "composing" : "breathing"));
    this.orb.set(motion);
    const working = s === "listening" || s === "thinking" || s === "confirming" || this.busy !== null;
    if (working && !("active" in this.panel.dataset)) {
      delete this.panel.dataset.fading;
      this.panel.dataset.active = "";
    } else if (!working && "active" in this.panel.dataset) {
      delete this.panel.dataset.active;
      this.panel.dataset.fading = "";
    }
  }

  get isOpen() {
    return !this.card.hidden;
  }

  close() {
    this.card.hidden = true;
    this.show("closed");
    this.setState("idle");
  }

  /** Every render goes through here: the card is about to be replaced, so voice lines and the amount setter go with it. */
  private show(view: VoiceView) {
    if (this.shown === "explain" && view !== "explain") this.h.onExplainEnd?.();
    this.shown = view;
    this.voiceCard = false;
    this.applyAmount = null;
  }

  thinking(line = "Reading this page…", as: OrbState = "searching") {
    this.show("thinking");
    this.thinkingAs = as;
    this.setState("thinking");
    this.open();
    this.card.innerHTML = `<div class="head"><p class="say" aria-live="polite">${esc(line)}</p>${closeBtn()}</div>`;
    this.wireClose();
  }

  showError(message: string, opts: { retry?: boolean; action?: { label: string; run: () => void } } = {}) {
    this.show("error");
    this.setState("error");
    this.open();
    this.card.innerHTML = `<div class="head"><p class="say" aria-live="assertive">${esc(message)}</p>${closeBtn()}</div>
      <div class="row">${opts.action ? `<button class="primary" data-act="action">${esc(opts.action.label)}</button>` : ""}${
        opts.retry !== false && !opts.action ? `<button class="primary" data-act="retry">Try again</button>` : ""
      }</div>`;
    this.wireClose();
    this.card.querySelector<HTMLButtonElement>("[data-act=retry]")?.addEventListener("click", () => this.h.onGlance());
    this.card.querySelector<HTMLButtonElement>("[data-act=action]")?.addEventListener("click", () => {
      opts.action!.run();
      this.close();
    });
  }

  showResult(r: GlanceResult) {
    this.result = r;
    this.setState("showing");
    this.open();
    this.h.speak(r.summary);
    const top = r.entities[0] ?? null;

    if (r.verdict === "none" || !top) {
      this.show("none");
      this.card.innerHTML = `<div class="head"><p class="say">${esc(r.summary)}</p>${closeBtn()}</div>
        <p class="sub">Try a page about a company, or press <span class="kbd">⌥G</span> on a headline.</p>`;
      this.wireClose();
      return;
    }
    if (r.verdict === "multiple") {
      this.show("choice");
      this.card.innerHTML = `<div class="head"><p class="say">${esc(r.summary)}</p>${closeBtn()}</div>
        <div class="chips">${r.entities.map((e, i) => `<button class="chip" data-pick="${i}">${esc(e.name)}</button>`).join("")}</div>`;
      this.wireClose();
      this.card.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) =>
        b.addEventListener("click", () => this.showEntity(r.entities[Number(b.dataset.pick)]!)),
      );
      return;
    }
    if (r.verdict === "ask_user" || r.verdict === "disambiguate") {
      this.show("ask");
      this.card.innerHTML = `<div class="head"><p class="say">${esc(r.summary)}</p>${closeBtn()}</div>
        <div class="chips"><button class="chip" data-act="yes">Yes</button><button class="chip" data-act="no">No</button>${
          r.entities.length > 1 ? `<button class="chip" data-act="pick">Pick</button>` : ""
        }</div>`;
      this.wireClose();
      this.card.querySelector("[data-act=yes]")!.addEventListener("click", () => this.showEntity(top));
      this.card.querySelector("[data-act=no]")!.addEventListener("click", () => this.close());
      this.card.querySelector("[data-act=pick]")?.addEventListener("click", () => this.showResult({ ...r, verdict: "multiple", summary: `I see ${r.entities.map((e) => e.name).join(", ")} here. Which one?` }));
      return;
    }
    this.showEntity(top, r.summary);
  }

  /**
   * Counter-view (spec §7.5): one bear-case sentence under the amount, from the last week's headlines.
   * Fetched after the card renders so the buy button never waits on it; dropped if the card moved on;
   * dismissable for a day per company; off entirely when the user turned it off in settings.
   */
  private async loadCounterView(e: GlanceEntity) {
    if (!this.h.onCounterView || counterViewDismissed(e.ticker)) return;
    const res = await this.h.onCounterView(e).catch(() => null);
    if (!res || !res.ok || !res.enabled || !res.text) return;
    if (this.entityRef !== e || this.shown !== "company") return;
    const chips = this.card.querySelector(".chips");
    if (!chips || this.card.querySelector(".counter")) return;
    const p = document.createElement("p");
    p.className = "counter";
    p.setAttribute("role", "note");
    p.innerHTML = `<span class="counter-text">${esc(res.text)}</span>${
      res.source ? ` <a class="counter-src" href="${esc(res.source.url)}" target="_blank" rel="noopener">${esc(res.source.source)}</a>` : ""
    }<button class="counter-x" type="button" aria-label="Dismiss">×</button>`;
    p.querySelector(".counter-x")!.addEventListener("click", () => {
      p.remove();
      try {
        localStorage.setItem(CV_DISMISS_KEY(e.ticker), String(Date.now()));
      } catch {
        /* ignore */
      }
    });
    chips.after(p);
  }

  /** The buy card for one resolved company (spec §7.3 active mode, §7.5). */
  showEntity(e: GlanceEntity, sentence?: string) {
    this.entityRef = e;
    this.setState("showing");
    this.open();
    this.h.onPick?.(e);
    if (!e.tokenized || !e.mint) {
      this.show("untokenized");
      const line = `That's ${e.name}. It's not available on-chain yet. Want me to tell you when it is?`;
      this.card.innerHTML = `<div class="head"><p class="say">${esc(line)}</p>${closeBtn()}</div>
        <div class="row"><button class="primary" data-act="watch">Tell me when</button><button class="ghost" data-act="close">No thanks</button></div>
        ${this.alsoRow(e)}`;
      this.wireClose();
      this.wireAlso(e);
      this.card.querySelector("[data-act=close]")!.addEventListener("click", () => this.close());
      this.card.querySelector<HTMLButtonElement>("[data-act=watch]")!.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        this.work("working");
        const res = await this.h.onWatch(e);
        this.work(null);
        this.finish(res.ok ? res.message : res.message, res.ok);
      });
      return;
    }
    this.show("company");
    const say = sentence ?? entitySentence(e);
    const listings = e.listings ?? [];
    // Several tokens track one company (PreStocks and Tessera for OpenAI): the one nearest its issuer's mark is picked first.
    let chosen: EntityListing | null = defaultListing(listings);
    const delta = e.deltaPct !== null && e.deltaPct !== undefined ? ` · ${e.deltaPct >= 0 ? "+" : "−"}${Math.abs(e.deltaPct).toFixed(1)}% since published` : "";
    const badge = e.kind === "pre-ipo" ? `<span class="badge">Pre-IPO</span> ` : "";
    const sub =
      listings.length === 1 && chosen
        ? `${badge}${esc(chosen.symbol)} · ${esc(chosen.issuer)} · ${usd(chosen.tokenUsd ?? e.priceUsd ?? null)} · ${premiumLabel(chosen)}${delta}`
        : listings.length > 1
          ? `${badge}${esc(e.ticker)} · ${listings.length} tokens, priced against each issuer's mark${delta}`
          : e.priceUsd !== null && e.priceUsd !== undefined
            ? `${badge}${esc(e.ticker)} ${usd(e.priceUsd)}${delta}`
            : `${badge}${esc(e.ticker)}`;
    const tokens =
      listings.length > 1
        ? `<div class="tokens" role="radiogroup" aria-label="Which token">${listings
            .map(
              (l, i) =>
                `<button class="token" type="button" role="radio" data-token="${i}" aria-checked="${l === chosen}"><span class="t-sym">${esc(l.symbol)}</span><span class="t-iss">${esc(l.issuer)}</span><span class="t-px">${usd(l.tokenUsd)}</span><span class="t-prem${premiumClass(l)}">${premiumLabel(l)}</span></button>`,
            )
            .join("")}</div>`
        : "";
    this.card.innerHTML = `<div class="head"><div><p class="say" aria-live="polite">${esc(say)}</p><p class="sub">${sub}</p></div>${closeBtn()}</div>
      ${tokens}
      <div class="chips" role="group" aria-label="Amount">${AMOUNT_CHIPS.map(
        (a) => `<button class="chip" data-amt="${a}" aria-pressed="${a === this.amount}">$${a}</button>`,
      ).join("")}<label class="chip custom"><span class="sr-only"></span><input type="number" inputmode="decimal" min="1" step="1" placeholder="$ custom" aria-label="Custom amount in dollars"></label></div>
      <div class="row"><button class="primary" data-act="buy">Buy $${this.amount} of ${esc(e.name)}</button><button class="ghost" data-act="why">Why did it move?</button></div>
      <p class="status" data-role="status" aria-live="polite"></p>
      ${this.alsoRow(e)}
      <p class="foot">Spends from your vault${this.rememberLink(" · ")}</p>`;
    this.wireClose();
    this.wireRemember();
    this.wireAlso(e);
    void this.loadCounterView(e);
    const buyBtn = this.card.querySelector<HTMLButtonElement>("[data-act=buy]")!;
    const status = this.card.querySelector<HTMLParagraphElement>("[data-role=status]")!;
    const buyLabel = () => `Buy $${this.amount} of ${chosen && listings.length > 1 ? chosen.symbol : e.name}`;
    buyBtn.textContent = buyLabel();
    this.card.querySelectorAll<HTMLButtonElement>("[data-token]").forEach((b) =>
      b.addEventListener("click", () => {
        chosen = listings[Number(b.dataset.token)] ?? chosen;
        this.card.querySelectorAll<HTMLButtonElement>("[data-token]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        buyBtn.textContent = buyLabel();
      }),
    );
    const setAmount = (a: number) => {
      this.amount = a;
      this.card.querySelectorAll<HTMLButtonElement>("[data-amt]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.amt) === a)));
      buyBtn.textContent = buyLabel();
    };
    this.card.querySelectorAll<HTMLButtonElement>("[data-amt]").forEach((b) => b.addEventListener("click", () => setAmount(Number(b.dataset.amt))));
    const custom = this.card.querySelector<HTMLInputElement>(".custom input")!;
    this.applyAmount = (a) => {
      setAmount(a);
      custom.value = (AMOUNT_CHIPS as readonly number[]).includes(a) ? "" : String(a);
    };
    custom.addEventListener("input", () => {
      const v = Number(custom.value);
      if (v >= 1) setAmount(Math.round(v));
    });
    custom.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") buyBtn.click();
    });
    buyBtn.addEventListener("click", async () => {
      this.setState("confirming");
      buyBtn.disabled = true;
      status.className = "status busy";
      status.textContent = `Buying ${e.name}…`;
      const res = await this.h.onBuy(chosen ? { ...e, mint: chosen.mint } : e, this.amount);
      if (res.ok) {
        this.finish(res.message, true, res);
      } else {
        this.setState("error");
        buyBtn.disabled = false;
        status.className = "status err";
        status.textContent = res.message;
        if (res.code === "OUTPUT_MINT_NOT_ISSUER" && res.realMint) {
          // Spec §7.8 lookalike token: the line offers the real one; this is the button that takes it.
          const real = res.realMint;
          const chip = document.createElement("button");
          chip.className = "chip";
          chip.textContent = `Buy the real ${e.name}`;
          chip.addEventListener("click", () => this.showEntity({ ...e, mint: real, tokenized: true }));
          status.after(chip);
        }
        if (res.code === "OVER_DAILY_CAP" && res.remainingUsd && res.remainingUsd >= 1) {
          const amt = Math.floor(res.remainingUsd);
          const chip = document.createElement("button");
          chip.className = "chip";
          chip.textContent = `Buy $${amt} now`;
          chip.addEventListener("click", () => {
            setAmount(amt);
            buyBtn.click();
          });
          status.after(chip);
        }
        if (res.code === "SESSION_EXPIRED" || res.code === "NO_SESSION" || res.code === "AUTH_INVALID" || res.code === "INSUFFICIENT_FUNDS") {
          const open = document.createElement("button");
          open.className = "chip";
          open.textContent = res.code === "INSUFFICIENT_FUNDS" ? "Add money" : "Open Glance";
          open.addEventListener("click", () => this.h.onOpenPanel());
          status.after(open);
        }
        this.h.speak(res.message);
      }
    });
    this.card.querySelector<HTMLButtonElement>("[data-act=why]")!.addEventListener("click", async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      status.className = "status busy";
      status.textContent = "Checking the news…";
      this.work("working");
      const res = await this.h.onWhy(e);
      this.work(null);
      btn.disabled = false;
      if (res.ok) {
        status.className = "status";
        status.textContent = res.text;
        this.h.speak(res.text);
        if (res.sources.length) {
          const ul = document.createElement("ul");
          ul.className = "sources";
          ul.innerHTML = res.sources.slice(0, 3).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}: ${esc(s.title)}</a></li>`).join("");
          status.after(ul);
        }
      } else {
        status.className = "status err";
        status.textContent = res.message;
      }
    });
  }

  // ---- Selling, from the vault ----

  private selling: Holding | null = null;

  /**
   * The card that confirms a sell (spec §7.7, by voice or from the page): the position, the amount,
   * and a Sell button that is only ever pressed by the user, or by a spoken "yes" on this card.
   */
  showSell(h: Holding, amount: { usd: number } | { all: true }) {
    this.show("sell");
    this.selling = h;
    this.setState("showing");
    this.open();
    const value = h.valueUsd ?? 0;
    let choice: { usd: number } | { all: true } = "all" in amount || amount.usd >= value ? { all: true } : amount;
    const label = () => ("all" in choice ? `Sell all ${esc(h.name)}` : `Sell ${usd(choice.usd)} of ${esc(h.name)}`);
    const say = "all" in choice ? `Sell all your ${h.name}, about ${usd(value)}?` : `Sell ${usd(choice.usd)} of ${h.name}?`;
    const chips = [5, 10, 25].filter((a) => a < value);
    this.card.innerHTML = `<div class="head"><div><p class="say" aria-live="polite">${esc(say)}</p><p class="sub">You own ${usd(value)} · ${h.shares.toPrecision(3)} shares</p></div>${closeBtn()}</div>
      <div class="chips" role="group" aria-label="Amount">${chips.map((a) => `<button class="chip" data-sell-amt="${a}" aria-pressed="${"usd" in choice && choice.usd === a}">$${a}</button>`).join("")}<button class="chip" data-sell-amt="all" aria-pressed="${"all" in choice}">All</button></div>
      <div class="row"><button class="primary" data-act="sell">${label()}</button><button class="ghost" data-act="no">Not now</button></div>
      <p class="status" data-role="status" aria-live="polite"></p>`;
    this.wireClose();
    this.h.speak(say);
    const sellBtn = this.card.querySelector<HTMLButtonElement>("[data-act=sell]")!;
    const status = this.card.querySelector<HTMLParagraphElement>("[data-role=status]")!;
    const pick = (next: { usd: number } | { all: true }) => {
      choice = next;
      this.card.querySelectorAll<HTMLButtonElement>("[data-sell-amt]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sellAmt === ("all" in next ? "all" : String(next.usd)))));
      sellBtn.innerHTML = label();
    };
    this.applyAmount = (a) => pick(a >= value ? { all: true } : { usd: a });
    this.card.querySelectorAll<HTMLButtonElement>("[data-sell-amt]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.sellAmt === "all" ? { all: true } : { usd: Number(b.dataset.sellAmt) })));
    this.card.querySelector("[data-act=no]")!.addEventListener("click", () => this.close());
    sellBtn.addEventListener("click", async () => {
      if (!this.h.onSell) return;
      this.setState("confirming");
      sellBtn.disabled = true;
      status.className = "status busy";
      status.textContent = `Selling ${h.name}…`;
      const res = await this.h.onSell(h, choice);
      if (res.ok) this.finish(res.message, true);
      else {
        this.setState("error");
        sellBtn.disabled = false;
        status.className = "status err";
        status.textContent = res.message;
        this.h.speak(res.message);
      }
    });
  }

  // ---- "Show me": an explanation spoken while Glance draws on the page ----

  /** The card for an explanation: the question, then each spoken segment as it is said. */
  showExplanation(question: string, lines: string[], skills: string[] = []) {
    this.show("explain");
    this.setState("showing");
    this.open();
    this.card.innerHTML = `<div class="head"><p class="sub asked">${esc(`“${question}”`)}</p>${closeBtn()}</div>
      <div class="explain" aria-live="polite">${lines.map((l, i) => `<p class="step" data-step="${i}" hidden>${esc(l)}</p>`).join("")}</div>
      <p class="status" data-role="explain-status" aria-live="polite" hidden></p>
      ${skills.length ? `<p class="skills-used">Using: ${esc(skills.map((n) => n.replace(/-/g, " ")).join(", "))}</p>` : ""}
      <div class="row"><button class="ghost wide" type="button" data-act="clear-sketch">Clear drawings</button></div>
      ${this.h.onRemember ? `<p class="foot">${this.rememberLink("")}</p>` : ""}`;
    this.wireClose();
    this.wireRemember();
    this.card.querySelector<HTMLButtonElement>("[data-act=clear-sketch]")!.addEventListener("click", (ev) => {
      this.h.onClearSketch?.();
      (ev.currentTarget as HTMLButtonElement).disabled = true;
    });
  }

  /** Add the lines of a later step (after a scroll or click) to the card; returns the index of the first. */
  explainAppend(lines: string[]): number {
    const box = this.card.querySelector(".explain");
    const start = this.card.querySelectorAll(".step").length;
    box?.insertAdjacentHTML("beforeend", lines.map((l, i) => `<p class="step" data-step="${start + i}" hidden>${esc(l)}</p>`).join(""));
    return start;
  }

  /** What Glance is doing between spoken steps ("Clicking “1Y”…"), or null to hide it. */
  explainStatus(text: string | null) {
    const p = this.card.querySelector<HTMLElement>("[data-role=explain-status]");
    if (!p) return;
    p.hidden = !text;
    p.className = "status busy";
    p.textContent = text ?? "";
  }

  /** The orb and beam while an explanation scrolls, clicks or looks again; null when it is talking. */
  explainWorking(kind: OrbState | null) {
    if (this.shown === "explain") this.work(kind);
  }

  /** Reveal segment `i` as it starts being said; earlier ones stay, dimmed. */
  explainStep(i: number) {
    this.card.querySelectorAll<HTMLElement>(".step").forEach((p) => {
      const n = Number(p.dataset.step);
      if (n <= i) p.hidden = false;
      p.toggleAttribute("aria-current", n === i);
    });
  }

  explainDone() {
    this.work(null);
    this.explainStatus(null);
    this.card.querySelectorAll<HTMLElement>(".step").forEach((p) => {
      p.hidden = false;
      p.removeAttribute("aria-current");
    });
  }

  // ---- Push-to-talk (spec §7.4) ----

  get view(): VoiceView {
    return this.shown;
  }
  get entity(): GlanceEntity | null {
    return this.shown === "company" || this.shown === "untokenized" || this.shown === "done" ? this.entityRef : null;
  }
  get amountUsd(): number {
    return this.amount;
  }
  get summary(): string | null {
    return this.result?.summary ?? null;
  }
  /** The journal entry of the buy this card just confirmed, for a spoken note. */
  get lastJournalId(): number | null {
    return this.shown === "done" ? (this.lastBuy?.journalId ?? null) : null;
  }

  /** The card as the backend reads a command against it. */
  voiceContext(): VoiceContext {
    const brief = (e: GlanceEntity): VoiceCompany => ({ companyId: e.companyId, name: e.name, ticker: e.ticker });
    const onCard = this.shown === "choice" || this.shown === "ask" || this.shown === "company" || this.shown === "untokenized";
    const current = this.shown === "ask" ? (this.result?.entities[0] ?? null) : this.entity;
    if (this.shown === "sell" && this.selling) {
      return { view: "sell", entities: [], current: { companyId: this.selling.ticker.toLowerCase(), name: this.selling.name, ticker: this.selling.ticker }, amountUsd: null };
    }
    return {
      view: this.shown,
      entities: onCard && this.result ? this.result.entities.map(brief) : [],
      current: current ? brief(current) : null,
      amountUsd: this.shown === "company" ? this.amount : null,
    };
  }

  /** Show that Glance is listening, over the card if one is open, or in a card of its own. */
  listening() {
    this.listenFrom = this.state === "listening" ? this.listenFrom : this.state;
    this.setState("listening");
    if (this.shown === "closed" || this.shown === "thinking") this.openVoiceCard("Listening…", "Let go when you're done.");
    else this.voiceLine("Listening…", "listening");
  }

  /** A card that holds only what was heard and answered; the next real render replaces it. */
  private openVoiceCard(line: string, sub?: string) {
    this.show("closed");
    this.voiceCard = true;
    this.open();
    this.card.innerHTML = `<div class="head"><p class="say" aria-live="polite" data-voice="listening">${esc(line)}</p>${closeBtn()}</div>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}`;
    this.wireClose();
  }

  /** Let go: the take is on its way to the backend. */
  hearing() {
    this.thinkingAs = "solving";
    this.setState("thinking");
    this.voiceLine("One moment…", "listening");
  }

  heard(transcript: string) {
    this.setState(this.voiceCard ? "showing" : this.listenFrom);
    this.voiceLine(`“${transcript}”`, "heard");
  }

  /** After a command redrew the card, show what was heard above the new one (unless an answer took its place). */
  echoHeard(transcript: string) {
    // The explanation card already opens with the question.
    if (this.card.hidden || this.voiceCard || this.shown === "closed" || this.shown === "explain" || this.card.querySelector(":scope > .voice")) return;
    this.voiceLine(`“${transcript}”`, "heard");
  }

  /** A spoken answer to a command, shown without replacing the card. `speakAs` lets a fresh summary lead into it. */
  reply(line: string, speakAs?: string) {
    if (this.shown === "closed" && !this.voiceCard) this.openVoiceCard(line);
    if (this.state === "listening" || this.state === "thinking") this.setState(this.voiceCard ? "showing" : this.listenFrom);
    this.voiceLine(line, "reply");
    this.h.speak(speakAs ?? line);
  }

  /** The take was dropped (a tap, or focus left the page): put the card back the way it was. */
  stopListening() {
    if (this.voiceCard) {
      this.close();
      return;
    }
    this.card.querySelector(":scope > .voice")?.remove();
    if (this.state === "listening" || this.state === "thinking") this.setState(this.listenFrom);
  }

  /** Press a button on the card the way a tap would. False when the card has no such button. */
  press(act: "buy" | "sell" | "why" | "watch" | "yes" | "no" | "retry"): boolean {
    const b = this.card.querySelector<HTMLButtonElement>(`[data-act=${act}]`);
    if (this.card.hidden || !b || b.disabled) return false;
    b.click();
    return true;
  }

  /** Set the amount on the buy card, or for the next one. */
  chooseAmount(usd: number) {
    const a = Math.max(1, Math.round(usd));
    if (this.applyAmount) this.applyAmount(a);
    else this.amount = a;
  }

  /** Open the buy card for a company from the last result. */
  pickCompany(companyId: string): boolean {
    const e = this.result?.entities.find((x) => x.companyId === companyId);
    if (!e) return false;
    this.showEntity(e);
    return true;
  }

  /** Reopen the buy card for the company just bought, for "buy ten more". */
  reopenEntity(): boolean {
    if (!this.entityRef) return false;
    this.showEntity(this.entityRef);
    return true;
  }

  /** "What else is on this page": the choice chips, when the last result had more than one company. */
  showChoices(): boolean {
    const r = this.result;
    if (!r || r.entities.length < 2) return false;
    this.showResult({ ...r, verdict: "multiple", summary: `I see ${listNames(r.entities.map((e) => e.name))} here. Which one?` });
    return true;
  }

  /** A line on the open card that isn't spoken, for progress ("Reading the page to remember it…"). */
  status(line: string) {
    if (this.shown === "closed" && !this.voiceCard) this.openVoiceCard(line);
    this.voiceLine(line, "listening");
  }

  /** The other companies this glance found, beside the one on the card: tap one to open its card instead. */
  private alsoOf(e: GlanceEntity): GlanceEntity[] {
    return (this.result?.entities ?? []).filter((x) => x.companyId !== e.companyId).slice(0, 4);
  }

  private alsoRow(e: GlanceEntity): string {
    const others = this.alsoOf(e);
    if (!others.length) return "";
    return `<p class="foot also">Also on this page: ${others.map((x, i) => `<button class="link" type="button" data-also="${i}">${esc(x.name)}</button>`).join(" · ")}</p>`;
  }

  private wireAlso(e: GlanceEntity) {
    const others = this.alsoOf(e);
    this.card.querySelectorAll<HTMLButtonElement>("[data-also]").forEach((b) =>
      b.addEventListener("click", () => {
        const next = others[Number(b.dataset.also)];
        if (next) this.showEntity(next);
      }),
    );
  }

  private rememberLink(sep: string): string {
    return this.h.onRemember ? `${sep}<button class="link" type="button" data-act="remember">Remember this page</button>` : "";
  }

  private wireRemember() {
    const btn = this.card.querySelector<HTMLButtonElement>("[data-act=remember]");
    const run = this.h.onRemember;
    if (!btn || !run) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Remembering…";
      const ok = await run().catch(() => false);
      if (!btn.isConnected) return;
      btn.textContent = ok ? "Remembered" : "Remember this page";
      btn.disabled = ok;
    });
  }

  private voiceLine(text: string, kind: "listening" | "heard" | "reply") {
    if (this.voiceCard) {
      const say = this.card.querySelector<HTMLElement>(".say");
      if (say) {
        say.textContent = text;
        say.dataset.voice = kind;
      }
      this.card.querySelector(":scope > .sub")?.remove();
      return;
    }
    let line = this.card.querySelector<HTMLParagraphElement>(":scope > .voice");
    if (!line) {
      line = document.createElement("p");
      line.className = "voice";
      line.setAttribute("aria-live", "polite");
      this.card.prepend(line);
    }
    line.dataset.voice = kind;
    line.textContent = text;
  }

  private finish(message: string, ok: boolean, buy?: BuyResult) {
    this.show(ok ? "done" : "error");
    this.lastBuy = buy ?? null;
    this.setState(ok ? "done" : "error");
    this.h.speak(message);
    this.card.innerHTML = `<div class="head"><div class="done">${ok ? `<span class="tick" aria-hidden="true">✓</span>` : ""}<p class="say" aria-live="assertive">${esc(message)}</p></div>${closeBtn()}</div>
      ${buy ? `<p class="sub">${buy.sharesDelta.toPrecision(3)} shares at ${usd(buy.usdPerShare)} · <a href="#" data-act="panel">See in Glance</a></p>` : ""}
      <button class="ghost wide" type="button" data-act="back">Back to reading</button>`;
    this.wireClose();
    this.card.querySelector("[data-act=panel]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.h.onOpenPanel();
    });
    this.card.querySelector("[data-act=back]")?.addEventListener("click", () => this.close());
    if (ok) {
      try {
        playChime();
      } catch {
        /* no audio */
      }
      setTimeout(() => {
        if (this.state === "done") this.close();
      }, 6000);
    }
  }

  private open() {
    this.card.hidden = false;
  }

  private wireClose() {
    this.card.querySelector<HTMLButtonElement>(".close")?.addEventListener("click", () => this.close());
    this.card.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Escape") this.close();
      },
      { once: true },
    );
  }

  private wireAvatar() {
    let dragging = false;
    let moved = false;
    let holding = false;
    let holdTimer: number | undefined;
    let ox = 0;
    let oy = 0;
    let sx = 0;
    let sy = 0;
    this.avatar.addEventListener("pointerdown", (ev) => {
      dragging = true;
      moved = false;
      holding = false;
      const r = this.root.getBoundingClientRect();
      ox = ev.clientX - r.right;
      oy = ev.clientY - r.bottom;
      sx = ev.clientX;
      sy = ev.clientY;
      this.avatar.setPointerCapture(ev.pointerId);
      window.clearTimeout(holdTimer);
      // Press and hold (spec §7.4): still after HOLD_MS, it listens until the press ends.
      if (this.h.onListenStart) holdTimer = window.setTimeout(() => (holding = this.h.onListenStart!()), HOLD_MS);
    });
    this.avatar.addEventListener("pointermove", (ev) => {
      if (!dragging || holding) return;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      window.clearTimeout(holdTimer);
      const right = Math.max(8, window.innerWidth - (ev.clientX - ox));
      const bottom = Math.max(8, window.innerHeight - (ev.clientY - oy));
      this.root.style.right = `${right}px`;
      this.root.style.bottom = `${bottom}px`;
    });
    const release = (ev: PointerEvent) => {
      window.clearTimeout(holdTimer);
      if (!dragging) return;
      dragging = false;
      if (holding) {
        holding = false;
        this.h.onListenStop?.();
        return;
      }
      if (ev.type === "pointercancel") return;
      if (moved) {
        localStorage.setItem(POS_KEY(), JSON.stringify({ right: this.root.style.right, bottom: this.root.style.bottom }));
        return;
      }
      if (this.isOpen) this.close();
      else this.h.onGlance();
    };
    this.avatar.addEventListener("pointerup", release);
    this.avatar.addEventListener("pointercancel", release);
    this.avatar.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this.h.onGlance();
      }
    });
  }

  private restorePosition() {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY()) ?? "null") as { right: string; bottom: string } | null;
      if (p?.right) this.root.style.right = p.right;
      if (p?.bottom) this.root.style.bottom = p.bottom;
    } catch {
      /* ignore */
    }
  }
}

/** The token nearest its issuer's mark among those with a price; the first when none has both. */
export function defaultListing(listings: EntityListing[]): EntityListing | null {
  const priced = listings.filter((l) => l.tokenUsd !== null && l.premiumPct !== null);
  if (!priced.length) return listings[0] ?? null;
  return priced.reduce((best, l) => (Math.abs(l.premiumPct!) < Math.abs(best.premiumPct!) ? l : best));
}

/** "+7.3% vs mark", "at mark", "no mark". */
export function premiumLabel(l: EntityListing): string {
  if (l.premiumPct === null) return "no mark";
  if (Math.abs(l.premiumPct) < 0.1) return "at mark";
  return `${l.premiumPct > 0 ? "+" : "−"}${Math.abs(l.premiumPct).toFixed(1)}% vs mark`;
}
const premiumClass = (l: EntityListing) => (l.premiumPct === null || Math.abs(l.premiumPct) < 2 ? "" : l.premiumPct > 0 ? " over" : " under");

export function entitySentence(e: GlanceEntity): string {
  if (e.priceUsd === null || e.priceUsd === undefined) return `That's ${e.name}. I can't get a price right now.`;
  const price = e.priceUsd >= 100 ? `$${e.priceUsd.toFixed(0)}` : `$${e.priceUsd.toFixed(2)}`;
  if (e.deltaPct !== null && e.deltaPct !== undefined) {
    return `That's ${e.name}. ${e.ticker} is ${price} on-chain, ${e.deltaPct >= 0 ? "up" : "down"} ${Math.abs(e.deltaPct).toFixed(1)}% since this was published.`;
  }
  return `That's ${e.name}. ${e.ticker} is ${price} on-chain.`;
}

/** "Apple, Nvidia, and Tesla" */
function listNames(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function closeBtn() {
  return `<button class="close" type="button" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Two-note confirmation cue (spec §7.5 step 6). */
function playChime() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const play = (f: number, t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + 0.3);
  };
  play(660, 0);
  play(990, 0.14);
}
