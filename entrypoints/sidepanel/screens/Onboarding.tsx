import React, { useEffect, useState } from "react";
import { useGlanceAuth } from "../../../lib/auth";
import { useStorageValue } from "../hooks";
import type { SessionView } from "../../../lib/api-types";
import { Button, Card, Eyebrow, Tile } from "../components/ui";
import { SESSION_DAYS } from "../../../lib/config";

export type OnboardingStep = "signin" | "account" | "tryit";

const FUND_TILES = [25, 50, 100] as const;
const LIMIT_TILES = [5, 10, 25, 50] as const;

/**
 * Spec §7.2 in the prototype's voice. Wallet approvals happen in the web console (Phantom
 * cannot run inside an extension page): the panel collects the picks, the console asks for
 * the one approval, and the panel reflects on-chain state when the user comes back.
 */
export function Onboarding(p: { step: OnboardingStep; session: SessionView | null; refetchSession: () => Promise<void>; onDone: () => void; welcome: boolean }) {
  if (p.step === "signin") return <SignIn welcome={p.welcome} />;
  if (p.step === "account") return <Setup session={p.session} refetch={p.refetchSession} />;
  return <TryIt onDone={p.onDone} />;
}

function SignIn({ welcome }: { welcome: boolean }) {
  const auth = useGlanceAuth();
  const waiting = auth.signingIn;
  return (
    <div className="rise">
      <h1 className="mb-2 mt-1 text-[21px] font-semibold tracking-[-0.02em]">Hey. I'm Glance.</h1>
      <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
        {welcome ? "I'm installed. " : ""}I live in your sidebar and buy stocks in one tap. Connect a wallet and approve one message. It costs nothing and moves nothing.
      </p>
      <Card>
        {!waiting ? (
          <>
            <Eyebrow className="mb-3">Step 1 of 2</Eyebrow>
            <p className="mb-3.5 text-sm">Pick a wallet.</p>
            <Button size="lg" variant="phantom" className="w-full" onClick={() => void auth.signIn()}>
              <span className="h-5 w-5 rounded-[6px] bg-white/[0.22]" aria-hidden />
              Phantom
            </Button>
            <Button size="lg" variant="secondary" className="mt-2 w-full text-text-2" onClick={() => window.open("https://phantom.com/download", "_blank", "noopener")}>
              I don't have one yet
            </Button>
          </>
        ) : (
          <>
            <Eyebrow className="mb-3">Step 2 of 2</Eyebrow>
            <div className="mb-3.5 flex items-center gap-2.5 rounded-[10px] border border-[rgba(255,255,255,0.10)] bg-white/[0.07] px-3 py-2.5">
              <span className="h-[22px] w-[22px] rounded-[7px] bg-phantom" aria-hidden />
              <span className="font-mono text-[12.5px] text-text-2">Glance tab open</span>
              <span className="flex-1" />
              <span className="text-[11px] text-accent-text">waiting</span>
            </div>
            <p className="mb-3.5 text-sm">Approve the sign-in message in the Glance tab.</p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">This panel updates by itself once you have.</p>
          </>
        )}
        {auth.error ? (
          <p role="alert" className="mt-3 text-sm text-danger-text">
            {auth.error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/** SETUP 1 OF 2 (fund) and SETUP 2 OF 2 (limit) as in the prototype; the console takes the picks and asks for one approval. */
function Setup({ session, refetch }: { session: SessionView | null; refetch: () => Promise<void> }) {
  const auth = useGlanceAuth();
  const [stage, setStage] = useState<"fund" | "limit" | "console">("fund");
  const [fund, setFund] = useState<number>(50);
  const [limit, setLimit] = useState<number>(25);
  useEffect(() => {
    if (stage !== "console") return;
    const id = window.setInterval(() => void refetch(), 3000);
    return () => window.clearInterval(id);
  }, [stage, refetch]);

  if (stage === "fund") {
    return (
      <div className="rise">
        <Eyebrow className="mb-2.5 mt-1">Setup 1 of 2</Eyebrow>
        <h2 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">Fund the vault.</h2>
        <p className="mb-[18px] text-[13.5px] leading-relaxed text-muted-foreground">This is the only pot I can spend from. Nothing else in your wallet is reachable.</p>
        <div className="mb-3.5 grid grid-cols-3 gap-2" role="group" aria-label="Amount to add">
          {FUND_TILES.map((v) => (
            <Tile key={v} selected={fund === v} onClick={() => setFund(v)}>
              ${v}
            </Tile>
          ))}
        </div>
        <Button size="lg" className="w-full" onClick={() => setStage("limit")}>
          Fund ${fund}
        </Button>
        <p className="mt-3 font-mono text-[11px] text-muted-2">Test money on devnet. No real funds move.</p>
      </div>
    );
  }
  if (stage === "limit") {
    return (
      <div className="rise">
        <Eyebrow className="mb-2.5 mt-1">Setup 2 of 2</Eyebrow>
        <h2 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">Set my leash.</h2>
        <p className="mb-[18px] text-[13.5px] leading-relaxed text-muted-foreground">The most I can spend in any 24 hours. Past it, I stop and ask.</p>
        <div className="mb-3.5 grid grid-cols-2 gap-2" role="group" aria-label="Daily limit">
          {LIMIT_TILES.map((v) => (
            <Tile key={v} selected={limit === v} onClick={() => setLimit(v)}>
              ${v} / day
            </Tile>
          ))}
        </div>
        <Button
          size="lg"
          className="w-full"
          onClick={async () => {
            setStage("console");
            await auth.openConsole("/account", { action: "create", deposit: String(fund), cap: String(limit) });
          }}
        >
          Let's go
        </Button>
        <p className="mt-3 font-mono text-[11px] text-muted-2">One approval in Phantom, in the Glance tab. Change the leash any time in Settings.</p>
      </div>
    );
  }
  return (
    <div className="rise">
      <Eyebrow className="mb-2.5 mt-1">Almost there</Eyebrow>
      <h2 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">Approve it in the Glance tab.</h2>
      <p className="mb-[18px] text-[13.5px] leading-relaxed text-muted-foreground">
        One approval creates your vault with ${fund} in it and lets me buy up to ${limit} a day for {SESSION_DAYS} days. I can only buy real stocks into that vault and can never send money anywhere else.
      </p>
      <Card>
        <p className="text-sm text-text-2">{session?.exists ? "Vault found. One moment…" : "Waiting for your approval in Phantom…"}</p>
      </Card>
      <Button size="lg" variant="secondary" className="mt-3 w-full" onClick={() => void auth.openConsole("/account", { action: "create", deposit: String(fund), cap: String(limit) })}>
        Reopen the Glance tab
      </Button>
      <button type="button" className="mt-3 w-full text-center font-mono text-[11px] text-muted-2 hover:text-text-2" onClick={() => setStage("fund")}>
        Change the amounts
      </button>
    </div>
  );
}

function TryIt({ onDone }: { onDone: () => void }) {
  const [first] = useStorageValue<string | null>("glance:firstGlanceAt", null);
  const [seenAt] = useState(() => Date.now());
  const celebrated = !!first && new Date(first).getTime() >= seenAt - 60_000;
  useEffect(() => {
    if (celebrated) {
      const t = window.setTimeout(onDone, 2500);
      return () => window.clearTimeout(t);
    }
  }, [celebrated, onDone]);
  return (
    <div className="rise relative">
      {celebrated ? <Confetti /> : null}
      <Eyebrow className="mb-2.5 mt-1">All set</Eyebrow>
      <h2 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">{celebrated ? "That's a glance." : "Click a company on the page."}</h2>
      <p className="mb-[18px] text-[13.5px] leading-relaxed text-muted-foreground">
        {celebrated ? (
          "You're all set."
        ) : (
          <>
            Open any article about a company and press <kbd className="rounded-md border border-border-strong bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px]">⌥G</kbd>, or tap the dot in the corner of the page. I'll offer to buy it. You can also hold <kbd className="rounded-md border border-border-strong bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px]">⌥V</kbd> and say “buy ten dollars”.
          </>
        )}
      </p>
      <Button size="lg" variant="secondary" className="w-full" onClick={onDone}>
        Go to my portfolio
      </Button>
    </div>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 24 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden" aria-hidden>
      {pieces.map((_, i) => (
        <span key={i} className="absolute top-0 block h-2 w-1.5 rounded-sm" style={{ left: `${(i * 37) % 100}%`, background: i % 3 === 0 ? "var(--accent)" : i % 3 === 1 ? "var(--success)" : "var(--foreground)", animation: `fall ${1.6 + (i % 5) * 0.2}s cubic-bezier(.2,.7,.3,1) ${(i % 7) * 0.08}s forwards` }} />
      ))}
      <style>{`@keyframes fall{to{transform:translateY(110vh) rotate(360deg);opacity:.2}}`}</style>
    </div>
  );
}
