import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, FileText, Ban } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { VerdictBadge } from "@/components/VerdictBadge";
import { AsyncBoundary } from "@/components/AsyncState";
import { fetchStats, fetchRecentScans, formatDate, type ScanRecord } from "@/api";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SNARE Identity Verification" },
      {
        name: "description",
        content:
          "Monitor KYC and AML document screening volume, risk distribution and recent identity verifications in the SNARE console.",
      },
      { property: "og:title", content: "Dashboard — SNARE Identity Verification" },
      {
        property: "og:description",
        content: "Live KYC screening metrics, risk distribution and recent verification activity.",
      },
    ],
  }),
  component: Dashboard,
});

const riskColors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)"];

function Dashboard() {
  const { officer } = useAuth();
  const displayName = officer?.name ?? "Officer";
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const scansQuery = useQuery({ queryKey: ["scans", "recent"], queryFn: () => fetchRecentScans(100) });

  const stats = statsQuery.data;
  const scans = scansQuery.data?.data ?? [];

  const total = stats?.totalScans ?? 0;
  const successful = stats?.approved ?? 0;
  const highRisk = stats?.rejected ?? 0;
  const review = stats?.review ?? 0;
  const blacklisted = stats?.blacklisted ?? 0;

  const riskDistribution = [
    { name: "Low Risk / कम", value: total ? Math.round((successful / total) * 100) : 0, key: "low" },
    { name: "Review / समीक्षा", value: total ? Math.round((review / total) * 100) : 0, key: "medium" },
    { name: "Rejected / अस्वीकृत", value: total ? Math.round((highRisk / total) * 100) : 0, key: "high" },
  ];

  const weeklyVolume = useWeeklyVolume(scans);

  const isLoading = statsQuery.isLoading || scansQuery.isLoading;
  const isError = statsQuery.isError || scansQuery.isError;
  const errorMessage =
    (statsQuery.error as Error)?.message || (scansQuery.error as Error)?.message;

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Welcome back, {displayName}.</h1>
        <p className="text-xs text-muted-foreground">
          सत्यापन पर आपका स्वागत है — आगे का सारांश नीचे
        </p>
      </div>

      <AsyncBoundary isLoading={isLoading} isError={isError} errorMessage={errorMessage}>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="surface-card p-5">
            <div className="flex items-start justify-between">
              <p className="text-sm font-medium">Successful verifications</p>
              <CheckCircle2 className="size-5 text-success" />
            </div>
            <p className="mt-6 text-4xl font-bold">{successful.toLocaleString()}</p>
          </div>
          <div className="surface-card p-5">
            <div className="flex items-start justify-between">
              <p className="text-sm font-medium">High Risk</p>
              <AlertTriangle className="size-5 text-warning" />
            </div>
            <p className="mt-6 text-4xl font-bold">{highRisk.toLocaleString()}</p>
          </div>
          <div className="surface-card space-y-3 p-5">
            <Stat icon={FileText} label="Total Verifications" value={total.toLocaleString()} />
            <Stat icon={FileText} label="Pending Review" value={review.toLocaleString()} />
            <Stat icon={Ban} label="Blacklisted" value={blacklisted.toLocaleString()} tone="danger" />
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="surface-card p-5">
            <p className="text-sm font-semibold">Risk Distribution</p>
            <p className="text-[11px] text-muted-foreground">जोखिम वितरण</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskDistribution}
                    dataKey="value"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {riskDistribution.map((entry, i) => (
                      <Cell key={entry.key} fill={riskColors[i]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-1.5">
              {riskDistribution.map((r, i) => (
                <li key={r.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: riskColors[i] }}
                  />
                  <span className="flex-1 text-muted-foreground">{r.name}</span>
                  <span className="font-semibold">{r.value}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="surface-card p-5">
            <div className="mb-2 text-right">
              <p className="text-sm font-semibold">Weekly Volume</p>
              <p className="text-[11px] text-muted-foreground">साप्ताहिक मात्रा</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyVolume} layout="vertical" barSize={16}>
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                  />
                  <Tooltip cursor={false} />
                  <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="surface-card mt-4 p-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold">Recent Verifications</p>
              <p className="text-xs text-muted-foreground">
                Monitor identity verification submissions and approval actions.
              </p>
            </div>
            <Link to="/history" className="text-xs font-semibold text-primary hover:underline">
              Total {scansQuery.data?.pagination?.total?.toLocaleString?.() || total.toLocaleString()}
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["ID", "Document", "Verdict", "Risk Score", "Date", "Action"].map((h) => (
                    <th key={h} className="label-caps whitespace-nowrap py-2 pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scans.slice(0, 6).map((v) => (
                  <tr key={v.id} className="border-b border-border/60 last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {v.id.slice(0, 8)}
                    </td>
                    <td className="py-3 pr-4 font-medium">
                      {String(v.extractedData?.documentNumber ?? (v.documentType || "Passport"))}
                    </td>
                    <td className="py-3 pr-4">
                      <VerdictBadge verdict={v.verdict} />
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{v.riskScore}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(v.createdAt)}</td>
                    <td className="py-3 pr-4">
                      <Link
                        to="/history"
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AsyncBoundary>
    </AppShell>
  );
}

function useWeeklyVolume(scans: ScanRecord[]) {
  const days = [...new Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { iso: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: "short" }) };
  });

  const counts = days.map((day) => ({
    day: day.label,
    value: scans.filter((s) => s.createdAt.slice(0, 10) === day.iso).length,
  }));
  return counts;
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-lg font-bold">{value}</span>
        <Icon className={tone === "danger" ? "size-4 text-destructive" : "size-4 text-primary"} />
      </span>
    </div>
  );
}