import React, { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { useApi, useQuery } from "../hooks";
import type { JournalEntry } from "../../../lib/api-types";
import { pct, timeAgo } from "../../../lib/format";
import { Button, Empty, ErrorBox, Skeleton, inputClass } from "../components/ui";

type Sort = "newest" | "best" | "worst";

/** Spec §7.7 "Headlines you own" in the prototype's card: ticker pill, move, time, the headline, actions. */
export function Journal() {
  const q = useQuery<{ ok: true; entries: JournalEntry[] }>((api) => api.get("/journal"), [], { pollMs: 30_000 });
  const api = useApi();
  const [sort, setSort] = useState<Sort>("newest");
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");

  if (q.loading && !q.data) {
    return (
      <div className="space-y-2.5" aria-busy>
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (q.error && !q.data) return <ErrorBox message={q.error.message} onRetry={() => void q.refetch()} />;
  const entries = [...(q.data?.entries ?? [])].sort((a, b) =>
    sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : sort === "best" ? (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) : (a.changePct ?? Infinity) - (b.changePct ?? Infinity),
  );
  return (
    <div className="rise">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Headlines</h2>
        {entries.length > 1 ? (
          <>
            <label className="sr-only" htmlFor="sort">
              Sort
            </label>
            <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${inputClass} h-8 w-auto rounded-[9px] px-2.5 text-[12.5px]`}>
              <option value="newest">Newest</option>
              <option value="best">Best thesis</option>
              <option value="worst">Worst thesis</option>
            </select>
          </>
        ) : null}
      </div>
      <p className="mb-3.5 text-[13px] text-muted-foreground">The stories you bought from, and how they aged.</p>
      {entries.length === 0 ? (
        <Empty title="No headlines yet." body="Every buy keeps the story behind it. Your first one lands here." />
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="glass px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-md bg-accent-soft px-[7px] py-[3px] font-mono text-[11px] text-accent-text">{e.ticker}</span>
                {e.changePct !== null ? <span className={`font-mono text-[11px] tabular-nums ${e.changePct >= 0 ? "text-success" : "text-danger-text"}`}>{pct(e.changePct, 1)}</span> : null}
                <span className="flex-1" />
                <span className="font-mono text-[10.5px] text-muted-2">{timeAgo(e.createdAt)}</span>
              </div>
              <p className="mb-2.5 text-sm leading-snug text-[#e8e8ee]" style={{ textWrap: "pretty" } as React.CSSProperties}>
                {e.title || `Bought ${e.name}`}
              </p>
              <p className="font-mono text-[11.5px] tabular-nums text-muted-foreground">{e.line}</p>
              {editing === e.id ? (
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    await api.patch(`/journal/${e.id}`, { note: note || null });
                    setEditing(null);
                    void q.refetch();
                  }}
                >
                  <label className="sr-only" htmlFor={`note-${e.id}`}>
                    Note
                  </label>
                  <input id={`note-${e.id}`} className={`${inputClass} h-9`} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why you bought it" autoFocus />
                  <Button size="sm" type="submit">
                    Save
                  </Button>
                </form>
              ) : e.note ? (
                <p className="mt-2 text-[13px] leading-snug text-text-3">“{e.note}”</p>
              ) : null}
              <div className="mt-2.5 flex items-center gap-2">
                {e.url && !e.url.startsWith("script://") ? (
                  <a href={e.url} target="_blank" rel="noopener" className="glass-btn inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] text-accent-text hover:border-primary hover:text-[#c3d3ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ExternalLink size={12} aria-hidden /> Open story
                  </a>
                ) : null}
                {editing !== e.id ? (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-[9px] px-2 text-[12.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setEditing(e.id);
                      setNote(e.note ?? "");
                    }}
                  >
                    {e.note ? "Edit note" : "Add a note"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ml-auto inline-flex h-8 items-center gap-1 rounded-[9px] px-2 text-[12.5px] text-muted-2 hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={async () => {
                    await api.delete(`/journal/${e.id}`);
                    void q.refetch();
                  }}
                  aria-label={`Delete entry for ${e.name}`}
                >
                  <Trash2 size={13} aria-hidden /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
