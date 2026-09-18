import React, { useState } from "react";
import { useApi, useQuery, useToast } from "../hooks";
import { isApiError } from "../../../lib/api";
import type { Holding, Portfolio as PortfolioT, SessionView } from "../../../lib/api-types";
import { pct, shares, usd } from "../../../lib/format";
import { Button, Card, Chip, Dialog, Empty, ErrorBox, Skeleton, Stat, Toast, useFlash } from "../components/ui";

/** Spec §7.7 Portfolio in the prototype's layout: Stocks / Cash card, glass rows, Sell dialog. */
export function Portfolio({ session, onGoSettings }: { session: SessionView | null; onGoSettings: () => void }) {
  const q = useQuery<PortfolioT>((api) => api.get<PortfolioT>("/portfolio"), [], { pollMs: 20_000 });
  const [selling, setSelling] = useState<Holding | null>(null);
  const { toast, show } = useToast();
  const flash = useFlash(q.data?.totalUsd);

  if (q.loading && !q.data) {
    return (
      <div className="space-y-2.5" aria-busy>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-[92px]" />
        <Skeleton className="h-[72px]" />
        <Skeleton className="h-[72px]" />
      </div>
    );
  }
  if (q.error && !q.data) return <ErrorBox message={q.error.message} onRetry={() => void q.refetch()} />;
  const p = q.data!;
  const moves = p.holdings.filter((h) => h.dayChangePct !== null && h.valueUsd !== null);
  const dayUsd = moves.reduce((a, h) => a + (h.valueUsd! * (h.dayChangePct! / 100)) / (1 + h.dayChangePct! / 100), 0);
  const pnl = moves.length ? dayUsd : null;
  return (
    <div className="rise">
      <h2 className="mb-3.5 text-[20px] font-semibold tracking-[-0.02em]">Portfolio</h2>
      <Card className="mb-2.5 flex gap-2.5">
        <Stat
          label="Stocks"
          value={<span className={flash ? "text-success transition-colors" : "transition-colors duration-500"}>{usd(p.totalUsd)}</span>}
          sub={p.holdings.length === 0 ? "nothing held" : pnl !== null ? `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl)).slice(1)} today` : undefined}
          subClass={p.holdings.length === 0 ? "text-muted-2" : pnl !== null && pnl < 0 ? "text-danger-text" : "text-success"}
        />
        <Stat label="Cash" value={usd(p.cashUsd)} sub={session ? `${usd(session.remainingTodayUsd)} left today` : undefined} />
      </Card>

      {p.holdings.length === 0 ? (
        <Empty title="Nothing in here yet." body="Click any company name on the page and I'll offer to buy it." />
      ) : (
        <ul className="space-y-2">
          {p.holdings.map((h) => (
            <li key={h.mint} className="glass flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{h.name}</p>
                <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {shares(h.shares)} shares · {usd(h.priceUsd)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[15px] font-semibold tabular-nums">{usd(h.valueUsd)}</p>
                {h.dayChangePct !== null ? <p className={`mt-0.5 font-mono text-[11px] tabular-nums ${h.dayChangePct >= 0 ? "text-success" : "text-danger-text"}`}>{pct(h.dayChangePct)} today</p> : null}
              </div>
              <Button size="sm" variant="secondary" className="text-text-2" onClick={() => setSelling(h)} aria-label={`Sell ${h.name}`}>
                Sell
              </Button>
            </li>
          ))}
        </ul>
      )}

      {p.paused ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          I'm paused.{" "}
          <button type="button" className="text-accent-text underline-offset-2 hover:underline" onClick={onGoSettings}>
            Wake me in Settings
          </button>
        </p>
      ) : null}

      {selling ? (
        <SellDialog
          holding={selling}
          onClose={() => setSelling(null)}
          onSold={(m) => {
            setSelling(null);
            show(m, "ok");
            void q.refetch();
          }}
        />
      ) : null}
      {toast ? <Toast text={toast.text} kind={toast.kind} /> : null}
    </div>
  );
}

function SellDialog({ holding, onClose, onSold }: { holding: Holding; onClose: () => void; onSold: (msg: string) => void }) {
  const api = useApi();
  const max = holding.valueUsd ?? 0;
  const all = Math.floor(max);
  const options = [10, 25].filter((v) => v < all);
  const [amount, setAmount] = useState<number>(all);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sellingAll = amount >= all;
  return (
    <Dialog
      title={sellingAll ? `Sell all your ${holding.name}?` : `Sell $${amount} of ${holding.name}?`}
      body={
        <>
          {usd(sellingAll ? max : amount)} goes back to the vault as cash. You can buy back any time.
          {options.length ? (
            <span className="mt-3 flex flex-wrap gap-2" role="group" aria-label="How much">
              {options.map((v) => (
                <Chip key={v} selected={amount === v} onClick={() => setAmount(v)}>
                  ${v}
                </Chip>
              ))}
              <Chip selected={sellingAll} onClick={() => setAmount(all)}>
                All
              </Chip>
            </span>
          ) : null}
          {err ? (
            <span role="alert" className="mt-2 block text-danger-text">
              {err}
            </span>
          ) : null}
        </>
      }
      onClose={onClose}
    >
      <Button
        size="lg"
        className="flex-1"
        loading={busy}
        disabled={!(amount >= 1 && amount <= max + 0.01)}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await api.post<{ ok: true; message: string }>("/sell", sellingAll ? { inputMint: holding.mint, stockAmountRaw: holding.sharesRaw } : { inputMint: holding.mint, usd: amount });
          setBusy(false);
          if (isApiError(r)) setErr(r.message);
          else onSold(r.message);
        }}
      >
        Sell it
      </Button>
      <Button size="lg" variant="secondary" className="text-text-2" onClick={onClose}>
        Keep it
      </Button>
    </Dialog>
  );
}
