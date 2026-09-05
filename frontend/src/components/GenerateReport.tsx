import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchScans, fetchStats, fetchBlacklist, type ScanRecord, type Stats } from "@/api";

const REPORT_TYPES = [
  "Verification Summary",
  "Risk Analysis",
  "Blacklist Activity",
  "Verification History",
] as const;

const RANGE_LABELS: Record<string, string> = {
  "7": "Last 7 Days",
  "30": "Last 30 Days",
  "90": "Last 90 Days",
};
const DEFAULT_RANGE = "30";

export function GenerateReport() {
  const scansQuery = useQuery({ queryKey: ["scans", "generate-report"], queryFn: () => fetchScans({ limit: 100 }) });
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const blacklistQuery = useQuery({ queryKey: ["blacklist", "generate-report"], queryFn: () => fetchBlacklist() });

  const [showGenerate, setShowGenerate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genType, setGenType] = useState<(typeof REPORT_TYPES)[number]>("Verification Summary");
  const [genRange, setGenRange] = useState(DEFAULT_RANGE);
  const [genFormat, setGenFormat] = useState<"PDF" | "CSV">("PDF");
  const [noticeError, setNoticeError] = useState<string | null>(null);

  const officer = useAuth().officer;
  const stats = statsQuery.data;
  const allScans = scansQuery.data?.data ?? [];
  const blacklist = blacklistQuery.data ?? [];

  const openGenerateModal = () => {
    setGenerating(false);
    setNoticeError(null);
    setShowGenerate(true);
  };

  const handleGenerate = () => {
    setGenerating(true);
    setNoticeError(null);
    window.setTimeout(() => {
      setGenerating(false);
      setShowGenerate(false);
      setShowPreview(true);
    }, 900);
  };

  const downloadReport = () => {
    try {
      generateReportFile(genType, genFormat, stats, allScans, blacklist, officer?.name ?? "Officer");
    } catch (e) {
      setNoticeError(e instanceof Error ? e.message : "Unable to generate report file.");
    }
  };

  return (
    <>
      <button
        onClick={openGenerateModal}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <FilePlus2 className="size-4" /> Generate Report
      </button>

      {showGenerate && (
        <Modal onClose={() => setShowGenerate(false)}>
          <ModalHeader icon={<FilePlus2 className="size-4" />} title="Generate Report" onClose={() => setShowGenerate(false)} />
          <div className="space-y-4 text-sm">
            <Field label="Report Type">
              <select
                value={genType}
                onChange={(e) => setGenType(e.target.value as (typeof REPORT_TYPES)[number])}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Date Range">
              <select
                value={genRange}
                onChange={(e) => setGenRange(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              >
                {Object.entries(RANGE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <div className="flex gap-4">
                {(["PDF", "CSV"] as const).map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="genFormat"
                      value={f}
                      checked={genFormat === f}
                      onChange={() => setGenFormat(f)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    <span className="text-sm text-foreground/80">{f}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
          {noticeError && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-destructive">{noticeError}</p>}
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              onClick={() => setShowGenerate(false)}
              disabled={generating}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
              {generating ? "Generating..." : "Generate"}
            </button>
          </div>
        </Modal>
      )}

      {showPreview && (
        <Modal onClose={() => setShowPreview(false)}>
          <ModalHeader icon={<Download className="size-4 text-success" />} title="Report Generated" onClose={() => setShowPreview(false)} />
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <h4 className="font-bold">{genType}</h4>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <PreviewStat label="Date Range" value={`${formatRangeStart(genRange)} – ${formatToday()}`} />
              <PreviewStat label="Total Verifications" value={previewCount(genType, allScans, stats).total.toString()} />
              <PreviewStat label="Approved" value={previewCount(genType, allScans, stats).approved.toString()} />
              <PreviewStat label="Needs Review" value={previewCount(genType, allScans, stats).review.toString()} />
              <PreviewStat label="High Risk" value={previewCount(genType, allScans, stats).rejected.toString()} />
            </div>
            <p className="text-xs text-muted-foreground">
              Generated from live verification records. Choose a format below to download.
            </p>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              onClick={() => setShowPreview(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-muted"
            >
              Close
            </button>
            <button
              onClick={downloadReport}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {genFormat === "CSV" ? <FileSpreadsheet className="size-4" /> : <Download className="size-4" />}
              Download {genFormat}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function previewCount(type: string, scans: ScanRecord[], stats: Stats | undefined) {
  if (type === "Verification Summary") {
    const total = stats?.totalScans ?? (scans.length ?? 0);
    const approved = stats?.approved ?? scans.filter((s) => s.verdict === "APPROVE").length;
    const review = stats?.review ?? scans.filter((s) => s.verdict === "REVIEW").length;
    const rejected = stats?.rejected ?? scans.filter((s) => s.verdict === "REJECT").length;
    return { total, approved, review, rejected };
  }
  const fromMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const inRange = scans.filter((s) => new Date(s.createdAt).getTime() >= fromMs);
  return {
    total: inRange.length,
    approved: inRange.filter((s) => s.verdict === "APPROVE").length,
    review: inRange.filter((s) => s.verdict === "REVIEW").length,
    rejected: inRange.filter((s) => s.verdict === "REJECT").length,
  };
}

function formatRangeStart(days: string) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function formatToday() {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-caps block pb-1">{label}</label>
      {children}
    </div>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
      <h3 className="flex items-center gap-1.5 text-sm font-bold">{icon}{title}</h3>
      <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function generateReportFile(
  type: string,
  format: "PDF" | "CSV",
  stats: Stats | undefined,
  scans: ScanRecord[],
  blacklist: Record<string, unknown>[],
  officerName: string,
) {
  const now = new Date();
  const genDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fromMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const inRange = scans.filter((s) => new Date(s.createdAt).getTime() >= fromMs);
  const picked = previewCount(type, scans, stats);

  if (format === "CSV") {
    const rows = inRange.map((s) => [
      s.id,
      String(s.extractedData?.documentNumber ?? s.documentType ?? "Passport"),
      s.documentType,
      s.verdict,
      String(s.riskScore),
      s.createdAt,
      s.reviewedBy ?? "",
    ]);
    const header = ["Verification ID", "Document Number", "Document Type", "Verdict", "Risk Score", "Date", "Reviewer"];
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    downloadBlob(csv, `SNARE_${type.replace(/\s+/g, "_")}_${genDate.replace(/\s+/g, "_")}.csv`, "text/csv");
    return;
  }

  const lines: string[] = [
    "IDENTRA AI — SNARE Verification Console",
    "AI-Powered Identity & Document Screening System",
    "Verification Report",
    "",
    "Report Type: " + type,
    "Date Range: Last 30 Days",
    "Generated Date: " + genDate,
    "Generated By: " + officerName,
    "",
  ];

  if (type === "Blacklist Activity") {
    lines.push("BLACKLIST ACTIVITY REPORT");
    lines.push("Total Blacklist Records: " + (blacklist.length || (stats?.blacklisted ?? 0)).toLocaleString());
    lines.push("Recent Matches: " + blacklist.length);
    lines.push("");
    lines.push("Document Number\tReason\tDate Added");
    blacklist.forEach((r) => {
      lines.push(
        `${String((r as Record<string, unknown>).documentNumber ?? "")}\t${String((r as Record<string, unknown>).reason ?? "")}\t${String((r as Record<string, unknown>).createdAt ?? "")}`,
      );
    });
  } else {
    lines.push("SUMMARY STATISTICS");
    lines.push("Total Verifications: " + picked.total.toLocaleString());
    lines.push("Approved: " + picked.approved.toLocaleString());
    lines.push("Needs Review: " + picked.review.toLocaleString());
    lines.push("High Risk: " + picked.rejected.toLocaleString());
    lines.push("");
    lines.push("VERIFICATION ACTIVITY");
    inRange.slice(0, 20).forEach((s) =>
      lines.push(
        `${new Date(s.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}: ${s.id} — ${s.verdict} (risk ${s.riskScore})`,
      ),
    );
    lines.push("");
    lines.push("VERIFICATION RESULTS");
    lines.push("Approved: " + (picked.total ? Math.round((picked.approved / picked.total) * 100) : 0) + "%");
    lines.push("Needs Review: " + (picked.total ? Math.round((picked.review / picked.total) * 100) : 0) + "%");
    lines.push("Rejected: " + (picked.total ? Math.round((picked.rejected / picked.total) * 100) : 0) + "%");
  }
  lines.push("");
  lines.push("— End of Report —");

  downloadBlob(lines.join("\n"), `SNARE_${type.replace(/\s+/g, "_")}_${genDate.replace(/\s+/g, "_")}.txt`, "text/plain");
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}