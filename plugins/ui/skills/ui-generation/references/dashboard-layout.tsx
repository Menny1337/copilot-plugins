import * as React from "react";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Settings,
  Bell,
  Search,
  Menu,
  X,
  TrendingUp,
  TrendingDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Dashboard Layout — Few-Shot Example
// Demonstrates: sidebar navigation, responsive collapse, header,
// KPI cards with hierarchy, content grid, section spacing
// ============================================================

// --- Layout Shell ---

interface DashboardLayoutProps {
  children: React.ReactNode;
}

function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-slate-200",
          "transform transition-transform duration-200 ease-in-out",
          "lg:translate-x-0 lg:static lg:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo area */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-slate-100">
            <span className="text-lg font-bold text-slate-900">Acme</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 rounded-md text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
            <NavItem icon={LayoutDashboard} label="Dashboard" active />
            <NavItem icon={BarChart3} label="Analytics" />
            <NavItem icon={Users} label="Customers" badge="12" />
            <NavItem icon={Settings} label="Settings" />
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ml-0 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur border-b border-slate-100">
          <div className="flex items-center justify-between h-full px-4 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Open sidebar"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* Search — desktop only */}
              <div className="hidden md:flex items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search..."
                    className="w-64 pl-10 pr-4 py-2 rounded-lg bg-slate-50 border-0 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-colors"
                    aria-label="Search"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="relative p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full" />
              </button>
              <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-medium text-white" aria-label="User avatar">
                M
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

// --- Nav Item ---

interface NavItemProps {
  icon: React.FC<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: string;
}

function NavItem({ icon: Icon, label, active, badge }: NavItemProps) {
  return (
    <a
      href="#"
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        active
          ? "bg-blue-50 text-blue-600"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className={cn("h-5 w-5 shrink-0", active ? "text-blue-500" : "text-slate-400")} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-600">
          {badge}
        </span>
      )}
    </a>
  );
}

// --- KPI Card ---

interface KpiCardProps {
  title: string;
  value: string;
  change: number;
  period?: string;
}

function KpiCard({ title, value, change, period = "vs last month" }: KpiCardProps) {
  const isPositive = change >= 0;

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* TERTIARY: Label */}
      <p className="text-sm font-medium text-slate-500">{title}</p>

      {/* PRIMARY: Value — largest, boldest, most prominent */}
      <p className="mt-2 text-2xl font-bold text-slate-900 tracking-tight">{value}</p>

      {/* SECONDARY: Trend indicator */}
      <div className="mt-2 flex items-center gap-1">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-xs font-medium",
            isPositive ? "text-green-600" : "text-red-500"
          )}
        >
          {isPositive ? (
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isPositive ? "+" : ""}
          {change}%
        </span>
        <span className="text-xs text-slate-400">{period}</span>
      </div>
    </div>
  );
}

// --- Dashboard Page (composed example) ---

function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Welcome back. Here's what's happening.</p>
        </div>

        {/* KPI cards — 4-column grid, responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <KpiCard title="Total Revenue" value="$45,231" change={12.5} />
          <KpiCard title="Active Users" value="2,345" change={8.2} />
          <KpiCard title="Conversion Rate" value="3.6%" change={-2.1} />
          <KpiCard title="Avg. Order" value="$124" change={4.3} />
        </div>

        {/* Content sections — generous spacing between */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart area — 2/3 width */}
          <div className="lg:col-span-2 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-medium text-slate-900">Revenue Over Time</h2>
              <select
                className="text-xs text-slate-500 bg-transparent border-0 focus:ring-0 cursor-pointer"
                aria-label="Time period"
              >
                <option>Last 7 days</option>
                <option>Last 30 days</option>
                <option>Last 90 days</option>
              </select>
            </div>
            {/* Chart placeholder */}
            <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
              Chart Component Here
            </div>
          </div>

          {/* Activity feed — 1/3 width */}
          <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-base font-medium text-slate-900 mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {["New order #1234", "User signup: john@acme.com", "Payment processed"].map(
                (item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0"
                  >
                    <span className="text-sm text-slate-700">{item}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export { DashboardLayout, DashboardPage, KpiCard, NavItem };
