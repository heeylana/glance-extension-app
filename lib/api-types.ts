/** Response shapes from glance-backend. Keep in sync with glance-backend/src/routes. */
export interface ApiError {
  ok: false;
  code: string;
  message: string;
  remainingUsd?: number;
  realMint?: string;
}

export interface GlanceInput {
  url: string;
  title?: string;
  site?: "x" | "youtube" | "article" | "generic";
  publishedAt?: string | number;
  text: string;
  captions?: string;
  context?: { url?: string; title?: string; site?: string; screenshotHash?: string; note?: string };
  /** The company the user hovered and asked to glance ("Glance this" on its underline): it leads the answer. */
  focus?: string;
}

export interface GlanceEntity {
  companyId: string;
  name: string;
  ticker: string;
  confidence: number;
  evidence: string[];
  tokenized: boolean;
  mint?: string;
  decimals?: number;
  priceUsd?: number | null;
  priceAtPublishUsd?: number | null;
  deltaPct?: number | null;
  deltaQuality?: "exact" | "estimate" | null;
  /** The day's move from the price feed; the card's chart takes its colour from this. */
  changeTodayPct?: number | null;
  priceStale?: boolean;
  kind?: "stock" | "etf" | "pre-ipo";
  /** Every token of the company (xStocks, PreStocks, Tessera); the buy card lets the user pick one. */
  listings?: EntityListing[];
  about?: string;
}

export interface EntityListing {
  /** Catalog (mainnet) mint: /buy accepts it, and on devnet trades its mock. */
  mint: string;
  symbol: string;
  issuer: string;
  kind: "stock" | "etf" | "pre-ipo";
  /** On-chain price of the token. */
  tokenUsd: number | null;
  /** The issuer's mark for what the token tracks. */
  markUsd: number | null;
  /** Token price against the mark, in percent: positive is a premium. */
  premiumPct: number | null;
  liquidityUsd: number | null;
}

export interface GlanceResult {
  ok: true;
  verdict: "confident" | "disambiguate" | "ask_user" | "multiple" | "none";
  entities: GlanceEntity[];
  summary: string;
  publishedAt: string | null;
  amountChips: number[];
  /** "screenshot" when the vision fallback produced this result (spec §7.3). */
  source?: "text" | "screenshot";
  /** sha256 of the screenshot the backend read and discarded; recorded in the journal on a buy. */
  screenshotHash?: string;
}

/** Vision fallback input: the page context plus a `data:image/jpeg;base64,` capture of the visible tab. */
export interface GlanceVisionInput {
  url: string;
  title?: string;
  site?: GlanceInput["site"];
  publishedAt?: string | number;
  image: string;
}

export interface BuyResult {
  ok: true;
  side: "buy" | "sell";
  signature: string;
  ticker: string;
  companyName: string;
  mint: string;
  usdcValue: number;
  usdPerShare: number;
  sharesDelta: number;
  positionShares: number;
  positionUsd: number;
  message: string;
  journalId?: number;
}

export interface WhyResult {
  ok: true;
  text: string;
  sources: { title: string; source: string; url: string; publishedAt: string }[];
}

/** Counter-view (spec §7.5): the strongest bear case from the last week, or nothing; off when the user disabled it. */
export interface CounterViewResult {
  ok: true;
  enabled: boolean;
  text: string | null;
  source: { title: string; source: string; url: string; publishedAt: string } | null;
}

export interface PriceRow {
  ticker: string;
  name: string;
  tokenized: boolean;
  mint?: string;
  priceUsd: number | null;
  stale: boolean | null;
  source: string | null;
}

export interface DictionaryCompany {
  id: string;
  name: string;
  ticker: string;
  aliases: string[];
  products: string[];
  execs: string[];
  tokenized: boolean;
  /** A private company, bought through pre-IPO tokens. */
  private?: boolean;
  ambiguousName?: boolean;
  ambiguousTicker?: boolean;
}
export interface Dictionary {
  ok: true;
  version: number;
  generatedAt: string;
  companies: DictionaryCompany[];
}

export interface SessionView {
  ok: true;
  wallet: string;
  vault: string;
  exists: boolean;
  paused: boolean;
  pausedOnChain: boolean;
  pausedServer: boolean;
  agentActive: boolean;
  agentExpiresAt: string | null;
  needsAccount: boolean;
  needsRenewal: boolean;
  dailyCapUsd: number;
  perTxCapUsd: number;
  maxSlippageBps: number;
  spentTodayUsd: number;
  remainingTodayUsd: number;
  cashUsd: number;
  counterViewEnabled: boolean;
  agent: string;
  consoleUrl: string;
  cluster: string;
  sessionTtlDays: number;
  usdcMint: string;
  message?: string;
}

export interface Holding {
  ticker: string;
  name: string;
  mint: string;
  shares: number;
  sharesRaw: string;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  dayChangePct: number | null;
}
export interface Portfolio {
  ok: true;
  wallet: string;
  vault: string;
  exists: boolean;
  cashUsd: number;
  holdings: Holding[];
  totalUsd: number;
  paused: boolean;
  remainingTodayUsd: number;
}

export interface JournalEntry {
  id: number;
  companyId: string;
  name: string;
  ticker: string;
  mint: string;
  url: string;
  title: string;
  site: string | null;
  screenshotHash: string | null;
  amountUsd: number;
  buyPriceUsd: number;
  nowPriceUsd: number | null;
  changePct: number | null;
  note: string | null;
  createdAt: string;
  line: string;
}

export interface WatchRow {
  companyId: string;
  ticker: string;
  name: string;
  nowTokenized: boolean;
  createdAt: string;
}

export interface ActivityRow {
  id: number;
  side: "buy" | "sell";
  status: "pending" | "confirmed" | "failed";
  usdcValue: number;
  signature: string | null;
  headline: string | null;
  url: string | null;
  failureCode: string | null;
  createdAt: string;
}

/** Push-to-talk (spec §7.4). Keep in sync with glance-backend/src/services/voice.ts. */
export type VoiceView = "closed" | "thinking" | "listening" | "none" | "company" | "untokenized" | "choice" | "ask" | "done" | "error" | "explain" | "sell";
export interface VoiceCompany {
  companyId: string;
  name: string;
  ticker: string;
}
/** What the bubble shows when the user lets go; the backend reads the command against it. */
export interface VoiceContext {
  view: VoiceView;
  entities: VoiceCompany[];
  current: VoiceCompany | null;
  amountUsd: number | null;
}
export interface VoiceCommand {
  kind: "glance" | "list" | "buy" | "sell" | "amount" | "confirm" | "cancel" | "why" | "pick" | "watch" | "note" | "explain" | "scroll" | "balance" | "limit" | "holdings" | "stock" | "advice" | "remember" | "settings" | "unknown";
  amountUsd: number | null;
  companyId: string | null;
  note: string | null;
  direction: "up" | "down" | "top" | "bottom" | null;
  all: boolean | null;
}
/** What Birdeye says about the token's own market. Null fields where it had nothing. Keep in sync with glance-backend/src/services/birdeye.ts. */
export interface TokenMarket {
  priceUsd: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  trades24h: number | null;
  markets: number | null;
}
/** POST /company: one company asked about out loud, with the card that lets the user buy it. */
export interface CompanyResult {
  ok: true;
  entity: GlanceEntity;
  summary: string;
  /** null without a Birdeye key, or when it was too slow for the spoken answer. */
  market: TokenMarket | null;
}
/**
 * POST /advice: what Glance makes of a company, from its price, its on-chain market and the week's
 * news — what is happening, the case for, the case against, what to watch. Never a recommendation,
 * and `disclaimer` is written by the backend, not the model, so it is always there.
 */
export interface AdviceResult {
  ok: true;
  entity: GlanceEntity;
  summary: string;
  market: TokenMarket | null;
  lines: string[];
  /** The lines plus the spoken disclaimer, one per clip: a whole read is too long for one. */
  spokenLines: string[];
  spoken: string;
  disclaimer: string | null;
  sources: { title: string; source: string; url: string; publishedAt: string }[];
}
/** POST /company/history: the day's hourly prices behind the card's little chart, and the market if it has caught up. */
export interface CompanyHistory {
  ok: true;
  points: { t: number; usd: number }[];
  market: TokenMarket | null;
}
export interface VoiceResult {
  ok: true;
  transcript: string;
  command: VoiceCommand;
  via: "grammar" | "llm" | "none";
}

/** "Show me": a question about the page, answered out loud while Glance draws on it. Keep in sync with glance-backend/src/services/explain.ts. */
export interface ExplainElement {
  id: string;
  kind: string;
  text: string;
  /** x, y, w, h in screenshot pixels. */
  box: [number, number, number, number];
}
/** One earlier step of the same answer: what was said, then what was scrolled or clicked and how it went. */
export interface ExplainStep {
  said: string[];
  action: { kind: "scroll" | "click"; target: string | null; direction: "up" | "down" | null; outcome: "done" | "refused" | "failed" | "off" };
}
export interface ExplainInput {
  question: string;
  url: string;
  title?: string;
  size: { w: number; h: number };
  image?: string;
  elements: ExplainElement[];
  history: ExplainStep[];
  stepsLeft: number;
  /** Remembered pages relevant to this question (lib/memory.ts pickNotes), at most 3. */
  memory?: ExplainMemory[];
}

/** A remembered page as "show me" reads it. */
export interface ExplainMemory {
  title: string;
  url: string;
  savedAt: string;
  publishedAt: string | null;
  summary: string;
  facts: string[];
}

/** POST /remember: the page to keep a fact sheet of. */
export interface RememberInput {
  url: string;
  title?: string;
  site?: GlanceInput["site"];
  publishedAt?: string | number;
  text: string;
}

/**
 * A remembered page, kept only in this browser (chrome.storage.local, `glance:memory`). The backend
 * builds it on request and keeps nothing.
 */
export interface PageNote {
  id: string;
  url: string;
  title: string;
  site: string | null;
  publishedAt: string | null;
  savedAt: string;
  summary: string;
  facts: string[];
  companies: { companyId: string; name: string; ticker: string }[];
}
export type RememberResult = { ok: true; note: Omit<PageNote, "id"> };
export interface ExplainAction {
  kind: "none" | "scroll" | "click";
  element: string | null;
  direction: "up" | "down" | null;
}
export interface SketchMark {
  kind: "circle" | "underline" | "highlight" | "box" | "arrow" | "line" | "path" | "note" | "level" | "zone" | "trend";
  element: string | null;
  quote: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  points: { x: number; y: number }[] | null;
  text: string | null;
  price?: number | null;
  price2?: number | null;
}
/** The price chart marks are drawn on: its plot area and two labelled prices, in screenshot pixels. */
export interface ExplainChart {
  plot: { x: number; y: number; w: number; h: number };
  ticks: { price: number; y: number }[];
}
export interface ExplainResult {
  ok: true;
  segments: { say: string; marks: SketchMark[] }[];
  chart: ExplainChart | null;
  action: ExplainAction;
  skills: string[];
}
