import { useMemo, useRef, useState } from "react";
import {
  Award,
  Calendar,
  Clock,
  Factory,
  Filter,
  LogIn,
  LogOut,
  Pause,
  ScanLine,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Worker } from "@/data/types";
import { num, dt } from "@/lib/format";
import { cn } from "@/lib/cn";

const statusTone = (s: Worker["status"]) =>
  s === "in" ? "success" : s === "break" ? "warning" : "neutral";

export const Productivity = () => {
  const [q, setQ] = useState("");
  const [shift, setShift] = useState<Worker["shift"] | "all">("all");
  const [punchOpen, setPunchOpen] = useState(false);
  const [selectedAttendanceDay, setSelectedAttendanceDay] = useState<string | null>(null);
  const [highlightAttendance, setHighlightAttendance] = useState(false);
  const attendanceSectionRef = useRef<HTMLDivElement>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const live = useApi(() => api.workers(), []);
  const workers = live.data ?? [];
  // Real attendance heatmap (replaces the seeded sequence) and live
  // production-lines rollup for the Production lines panel below.
  const heatmap = useApi(() => api.attendanceHeatmap(28), []);
  const linesResp = useApi(() => api.productionLinesReport(), []);
  const lines = linesResp.data?.lines ?? [];

  const filtered = useMemo(
    () =>
      workers.filter((w) => {
        if (shift !== "all" && w.shift !== shift) return false;
        if (!q) return true;
        const t = q.toLowerCase();
        return w.name.toLowerCase().includes(t) || w.empNo.toLowerCase().includes(t);
      }),
    [q, shift, workers]
  );

  const inCount = workers.filter((w) => w.status === "in").length;
  // Guard against empty workers - avg of nothing is NaN, which breaks
  // the "1.8" delta line on the Kpi tile.
  const avgEff =
    workers.length > 0
      ? workers.reduce((s, w) => s + w.efficiency, 0) / workers.length
      : 0;
  const avgRej =
    workers.length > 0
      ? workers.reduce((s, w) => s + w.rejectionRate, 0) / workers.length
      : 0;

  const lineOutput = useMemo(() => {
    const out: Record<string, { line: string; output: number; target: number }> = {};
    for (const w of workers) {
      const k = w.station;
      if (!out[k]) out[k] = { line: k, output: 0, target: 0 };
      out[k].output += w.unitsToday;
      out[k].target += w.targetToday;
    }
    return Object.values(out);
  }, [workers]);

  const topPerformer = useMemo(() => {
    if (workers.length === 0) return null;
    return [...workers].sort((a, b) => b.efficiency - a.efficiency)[0];
  }, [workers]);

  const openAttendance = (date?: string) => {
    const day = date ?? new Date().toISOString().slice(0, 10);
    setSelectedAttendanceDay(day);
    attendanceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightAttendance(true);
    window.setTimeout(() => setHighlightAttendance(false), 1600);
  };

  const cols: Column<Worker>[] = [
    {
      key: "emp",
      header: "Emp",
      cell: (r) => <span className="font-mono text-caption font-semibold">{r.empNo}</span>,
      width: "100px",
    },
    {
      key: "name",
      header: "Name",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary-50 text-primary grid place-items-center font-bold text-caption">
            {r.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </div>
          <div>
            <div className="font-semibold">{r.name}</div>
            <div className="text-caption text-ink-muted">{r.station} · Shift {r.shift}</div>
          </div>
        </div>
      ),
      sortable: true,
      sortValue: (r) => r.name,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Chip size="sm" tone={statusTone(r.status)} icon={<StatusDot tone={statusTone(r.status)} />}>
          {r.status === "in" ? "On floor" : r.status === "break" ? "On break" : "Off duty"}
        </Chip>
      ),
      width: "130px",
    },
    {
      key: "hours",
      header: "Hours",
      align: "right",
      cell: (r) => <span className="tnum">{r.hoursToday.toFixed(1)}h</span>,
      width: "80px",
    },
    {
      key: "units",
      header: "Output",
      align: "right",
      cell: (r) => (
        <div className="text-right">
          <div className="font-bold tnum">{num(r.unitsToday)}</div>
          <div className="text-caption text-ink-muted tnum">/ {num(r.targetToday)}</div>
        </div>
      ),
      width: "120px",
      sortable: true,
      sortValue: (r) => r.unitsToday,
    },
    {
      key: "eff",
      header: "Efficiency",
      cell: (r) => {
        const tone = r.efficiency > 95 ? "success" : r.efficiency > 80 ? "warning" : "danger";
        return (
          <div className="flex items-center gap-2 min-w-[140px]">
            <div className="flex-1 h-1.5 bg-canvas rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full",
                  tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-danger"
                )}
                style={{ width: `${Math.min(100, r.efficiency)}%` }}
              />
            </div>
            <span
              className={cn(
                "text-body-sm font-bold tnum w-12 text-right",
                tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger"
              )}
            >
              {r.efficiency.toFixed(0)}%
            </span>
          </div>
        );
      },
      width: "200px",
      sortable: true,
      sortValue: (r) => r.efficiency,
    },
    {
      key: "rej",
      header: "Rejection",
      align: "right",
      cell: (r) => <span className="tnum text-ink-muted">{r.rejectionRate.toFixed(1)}%</span>,
      width: "100px",
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Worker Productivity</h2>
            <Chip tone="success" icon={<StatusDot tone="success" />}>{inCount} on floor</Chip>
          </>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Calendar size={14} />}
              onClick={() => openAttendance()}
            >
              Attendance
            </Button>
            <Button
              size="sm"
              icon={<ScanLine size={14} />}
              onClick={() => setPunchOpen(true)}
            >
              Punch In · F2
            </Button>
          </>
        }
      />

      {banner && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm flex items-center gap-2",
            banner.tone === "ok"
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          <span className="flex-1">{banner.text}</span>
          <button
            className="underline text-caption"
            onClick={() => setBanner(null)}
          >
            dismiss
          </button>
        </div>
      )}

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
        <Kpi
          label="Avg Efficiency"
          value={workers.length > 0 ? `${avgEff.toFixed(1)}%` : "—"}
          deltaSuffix=""
          icon={<TrendingUp size={14} />}
          accent="success"
        />
        <Kpi
          label="Avg Rejection"
          value={workers.length > 0 ? `${avgRej.toFixed(2)}%` : "—"}
          deltaSuffix=""
          icon={<TrendingDown size={14} />}
          accent="primary"
        />
        <Kpi
          label="On Floor"
          value={`${inCount}/${workers.length}`}
          deltaSuffix=""
          icon={<Users size={14} />}
          accent="primary"
        />
        <Kpi
          label="Top Performer"
          value={topPerformer?.name.split(" ")[0] ?? "—"}
          icon={<Award size={14} />}
          accent="warning"
          hint={
            topPerformer
              ? `${topPerformer.efficiency.toFixed(0)}% eff`
              : "no data"
          }
        />
      </div>

      <div className="grid grid-cols-12 gap-4 p-4 bg-canvas">
        <Card title="Line Output Today" subtitle="Units produced vs target" className="col-span-12 lg:col-span-7" bodyClassName="!pt-2">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineOutput} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#CBD2D6" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="line" stroke="#687173" fontSize={11} tickLine={false} />
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
                <Bar dataKey="target" fill="#CBD2D6" radius={[4, 4, 0, 0]} name="Target" />
                <Bar dataKey="output" fill="#003087" radius={[4, 4, 0, 0]} name="Output" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div
          ref={attendanceSectionRef}
          className={cn(
            "col-span-12 lg:col-span-5 transition-shadow rounded-md",
            highlightAttendance && "ring-2 ring-primary ring-offset-2"
          )}
        >
          <Card
            title="Attendance Heatmap"
            subtitle="Last 4 weeks · daily distinct workers punched in · click a day for detail"
          >
            <AttendanceHeatmap
              rows={heatmap.data ?? []}
              loading={heatmap.loading}
              selectedDate={selectedAttendanceDay}
              onDayClick={(date) => openAttendance(date)}
            />
            {selectedAttendanceDay && (
              <AttendanceDayPanel
                date={selectedAttendanceDay}
                onClose={() => setSelectedAttendanceDay(null)}
              />
            )}
          </Card>
        </div>
      </div>

      {/* Production lines: live rollup of WorkCenter throughput vs
          capacity. Drives a single source of truth for "what is
          actually running" - the Manufacturing right rail uses the
          same endpoint, so the two views always agree. */}
      <div className="px-4 pb-4 bg-canvas">
        <Card
          title="Production lines"
          subtitle={`Live · ${lines.length} active line${lines.length === 1 ? "" : "s"}`}
        >
          {linesResp.loading ? (
            <div className="py-6 text-center text-body-sm text-ink-muted">
              Loading…
            </div>
          ) : lines.length === 0 ? (
            <div className="py-6 text-center text-body-sm text-ink-muted">
              No work centers configured. Add them in <strong>Settings &raquo; Production lines</strong>.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {lines.map((line) => {
                const machines = line.machines ?? [];
                const utilTone =
                  line.utilisationPct === null
                    ? "neutral"
                    : line.utilisationPct >= 80
                      ? "success"
                      : line.utilisationPct >= 30
                        ? "warning"
                        : "neutral";
                const running = machines.filter(
                  (m) => m.status === "running" || m.busy
                ).length;
                return (
                  <div
                    key={line.id}
                    className="border border-border rounded-md p-3 bg-surface"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div
                        className={cn(
                          "h-9 w-9 rounded-md grid place-items-center",
                          running > 0
                            ? "bg-success-soft text-success"
                            : "bg-canvas text-ink-muted"
                        )}
                      >
                        <Factory size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-body-sm font-bold truncate">
                          {line.name}
                        </div>
                        <div className="text-caption text-ink-muted font-mono">
                          {line.code}
                        </div>
                      </div>
                      {line.activeOrders > 0 ? (
                        <Chip size="sm" tone="primary">
                          {line.activeOrders} MO
                        </Chip>
                      ) : (
                        <Chip size="sm" tone="neutral">
                          idle
                        </Chip>
                      )}
                    </div>
                    {line.dailyCapacity !== null ? (
                      <>
                        <div className="flex items-center justify-between text-caption mb-1">
                          <span className="text-ink-muted">Output / capacity</span>
                          <span className="tnum font-semibold">
                            {num(line.outputToday)} / {num(line.dailyCapacity)}
                          </span>
                        </div>
                        <div className="h-2 bg-canvas rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full",
                              utilTone === "success" && "bg-success",
                              utilTone === "warning" && "bg-warning",
                              utilTone === "neutral" && "bg-ink-muted/40"
                            )}
                            style={{
                              width: `${Math.min(100, line.utilisationPct ?? 0)}%`,
                            }}
                          />
                        </div>
                        <div className="text-caption text-ink-muted mt-1">
                          {line.utilisationPct ?? 0}% utilisation today
                        </div>
                      </>
                    ) : (
                      <div className="text-caption text-ink-muted">
                        Capacity not set ·{" "}
                        <span className="tnum">{num(line.outputToday)}</span>{" "}
                        produced today
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {machines.length === 0 ? (
                        <div className="col-span-2 text-caption text-ink-muted">
                          No machines yet.
                        </div>
                      ) : (
                        machines.map((m) => {
                          const tone =
                            m.status === "running"
                              ? "success"
                              : m.status === "maintenance"
                                ? "warning"
                                : m.status === "broken"
                                  ? "danger"
                                  : "neutral";
                          return (
                            <div
                              key={m.id}
                              className="flex items-center gap-1.5 text-caption px-1.5 py-1 rounded bg-canvas/60"
                            >
                              <StatusDot
                                tone={
                                  tone === "success"
                                    ? "success"
                                    : tone === "warning"
                                      ? "warning"
                                      : tone === "danger"
                                        ? "danger"
                                        : "neutral"
                                }
                              />
                              <span className="truncate">{m.name}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {line.orders.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                        {line.orders.slice(0, 3).map((o) => (
                          <div
                            key={o.id}
                            className="flex items-center gap-2 text-caption"
                          >
                            <span className="font-mono font-semibold">
                              {o.orderNo}
                            </span>
                            <span className="text-ink-muted truncate flex-1">
                              {o.productSku} · {o.productName}
                            </span>
                            <span className="tnum">
                              {num(o.actualQty)}/{num(o.plannedQty)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="px-4 py-3 bg-surface border-y border-border flex items-center gap-3 flex-wrap">
        <Input
          size="sm"
          iconLeft={<Search size={14} />}
          placeholder="Search worker, emp number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="!h-8"
        />
        <div className="flex items-center gap-1 ml-2">
          {(["all", "A", "B", "C"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setShift(s)}
              className={cn(
                "h-7 px-3 rounded-md text-caption font-semibold transition-colors",
                shift === s ? "bg-primary text-white" : "bg-canvas text-ink-muted hover:text-primary"
              )}
            >
              {s === "all" ? "All shifts" : `Shift ${s}`}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" icon={<Filter size={14} />}>More filters</Button>
        <span className="ml-auto text-caption text-ink-muted flex items-center gap-1">
          <Clock size={12} /> Updated live
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-surface">
        <DataTable rows={filtered} columns={cols} rowKey={(r) => r.id} />
      </div>

      {punchOpen && (
        <PunchModal
          workers={workers}
          onClose={() => setPunchOpen(false)}
          onPunched={async (msg) => {
            setBanner({ tone: "ok", text: msg });
            setPunchOpen(false);
            await live.refetch();
          }}
          onError={(msg) => setBanner({ tone: "err", text: msg })}
        />
      )}
    </div>
  );
};

// ---- Attendance heatmap ------------------------------------------
//
// Renders the last 28 days as a 7-col grid (one column per weekday).
// Cell intensity scales with the day's distinct-worker punch-in count
// vs. the configured Worker headcount. This replaces the seeded
// pseudo-random heatmap that used to ship in this page.
interface HeatmapRow {
  date: string;
  weekday: string;
  presentCount: number;
}

const AttendanceHeatmap = ({
  rows,
  loading,
  selectedDate,
  onDayClick,
}: {
  rows: HeatmapRow[];
  loading: boolean;
  selectedDate?: string | null;
  onDayClick?: (date: string) => void;
}) => {
  const max = Math.max(1, ...rows.map((r) => r.presentCount));
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // Bucket rows into a Map keyed by ISO date for quick lookup. Then
  // build a grid that always shows the most recent 28 days, padded
  // with empty cells when the API returned fewer rows than requested.
  const byDate = new Map<string, HeatmapRow>();
  for (const r of rows) byDate.set(r.date, r);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Anchor the grid so the last column is "today's weekday". We render
  // 4 weeks (28 cells), oldest on the left.
  const cells: Array<{ date: string; row: HeatmapRow | null }> = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, row: byDate.get(key) ?? null });
  }
  return (
    <>
      <div className="grid grid-cols-7 gap-1 mb-2 text-caption text-ink-muted text-center">
        {weekdayLabels.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const count = c.row?.presentCount ?? 0;
          const intensity = max > 0 ? count / max : 0;
          const dateLabel = new Date(c.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          return (
            <button
              key={i}
              type="button"
              title={`${dateLabel} · ${count} on floor`}
              onClick={() => onDayClick?.(c.date)}
              className={cn(
                "aspect-square rounded-sm grid place-items-center text-[10px] tnum font-semibold transition-transform",
                "hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                onDayClick && "cursor-pointer",
                selectedDate === c.date && "ring-2 ring-primary ring-offset-1"
              )}
              style={{
                background: count > 0
                  ? `rgba(0, 48, 135, ${0.1 + intensity * 0.85})`
                  : "rgba(0, 0, 0, 0.04)",
                color: intensity > 0.5 ? "white" : "#1A1A2E",
              }}
            >
              {count > 0 ? count : ""}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3 text-caption text-ink-muted">
        <span>{loading ? "Loading…" : `Peak ${max}`}</span>
        <div className="flex items-center gap-1">
          {[0.1, 0.3, 0.5, 0.7, 0.95].map((a, i) => (
            <div
              key={i}
              className="h-3 w-3 rounded-sm"
              style={{ background: `rgba(0, 48, 135, ${a})` }}
            />
          ))}
        </div>
        <span>More</span>
      </div>
    </>
  );
};

const AttendanceDayPanel = ({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) => {
  const live = useApi(() => api.attendanceDay(date), [date]);
  const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-body-sm font-semibold">{label}</div>
        <button
          type="button"
          onClick={onClose}
          className="text-caption text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>
      {live.loading && (
        <div className="text-caption text-ink-muted py-2">Loading roster…</div>
      )}
      {live.error && (
        <div className="text-caption text-danger py-2">{(live.error as Error).message}</div>
      )}
      {!live.loading && !live.error && live.data && live.data.workers.length === 0 && (
        <div className="text-caption text-ink-muted py-2">No punch-ins recorded for this day.</div>
      )}
      {live.data && live.data.workers.length > 0 && (
        <div className="max-h-40 overflow-y-auto divide-y divide-border border border-border rounded-md">
          {live.data.workers.map((w) => (
            <div key={w.workerId} className="px-3 py-2 flex items-center gap-2 text-body-sm">
              <span className="font-mono text-caption font-semibold w-14 shrink-0">{w.empNo}</span>
              <span className="flex-1 min-w-0 truncate font-medium">{w.name}</span>
              <span className="text-caption text-ink-muted shrink-0">
                {w.inAt ? dt(w.inAt) : "—"}
                {w.outAt ? ` → ${dt(w.outAt)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---- Punch modal -------------------------------------------------
//
// Quick worker picker + direction (in / out / break). Calls the
// /workers/punch endpoint and bubbles up a status banner. We don't
// support badge-scanning here yet - that's a follow-up - but the
// emp-number search lets the operator type the badge directly and hit
// Enter to punch in.
const PunchModal = ({
  workers,
  onClose,
  onPunched,
  onError,
}: {
  workers: Worker[];
  onClose: () => void;
  onPunched: (msg: string) => Promise<void> | void;
  onError: (msg: string) => void;
}) => {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const filtered = workers.filter((w) => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
      w.empNo.toLowerCase().includes(t) || w.name.toLowerCase().includes(t)
    );
  });

  const punch = async (
    w: Worker,
    direction: "in" | "out" | "break"
  ) => {
    setBusy(`${w.id}-${direction}`);
    try {
      await api.punchWorker({ empNo: w.empNo, direction });
      const verb =
        direction === "in" ? "punched in" : direction === "out" ? "punched out" : "on break";
      await onPunched(`${w.name} (${w.empNo}) ${verb}.`);
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[560px] max-w-[95vw] max-h-[80vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <ScanLine size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Punch in / out
              </div>
              <div className="text-body-sm">
                Search by emp number or name; tap an action.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <Input
            iconLeft={<Search size={14} />}
            placeholder="Type emp number or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
              No matching worker.
            </div>
          )}
          {filtered.slice(0, 30).map((w) => (
            <div
              key={w.id}
              className="px-4 py-2.5 flex items-center gap-3"
            >
              <div className="h-8 w-8 rounded-full bg-primary-50 text-primary grid place-items-center font-bold text-caption">
                {w.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-body-sm font-semibold truncate">
                  {w.name}
                </div>
                <div className="text-caption text-ink-muted">
                  {w.empNo} · {w.station} · Shift {w.shift}
                </div>
              </div>
              <Chip size="sm" tone={statusTone(w.status)}>
                {w.status === "in" ? "On floor" : w.status === "break" ? "Break" : "Off"}
              </Chip>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={w.status === "in" ? "outline" : "primary"}
                  icon={<LogIn size={12} />}
                  onClick={() => punch(w, "in")}
                  disabled={busy !== null || w.status === "in"}
                >
                  In
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Pause size={12} />}
                  onClick={() => punch(w, "break")}
                  disabled={busy !== null || w.status !== "in"}
                >
                  Break
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<LogOut size={12} />}
                  onClick={() => punch(w, "out")}
                  disabled={busy !== null || w.status === "out"}
                >
                  Out
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
