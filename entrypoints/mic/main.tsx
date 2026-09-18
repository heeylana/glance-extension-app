import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "../../assets/globals.css";
import { Button, Card, Eyebrow, Mark } from "../sidepanel/components/ui";
import { watchMicPermission, type MicState } from "../../lib/mic";

/**
 * The one place Glance asks for the microphone (spec §7.1). The push-to-talk recorder is an offscreen
 * document, which cannot show a permission prompt, so the grant happens here on the extension's own
 * origin and the recorder inherits it. Opened from Settings or from the bubble when a take is refused.
 */
function MicSetup() {
  const [state, setState] = useState<MicState | "checking" | "missing" | "asking">("checking");
  const asked = useRef(false);

  const ask = async () => {
    asked.current = true;
    setState("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setState("granted");
    } catch (e) {
      setState(e instanceof DOMException && e.name === "NotFoundError" ? "missing" : "denied");
    }
  };

  useEffect(
    () =>
      watchMicPermission((s) => {
        setState((cur) => (cur === "asking" ? cur : s));
        // Arriving here is the user's request for the prompt; show it once without another click.
        if (s === "prompt" && !asked.current) void ask();
      }),
    [],
  );

  const kbd = (k: string) => <kbd className="rounded-md border border-border-strong bg-white/[0.07] px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd>;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Mark />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Glance</span>
      </div>
      <Card>
        <Eyebrow className="mb-2.5">Talk to Glance</Eyebrow>
        {state === "granted" ? (
          <>
            <h1 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">I can hear you now.</h1>
            <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
              On any story, hold {kbd("⌥V")} or hold the dot in the corner, say what you want, and let go. I only listen while you hold.
            </p>
            <Button size="lg" variant="secondary" className="w-full" onClick={() => window.close()}>
              Close this tab
            </Button>
          </>
        ) : state === "denied" ? (
          <>
            <h1 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">The microphone is blocked.</h1>
            <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
              Click the icon at the right end of the address bar, allow the microphone for Glance, then try again. Tapping still works without it.
            </p>
            <Button size="lg" className="w-full" onClick={() => void ask()}>
              Try again
            </Button>
          </>
        ) : state === "missing" ? (
          <>
            <h1 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">I can't find a microphone.</h1>
            <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">Plug one in or pick one in your system settings, then try again.</p>
            <Button size="lg" className="w-full" onClick={() => void ask()}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-[21px] font-semibold tracking-[-0.02em]">Let Glance hear you.</h1>
            <p className="mb-5 text-[13.5px] leading-relaxed text-muted-foreground">
              Hold {kbd("⌥V")} on a story and say “buy ten dollars”, “why did it move?” or “no”. Your browser asks once; sites never see the microphone.
            </p>
            <Button size="lg" className="w-full" loading={state === "asking" || state === "checking"} onClick={() => void ask()}>
              Allow microphone
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MicSetup />
  </React.StrictMode>,
);
