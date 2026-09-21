import React, { useEffect, useState } from "react";

/*
 * Side panel primitives in the glass design language (Claude Design prototype, 15 Sep 2026).
 * Buttons: accent primary, glass secondary, outlined ghost, red destructive, Phantom purple.
 * Cards are glass; empty states are dashed glass; numbers are IBM Plex Mono.
 */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "phantom" | "light";
  size?: "md" | "lg" | "sm";
  loading?: boolean;
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  const base = `inline-flex items-center justify-center gap-2 font-sans select-none transition-[background-color,border-color,color,transform] duration-100 ease-out active:translate-y-px disabled:opacity-60 disabled:pointer-events-none ${FOCUS}`;
  const variants = {
    primary: "bg-primary text-primary-foreground font-bold tracking-[-0.01em] hover:bg-primary-hover",
    secondary: "glass-btn text-foreground font-medium",
    ghost: "bg-transparent border border-border-solid text-muted-foreground font-medium hover:text-foreground hover:border-[#45455a]",
    destructive: "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive-hover",
    phantom: "bg-phantom text-white font-semibold hover:bg-phantom-hover",
    light: "bg-foreground text-[#111] font-semibold hover:bg-white",
  } as const;
  const sizes = { sm: "h-9 px-3.5 rounded-[10px] text-[13px]", md: "h-10 px-4 rounded-[10px] text-[13.5px]", lg: "h-11 px-5 rounded-xl text-sm" } as const;
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 rounded-full border-2 border-border-solid border-t-primary motion-safe:animate-spin ${className}`} aria-hidden />;
}

export function Card({ className = "", children, as: Tag = "section" }: { className?: string; children: React.ReactNode; as?: "section" | "div" }) {
  return <Tag className={`glass p-4 text-card-foreground ${className}`}>{children}</Tag>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-[10px] bg-white/[0.06] motion-safe:animate-pulse ${className}`} aria-hidden />;
}

/** Mono, uppercase, letter-spaced label ("STEP 1 OF 2"). */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`eyebrow ${className}`}>{children}</p>;
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger-text" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass = `h-10 w-full rounded-[10px] border border-input bg-white/[0.06] px-3 text-sm text-foreground placeholder:text-muted-2 ${FOCUS}`;

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="dashed flex flex-col items-center justify-center gap-3 px-5 py-8 text-center">
      {icon ? (
        <div className="grid h-9 w-9 place-items-center rounded-full border-2 border-border-solid text-muted-2" aria-hidden>
          {icon}
        </div>
      ) : (
        <div className="grid h-9 w-9 place-items-center rounded-full border-2 border-border-solid" aria-hidden>
          <span className="h-[9px] w-[9px] rounded-full bg-[#3f3f4c]" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm text-text-2">{title}</p>
        {body ? <p className="mx-auto max-w-[30ch] text-[13px] leading-relaxed text-[#7a7a86]">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="glass flex items-start justify-between gap-3 p-3 text-sm">
      <span className="text-text-2">{message}</span>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Big mono number with a small label above and an optional line under it. */
export function Stat({ label, value, sub, subClass = "text-muted-2", mono = true }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subClass?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[25px] font-semibold leading-none tracking-[-0.02em] ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
      {sub ? <p className={`mt-1.5 font-mono text-[11.5px] tabular-nums ${subClass}`}>{sub}</p> : null}
    </div>
  );
}

/** Prototype switch: 46×26 track, dark knob. */
export function Toggle({ id, label, checked, onChange, hint, disabled }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        {label ? (
          <label htmlFor={id} className={`text-sm font-medium ${disabled ? "text-[#7a7a86]" : ""}`}>
            {label}
          </label>
        ) : null}
        {hint ? <p className="text-[12.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative flex h-[26px] w-[46px] shrink-0 items-center rounded-full border border-border-strong p-[2px] transition-colors duration-150 ${checked ? "bg-primary" : "bg-white/10"} ${disabled ? "opacity-60" : ""} ${FOCUS}`}
      >
        <span className={`h-5 w-5 rounded-full bg-[#0b0b10] shadow-[0_1px_3px_rgba(0,0,0,0.55)] transition-transform duration-150 ease-[cubic-bezier(.2,.8,.2,1)] ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

/** Amount chip: pill, mono, accent when selected. */
export function Chip({ selected, className = "", children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex h-9 items-center justify-center rounded-full border px-4 font-mono text-[13px] tabular-nums transition-colors duration-100 ${
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border-solid bg-chip text-text-2 hover:border-[#45455a]"
      } ${FOCUS} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Big selectable tile (fund / limit pickers), 52px tall. */
export function Tile({ selected, className = "", children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex h-[52px] items-center justify-center rounded-xl border px-3 font-mono text-[15px] tabular-nums transition-colors duration-100 ${
        selected ? "border-primary bg-primary text-primary-foreground" : "border-border-solid bg-chip text-text-2 hover:border-[#45455a]"
      } ${FOCUS} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Row inside a glass card: title + mono detail on the left, an action on the right. */
export function Row({ title, detail, action, detailMono = true }: { title: React.ReactNode; detail?: React.ReactNode; action?: React.ReactNode; detailMono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold tracking-[-0.01em]">{title}</p>
        {detail ? <p className={`mt-0.5 text-[11.5px] text-muted-foreground ${detailMono ? "font-mono" : "text-[12.5px]"}`}>{detail}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Hairline({ className = "my-3.5" }: { className?: string }) {
  return <div className={`hairline ${className}`} aria-hidden />;
}

/** Amount slider with a visible value; native range for keyboard support. */
export function AmountSlider({ id, label, value, min, max, step = 1, onChange, format = (v: number) => `$${v}` }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-sm font-semibold tabular-nums">
          {format(value)}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full accent-[var(--accent)]" />
      <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

/** Glass pill toast, bottom centre, with a coloured dot for the kind. */
export function Toast({ text, kind = "ok" }: { text: string; kind?: "ok" | "warn" | "wait" | "err" }) {
  const dot = { ok: "bg-success", warn: "bg-warn", wait: "bg-accent-text", err: "bg-danger-text" }[kind];
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(26,26,34,0.72)] px-[18px] py-3 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-[24px] backdrop-saturate-[160%] motion-safe:animate-[glance-toast_200ms_ease-out_both]">
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="text-[13.5px] text-foreground">{text}</span>
    </div>
  );
}

/** Centred glass dialog with a scrim. Escape closes. */
export function Dialog({ title, body, children, onClose }: { title: string; body?: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,6,9,0.62)] p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="rise w-[340px] max-w-full rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(24,24,32,0.66)] p-5 shadow-[0_30px_70px_rgba(0,0,0,0.5)] backdrop-blur-[32px] backdrop-saturate-[170%]" onClick={(e) => e.stopPropagation()}>
        <h3 id="dlg-title" className="text-[17px] font-semibold tracking-[-0.01em]">
          {title}
        </h3>
        {body ? <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p> : null}
        <div className="mt-[18px] flex gap-2">{children}</div>
      </div>
    </div>
  );
}

/** Brand mark: the Glance eye on the accent square (public/logo.svg). */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-[5px] bg-primary text-primary-foreground" style={{ width: size, height: size }} aria-hidden>
      <img src="/logo.svg" alt="" style={{ width: Math.round(size * 0.74) }} className="brightness-0 invert" />
    </span>
  );
}

/** A value that flashes briefly when it changes (portfolio ticking up). */
export function useFlash(value: unknown): boolean {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 600);
    return () => window.clearTimeout(t);
  }, [value]);
  return flash;
}
