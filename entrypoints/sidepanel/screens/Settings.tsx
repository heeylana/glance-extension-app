import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useGlanceAuth } from "../../../lib/auth";
import { useApi, useQuery, useToast, type ToastKind } from "../hooks";
import { isApiError } from "../../../lib/api";
import type { ActivityRow, PageNote, SessionView } from "../../../lib/api-types";
import { forgetAll, forgetNote, loadNotes, MEMORY_KEY } from "../../../lib/memory-store";
import { explorerTx, timeAgo, truncateAddress, usd } from "../../../lib/format";
import { Button, Card, ErrorBox, Hairline, Row, Skeleton, Toast, Toggle } from "../components/ui";
import { SOLANA_CLUSTER } from "../../../lib/config";
import { openMicSetup, watchMicPermission, type MicState } from "../../../lib/mic";
import { browser } from "wxt/browser";

/**
 * Spec §7.7 Settings in the prototype's layout: status card, limit + permission card, cash card,
 * collapsible Advanced (toggles, caps, activity, revoke, delete journal), sign out. Pause is
 * instant here (server flag) and also offered on-chain; anything needing the owner's approval
 * opens the console at the matching card.
 */
export function Settings({ session, refetchSession }: { session: SessionView | null; refetchSession: () => Promise<void> }) {
  const auth = useGlanceAuth();
  const api = useApi();
  const { toast, show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!session) {
    return (
      <div className="space-y-2.5" aria-busy>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-20" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  const run = async (key: string, fn: () => Promise<string | void>, kind: ToastKind = "ok") => {
    setBusy(key);
    try {
      const m = await fn();
      if (m) show(m, kind);
      await refetchSession();
    } catch (e) {
      show(e instanceof Error ? e.message : "That didn't go through. Try again?", "err");
    } finally {
      setBusy(null);
    }
  };
  const console_ = (action: string, extra: Record<string, string> = {}) => auth.openConsole("/account", { action, ...extra });

  return (
    <div className="rise">
      <h2 className="mb-3.5 text-[20px] font-semibold tracking-[-0.02em]">Settings</h2>

      <Card className="mb-2.5">
        <Row
          title={session.paused ? "Glance is paused" : session.needsRenewal ? "Glance needs a renewal" : "Glance is on"}
          detailMono={false}
          detail={session.paused ? (session.pausedOnChain ? "I won't buy anything until you say so." : "Paused here. Your account page can pause on-chain too.") : session.needsRenewal ? "Renew below to keep buying." : `Buys up to ${usd(session.dailyCapUsd)} a day.`}
          action={
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "pause"}
              onClick={() =>
                run(
                  "pause",
                  async () => {
                    const r = await api.post<SessionView>(session.paused ? "/session/unpause" : "/session/pause");
                    if (isApiError(r)) throw new Error(r.message);
                    if (!session.paused) void console_("pause");
                    else if (r.pausedOnChain) void console_("unpause");
                    return session.paused ? "Back on duty." : "Paused. I'll sit still.";
                  },
                  session.paused ? "ok" : "warn",
                )
              }
            >
              {session.paused ? "Resume" : "Pause"}
            </Button>
          }
        />
      </Card>

      <Card className="mb-2.5">
        <Row
          title="Daily limit"
          detail={`${usd(session.dailyCapUsd)} a day · ${usd(session.spentTodayUsd)} used in the last 24h`}
          action={
            <Button size="sm" variant="secondary" onClick={() => void console_("limit")}>
              Change
            </Button>
          }
        />
        <Hairline />
        <Row
          title="Permission"
          detail={session.agentActive && session.agentExpiresAt ? `Renews ${new Date(session.agentExpiresAt).toLocaleDateString()}` : "Lapsed"}
          action={
            <Button size="sm" variant={session.needsRenewal ? "primary" : "secondary"} onClick={() => void console_("renew")}>
              Renew
            </Button>
          }
        />
      </Card>

      <Card className="mb-2.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-muted-foreground">Cash in the vault</p>
            <p className="mt-1 font-mono text-[25px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{usd(session.cashUsd)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void console_("deposit")}>
              Add
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void console_("withdraw")}>
              Withdraw
            </Button>
          </div>
        </div>
        {SOLANA_CLUSTER === "devnet" ? (
          <button
            type="button"
            className="mt-2.5 font-mono text-[11px] text-muted-2 underline-offset-2 hover:text-text-2 hover:underline disabled:opacity-60"
            disabled={busy === "fund"}
            onClick={() =>
              run("fund", async () => {
                const r = await api.post<{ ok: true; message: string }>("/session/fund", { usd: 50 });
                if (isApiError(r)) throw new Error(r.message);
                return r.message;
              })
            }
          >
            Add $50 test money
          </button>
        ) : null}
        <Hairline />
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{truncateAddress(session.wallet, 6)}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-[30px] px-3 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(session.wallet);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
            aria-label="Copy wallet address"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Card>

      <RememberedPages show={show} />

      <Advanced session={session} refetch={refetchSession} show={show} />

      <Button variant="ghost" size="lg" className="mt-2.5 w-full hover:border-[rgba(240,84,74,0.5)] hover:text-danger-text" onClick={() => void auth.signOut()}>
        Sign out
      </Button>

      {toast ? <Toast text={toast.text} kind={toast.kind} /> : null}
    </div>
  );
}

/** "Remember this page" notes: kept only in this browser, listed here to open or forget. */
function RememberedPages({ show }: { show: (t: string, k?: ToastKind) => void }) {
  const [notes, setNotes] = useState<PageNote[] | null>(null);
  React.useEffect(() => {
    const load = () => void loadNotes().then(setNotes);
    load();
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && MEMORY_KEY in changes) load();
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);
  return (
    <Card className="mb-2.5">
      <p className="text-[14.5px] font-semibold">Remembered pages</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Say “remember this” on a page and I'll use it when you ask about it elsewhere. Kept only in this browser, for 30 days.</p>
      {notes === null ? (
        <Skeleton className="mt-2 h-10" />
      ) : notes.length === 0 ? (
        <p className="mt-2.5 border-t border-[rgba(255,255,255,0.07)] pt-[11px] text-[13px] text-[#7a7a86]">Nothing remembered yet.</p>
      ) : (
        <>
          <ul className="mt-1.5">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center gap-2.5 border-t border-[rgba(255,255,255,0.07)] py-[11px]">
                <div className="min-w-0 flex-1">
                  <a href={n.url} target="_blank" rel="noopener" className="block truncate text-[13.5px] text-[#e8e8ee] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {n.title}
                  </a>
                  <p className="truncate font-mono text-[11px] text-muted-2">{[n.companies.map((c) => c.ticker).join(" "), timeAgo(n.savedAt)].filter(Boolean).join(" · ")}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-[30px] px-3 text-xs"
                  aria-label={`Forget ${n.title}`}
                  onClick={async () => {
                    await forgetNote(n.id);
                    show("Forgotten.");
                  }}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="mt-1"
            onClick={async () => {
              await forgetAll();
              show("I've forgotten every page.");
            }}
          >
            Forget all
          </Button>
        </>
      )}
    </Card>
  );
}

/** Spec §7.9: the journal is the user's; one place to wipe it. Two taps, no modal. */
function DeleteJournal({ show }: { show: (t: string, k?: ToastKind) => void }) {
  const api = useApi();
  const [arm, setArm] = useState(false);
  return (
    <div className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Delete my journal</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Removes every headline you bought from and your notes. Holdings are untouched.</p>
      </div>
      {arm ? (
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              await api.delete("/journal");
              setArm(false);
              show("Journal deleted. Holdings untouched.");
            }}
          >
            Really delete
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setArm(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="hover:border-[rgba(240,84,74,0.6)] hover:text-[#ff8a80]" onClick={() => setArm(true)}>
          Delete
        </Button>
      )}
    </div>
  );
}

function Advanced({ session, refetch, show }: { session: SessionView; refetch: () => Promise<void>; show: (t: string, k?: ToastKind) => void }) {
  const api = useApi();
  const auth = useGlanceAuth();
  const [open, setOpen] = useState(false);
  const act = useQuery<{ ok: true; activity: ActivityRow[] }>((api) => api.get("/session/activity"), [open], { enabled: open });
  const [voice, setVoice] = useState(true);
  React.useEffect(() => {
    void browser.storage.local.get("glance:voice").then((r) => setVoice(((r as Record<string, string | undefined>)["glance:voice"] ?? "on") !== "off"));
  }, []);
  const [actOnPage, setActOnPage] = useState(true);
  const [talk, setTalk] = useState(true);
  const [mic, setMic] = useState<MicState | null>(null);
  React.useEffect(() => {
    void browser.storage.local.get("glance:talk").then((r) => setTalk(((r as Record<string, string | undefined>)["glance:talk"] ?? "on") !== "off"));
    void browser.storage.local.get("glance:act").then((r) => setActOnPage(((r as Record<string, string | undefined>)["glance:act"] ?? "on") !== "off"));
    return watchMicPermission(setMic);
  }, []);
  return (
    <Card className="p-0">
      <button type="button" className="flex w-full items-center gap-3 rounded-[14px] p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex-1 text-[14.5px] font-semibold">Advanced</span>
        <span className="text-[13px] text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="px-4 pb-4">
          <Hairline className="mb-1.5" />
          <Toggle
            id="counter"
            label="Counter-view before buying"
            hint="One bear-case headline under the amount."
            checked={session.counterViewEnabled}
            onChange={async (v) => {
              await api.post("/session/preferences", { counterViewEnabled: v });
              await refetch();
              show(v ? "Counter-view on. I'll argue back." : "Counter-view off. Bold.", v ? "ok" : "warn");
            }}
          />
          <Toggle
            id="voice"
            label="Read replies aloud"
            checked={voice}
            onChange={async (v) => {
              setVoice(v);
              await browser.storage.local.set({ "glance:voice": v ? "on" : "off" });
            }}
          />
          <Toggle
            id="talk"
            label="Talk to Glance"
            hint={mic === "granted" || !talk ? "Hold ⌥V, or hold the dot, and speak." : "Needs your microphone once."}
            checked={talk}
            onChange={async (v) => {
              setTalk(v);
              await browser.storage.local.set({ "glance:talk": v ? "on" : "off" });
              if (v && mic !== "granted") void openMicSetup();
            }}
          />
          {talk && mic !== null && mic !== "granted" ? (
            <Button size="sm" variant="secondary" className="mb-2" onClick={() => void openMicSetup()}>
              {mic === "denied" ? "Unblock microphone" : "Allow microphone"}
            </Button>
          ) : null}
          <Toggle
            id="act"
            label="Let Glance scroll and click"
            hint="When you ask it to show you something. Never buys, submits, signs in or types."
            checked={actOnPage}
            onChange={async (v) => {
              setActOnPage(v);
              await browser.storage.local.set({ "glance:act": v ? "on" : "off" });
            }}
          />
          <Toggle id="anytoken" label="Any-token mode" hint="Coming soon." checked={false} disabled onChange={() => show("Not yet. Equities only for now.", "wait")} />

          <div className="mt-1.5 flex gap-3 border-t border-[rgba(255,255,255,0.08)] pb-3 pt-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-muted-foreground">Per-buy cap</p>
              <p className="mt-0.5 font-mono text-[15px] tabular-nums">{usd(session.perTxCapUsd)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-muted-foreground">Max price slip</p>
              <p className="mt-0.5 font-mono text-[15px] tabular-nums">{(session.maxSlippageBps / 100).toFixed(1)}%</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void auth.openConsole("/account", { action: "limit" })}>
            Change caps
          </Button>

          <p className="mb-0.5 mt-5 text-[14.5px] font-semibold">Activity</p>
          {act.loading && !act.data ? (
            <Skeleton className="mt-2 h-16" />
          ) : act.error ? (
            <ErrorBox message={act.error.message} onRetry={() => void act.refetch()} />
          ) : (act.data?.activity.length ?? 0) === 0 ? (
            <p className="mt-2.5 border-t border-[rgba(255,255,255,0.07)] pt-[11px] text-[13px] text-[#7a7a86]">Nothing signed yet.</p>
          ) : (
            <ul>
              {act.data!.activity.slice(0, 20).map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 border-t border-[rgba(255,255,255,0.07)] py-[11px]">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#e8e8ee]">
                    {a.side === "buy" ? "Bought" : "Sold"} {usd(a.usdcValue)} · {a.status}
                    {a.headline ? ` · ${a.headline}` : ""}
                  </span>
                  {a.signature ? (
                    <a className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-text-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={explorerTx(a.signature, SOLANA_CLUSTER)} target="_blank" rel="noopener" aria-label="View on explorer">
                      {truncateAddress(a.signature)} <ExternalLink size={12} className="text-muted-2" aria-hidden />
                    </a>
                  ) : (
                    <span className="shrink-0 font-mono text-xs text-muted-2">{timeAgo(a.createdAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex items-center gap-3 border-t border-[rgba(255,255,255,0.08)] pb-3.5 pt-[18px]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Remove Glance's permission</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Your money stays in your account.</p>
            </div>
            <Button size="sm" variant="destructive" onClick={() => void auth.openConsole("/account", { action: "revoke" })}>
              Revoke
            </Button>
          </div>
          <div className="border-t border-[rgba(255,255,255,0.08)]">
            <DeleteJournal show={show} />
          </div>
          <p className="break-all font-mono text-[10px] text-muted-2">Account {session.vault}</p>
        </div>
      ) : null}
    </Card>
  );
}
