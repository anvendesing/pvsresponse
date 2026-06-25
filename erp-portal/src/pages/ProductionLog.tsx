import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Factory,
  Gauge,
  Info,
  Timer,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Kpi } from "@/components/common/Kpi";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import { CollapsibleStats } from "@/components/common/CollapsibleStats";
import { DataTable, type Column } from "@/components/common/DataTable";
import { useApi } from "@/hooks/useApi";
import {
  api,
  type MoWoLogRow,
  type MachineUtilizationRow,
} from "@/lib/api";
import { dt, num } from "@/lib/format";
import { cn } from "@/lib/cn";

type Tab = "wo-log" | "machine-util";

const fmtMin = (m: number | null): string => {
  if (m == null) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
};

const utilTone = (pct: number | null) => {
  if (pct == null) return "neutral" as const;
  if (pct >= 80) return "success" as const;
  if (pct >= 50) return "primary" as const;
  if (pct >= 25) return "warning" as const;
  return "danger" as const;
};

const woStatusTone = (s: string) => {
  switch (s) {
    case "complete": return "success" as const;
    case "running": return "primary" as const;
    case "queued": case "ready": case "waiting": return "neutral" as const;
    case "paused": case "rework": return "warning" as const;
    default: return "neutral" as const;
  }
};

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:4000/v1";

const downloadCsv = (path: string) => {
  const token = localStorage.getItem("authToken") ?? "";
  fetch(`${apiBase}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() ?? "report.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
};

export const ProductionLog = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("wo-log");
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");

  const woLog = useApi(() => api.moWoLog({ days }), [days]);
  const machineUtil = useApi(() => api.machineUtilization({ days }), [days]);

  const rows: MoWoLogRow[] = useMemo(() => {
    const all = woLog.data?.rows ?? [];
    if (!search) return all;
    const t = search.toLowerCase();
    return all.filter((r) =>
      [r.orderNo, r.workOrderNo, r.productSku, r.productName, r.machineCode, r.lineCode, r.operationName, r.facilityCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t))
    );
  }, [woLog.data, search]);

  const machines: MachineUtilizationRow[] = useMemo(() => {
    const all = machineUtil.data?.rows ?? [];
    if (!search) return all;
    const t = search.toLowerCase();
    return all.filter((r) =>
      [r.machineCode, r.machineName, r.lineCode, r.facilityCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t))
    );
  }, [machineUtil.data, search]);

  const woColumns: Column<MoWoLogRow>[] = [
    {
      key: "mo", header: "MO", width: "160px",
      sortable: true, sortValue: (r) => r.orderNo,
      cell: (r) => (
        <div className="flex flex-col">
          <button
            className="text-left font-semibold text-primary hover:underline"
            onClick={(e) => { e.stopPropagation(); navigate(`/manufacturing?focus=${r.moId}`); }}
          >
            {r.orderNo}
          </button>
          <span className="text-xs text-text-subtle">{r.moStatus}</span>
        </div>
      ),
    },
    {
      key: "product", header: "Product", width: "200px",
      sortable: true, sortValue: (r) => r.productSku,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{r.productSku}</span>
          <span className="text-xs text-text-subtle truncate">{r.productName}{r.variantSize ? ` · ${r.variantSize}` : ""}</span>
        </div>
      ),
    },
    {
      key: "wo", header: "Work Order", width: "150px",
      sortable: true, sortValue: (r) => r.workOrderNo,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium">{r.workOrderNo}</span>
          <Chip tone={woStatusTone(r.woStatus)}>{r.woStatus}</Chip>
        </div>
      ),
    },
    {
      key: "op", header: "Operation", width: "160px",
      cell: (r) => r.operationName ? (
        <div className="flex flex-col">
          <span className="text-sm">{r.operationName}</span>
          <span className="text-xs text-text-subtle">
            {r.operationSeq != null ? `Seq ${r.operationSeq}` : ""}
            {r.splitSeq > 0 ? ` · split ${r.splitSeq}` : ""}
            {r.plannedMinutes != null ? ` · plan ${fmtMin(r.plannedMinutes)}` : ""}
          </span>
        </div>
      ) : <span className="text-text-subtle">—</span>,
    },
    {
      key: "line", header: "Line / Facility", width: "160px",
      sortable: true, sortValue: (r) => r.lineCode ?? "",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{r.lineCode ?? "—"}</span>
          <span className="text-xs text-text-subtle">{r.facilityCode ?? ""}</span>
        </div>
      ),
    },
    {
      key: "machine", header: "Machine", width: "150px",
      sortable: true, sortValue: (r) => r.machineCode ?? "",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-sm">{r.machineCode ?? "—"}</span>
          <span className="text-xs text-text-subtle">{r.machineName ?? ""}</span>
        </div>
      ),
    },
    {
      key: "start", header: "Start", width: "130px",
      sortable: true, sortValue: (r) => r.woStartTime ?? "",
      cell: (r) => r.woStartTime ? <span className="text-xs">{dt(r.woStartTime)}</span> : <span className="text-text-subtle">—</span>,
    },
    {
      key: "end", header: "End", width: "130px",
      sortable: true, sortValue: (r) => r.woEndTime ?? "",
      cell: (r) => r.woEndTime ? <span className="text-xs">{dt(r.woEndTime)}</span> : <span className="text-text-subtle">—</span>,
    },
    {
      key: "duration", header: "Duration", width: "90px", align: "right",
      sortable: true, sortValue: (r) => r.durationMin ?? -1,
      cell: (r) => <span className="font-mono text-sm">{fmtMin(r.durationMin)}</span>,
    },
    {
      key: "output", header: "Out / Target", width: "120px", align: "right",
      sortable: true, sortValue: (r) => r.output,
      cell: (r) => (
        <span className="font-mono text-sm">
          {num(r.output, 2)} <span className="text-text-subtle">/ {num(r.target, 2)}</span>
        </span>
      ),
    },
    {
      key: "tva", header: "Out / Target %", width: "120px", align: "center",
      sortable: true, sortValue: (r) => r.targetVsActualPct ?? -1,
      cell: (r) => r.targetVsActualPct == null ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <Chip tone={utilTone(r.targetVsActualPct)}>{r.targetVsActualPct}%</Chip>
      ),
    },
    {
      key: "tvp", header: "Time vs plan", width: "110px", align: "center",
      sortable: true, sortValue: (r) => r.timeVsPlanPct ?? -1,
      cell: (r) => r.timeVsPlanPct == null ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <Chip tone={r.timeVsPlanPct >= 100 ? "success" : r.timeVsPlanPct >= 75 ? "primary" : "warning"}>
          {r.timeVsPlanPct}%
        </Chip>
      ),
    },
    {
      key: "util", header: "Cap util %", width: "100px", align: "center",
      sortable: true, sortValue: (r) => r.utilizationPct ?? -1,
      cell: (r) => r.utilizationPct == null ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <Chip tone={utilTone(r.utilizationPct)}>{r.utilizationPct}%</Chip>
      ),
    },
    {
      key: "qa", header: "QA", width: "70px", align: "center",
      cell: (r) => r.qaStatus ? (
        <Chip tone={r.qaStatus === "pass" ? "success" : r.qaStatus === "fail" ? "danger" : "neutral"}>
          {r.qaStatus}
        </Chip>
      ) : <span className="text-text-subtle">—</span>,
    },
    {
      key: "materials", header: "Mat. used", width: "100px", align: "right",
      sortable: true, sortValue: (r) => r.materialsConsumed,
      cell: (r) => <span className="font-mono text-sm">{num(r.materialsConsumed, 2)}</span>,
    },
    {
      key: "workers", header: "Workers", width: "120px",
      cell: (r) => r.workers.length > 0 ? (
        <span className="text-xs">{r.workers.join(", ")}</span>
      ) : <span className="text-text-subtle">—</span>,
    },
  ];

  const machineColumns: Column<MachineUtilizationRow>[] = [
    {
      key: "machine", header: "Machine", width: "200px",
      sortable: true, sortValue: (r) => r.machineCode,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold">{r.machineCode}</span>
          <span className="text-xs text-text-subtle">{r.machineName}</span>
        </div>
      ),
    },
    {
      key: "status", header: "Status", width: "100px", align: "center",
      cell: (r) => (
        <Chip tone={r.machineStatus === "running" ? "success" : r.machineStatus === "broken" ? "danger" : r.machineStatus === "maintenance" ? "warning" : "neutral"}>
          {r.machineStatus}
        </Chip>
      ),
    },
    {
      key: "line", header: "Line / Facility", width: "200px",
      sortable: true, sortValue: (r) => r.lineCode ?? "",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-sm">{r.lineCode ?? "—"}</span>
          <span className="text-xs text-text-subtle">{r.facilityCode ?? ""}</span>
        </div>
      ),
    },
    {
      key: "cap", header: "Cap/hr", width: "90px", align: "right",
      sortable: true, sortValue: (r) => r.capacityPerHour ?? 0,
      cell: (r) => <span className="font-mono text-sm">{r.capacityPerHour != null ? num(r.capacityPerHour, 0) : "—"}</span>,
    },
    {
      key: "wos", header: "WOs (✓)", width: "100px", align: "right",
      sortable: true, sortValue: (r) => r.woCount,
      cell: (r) => <span className="font-mono text-sm">{r.woCount} <span className="text-text-subtle">({r.completedCount})</span></span>,
    },
    {
      key: "run", header: "Run time", width: "120px", align: "right",
      sortable: true, sortValue: (r) => r.runMin,
      cell: (r) => <span className="font-mono text-sm">{fmtMin(r.runMin)}</span>,
    },
    {
      key: "util", header: "Time util %", width: "130px", align: "center",
      sortable: true, sortValue: (r) => r.utilizationPct,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-2 w-16 rounded-full bg-surface-subtle overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                r.utilizationPct >= 80 ? "bg-success" :
                r.utilizationPct >= 50 ? "bg-primary" :
                r.utilizationPct >= 25 ? "bg-warning" : "bg-danger"
              )}
              style={{ width: `${Math.min(100, r.utilizationPct)}%` }}
            />
          </div>
          <span className="font-mono text-xs w-10 text-right">{r.utilizationPct}%</span>
        </div>
      ),
    },
    {
      key: "output", header: "Output", width: "100px", align: "right",
      sortable: true, sortValue: (r) => r.output,
      cell: (r) => <span className="font-mono text-sm">{num(r.output, 2)}</span>,
    },
    {
      key: "tp", header: "Throughput/hr", width: "130px", align: "right",
      sortable: true, sortValue: (r) => r.throughputPerHour,
      cell: (r) => <span className="font-mono text-sm">{num(r.throughputPerHour, 2)}</span>,
    },
    {
      key: "capUtil", header: "Cap util %", width: "110px", align: "center",
      sortable: true, sortValue: (r) => r.capacityUtilizationPct ?? -1,
      cell: (r) => r.capacityUtilizationPct == null ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <Chip tone={utilTone(r.capacityUtilizationPct)}>{r.capacityUtilizationPct}%</Chip>
      ),
    },
  ];

  const woTotals = woLog.data?.totals;
  const muTotals = machineUtil.data?.totals;

  const sourcesTooltip = [
    "Sources:",
    "• ProductionOrder — MO start/due/qty/efficiency",
    "• WorkOrder.startTime/endTime — run window",
    "• ProductionLine.capacityPerHour — denominator for cap util",
    "• Machine — status + line linkage",
    "• BomOperation.durationMinutes — planned minutes",
    "• StockLedger (txnType=Issue, ref=MO.orderNo) — materials consumed",
    "",
    `Time util % = run minutes ÷ (days × ${machineUtil.data?.hoursPerDay ?? 8}h)`,
    "Cap util % = output ÷ (capacity × run hours)",
    "Out/Target % = WO output ÷ WO target",
    "Time vs plan = BomOperation.durationMinutes ÷ actual run minutes",
  ].join("\n");

  const statsSummary = woTotals && muTotals
    ? `${num(woTotals.moCount, 0)} MO · ${num(woTotals.woCount, 0)} WO · ${fmtMin(woTotals.totalRunMin)} run · ${muTotals.avgUtilizationPct}% avg util`
    : "Loading…";

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-none flex flex-col">
      <div className="p-4 pb-2">
      <Toolbar
        left={
          <Button variant="ghost" onClick={() => navigate("/manufacturing")}>
            <ArrowLeft className="h-4 w-4" /> Manufacturing
          </Button>
        }
        right={
          <>
            <label className="text-xs text-text-subtle">Window</label>
            <select
              className="border border-border rounded px-2 py-1 text-sm bg-surface"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
            >
              <option value={1}>Last 24h</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Input
              placeholder="Search MO / WO / machine…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            <Button
              variant="ghost"
              onClick={() =>
                downloadCsv(
                  tab === "wo-log"
                    ? `/reports/mo-wo-log?days=${days}&format=csv`
                    : `/reports/machine-utilization?days=${days}&format=csv`
                )
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            <button
              type="button"
              title={sourcesTooltip}
              aria-label="Data sources and formulas"
              className="inline-flex items-center justify-center w-8 h-8 rounded text-text-subtle hover:text-text hover:bg-canvas"
            >
              <Info className="h-4 w-4" />
            </button>
          </>
        }
      />
      </div>

      <CollapsibleStats storageKey="production-log" title="Stats" summary={statsSummary}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Factory className="h-4 w-4" />}
            label="MOs in window"
            value={woTotals ? num(woTotals.moCount, 0) : "—"}
            hint={`${days}-day window`}
          />
          <Kpi
            icon={<Wrench className="h-4 w-4" />}
            label="Work orders"
            value={woTotals ? num(woTotals.woCount, 0) : "—"}
            hint="Started or updated"
          />
          <Kpi
            icon={<Timer className="h-4 w-4" />}
            label="Total run time"
            value={woTotals ? fmtMin(woTotals.totalRunMin) : "—"}
            hint="Sum of WO durations"
          />
          <Kpi
            icon={<Gauge className="h-4 w-4" />}
            label="Avg machine util"
            value={muTotals ? `${muTotals.avgUtilizationPct}%` : "—"}
            hint={`vs ${machineUtil.data?.hoursPerDay ?? 8}h/day`}
          />
        </div>
      </CollapsibleStats>

      <div className="px-4 pt-3 flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("wo-log")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "wo-log" ? "border-primary text-primary" : "border-transparent text-text-subtle hover:text-text"
          )}
        >
          <TrendingUp className="inline h-4 w-4 mr-1" />
          MO / WO Log
        </button>
        <button
          onClick={() => setTab("machine-util")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "machine-util" ? "border-primary text-primary" : "border-transparent text-text-subtle hover:text-text"
          )}
        >
          <Gauge className="inline h-4 w-4 mr-1" />
          Machine utilization
        </button>
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-4 pt-3 flex flex-col">
        <div className="flex-1 min-h-0 bg-surface border border-border rounded-lg shadow-e1 overflow-hidden">
          {tab === "wo-log" ? (
            <DataTable
              rows={rows}
              columns={woColumns}
              rowKey={(r) => r.woId}
              empty={
                woLog.loading ? "Loading production log…" :
                woLog.error ? `Failed to load: ${String(woLog.error)}` :
                "No work orders in this window."
              }
              dense
              stickyHeader
              className="h-full"
            />
          ) : (
            <DataTable
              rows={machines}
              columns={machineColumns}
              rowKey={(r) => r.machineId}
              empty={
                machineUtil.loading ? "Loading machine utilization…" :
                machineUtil.error ? `Failed to load: ${String(machineUtil.error)}` :
                "No machines found."
              }
              dense
              stickyHeader
              className="h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductionLog;
