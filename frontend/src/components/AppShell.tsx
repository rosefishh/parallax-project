import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  Sparkles,
  History,
  ShieldBan,
  ScrollText,
  Settings,
  Search,
  Moon,
  Sun,
  Bell,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

const nav = [
  { to: "/", label: "Home", hi: "होम", icon: Sparkles },
  { to: "/dashboard", label: "Dashboard", hi: "डैशबोर्ड", icon: LayoutDashboard },
  { to: "/new-verification", label: "New Verification", hi: "नया सत्यापन", icon: FilePlus2 },
  { to: "/identra-ai", label: "Identra AI", hi: "इंद्र एआई", icon: Sparkles },
  { to: "/history", label: "History", hi: "इतिहास", icon: History },
  { to: "/blacklist", label: "Blacklist Admin", hi: "काली सूची प्रशासन", icon: ShieldBan },
  { to: "/audit-trail", label: "Audit Trail", hi: "लेखा परीक्षा", icon: ScrollText },
  { to: "/settings", label: "Settings", hi: "सेटिंग", icon: Settings },
] as const;

export function useDarkMode() {
  const { theme, setTheme } = useTheme();
  return { dark: theme === "dark", setDark: (dark: boolean) => setTheme(dark ? "dark" : "light") };
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { dark, setDark } = useDarkMode();
  const { officer, signOut } = useAuth();
  const displayName = officer?.name ?? "Priyadarshani Basu";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-sidebar px-3 py-4 text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-2 pb-5">
          <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary">
            <ShieldCheck className="size-4 text-sidebar-primary-foreground" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-[0.18em]">SNARE</p>
            <p className="text-[10px] text-sidebar-muted">Scan. Score. Secure.</p>
            <p className="text-[10px] text-sidebar-muted">स्कैन · स्कोर · सुरक्षा</p>
          </div>
        </div>

        <Link
          to="/new-verification"
          className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-sidebar-primary px-3 py-2.5 text-sm font-semibold text-sidebar-primary-foreground transition-opacity hover:opacity-90"
        >
          + Verify Your Docs
        </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, hi, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="leading-tight">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-[10px] text-sidebar-muted">{hi}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen w-full min-w-0 flex-1 flex-col md:pl-64">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-8">
          <div className="relative flex-1 max-w-3xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search"
              aria-label="Search verifications"
              className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button
            onClick={() => setDark(!dark)}
            aria-label="Toggle dark mode"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            aria-label="Notifications"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <Bell className="size-4" />
          </button>
          <div className="flex items-center gap-2 rounded-full bg-muted py-1 pl-1 pr-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials || "PB"}
            </span>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:block">
              {displayName}
            </span>
            <button
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageTitle({ title, hi, sub }: { title: string; hi?: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {hi && <p className="text-xs text-muted-foreground">{hi}</p>}
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}
