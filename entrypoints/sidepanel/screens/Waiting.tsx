import React from "react";
import { useApi, useQuery } from "../hooks";
import type { WatchRow } from "../../../lib/api-types";
import { timeAgo } from "../../../lib/format";
import { Button, Empty, ErrorBox, Skeleton } from "../components/ui";

/** Spec §7.7 "Waiting on the headline": companies glanced but not on-chain yet, in the prototype's Waiting look. */
export function Waiting() {
  const q = useQuery<{ ok: true; watchlist: WatchRow[] }>((api) => api.get("/watchlist"), []);
  const api = useApi();
  if (q.loading && !q.data) {
    return (
      <div className="space-y-2.5" aria-busy>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (q.error && !q.data) return <ErrorBox message={q.error.message} onRetry={() => void q.refetch()} />;
  const rows = q.data?.watchlist ?? [];
  return (
    <div className="rise">
      <h2 className="mb-1.5 text-[20px] font-semibold tracking-[-0.02em]">Waiting</h2>
      <p className="mb-3.5 text-[13px] text-muted-foreground">Companies you glanced that aren't on-chain yet. I'll tell you when they are.</p>
      {rows.length === 0 ? (
        <Empty title="Queue's empty." body="When a company isn't on-chain yet, tap “Tell me when” and it lands here." />
      ) : (
        <ul className="space-y-2">
          {rows.map((w) => (
            <li key={w.companyId} className="glass flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">{w.name}</p>
                <p className={`mt-0.5 font-mono text-[11.5px] ${w.nowTokenized ? "text-success" : "text-muted-foreground"}`}>{w.nowTokenized ? "Now available" : `Added ${timeAgo(w.createdAt)}`}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="hover:border-[#5a3a36] hover:text-danger-text"
                aria-label={`Stop waiting for ${w.name}`}
                onClick={async () => {
                  await api.delete(`/watchlist/${w.companyId}`);
                  void q.refetch();
                }}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
