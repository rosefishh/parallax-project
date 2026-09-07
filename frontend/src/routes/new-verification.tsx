import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Check, ChevronDown, FileText, UploadCloud, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SelfieCapture } from "@/components/SelfieCapture";
import { setPendingScan } from "@/lib/pendingScan";
import { DOCUMENT_TYPES } from "@/lib/documentTypes";

export const Route = createFileRoute("/new-verification")({
  head: () => ({
    meta: [
      { title: "New Verification — SNARE KYC Screening" },
      {
        name: "description",
        content:
          "Upload a passport, Aadhaar, PAN or voter ID and run SNARE's KYC and AML document screening engine.",
      },
      { property: "og:title", content: "New Verification — SNARE KYC Screening" },
      {
        property: "og:description",
        content: "Configure document parameters and start an identity screening run.",
      },
    ],
  }),
  component: NewVerification,
});

function NewVerification() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("PASSPORT");
  const [faceMatch, setFaceMatch] = useState(true);
  const [selfie, setSelfie] = useState<File | null>(null);
  const selectedDoc = DOCUMENT_TYPES.find((d) => d.code === documentType) ?? DOCUMENT_TYPES[0];

  const startScreening = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setPendingScan({ file, documentType, faceMatch, selfie });
    navigate({
      to: "/screening",
      search: { documentType, faceMatch },
    });
  };

  return (
    <AppShell>
      <form className="mx-auto max-w-2xl" onSubmit={startScreening}>
        <div className="surface-card p-8">
          <Link
            to="/"
            className="label-caps mb-4 inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> KYC / AML Screening
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">New Verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure document parameters and prepare the extraction engine.
          </p>

          <p className="label-caps mt-6">Document Type</p>
          <div className="relative mt-2">
            <FileText className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full appearance-none rounded-lg border border-border bg-card py-2.5 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              {DOCUMENT_TYPES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{selectedDoc.hint}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {selectedDoc.fields.map((f) => (
              <li
                key={f}
                className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground"
              >
                <Check className="size-3 text-primary" /> {f}
              </li>
            ))}
          </ul>

          <p className="label-caps mt-5">Upload File</p>
          <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-accent/40 px-6 py-10 text-center transition-colors hover:bg-accent/70">
            <UploadCloud className="size-6 text-primary" />
            <span className="text-sm font-medium">
              {file?.name ?? "Drag & drop your document here"}
            </span>
            <span className="text-xs text-muted-foreground">or</span>
            <span className="rounded-md bg-card px-3 py-1.5 text-xs font-semibold shadow-sm">
              Browse Files
            </span>
            <span className="text-[10px] text-muted-foreground">
              PDF, JPG, PNG — up to 10MB
            </span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="mt-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Enable face-match verification</p>
              <p className="text-xs text-muted-foreground">Opens webcam for live selfie capture.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={faceMatch}
              onClick={() => setFaceMatch(!faceMatch)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${faceMatch ? "bg-primary" : "bg-muted"}`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-card shadow transition-all ${faceMatch ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>

          {faceMatch && <SelfieCapture selfie={selfie} onCapture={setSelfie} />}

          <button
            type="submit"
            disabled={!file || (faceMatch && !selfie)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="size-4" /> Start Screening
          </button>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {faceMatch && !selfie
              ? "Capture or upload a selfie to enable face-match verification."
              : "Upload a document to begin."}
          </p>
        </div>
      </form>
    </AppShell>
  );
}