import { createFileRoute, Link } from "@tanstack/react-router";
import { Moon } from "lucide-react";
import { AppShell, PageTitle, useDarkMode } from "@/components/AppShell";
import { GenerateReport } from "@/components/GenerateReport";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SNARE Console" },
      {
        name: "description",
        content:
          "Switch appearance and export session verification reports as PDF or CSV from the SNARE console.",
      },
      { property: "og:title", content: "Settings — SNARE Console" },
      {
        property: "og:description",
        content: "Appearance preferences and report export options for your workspace.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { dark, setDark } = useDarkMode();

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <PageTitle title="Settings" hi="सेटिंग" />

        <div className="surface-card flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <Moon className="size-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Dark mode</p>
              <p className="text-xs text-muted-foreground">डार्क मोड</p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={dark}
            onClick={() => setDark(!dark)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${dark ? "bg-primary" : "bg-warning"}`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-card shadow transition-all ${dark ? "left-[22px]" : "left-0.5"}`}
            />
          </button>
        </div>

        <div className="surface-card mt-4 p-5">
          <p className="text-sm font-semibold">Reports</p>
          <p className="text-xs text-muted-foreground">रिपोर्ट</p>

          <p className="mt-3 text-xs text-muted-foreground">
            रिपोर्ट / Generate verification, risk and blacklist reports from verified screening records.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <GenerateReport />
          </div>
          <Link to="/history" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
            Browse verification history →
          </Link>
        </div>
      </div>
    </AppShell>
  );
}