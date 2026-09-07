import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Send, LoaderCircle } from "lucide-react";
import { AppShell, PageTitle } from "@/components/AppShell";
import { askAssistant } from "@/api";

export const Route = createFileRoute("/identra-ai")({
  head: () => ({
    meta: [
      { title: "Identra AI — SNARE Verification Assistant" },
      {
        name: "description",
        content:
          "Ask Identra AI about verification records, the risk scoring model, tampering signals and blacklist entries.",
      },
      { property: "og:title", content: "Identra AI — SNARE Verification Assistant" },
      {
        property: "og:description",
        content: "Conversational assistant grounded in your live verification and blacklist data.",
      },
    ],
  }),
  component: IdentraAI,
});

const prompts = [
  "How many verifications are recorded?",
  "What triggers a REJECT verdict?",
  "How is tampering detected?",
  "What's on the blacklist?",
];

type Msg = { role: "ai" | "user"; text: string };

function IdentraAI() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "ai",
      text: "Identra AI online. I read this checkpoint's live verification and blacklist data. Ask me about any record, the scoring model, or the watchlist.",
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
      <PageTitle title="Identra AI" hi="इंद्र एआई" />

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
          {prompts.map((p) => (
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
            aria-label="Ask Identra AI"
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
    </AppShell>
  );
}