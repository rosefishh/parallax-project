import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Flag, FlagOff, ShieldCheck, BatteryMedium, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AsyncBoundary } from "@/components/AsyncState";
import { fetchScan, reviewScan, downloadPdfReport, resolveApiUrl, formatDate } from "@/api";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/verification-complete")({
  validateSearch: (search: Record<string, unknown>) => ({
    scanId: typeof search.scanId === "string" ? search.scanId : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Verification Complete — SNARE Report" },
      {
        name: "description",
        content:
          "Risk score, document authenticity, face match, blacklist status and extracted document data for a completed SNARE screening.",
      },
      { property: "og:title", content: "Verification Complete — SNARE Report" },
      {
        property: "og:description",
        content: "Full findings and extracted document data for the completed SNARE screening.",
      },
    ],
  }),
  component: VerificationComplete,
});

function VerificationComplete() {
  const { scanId } = Route.useSearch();

  const scanQuery = useQuery({
    queryKey: ["scan", scanId],
    queryFn: () => fetchScan(scanId!),
    enabled: !!scanId,
  });

  if (!scanId) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl">
          <div className="surface-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No verification selected. Start a new screening to generate a report.
            </p>
            <Link to="/new-verification" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
              New Verification
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <AsyncBoundary
          isLoading={scanQuery.isLoading}
          isError={scanQuery.isError}
          errorMessage={(scanQuery.error as Error)?.message}
        >
          <ResultCard scanId={scanId} />
        </AsyncBoundary>
      </div>
    </AppShell>
  );
}

function ResultCard({ scanId }: { scanId: string }) {
  const queryClient = useQueryClient();
  const { officer } = useAuth();
  const officerName = officer?.name ?? "Officer";
  const scanQuery = useQuery({ queryKey: ["scan", scanId], queryFn: () => fetchScan(scanId) });
  const scan = scanQuery.data;
  if (!scan) return null;

  const reviewMutation = useMutation({
    mutationFn: (flag: boolean) => reviewScan(scanId, flag, officerName),
    onSuccess: (updated) => {
      queryClient.setQueryData(["scan", scanId], updated);
      queryClient.invalidateQueries({ queryKey: ["scans"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  const extracted = scan.extractedData ?? {};
  const validation = scan.validationResults ?? {};
  const flags = scan.tamperingFlags ?? [];
  const needsReview = scan.needsReview ?? false;

  const okVerdict = scan.verdict === "APPROVE";
  const reviewVerdict = scan.verdict === "REVIEW";

  const forensics = (scan as unknown as { forensics?: { face?: { matched?: boolean; skipped?: boolean; face_score?: number; faceScore?: number; details?: string } } }).forensics;
  const faceInfo = forensics?.face;
  const faceMatched = faceInfo?.matched ?? scan.faceScore >= 0.65;
  const faceSkipped = faceInfo?.skipped ?? (scan.faceScore >= 0.99 && !faceInfo);
  const facePercent = Math.round((faceInfo?.face_score ?? faceInfo?.faceScore ?? scan.faceScore * 100) );

  const curated = [
    ["Verification ID", scan.id.slice(0, 8)],
    ["Document Type", String(scan.documentType ?? "Passport")],
    ["Document Number", String(extracted.documentNumber ?? "—")],
    ["Expiry Date", String(extracted.expiryDate ?? "—")],
    ["Date of Birth", String(extracted.dob ?? "—")],
    ["Nationality", String(extracted.nationality ?? "—")],
    ["Gender", String(extracted.gender ?? "—")],
    ["Timestamp", formatDate(scan.createdAt)],
  ];

  const findings = [
    { label: "Document Validation", value: (validation.passportFormatValid ?? false) ? "Passed" : "Failed" },
    {
      label: "Face Match",
      value: faceSkipped ? "Not Performed" : faceMatched ? `${facePercent}% Match` : `${facePercent}% Mismatch`,
      failed: !faceSkipped && !faceMatched,
    },
    {
      label: "Blacklist Status",
      value: validation.isBlacklisted ? "Flagged" : "Clear",
      failed: !!validation.isBlacklisted,
    },
    { label: "Tampering Detected", value: flags.length > 0 ? "Yes" : "None Found", failed: flags.length > 0 },
  ];

  return (
    <div className="surface-card p-8">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
            okVerdict
              ? "bg-success-soft text-success"
              : reviewVerdict
                ? "bg-warning-soft text-warning-foreground"
                : "bg-danger-soft text-destructive"
          }`}
        >
          {scan.verdict}
        </span>
        <h1 className="text-lg font-bold">Verification Complete</h1>
      </div>

      <div className="mt-6 text-center">
        <p className="label-caps">Risk Score</p>
        <p className="flex items-center justify-center gap-2 text-4xl font-bold">
          <BatteryMedium
            className={`size-6 ${
              okVerdict ? "text-success" : reviewVerdict ? "text-warning" : "text-destructive"
            }`}
          />
          {scan.riskScore}
          <span className="text-sm font-medium text-muted-foreground">/100</span>
        </p>
        <p
          className={`mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold ${
            okVerdict ? "text-success" : reviewVerdict ? "text-warning-foreground" : "text-destructive"
          }`}
        >
          {okVerdict ? <ShieldCheck className="size-4" /> : <AlertTriangle className="size-4" />}
          {scan.verdict === "APPROVE" ? "Low Risk Verdict" : scan.verdict === "REVIEW" ? "Manual Review Required" : "High Risk Verdict"}
        </p>
      </div>

      {flags.length > 0 && (
        <div className="mt-5 rounded-lg bg-danger-soft p-3 text-xs text-destructive">
          <p className="font-semibold">Suspicious indicators detected:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {scan.evidenceImageUrl && (
        <div className="mt-6">
          <p className="label-caps">Annotated Evidence</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Visual proof from the forensic engine — highlighted regions mark suspected tampering
            and AI artifacts.
          </p>
          <img
            src={resolveApiUrl(scan.evidenceImageUrl) ?? undefined}
            alt="Annotated document with forensic highlights"
            className="mt-3 w-full rounded-lg border border-border bg-muted"
          />
        </div>
      )}

      <p className="label-caps mt-8">Verification Findings</p>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {findings.map((f) => (
          <div key={f.label}>
            <p className="text-[11px] text-muted-foreground">{f.label}</p>
            <p className={`text-sm font-semibold ${f.failed ? "text-destructive" : "text-success"}`}>
              • {f.value}
            </p>
          </div>
        ))}
      </div>

      <p className="label-caps mt-8">Extracted System Data</p>
      <dl className="mt-3 divide-y divide-border">
        {curated.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v as string}</dd>
          </div>
        ))}
      </dl>

      <button
        onClick={() => downloadPdfReport(scanId)}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Download className="size-4" /> Download Report
      </button>
      {needsReview && (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-foreground">
          <Flag className="size-3.5" /> Flagged for manual review
          {scan.reviewedAt ? ` by ${scan.reviewedBy ?? "reviewer"} at ${formatDate(scan.reviewedAt)}` : ""}
        </p>
      )}
      <button
        onClick={() => reviewMutation.mutate(!needsReview)}
        disabled={reviewMutation.isPending}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm text-muted-foreground transition-opacity hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        {needsReview ? <FlagOff className="size-3.5" /> : <Flag className="size-3.5" />}
        {reviewMutation.isPending
          ? "Updating..."
          : needsReview
            ? "Clear Review Flag"
            : "Flag for Review"}
      </button>
      <div className="mt-4 text-center">
        <Link to="/" className="text-xs font-semibold text-primary hover:underline">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}