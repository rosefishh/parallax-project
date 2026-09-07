import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, ChevronLeft, ChevronRight, FileText, Flag } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { VerdictBadge } from "@/components/VerdictBadge";
import { LoadingState, ErrorState, EmptyState } from "@/components/AsyncState";
import { fetchScans, downloadPdfReport, formatDate } from "@/api";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Verification History — SNARE" },
      {
        name: "description",
        content:
          "Browse, filter and export past identity verification records with verdicts, timestamps and reviewers.",
      },
      { property: "og:title", content: "Verification History — SNARE" },
      {
        property: "og:description",
        content: "Searchable archive of every KYC verification run in your workspace.",
      },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 10;
const VERDICT_OPTIONS = ["All", "APPROVE", "REVIEW", "REJECT"];

function HistoryPage() {
  const [page, setPage] = useState(1);
  const [verdict, setVerdict] = useState("All");
  const [query, setQuery] = useState("");

  const { isLoading, isError, error, data, refetch } = useQuery({
    queryKey: ["scans", "history", page, verdict],
    queryFn: () => fetchScans({ page, limit: PAGE_SIZE, status: verdict === "All" ? undefined : verdict }),
  });

  const rows = useMemo(() => {
    const scans = data?.data ?? [];
    if (!query.trim()) return scans;
    const q = query.toLowerCase();
    return scans.filter(
      (scan) =>
        scan.id.toLowerCase().includes(q) ||
        String(scan.extractedData?.documentNumber ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  const exportCsv = () => {
    const header = ["Verification ID", "Document Number", "Verdict", "Risk Score", "Date", "Review Flag"];
    const lines = (data?.data ?? []).map((scan) =>
      [
        scan.id,
        String(scan.extractedData?.documentNumber ?? ""),
        scan.verdict,
        scan.riskScore,
        scan.createdAt,
        scan.needsReview ? "FLAGGED" : "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "snare-verification-history.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const total = data?.pagination?.total ?? 0;
  const pages = data?.pagination?.pages ?? 1;

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Verification History"
          hi="इतिहास"
          sub="Browse and export past verification records."
        />
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" /> Export CSV
        </button>
      </div>

      <div className="surface-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by ID or document number..."
              className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Verdict:
            <select
              value={verdict}
              onChange={(e) => {
                setVerdict(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm font-medium text-foreground outline-none"
            >
              {VERDICT_OPTIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <LoadingState label="Loading verification history..." />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState message="No verifications match your filters yet." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {[
                    "Verification ID",
                    "Document",
                    "Document Type",
                    "Verdict",
                    "Risk Score",
                    "Date",
                    "Actions",
                  ].map((h) => (
                      <th key={h} className="label-caps whitespace-nowrap py-2 pr-4">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((scan) => (
                  <tr key={scan.id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {scan.id.slice(0, 13)}
                    </td>
                    <td className="py-3 pr-4 font-semibold">
                      {String(scan.extractedData?.documentNumber ?? (scan.documentType || "Passport"))}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-bold text-success">
                        {scan.documentType}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="flex items-center gap-1.5">
                        <VerdictBadge verdict={scan.verdict} />
                        {scan.needsReview && (
                          <span title="Flagged for manual review">
                            <Flag className="size-3.5 text-warning-foreground" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{scan.riskScore}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(scan.createdAt)}</td>
                    <td className="py-3 pr-4">
                      <span className="flex items-center gap-2">
                        <Link
                          to="/verification-complete"
                          search={{ scanId: scan.id }}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          <FileText className="mr-1 inline size-3.5" />
                          Report
                        </Link>
                        <button
                          onClick={() => downloadPdfReport(scan.id)}
                          aria-label={`Download PDF for ${scan.id}`}
                          className="text-xs font-semibold text-muted-foreground hover:text-primary"
                        >
                          <Download className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total} results
          </p>
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className="size-3.5" />
            </PageBtn>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 3, pages - 6));
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