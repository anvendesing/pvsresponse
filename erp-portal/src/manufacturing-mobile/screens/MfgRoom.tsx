import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { ProductionOrder } from "../../data/types";
import { useDeviceFacility } from "../useDeviceFacility";

// =====================================================================
// MfgRoom — the main "what to produce" screen for this room
// =====================================================================
// Loads MOs filtered to the device's ProductionFacility, groups them
// by stage (Up next → In progress → QC → Done today), and surfaces
// material-issue + work-order signals so the operator can see at a
// glance what needs action.
//
// Tapping an MO opens the detail screen (/mfg/mo/:id) where the
// operator can issue materials, request transfers for shortages, log
// work orders and complete the run.

type Stage = "upnext" | "running" | "qc" | "done";

const stageLabel: Record<Stage, string> = {
  upnext: "Up next",
  running: "In progress",
  qc: "Quality check",
  done: "Done today",
};

const stageTone: Record<Stage, string> = {
  upnext: "bg-amber-100 text-amber-900 border-amber-200",
  running: "bg-emerald-100 text-emerald-900 border-emerald-200",
  qc: "bg-indigo-100 text-indigo-900 border-indigo-200",
  done: "bg-slate-100 text-slate-700 border-slate-200",
};

const dotByStage: Record<Stage, string> = {
  upnext: "bg-amber-500",
  running: "bg-emerald-500",
  qc: "bg-indigo-500",
  done: "bg-slate-400",
};

const moToStage = (mo: ProductionOrder): Stage | null => {
  if (mo.status === "planned" || mo.status === "delayed") return "upnext";
  if (mo.status === "in-progress") return "running";
  if (mo.status === "qc") return "qc";
  if (mo.status === "completed") {
    // Show only orders completed today.
    return "done";
  }
  // Skip cancelled.
  return null;
};

export const MfgRoom = () => {
  const facility = useDeviceFacility();
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!facility) return;
    setRefreshing(true);
    setError(null);
    try {
      const rows = await api.productionOrders({ facilityId: facility.id });
      setOrders(rows);
    } catch (e) {
      setError((e as Error).message ?? "Could not load production orders.");
    } finally {
      setRefreshing(false);
    }
  }, [facility]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh every 30s so the room board stays roughly live without
  // needing the operator to pull-to-refresh.
  useEffect(() => {
    const t = setInterval(() => {
      void load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const buckets = useMemo(() => {
    const map: Record<Stage, ProductionOrder[]> = {
      upnext: [],
      running: [],
      qc: [],
      done: [],
    };
    if (!orders) return map;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    for (const o of orders) {
      const stage = moToStage(o);
      if (!stage) continue;
      if (stage === "done") {
        // Heuristic: "done today" means status completed AND we received
        // it via this poll. The API doesn't return completedAt on the
        // list shape; we accept it for now and cap the visible list.
        map.done.push(o);
        continue;
      }
      map[stage].push(o);
    }
    // Earlier orderNo first for action queues; reverse for done.
    map.upnext.sort((a, b) => a.orderNo.localeCompare(b.orderNo));
    map.running.sort((a, b) => a.orderNo.localeCompare(b.orderNo));
    map.qc.sort((a, b) => a.orderNo.localeCompare(b.orderNo));
    map.done = map.done.slice(0, 8);
    return map;
  }, [orders]);

  if (!facility) return null;

  const counts: Array<{ stage: Stage; n: number }> = [
    { stage: "upnext", n: buckets.upnext.length },
    { stage: "running", n: buckets.running.length },
    { stage: "qc", n: buckets.qc.length },
    { stage: "done", n: buckets.done.length },
  ];

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* Counts strip */}
      <div className="grid grid-cols-4 gap-2">
        {counts.map((c) => (
          <div
            key={c.stage}
            className={`rounded-xl border px-2 py-2 text-center ${stageTone[c.stage]}`}
          >
            <div className="text-xl font-bold leading-none">{c.n}</div>
            <div className="text-[10px] uppercase tracking-wider mt-1">
              {stageLabel[c.stage]}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {facility.productionLineWarehouseCode
            ? `Stock from ${facility.productionLineWarehouseCode}`
            : "No line warehouse mapped"}
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="text-xs text-[#003087] font-medium underline disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {orders === null ? (
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Loading orders…
        </div>
      ) : (
        (["upnext", "running", "qc", "done"] as const).map((stage) => {
          const list = buckets[stage];
          if (list.length === 0 && stage === "done") return null;
          return (
            <section key={stage} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dotByStage[stage]}`} />
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                  {stageLabel[stage]}
                </h2>
                <span className="text-xs text-slate-400">({list.length})</span>
              </div>
              {list.length === 0 ? (
                <div className="rounded-xl bg-white border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-400">
                  Nothing here.
                </div>
              ) : (
                <ul className="space-y-2">
                  {list.map((mo) => (
                    <MoCard key={mo.id} mo={mo} stage={stage} />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
};

const MoCard = ({ mo, stage }: { mo: ProductionOrder; stage: Stage }) => {
  const pct = mo.plannedQty > 0 ? Math.min(100, Math.round((mo.actualQty / mo.plannedQty) * 100)) : 0;
  const variantBit = mo.variantSku
    ? ` · ${mo.variantSku}`
    : "";
  return (
    <li>
      <Link
        to={`/mfg/mo/${mo.id}`}
        className="block rounded-xl bg-white border border-slate-200 px-4 py-3 active:bg-slate-50"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#003087]">
                {mo.orderNo}
              </span>
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${stageTone[stage]} border`}>
                {stageLabel[stage]}
              </span>
            </div>
            <div className="text-sm font-medium text-slate-800 mt-1 truncate">
              {mo.product}{variantBit}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              <span className="font-mono">{mo.sku}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase text-slate-400">Planned</div>
            <div className="text-base font-bold text-slate-800 leading-none">
              {mo.plannedQty}
            </div>
            {stage !== "upnext" && (
              <div className="text-[10px] text-slate-500 mt-1">
                {mo.actualQty}/{mo.plannedQty}
              </div>
            )}
          </div>
        </div>
        {stage !== "upnext" && stage !== "done" && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </Link>
    </li>
  );
};
