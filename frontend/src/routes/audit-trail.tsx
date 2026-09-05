import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, ChevronLeft, ChevronRight, LogIn, ScrollText } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { VerdictBadge } from "@/components/VerdictBadge";
import { LoadingState, ErrorState, EmptyState } from "@/components/AsyncState";
import { fetchAuditEvents, deleteAuditEvent, formatDate, ApiError } from "@/api";

export const Route = createFileRoute("/audit-trail")({
  head: () => ({
    meta: [
      { title: "Audit Trail — SNARE Compliance Log" },
      {
        name: "description",
        content:
          "Immutable log of verification runs, approvals, overrides and blacklist changes with actor, resource and result.",
      },
      { property: "og:title", content: "Audit Trail — SNARE Compliance Log" },
      {
        property: "og:description",
        content: "Filter compliance events by date, actor, resource and outcome.",
      },
    ],
  }),
  component: AuditTrailPage,
});

const PAGE_SIZE = 10;

function AuditTrailPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [resource, setResource] = useState("ALL");
  const [result, setResult] = useState("ALL");
  const [noticeError, setNoticeError] = useState<string | null>(null);

  const auditQuery = useQuery({
    queryKey: ["audit", page, resource, result],
    queryFn: () =>
      fetchAuditEvents({
        page,
        limit: PAGE_SIZE,
        resource: resource === "ALL" ? undefined : resource,
        result: result === "ALL" ? undefined : result,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAuditEvent(id),
    onSuccess: () => {
      setNoticeError(null);
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (err) => {
      setNoticeError(
        err instanceof ApiError ? err.message : "Failed to remove event. Please try again.",
      );
    },
  });

  const events = auditQuery.data?.data ?? [];
  const total = auditQuery.data?.pagination?.total ?? 0;
  const pages = auditQuery.data?.pagination?.pages ?? 1;

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle title="Audit trail" hi="लेखा परीक्षा विवरण" />
        <div className="flex gap-3">
          <div className="surface-card px-4 py-2.5">
            <p className="label-caps">Total Events</p>
            <p className="text-xl font-bold">{total.toLocaleString()}</p>
          </div>
          <div className="surface-card px-4 py-2.5">
            <p className="label-caps">Verifications Tracked</p>
            <p className="text-xl font-bold text-success">
              {events.filter((e) => e.resource === "VERIFICATION").length}
            </p>
          </div>
        </div>
      </div>

      {noticeError && (
        <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-destructive">
          {noticeError}
        </div>
      )}

      <div className="surface-card p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <select
            aria-label="Filter by resource"
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          >
            <option value="ALL">ALL RESOURCES</option>
            <option>VERIFICATION</option>
            <option>BLACKLIST</option>
            <option>REPORT</option>
            <option>LOG_IN</option>
          </select>
          <select
            aria-label="Filter by result"
            value={result}
            onChange={(e) => {
              setResult(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          >
            <option value="ALL">ALL RESULTS</option>
            <option>SUCCESS</option>
            <option>APPROVE</option>
            <option>REVIEW</option>
            <option>REJECT</option>
            <option>DENIED</option>
            <option>PENDING</option>
          </select>
        </div>

        {auditQuery.isLoading ? (
          <LoadingState label="Loading audit trail..." />
        ) : auditQuery.isError ? (
          <ErrorState message={(auditQuery.error as Error)?.message} onRetry={() => auditQuery.refetch()} />
        ) : events.length === 0 ? (
          <EmptyState message="No audit events match your filters." />
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Timestamp (UTC)", "Actor", "Resource", "Result", "Actions"].map((h) => (
                    <th key={h} className="label-caps whitespace-nowrap py-2 pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap py-3 pr-4 text-sm text-foreground tabular-nums">
                      <span className="flex items-center gap-1.5">
                        {row.resource === "LOG_IN" && <LogIn className="size-3.5 text-muted-foreground" />}
                        {row.resource === "REPORT" && <ScrollText className="size-3.5 text-muted-foreground" />}
                        {formatDate(row.createdAt)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString("en-US", {
                          timeZone: "UTC",
                          hour12: true,
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZoneName: "short",
                        })}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-medium">{row.actor ?? "system@identra"}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {row.resource}:{row.action}
                    </td>
                    <td className="py-3 pr-4">
                      <VerdictBadge verdict={row.result} />
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        aria-label="Delete log entry"
                        onClick={() => deleteMutation.mutate(row.id)}
                        className="text-destructive hover:opacity-70"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total} entries
          </p>
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="size-3.5" />
            </PageBtn>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, pages - 4));
              const p = start + i;
              return (
                <PageBtn key={p} active={p === page} onClick={() => setPage(p)}>
                  {p}
                </PageBtn>
              );
            })}
            <PageBtn onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
              <ChevronRight className="size-3.5" />
            </PageBtn>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PageBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex size-7 items-center justify-center rounded-md border text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : disabled
            ? "cursor-not-allowed border-border text-muted-foreground/40"
            : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}