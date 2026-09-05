import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, Clock, Circle, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getPendingScan } from "@/lib/pendingScan";
import { scanDocument } from "@/api";

export const Route = createFileRoute("/screening")({
  validateSearch: (search: Record<string, unknown>) => ({
    documentType: typeof search.documentType === "string" ? search.documentType : "Passport",
    faceMatch: search.faceMatch === "true" || search.faceMatch === true,
  }),
  head: () => ({
    meta: [
      { title: "Screening in Progress — SNARE" },
      {
        name: "description",
        content:
          "Live progress of OCR extraction, blacklist checks, tampering scan and risk assessment for the submitted document.",
      },
      { property: "og:title", content: "Screening in Progress — SNARE" },
      {
        property: "og:description",
        content: "Track each stage of the SNARE identity screening pipeline in real time.",
      },
    ],
  }),
  component: Screening,
});

const screeningSteps = [
  "Uploading",
  "OCR Extraction",
  "Data Validation",
  "Blacklist Check",
  "Tampering Scan",
  "AI-Generated Content Check",
  "Face Match",
  "Risk Assessment",
  "Finalizing Report",
];

function Screening() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const pending = getPendingScan();

  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Animate the progress bar while the backend processes the scan.
  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => Math.min(96, p + 2 + Math.random()));
      setElapsed((e) => e + 1);
    }, 600);
    return () => clearInterval(t);
  }, []);

  // Drive the actual scan request exactly once.
  useEffect(() => {
    if (startedRef.current) return;
    if (!pending) {
      setError("No pending document found. Please start from New Verification.");
      return;
    }
    startedRef.current = true;

    const formData = new FormData();
    formData.append("document", pending.file);
    formData.append("documentType", search.documentType || pending.documentType);
    if (pending.selfie) formData.append("selfie", pending.selfie);

    scanDocument(formData)
      .then((res) => {
        setProgress(100);
        navigate({
          to: "/verification-complete",
          search: { scanId: res.data.id },
          replace: true,
        });
      })
      .catch((err: Error) => {
        setError(err.message || "Screening failed. Please try again.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = Math.floor((progress / 100) * screeningSteps.length);

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="surface-card p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Screening in Progress</h1>
            {error ? (
              <X className="size-5 text-destructive" />
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">
                {Math.floor(progress)}%
              </span>
            )}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                error ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {error ? (
            <p className="mt-6 rounded-lg bg-danger-soft p-4 text-center text-sm text-destructive">
              {error}
            </p>
          ) : (
            <ol className="mt-6 space-y-3">
              {screeningSteps.map((step, i) => {
                const complete = i < done;
                const active = i === done;
                return (
                  <li key={step} className="flex items-center gap-2.5 text-sm">
                    {complete ? (
                      <Check className="size-4 text-success" />
                    ) : active ? (
                      <Clock className="size-4 animate-pulse text-primary" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground/50" />
                    )}
                    <span
                      className={
                        complete || active ? "font-medium" : "text-muted-foreground/70"
                      }
                    >
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {!error && (
            <>
              <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" /> Elapsed: 00:{String(elapsed).padStart(2, "0")}
              </p>
              <div className="mt-3 text-center">
                <Link to="/" className="text-sm font-semibold text-destructive hover:underline">
                  Cancel Screening
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}