import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Send, LoaderCircle, ChevronDown } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { askAssistant } from "@/api";

export const Route = createFileRoute("/snare-ai")({
  head: () => ({
    meta: [
      { title: "Snare AI — SNARE Verification Assistant" },
      {
        name: "description",
        content:
          "Ask Snare AI about verification records, the risk scoring model, tampering signals and blacklist entries.",
      },
      { property: "og:title", content: "Snare AI — SNARE Verification Assistant" },
      {
        property: "og:description",
        content: "Conversational assistant grounded in your live verification and blacklist data.",
      },
    ],
  }),
  component: SnareAI,
});

const prompts = [
  "How many verifications are recorded?",
  "What triggers a REJECT verdict?",
  "How is tampering detected?",
  "What's on the blacklist?",
];

const quickPrompts = [...prompts, ...faqs.map((f) => f.q)];

const faqs: { q: string; a: string }[] = [
  {
    q: "What does APPROVE / REVIEW / REJECT mean?",
    a: "Scans are scored from 0–100. Scores of 0–30 approve automatically, 31–60 go to a human officer for manual review, and 61–100 are rejected. If any field cannot be read, the scan is lifted onto a review floor (31/37/43/49/55) so a partially legible document is never silently approved.",
  },
  {
    q: "How is the risk score calculated?",
    a: "The final 0–100 score combines three weighted categories: validation errors (40%), tampering and blacklist signals (40%) and face-match confidence (20%). Missing fields only raise the review floor; they are never treated as proof of forgery, while readable-but-defective scans (expired, blacklisted, malformed number, underage DOB) are always floored at 31.",
  },
  {
    q: "What triggers a REJECT verdict?",
    a: "Any scan scoring above 60. In practice that happens for blacklisted documents, heavy tampering/AI-generation signals, or an expired passport combined with other defects. A score of 61–100 always requires close inspection of the annotated evidence image.",
  },
  {
    q: "How is document tampering detected?",
    a: "The Python forensics engine analyses frequency-spectrum anomalies (AI-rendered or reprinted pages), edge discontinuity around the photo (cut-and-paste), panel inconsistencies, and image metadata. Any suspicious region is highlighted on the annotated evidence image and contributes to tamperScore — any score above 0 floors the scan to review.",
  },
  {
    q: "Why did a perfectly legible passport get REVIEW?",
    a: "Readability and validity are separate checks. A legible passport can still go to review if it is expired, blacklisted, has a malformed document number, low face match, or a date of birth that makes the holder under 18 — each of these is a hard defect that floors the verdict at REVIEW even when the raw score is low.",
  },
  {
    q: "What happens if I scan without a selfie?",
    a: "Face matching is skipped and counts as neutral confidence (1.0), so the scan still completes. However, biometric verification is strongly recommended — matching the holder's live photo against the document is the strongest proof of identity the platform can produce.",
  },
  {
    q: "Can OCR recover a blurred or damaged MRZ?",
    a: "Yes, partially. If the machine-readable zone is noisy, the engine runs a tolerant MRZ parse and, for the printed date cells, repairs mangled digits character by character (for example S→5, O→0, I→1, B→8) before normalising the date. If recovery still fails, the field simply counts as unreadable and pushes the scan to REVIEW — never to a false approval.",
  },
  {
    q: "Is every scan audited and exportable?",
    a: "Yes. Every scan, verdict, export and blacklist change is written to the audit trail with the acting officer, timestamp and action. Each verification can also be exported as a signed PDF certificate and the workspace can be exported to CSV/txt for compliance records.",
  },
  {
    q: "What goes on the blacklist?",
    a: "Document numbers flagged during investigations. Any incoming scan whose document number matches a blacklist entry is floored to REVIEW with the BLACKLISTED_DOCUMENT flag so an officer always re-verifies it before it can pass.",
  },
];

type Msg = { role: "ai" | "user"; text: string };

function SnareAI() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "ai",
      text: "Snare AI online. I read this checkpoint's live verification and blacklist data. Ask me about any record, the scoring model, or the watchlist.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  const send = async (text: string) => {
    if (!text.trim() || pending) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setPending(true);
    try {
      const answer = await askAssistant(text);
      setMessages((m) => [...m, { role: "ai", text: answer }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: "I couldn't reach the backend. Make sure the API server is running, then try again.",
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell>
      <PageTitle title="Snare AI" hi="स्नेयर एआई" />

      <div className="surface-card flex min-h-[28rem] flex-col p-6">
        <div className="flex-1 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-3"}>
              {m.role === "ai" && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Sparkles className="size-4 text-primary" />
                </span>
              )}
              <p
                className={`max-w-lg whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm ${
                  m.role === "ai"
                    ? "bg-accent text-accent-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {m.text}
              </p>
            </div>
          ))}
          {pending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Thinking...
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              disabled={pending}
              className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Ask Snare AI"
            placeholder="Ask about a record, stats, or the risk model..."
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{" "}
            Send
          </button>
        </form>
      </div>

      <div className="surface-card mt-6 p-6">
        <h2 className="label-caps text-xs">Frequently Asked Questions</h2>
        <div className="mt-4 divide-y divide-border/60">
          {faqs.map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
                {f.q}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </AppShell>
  );
}