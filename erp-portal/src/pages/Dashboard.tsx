import {
  Activity,
  AlertTriangle,
  Boxes,
  CircleAlert,
  Clock,
  Factory,
  KanbanSquare,
  Package,
  PackageCheck,
  ShoppingCart,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { Kpi } from "@/components/common/Kpi";
import { EmptyState } from "@/components/common/EmptyState";
import { inr, num } from "@/lib/format";
import { api, auth } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

const COLORS = ["#003087", "#009CDE", "#019C34", "#F5BA2E", "#687173"];

// Pick a time-of-day greeting so the dashboard header feels appropriate
// for the user's shift rather than always saying "evening".
const greetingFor = (date: Date): string => {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

// First name only — keeps the headline tight even when the signed-in
// user has a long full name. Falls back to the username, then a generic
// label if no session is available.
const firstNameOf = (full: string | null | undefined, fallback?: string | null) => {
  const f = (full ?? "").trim();
  if (f) return f.split(/\s+/)[0];
  const u = (fallback ?? "").trim();
  if (u) return u.split(/[.\s_-]/)[0];
  return "there";
};

export const Dashboard = () => {
  const sessionUser = auth.user();
  const greeting = greetingFor(new Date());
  const firstName = firstNameOf(sessionUser?.name, sessionUser?.username);
  const live = useApi(() => api.dashboard(), []);
  const liveTrend = useApi(() => api.productionTrend(), []);
  const liveSplit = useApi(() => api.procurementSplit(), []);
  const liveSales = useApi(() => api.salesTrend(), []);
  const liveStations = useApi(() => api.stationLoad(), []);
  const liveWorkers = useApi(() => api.workersSummary(), []);

  const loading =
    live.loading ||
    liveTrend.loading ||
    liveSplit.loading ||
    liveSales.loading ||
    liveStations.loading ||
    liveWorkers.loading;
  const errorObj =
    live.error ??
    liveTrend.error ??
    liveSplit.error ??
    liveSales.error ??
    liveStations.error ??
    liveWorkers.error;

  if (loading || errorObj) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6">
          <EmptyState
            loading={loading}
            error={errorObj}
            onRetry={() => {
              live.refetch();
              liveTrend.refetch();
              liveSplit.refetch();
              liveSales.refetch();
              liveStations.refetch();
              liveWorkers.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  const productionTrend = liveTrend.data ?? [];
  const procurementSplit = liveSplit.data ?? [];
  const salesTrend = liveSales.data ?? [];
  const stationLoad = liveStations.data ?? [];

  const planned = live.data?.productionTotals._sum.plannedQty ?? 0;
  const actual = live.data?.productionTotals._sum.actualQty ?? 0;
  const efficiency = (actual / Math.max(1, planned)) * 100;
  const inWorkers = live.data?.activeWorkers ?? liveWorkers.data?.in ?? 0;
  const totalWorkers = liveWorkers.data?.total ?? 0;
  const delayed = live.data?.delayedOrders ?? 0;
  const lowStock = live.data?.lowStock ?? 0;

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-h1 font-bold text-ink">
            {greeting}, {firstName}
          </h1>
          <div className="text-body text-ink-muted mt-1">
            Plant performance for the last 14 days · Updated 2 min ago
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone="success" icon={<StatusDot tone="success" />}>
            Live · backend connected
          </Chip>
          <Chip tone="info">Shift A · 14:30 → 22:30</Chip>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="Production Eff."
          value={`${efficiency.toFixed(1)}%`}
          delta={-0.6}
          icon={<Factory size={16} />}
          accent="warning"
        />
        <Kpi
          label="Active Workers"
          value={`${inWorkers}/${totalWorkers}`}
          delta={2}
          deltaSuffix=""
          icon={<Users size={16} />}
          hint="On shift"
          accent="primary"
        />
        <Kpi
          label="Delayed Orders"
          value={String(delayed)}
          delta={-1}
          deltaSuffix=""
          icon={<AlertTriangle size={16} />}
          accent="danger"
        />
        <Kpi
          label="Stock Alerts"
          value={String(lowStock)}
          delta={3}
          deltaSuffix=""
          icon={<Package size={16} />}
          hint="Below reorder"
          accent="warning"
        />
      </div>

      <EnquiryPipelineWidget />

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card
          title="Sales vs COGS"
          subtitle="Daily, last 14 days (₹)"
          actions={<Chip tone="primary">+8.2% WoW</Chip>}
          className="xl:col-span-2"
          bodyClassName="!pt-2"
        >
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrend} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#003087" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#003087" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#009CDE" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#009CDE" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#CBD2D6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#687173" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="#687173"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1A1A2E",
                    border: "none",
                    borderRadius: 8,
                    color: "white",
                    fontSize: 12,
                  }}
                  formatter={(v: number, n) => [inr(v), n]}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#003087"
                  strokeWidth={2}
                  fill="url(#g1)"
                  name="Sales"
                />
                <Area
                  type="monotone"
                  dataKey="cogs"
                  stroke="#009CDE"
                  strokeWidth={2}
                  fill="url(#g2)"
                  name="COGS"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Procurement Split" subtitle="Spend by category">
          <div className="h-[260px] flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={procurementSplit}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={56}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                >
                  {procurementSplit.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#1A1A2E",
                    border: "none",
                    borderRadius: 8,
                    color: "white",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => inr(v)}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(v) => <span className="text-ink">{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card
          title="Production Output"
          subtitle="Planned vs Actual (units)"
          className="xl:col-span-2"
          bodyClassName="!pt-2"
        >
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionTrend} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#CBD2D6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#687173" fontSize={11} tickLine={false} />
                <YAxis stroke="#687173" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#1A1A2E",
                    border: "none",
                    borderRadius: 8,
                    color: "white",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => num(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="planned" fill="#CBD2D6" radius={[4, 4, 0, 0]} name="Planned" />
                <Bar dataKey="actual" fill="#003087" radius={[4, 4, 0, 0]} name="Actual" />
                <Bar dataKey="scrap" fill="#D20000" radius={[4, 4, 0, 0]} name="Scrap" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Station Load" subtitle="Today">
          <div className="space-y-3">
            {stationLoad.map((s) => {
              const pct = Math.min(100, (s.output / s.target) * 100);
              const tone = pct > 85 ? "success" : pct > 60 ? "warning" : "danger";
              return (
                <div key={s.station}>
                  <div className="flex items-center justify-between text-body-sm">
                    <span className="font-semibold">{s.station}</span>
                    <span className="tnum text-ink-muted">
                      {s.output}/{s.target}
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-canvas rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        tone === "success"
                          ? "bg-success"
                          : tone === "warning"
                            ? "bg-warning"
                            : "bg-danger"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-caption text-ink-muted">
                    <span>Efficiency</span>
                    <span className="font-semibold">{s.efficiency}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Live Activity" subtitle="Last 30 min" actions={<Chip tone="info" icon={<Activity size={12} />}>real-time</Chip>}>
          <div className="space-y-2.5">
            {[
              {
                icon: <PackageCheck size={14} />,
                label: "GRN-1142 received",
                desc: "Steelworks Industries · 12 SKUs",
                tone: "success" as const,
                time: "2m",
              },
              {
                icon: <Factory size={14} />,
                label: "MO-2026-2206 entered QC",
                desc: "Finished Pump A2 · 240 units",
                tone: "info" as const,
                time: "11m",
              },
              {
                icon: <ShoppingCart size={14} />,
                label: "PO-2026-1118 approved",
                desc: "Quantum Auto Parts · ₹4.2L",
                tone: "primary" as const,
                time: "18m",
              },
              {
                icon: <Boxes size={14} />,
                label: "Transfer TRF-413 completed",
                desc: "WH-MAIN/A-2-1 → STR/B-1-3",
                tone: "neutral" as const,
                time: "22m",
              },
              {
                icon: <CircleAlert size={14} />,
                label: "Stock low: Bearing 6205",
                desc: "Reorder triggered automatically",
                tone: "warning" as const,
                time: "27m",
              },
            ].map((row, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-3 py-2 rounded-md hover:bg-canvas transition-colors"
              >
                <div
                  className={`h-8 w-8 rounded-md grid place-items-center shrink-0 ${
                    row.tone === "success"
                      ? "bg-success-soft text-success"
                      : row.tone === "warning"
                        ? "bg-warning-soft text-[#8a6300]"
                        : row.tone === "primary"
                          ? "bg-primary-50 text-primary"
                          : row.tone === "info"
                            ? "bg-[#E1F4FB] text-secondary"
                            : "bg-canvas text-ink-muted"
                  }`}
                >
                  {row.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-body-sm font-semibold text-ink">{row.label}</div>
                  <div className="text-caption text-ink-muted truncate">{row.desc}</div>
                </div>
                <div className="text-caption text-ink-muted shrink-0 flex items-center gap-1">
                  <Clock size={11} />
                  {row.time}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Pending Approvals" subtitle="Awaiting your review" actions={<Chip tone="warning">5 items</Chip>}>
          <div className="space-y-2">
            {[
              { id: "PR-2206", title: "Purchase Request", who: "Sandeep Kumar", value: 425000, type: "primary" },
              { id: "ADJ-203", title: "Stock Adjustment", who: "Naveen Pillai", value: -28400, type: "danger" },
              { id: "PO-2026-1124", title: "PO Amendment", who: "Procurement Team", value: 90000, type: "warning" },
              { id: "PR-2210", title: "Purchase Request", who: "Maintenance Team", value: 165000, type: "primary" },
              { id: "OVR-19", title: "Price Override", who: "Billing Counter 2", value: -12000, type: "danger" },
            ].map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-canvas hover:border-primary cursor-pointer transition-colors"
              >
                <div className="font-mono text-caption text-ink-muted w-32 truncate">{r.id}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-body-sm font-semibold text-ink truncate">{r.title}</div>
                  <div className="text-caption text-ink-muted truncate">{r.who}</div>
                </div>
                <div className={`text-body-sm font-bold tnum ${
                  r.value < 0 ? "text-danger" : "text-ink"
                }`}>
                  {inr(r.value)}
                </div>
                <button className="text-caption font-semibold text-primary hover:underline">
                  Review →
                </button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
    </div>
  );
};

// Self-contained CRM pipeline widget. Fetches independently and hides itself
// if the API errors (e.g. for roles without enquiry access) so it never
// blocks the rest of the dashboard.
const PIPELINE_STAGES: { id: string; label: string; cls: string }[] = [
  { id: "new",       label: "New",       cls: "bg-info" },
  { id: "contacted", label: "Contacted", cls: "bg-primary" },
  { id: "qualified", label: "Qualified", cls: "bg-warning" },
  { id: "proposal",  label: "Proposal",  cls: "bg-purple-500" },
  { id: "won",       label: "Won",       cls: "bg-success" },
];

const EnquiryPipelineWidget = () => {
  const { data, error } = useApi(() => api.enquiryStats(), []);
  if (error || !data) return null;
  const maxStage = Math.max(1, ...PIPELINE_STAGES.map((s) => data.byStage[s.id] ?? 0));

  return (
    <Card
      title="Enquiry pipeline"
      subtitle="CRM leads in progress"
      actions={
        <Link to="/enquiries" className="text-caption font-semibold text-primary hover:underline flex items-center gap-1">
          <KanbanSquare size={13} /> Open CRM →
        </Link>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
        <div className="md:col-span-3 space-y-2">
          {PIPELINE_STAGES.map((s) => {
            const n = data.byStage[s.id] ?? 0;
            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className="w-20 text-caption text-ink-muted shrink-0">{s.label}</div>
                <div className="flex-1 h-5 bg-canvas rounded-full overflow-hidden">
                  <div className={`h-full ${s.cls} rounded-full transition-all`} style={{ width: `${(n / maxStage) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-body-sm font-semibold tnum">{n}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-caption text-ink-muted uppercase tracking-wide">Pipeline value</div>
            <div className="text-h3 font-bold tnum">{inr(data.pipelineValue)}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${data.followUpsDue > 0 ? "border-danger/30 bg-danger/5" : "border-border"}`}>
            <div className="text-caption text-ink-muted uppercase tracking-wide flex items-center gap-1">
              <Clock size={11} /> Follow-ups due
            </div>
            <div className={`text-h3 font-bold tnum ${data.followUpsDue > 0 ? "text-danger" : "text-ink"}`}>
              {data.followUpsDue}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
