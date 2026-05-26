import { useState } from "react";
import {
  BarChart3,
  Boxes,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Pin,
  Plus,
  ShoppingCart,
  Star,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Toolbar } from "@/components/common/Toolbar";
import { EmptyState } from "@/components/common/EmptyState";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

const COLORS = ["#003087", "#009CDE", "#019C34", "#F5BA2E", "#687173"];

const REPORT_GROUPS = [
  {
    id: "inventory",
    name: "Inventory",
    icon: <Boxes size={14} />,
    items: ["Stock Valuation", "Reorder Forecast", "Slow Movers", "ABC Analysis", "Batch Expiry"],
  },
  {
    id: "production",
    name: "Production",
    icon: <BarChart3 size={14} />,
    items: ["Daily Output", "OEE Report", "Scrap Analysis", "Variance Analysis", "Cycle Time"],
  },
  {
    id: "procurement",
    name: "Procurement",
    icon: <ShoppingCart size={14} />,
    items: ["Vendor Spend", "Lead Time", "On-time Delivery", "PO Aging", "Price History"],
  },
  {
    id: "worker",
    name: "Workforce",
    icon: <Users size={14} />,
    items: ["Efficiency", "Attendance", "Overtime", "Rejection Rate", "Incentives"],
  },
  {
    id: "fin",
    name: "Financial",
    icon: <FileText size={14} />,
    items: ["Sales Register", "GST Summary", "Profit Margin", "Receivables", "Payables"],
  },
];

export const Reports = () => {
  const [active, setActive] = useState("Daily Output");
  const liveTrend = useApi(() => api.productionTrend(), []);
  const liveSplit = useApi(() => api.procurementSplit(), []);
  const liveSales = useApi(() => api.salesTrend(), []);
  const liveStations = useApi(() => api.stationLoad(), []);

  const productionTrend = liveTrend.data ?? [];
  const procurementSplit = liveSplit.data ?? [];
  const salesTrend = liveSales.data ?? [];
  const stationLoad = liveStations.data ?? [];

  const loading =
    liveTrend.loading || liveSplit.loading || liveSales.loading || liveStations.loading;
  const errorObj = liveTrend.error ?? liveSplit.error ?? liveSales.error ?? liveStations.error;

  if (loading || errorObj) {
    return (
      <div className="p-6">
        <EmptyState loading={loading} error={errorObj} onRetry={liveTrend.refetch} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={<h2 className="text-h3 font-bold">Reports & Analytics</h2>}
        right={
          <>
            <Button variant="outline" size="sm" icon={<Filter size={14} />}>
              Filters
            </Button>
            <Button variant="outline" size="sm" icon={<FileSpreadsheet size={14} />}>
              Excel
            </Button>
            <Button variant="outline" size="sm" icon={<Download size={14} />}>
              PDF
            </Button>
            <Button size="sm" icon={<Plus size={14} />}>
              Build Report
            </Button>
          </>
        }
      />

      <div className="flex-1 grid grid-cols-12 min-h-0">
        <aside className="col-span-3 bg-surface border-r border-border overflow-y-auto p-3 space-y-3">
          {REPORT_GROUPS.map((g) => (
            <div key={g.id}>
              <div className="flex items-center gap-1.5 px-2 mb-1 text-caption font-bold uppercase tracking-wider text-ink-muted">
                {g.icon}
                {g.name}
              </div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <button
                    key={it}
                    onClick={() => setActive(it)}
                    className={cn(
                      "w-full text-left px-2.5 h-8 flex items-center gap-2 rounded-md text-body-sm transition-colors",
                      active === it
                        ? "bg-primary text-white font-semibold"
                        : "text-ink hover:bg-canvas hover:text-primary"
                    )}
                  >
                    <span className="flex-1 truncate">{it}</span>
                    {it === "Daily Output" && <Star size={12} className="fill-warning text-warning" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <section className="col-span-9 bg-canvas overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-h2 font-bold">{active}</h3>
                <Chip tone="primary">Last 14 days</Chip>
              </div>
              <div className="text-body-sm text-ink-muted mt-1">
                Pinned for fast access · Real-time data · Drill down to row level
              </div>
            </div>
            <Button size="sm" variant="outline" icon={<Pin size={14} />}>
              Pin to Favorites
            </Button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card title="Sales Trend" subtitle="Daily revenue" className="xl:col-span-2" bodyClassName="!pt-2">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesTrend} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#CBD2D6" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" stroke="#687173" fontSize={11} tickLine={false} />
                    <YAxis stroke="#687173" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
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
                    <Line type="monotone" dataKey="sales" stroke="#003087" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="cogs" stroke="#009CDE" strokeWidth={2.5} strokeDasharray="4 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Spend Mix" subtitle="By category">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={procurementSplit}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
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
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Production Output by Day" subtitle="Planned vs actual" bodyClassName="!pt-2">
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
                  />
                  <Bar dataKey="planned" fill="#CBD2D6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#003087" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="scrap" fill="#D20000" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Station Drilldown" subtitle="Click a row to drill down" noPadding>
            <div className="grid grid-cols-12 grid-header-cell">
              <div className="col-span-3">Station</div>
              <div className="col-span-2 text-right">Output</div>
              <div className="col-span-2 text-right">Target</div>
              <div className="col-span-2 text-right">Eff %</div>
              <div className="col-span-3">Trend</div>
            </div>
            {stationLoad.map((s) => {
              const pct = (s.output / s.target) * 100;
              return (
                <div key={s.station} className="grid grid-cols-12 grid-cell items-center hover:bg-canvas cursor-pointer">
                  <div className="col-span-3 font-semibold">{s.station}</div>
                  <div className="col-span-2 text-right tnum font-semibold">{s.output}</div>
                  <div className="col-span-2 text-right tnum text-ink-muted">{s.target}</div>
                  <div className="col-span-2 text-right">
                    <Chip
                      tone={pct > 85 ? "success" : pct > 60 ? "warning" : "danger"}
                      size="sm"
                    >
                      {Math.round(pct)}%
                    </Chip>
                  </div>
                  <div className="col-span-3">
                    <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full",
                          pct > 85 ? "bg-success" : pct > 60 ? "bg-warning" : "bg-danger"
                        )}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        </section>
      </div>
    </div>
  );
};
