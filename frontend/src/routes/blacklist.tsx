import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusCircle, Info, Search, Trash2, FileText } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { LoadingState, ErrorState, EmptyState } from "@/components/AsyncState";
import { useAuth } from "@/lib/auth";
import {
  fetchBlacklist,
  addBlacklistEntry,
  deleteBlacklistEntry,
  formatDate,
  ApiError,
  type BlacklistEntry,
} from "@/api";

export const Route = createFileRoute("/blacklist")({
  head: () => ({
    meta: [
      { title: "Blacklist Admin — SNARE" },
      {
        name: "description",
        content:
          "Add, monitor and manage revoked or fraudulent identity document entries used during KYC screening.",
      },
      { property: "og:title", content: "Blacklist Admin — SNARE" },
      {
        property: "og:description",
        content: "Manage blocked document numbers and the reasons behind each blacklist entry.",
      },
    ],
  }),
  component: BlacklistAdmin,
});

function BlacklistAdmin() {
  const { officer } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [number, setNumber] = useState("");
  const [docType, setDocType] = useState("Passport");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);

  const entryQuery = useQuery({
    queryKey: ["blacklist", query],
    queryFn: () => fetchBlacklist(query),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      addBlacklistEntry({
        documentNumber: number,
        reason: reason || undefined,
        addedBy: officer?.name ?? "Officer",
        documentType: docType,
      }),
    onSuccess: () => {
      setNumber("");
      setReason("");
      setNotice("Document added to the blacklist.");
      setNoticeError(null);
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      setNoticeError(
        err instanceof ApiError ? err.message : "Failed to add entry. Please try again.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: BlacklistEntry) => deleteBlacklistEntry(entry.id),
    onSuccess: (_data, entry) => {
      setNotice(`${entry.documentNumber} removed from the blacklist.`);
      setNoticeError(null);
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => {
      setNoticeError(
        err instanceof ApiError ? err.message : "Failed to remove entry. Please try again.",
      );
    },
  });

  const entries = entryQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const addedToday = entries.filter((e) => e.createdAt.slice(0, 10) === today).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) return;
    addMutation.mutate();
  };

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Blacklist Admin"
          hi="काली सूची प्रशासन"
          sub="Add, monitor and manage revoked or fraudulent identity document entries."
        />
        <div className="flex gap-3">
          <div className="surface-card px-4 py-2.5">
            <p className="label-caps">Total Blocked</p>
            <p className="text-xl font-bold">{entryQuery.data?.length.toLocaleString() ?? "—"}</p>
          </div>
          <div className="surface-card px-4 py-2.5">
            <p className="label-caps">Added Today</p>
            <p className="text-xl font-bold text-success">+{addedToday}</p>
          </div>
        </div>
      </div>

      {(notice || noticeError) && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            noticeError ? "bg-danger-soft text-destructive" : "bg-success-soft text-success"
          }`}
        >
          {noticeError ?? notice}
        </div>
      )}

      <form className="surface-card p-5" onSubmit={submit}>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <PlusCircle className="size-4 text-primary" /> Add New Blacklisted Document
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Document Type *">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {["Passport", "Driver's License", "National ID"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Document Number *">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="NLD8840192A"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </Field>
          <Field label="Reason for Blacklist (optional)">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Identity theft, reported stolen..."
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> Ensure document checks have been fully audited before
            manual lock.
          </p>
          <button
            type="submit"
            disabled={!number.trim() || addMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusCircle className="size-4" />
            {addMutation.isPending ? "Adding..." : "Add to Blacklist"}
          </button>
        </div>
      </form>

      <div className="surface-card mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Blacklisted Entries{" "}
            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {entries.length} entries
            </span>
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entries..."
              className="rounded-lg border border-border bg-card py-1.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>

        {entryQuery.isLoading ? (
          <LoadingState label="Loading blacklist entries..." />
        ) : entryQuery.isError ? (
          <ErrorState message={(entryQuery.error as Error)?.message} onRetry={() => entryQuery.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState message="No blacklist entries found." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Document Type", "Document Number", "Reason", "Added By", "Date Added", "Actions"].map(
                    (h) => (
                      <th key={h} className="label-caps whitespace-nowrap py-2 pr-4">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4">
                      <span className="flex items-center gap-2 font-medium">
                        <FileText className="size-4 text-primary" /> {e.documentType ?? "Passport"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">{e.documentNumber}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-md bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-destructive">
                        {e.reason}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{e.addedBy ?? "System"}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(e.createdAt)}</td>
                    <td className="py-3 pr-4">
                      <button
                        aria-label={`Remove ${e.documentNumber}`}
                        onClick={() => deleteMutation.mutate(e)}
                        disabled={deleteMutation.isPending}
                        className="text-destructive transition-opacity hover:opacity-70 disabled:opacity-40"
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
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-caps mb-1.5">{label}</p>
      {children}
    </div>
  );
}