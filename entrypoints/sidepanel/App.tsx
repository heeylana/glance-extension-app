import React, { useEffect, useMemo, useState } from "react";
import { CreditCard, Newspaper, Clock, Settings as SettingsIcon } from "lucide-react";
import { GlanceAuthProvider, useGlanceAuth } from "../../lib/auth";
import { useQuery, useStorageValue } from "./hooks";
import type { SessionView } from "../../lib/api-types";
import { Mark, Skeleton } from "./components/ui";
import { Onboarding, type OnboardingStep } from "./screens/Onboarding";
import { Portfolio } from "./screens/Portfolio";
import { Journal } from "./screens/Journal";
import { Waiting } from "./screens/Waiting";
import { Settings } from "./screens/Settings";

export function App() {
  return (
    <GlanceAuthProvider>
      <Shell />
    </GlanceAuthProvider>
  );
}

type Tab = "portfolio" | "journal" | "waiting" | "settings";

/** The panel chrome from the prototype: glass title bar, scrolling body, glass tab bar. */
function Shell() {
  const auth = useGlanceAuth();
  const [onboarding, setOnboarding] = useStorageValue<{ done: boolean; step: OnboardingStep }>("glance:onboarding", { done: false, step: "signin" });
  const session = useQuery<SessionView>((api) => api.get<SessionView>("/session"), [auth.owner], { enabled: auth.ready && auth.authenticated, pollMs: 15_000 });
  const [tab, setTab] = useState<Tab>("portfolio");
  const welcome = useMemo(() => new URLSearchParams(location.search).get("welcome") === "1", []);

  useEffect(() => {
    if (auth.ready && !auth.authenticated && onboarding.done) void setOnboarding({ done: false, step: "signin" });
  }, [auth.ready, auth.authenticated, onboarding.done, setOnboarding]);

  const needsOnboarding = !auth.ready || !auth.authenticated || !onboarding.done || (session.data ? session.data.needsAccount : false);
  const step: OnboardingStep = !auth.authenticated ? "signin" : session.data?.needsAccount !== false ? "account" : "tryit";

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "portfolio", label: "Portfolio", icon: <CreditCard size={19} strokeWidth={1.7} aria-hidden /> },
    { id: "journal", label: "Headlines", icon: <Newspaper size={19} strokeWidth={1.7} aria-hidden /> },
    { id: "waiting", label: "Waiting", icon: <Clock size={19} strokeWidth={1.7} aria-hidden /> },
    { id: "settings", label: "Settings", icon: <SettingsIcon size={19} strokeWidth={1.7} aria-hidden /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="glass-bar flex shrink-0 items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <Mark />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Glance</span>
        <span className="flex-1" />
        {session.data?.paused ? (
          <span className="rounded-full border border-border-strong bg-white/[0.07] px-2.5 py-1 font-mono text-[11px] text-warn" role="status">
            paused
          </span>
        ) : session.data?.needsRenewal ? (
          <span className="rounded-full border border-border-strong bg-white/[0.07] px-2.5 py-1 font-mono text-[11px] text-warn" role="status">
            renew
          </span>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
        {!auth.ready ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : needsOnboarding ? (
          <Onboarding step={step} session={session.data} refetchSession={session.refetch} onDone={() => void setOnboarding({ done: true, step: "tryit" })} welcome={welcome} />
        ) : (
          <>
            {tab === "portfolio" && <Portfolio session={session.data} onGoSettings={() => setTab("settings")} />}
            {tab === "journal" && <Journal />}
            {tab === "waiting" && <Waiting />}
            {tab === "settings" && <Settings session={session.data} refetchSession={session.refetch} />}
          </>
        )}
      </main>

      {auth.ready && !needsOnboarding ? (
        <nav className="glass-bar grid shrink-0 grid-cols-4 gap-0.5 border-t border-border px-1.5 pb-2.5 pt-2" aria-label="Sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-[10px] px-0.5 py-1.5 text-[11.5px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                tab === t.id ? "text-foreground" : "text-muted-2 hover:text-text-2"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
