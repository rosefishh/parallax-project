import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Verified,
  PlayCircle,
  LayoutDashboard,
  ScanLine,
  Sparkles,
  ChevronRight,
  Info,
  CheckCircle2,
  Hourglass,
  ShieldAlert,
  Gavel,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SNARE — AI-Powered Identity & Document Verification" },
      {
        name: "description",
        content:
          "SNARE combines document OCR, forensic anomaly detection, watchlist screening and facial biometric consistency into a unified human-in-the-loop identity verification workbench.",
      },
      { property: "og:title", content: "SNARE — Identity & Document Screening" },
      {
        property: "og:description",
        content:
          "Assisting reviewers. Eliminating blind spots. A unified verification console by Identra AI.",
      },
    ],
  }),
  component: LandingPage,
});

const PIPELINE = [
  { n: 1, title: "Upload Document & Selfie", desc: "Ingests Passports, National IDs, Driver's Licenses, and live face selfies with format validation." },
  { n: 2, title: "OCR & MRZ Extraction", desc: "Extracts structured fields (Name, DOB, Doc No, Expiry) and standard ICAO Doc 9303 MRZ zones." },
  { n: 3, title: "Document Integrity Analysis", desc: "Evaluates blur/sharpness metrics, calculates 7-3-1 MRZ check digits, and inspects EXIF alteration metadata." },
  { n: 4, title: "Field & Record Matching", desc: "Applies fuzzy string similarity, token sort algorithms, and date normalization to catch discrepancies." },
  { n: 5, title: "Watchlist & Blacklist Check", desc: "Cross-references document numbers and applicant identities against fraud alerts and stolen ID registries." },
  { n: 6, title: "Biometric Consistency", desc: "Crops ID portrait and conducts 1:1 facial biometric cross-matching against the live selfie photograph." },
  { n: 7, title: "Explainable Risk Engine", desc: "Generates a composite 0-100 score and transparent, itemized reason flags categorised as Low, Medium, or High." },
  { n: 8, title: "Human Reviewer Workbench", desc: "Authorized officer makes the final informed decision (Approve, Request Info, Reject) with a mandatory audit log." },
];

const STATS = [
  { icon: ScanLine, value: "25,432+", label: "Screened Documents" },
  { icon: CheckCircle2, value: "18,769+", label: "Officer Verified", tone: "success" },
  { icon: Hourglass, value: "4,218+", label: "In Review Queue", tone: "warning" },
  { icon: ShieldAlert, value: "1,245+", label: "High Risk Escalations", tone: "danger" },
  { icon: Gavel, value: "692+", label: "Watchlist Hits" },
];

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Minimal top bar: logo + login/start actions only */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-10 md:py-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary">
              <ShieldCheck className="size-5 text-primary-foreground" />
            </span>
            <span className="text-xl font-extrabold tracking-[0.12em] text-foreground">SNARE</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent sm:inline-flex"
            >
              Officer Login
            </Link>
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <ScanLine className="size-4" />
              Start Screening
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero */}
        <section
          className="relative w-full overflow-hidden border-b border-border"
          style={{
            backgroundImage: "url(/skyline.png)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundAttachment: "fixed",
          }}
        >
          <div className="absolute inset-0 bg-background/85 backdrop-blur-sm" />
          <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-16 md:px-10 md:py-24 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              <p className="label-caps text-primary">
                राष्ट्रीय पहचान एवं दस्तावेज़ सत्यापन प्रणाली
              </p>
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
                AI-Powered Identity &amp; <br className="hidden md:block" /> Document Screening
                System
              </h1>
              <h2 className="text-xl font-semibold text-muted-foreground md:text-2xl">
                Assisting reviewers. Eliminating blind spots.
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                SNARE combines document OCR, forensic anomaly detection, fuzzy identity matching,
                watchlist screening, and facial biometric consistency into a unified
                human-in-the-loop verification workbench.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Link
                  to="/new-verification"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-card transition-opacity hover:opacity-90"
                >
                  <PlayCircle className="size-4" />
                  Launch Verification Workbench
                </Link>
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
                >
                  <LayoutDashboard className="size-4" />
                  View Officer Dashboard
                </Link>
              </div>

              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3.5 text-xs text-muted-foreground">
                <Info className="size-4 shrink-0 text-primary" />
                <span>
                  <strong className="font-semibold text-foreground">Human-in-the-Loop Philosophy:</strong>{" "}
                  SNARE assists authorized reviewers by surfacing risk indicators and anomalies
                  without making definitive automated fraud accusations.
                </span>
              </div>
            </div>

            {/* Live mockup */}
            <div className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-elevated md:p-7">
              <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                    <ShieldCheck className="size-5 text-primary" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Multi-Stage Screening Engine</h3>
                    <p className="text-xs text-muted-foreground">Case #IDN-20260828-8924</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success">
                  <span className="size-2 rounded-full bg-success" />
                  Low Risk (Score: 12)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                {[
                  { label: "OCR Text", val: "98.4%" },
                  { label: "MRZ Checksum", val: "Valid (7-3-1)" },
                  { label: "Watchlist", val: "Cleared" },
                  { label: "Face Biometrics", val: "96.2% Match" },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-border bg-background p-3">
                    <span className="label-caps block text-[10px] text-muted-foreground">{m.label}</span>
                    <span className="mt-1 block items-center justify-center gap-0.5 text-xs font-bold text-success">
                      <CheckCircle2 className="mr-0.5 inline size-3" />
                      {m.val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-background p-4">
                <span className="label-caps block text-[11px] text-muted-foreground">
                  Explainable Risk Assessment
                </span>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  &bull; Document is active (valid until 2032-08-20).
                  <br />
                  &bull; Full name matches application record with 100% token consistency.
                  <br />
                  &bull; No tampering signatures or compression anomalies identified.
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Reviewer Action:</span>
                <span className="rounded border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground">
                  Approved by Officer Sharma
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Stats bar */}
        <section className="bg-sidebar text-sidebar-foreground py-8">
          <div className="mx-auto w-full max-w-7xl px-4 md:px-10">
            <div className="grid grid-cols-2 gap-6 text-center md:grid-cols-3 lg:grid-cols-5">
              {STATS.map(({ icon: Icon, value, label, tone }, i) => (
                <div
                  key={label}
                  className={`flex flex-col items-center justify-center p-4 ${
                    i < STATS.length - 1
                      ? "border-r"
                      : "col-span-2 md:col-span-1"
                  } ${i < STATS.length - 1 ? "border-sidebar-border" : ""}`}
                >
                  <Icon
                    className={`mb-2 size-5 ${
                      tone === "success"
                        ? "text-success"
                        : tone === "warning"
                          ? "text-warning"
                          : tone === "danger"
                            ? "text-destructive"
                            : "text-sidebar-foreground/80"
                    }`}
                  />
                  <span
                    className={`text-2xl font-bold md:text-3xl ${
                      tone === "success"
                        ? "text-success"
                        : tone === "warning"
                          ? "text-warning"
                          : tone === "danger"
                            ? "text-destructive"
                            : ""
                    }`}
                  >
                    {value}
                  </span>
                  <span className="label-caps mt-1 text-sidebar-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 8-stage pipeline */}
        <section className="border-b border-border bg-background py-16 md:py-20">
          <div className="mx-auto w-full max-w-7xl px-4 md:px-10">
            <div className="mb-12 text-center">
              <p className="label-caps mb-2 text-primary">End-to-End Verification Pipeline</p>
              <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                The 8 Stages of SNARE
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground">
                Every identity document undergoes a systematic, explainable screening pipeline
                before presenting an audit packet to authorized officers.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map(({ n, title, desc }) => (
                <div
                  key={n}
                  className={`rounded-xl border p-6 transition-colors hover:border-primary ${
                    n === 8
                      ? "border-sidebar bg-sidebar text-sidebar-foreground hover:border-sidebar-ring"
                      : "border-border bg-card"
                  }`}
                >
                  <span
                    className={`mb-4 flex size-10 items-center justify-center rounded-lg text-sm font-bold ${
                      n === 8 ? "bg-primary text-primary-foreground" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {n}
                  </span>
                  <h3
                    className={`mb-2 font-bold ${
                      n === 8 ? "text-sidebar-foreground" : "text-foreground"
                    }`}
                  >
                    {title}
                  </h3>
                  <p
                    className={`text-sm ${
                      n === 8 ? "text-sidebar-muted" : "text-muted-foreground"
                    }`}
                  >
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA banner */}
        <section className="border-b border-border bg-background py-16">
          <div className="mx-auto max-w-4xl space-y-6 px-4 text-center">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-soft">
              <Verified className="size-8 text-success" />
            </span>
            <h2 className="text-3xl font-bold text-foreground">
              Ready to test the Verification Workbench?
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-relaxed text-muted-foreground">
              Upload your own test specimens or try our pre-packaged synthetic scenarios (Valid
              Passports, Expired Documents, Stolen Watchlist Hits, and Biometric Mismatches).
            </p>
            <div className="pt-1">
              <Link
                to="/new-verification"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-4 font-semibold text-primary-foreground shadow-elevated transition-opacity hover:opacity-90"
              >
                <Sparkles className="size-4" />
                Open Verification Workbench
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t-4 border-sidebar-ring bg-sidebar text-sidebar-foreground">
        <div className="mx-auto w-full max-w-7xl px-4 py-12 md:px-10">
          <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-4">
            <div className="col-span-1">
              <span className="mb-4 flex items-center gap-2 text-2xl font-bold">
                <ShieldCheck className="size-6 text-primary" />
                SNARE
              </span>
              <p className="max-w-xs text-sm text-sidebar-muted">
                AI-Powered Identity &amp; Document Screening Platform.
              </p>
            </div>
            <div className="col-span-1 flex flex-wrap gap-x-8 gap-y-4 text-sm md:col-span-3 md:justify-end">
              {[
                { label: "Dashboard", to: "/dashboard" },
                { label: "Workbench", to: "/new-verification" },
                { label: "Blacklist", to: "/blacklist" },
                { label: "Audit Trail", to: "/audit-trail" },
              ].map(({ label, to }) => (
                <Link
                  key={label}
                  to={to}
                  className="text-sidebar-muted transition-colors hover:text-sidebar-foreground"
                >
                  {label}
                </Link>
              ))}
              <a
                href="mailto:support@identra.gov.in"
                className="text-sidebar-muted transition-colors hover:text-sidebar-foreground"
              >
                support@identra.gov.in
              </a>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-sidebar-border pt-8 text-center md:flex-row md:text-left">
            <p className="text-sm text-sidebar-muted">
              © 2026 SNARE | Officer Support: 1800-IDENTRA
            </p>
            <p className="text-sm text-sidebar-muted">भारत सरकार</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
