import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type TransferOrderRow } from "../../lib/api";
import { useDeviceFacility } from "../useDeviceFacility";

// =====================================================================
// MfgTransfers — incoming material requests for this room's line WH
// =====================================================================
// Shows TRFs whose destination is this facility's production-line
// warehouse, sorted by status (open requests first). Operators get a
// quick "is my stuff on its way?" view; the actual pick + drop still
// happens on the warehouse /m/* PWA.

const statusLabel: Record<TransferOrderRow["status"], string> = {
  draft: "Draft",
  ready: "Ready to pick",
  in_transit: "In transit",
  done: "Delivered",
  cancelled: "Cancelled",
};

const statusTone: Record<TransferOrderRow["status"], string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  ready: "bg-amber-100 text-amber-900 border-amber-200",
  in_transit: "bg-indigo-100 text-indigo-900 border-indigo-200",
  done: "bg-emerald-100 text-emerald-900 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

// Strip the StockRule:<id> dedup marker (and any "auto-replenish
// transfer" boilerplate suffix from legacy rows) so the transfers
// screen shows the meaningful part of the note. Returns null when
// nothing remains worth displaying.
const prettyNotes = (raw: string | null): string | null => {
  if (!raw) return null;
  const cleaned = raw
    // Remove "StockRule:<cuid>" wherever it sits in the string.
    .replace(/StockRule:[A-Za-z0-9]+/g, "")
    // Legacy notes added this trailing phrase after the marker.
    .replace(/auto-replenish transfer/gi, "")
    // Tidy up leftover separators / double spaces.
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
};

const sortRank: Record<TransferOrderRow["status"], number> = {
  ready: 0,
  in_transit: 1,
  draft: 2,
  done: 3,
  cancelled: 4,
};

export const MfgTransfers = () => {
  const facility = useDeviceFacility();
  const [params] = useSearchParams();
  const moFilter = params.get("moId");
  const [rows, setRows] = useState<TransferOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!facility?.productionLineWarehouseId) {
      setRows([]);
      return;
    }
    setRefreshing(true);
    try {
      const data = await api.transferOrders({
        toWarehouseId: facility.productionLineWarehouseId,
        limit: 100,
        ...(moFilter ? { productionOrderId: moFilter } : {}),
      });
      setRows(data);
    } catch (e) {
      setError((e as Error).message ?? "Could not load transfers.");
    } finally {
      setRefreshing(false);
    }
  }, [facility, moFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const r = sortRank[a.status] - sortRank[b.status];
      if (r !== 0) return r;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [rows]);

  if (!facility) return null;

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            Incoming transfers
          </h1>
          <p className="text-xs text-slate-500">
            Destined for {facility.productionLineWarehouseCode ?? "this room"}
            {moFilter && rows && rows[0]?.productionOrder?.orderNo
              ? ` · MO ${rows[0].productionOrder.orderNo}`
              : ""}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="text-xs text-[#003087] font-medium underline disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {moFilter && (
        <Link
          to="/mfg/transfers"
          className="text-xs text-[#003087] underline"
        >
          ← Show all transfers
        </Link>
      )}

      {!facility.productionLineWarehouseId && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          No production-line warehouse mapped to this room. Ask a supervisor to
          configure it under Settings → Production Facilities.
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="rounded-xl bg-white border border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          Loading transfers…
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl bg-white border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          No incoming transfers.
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((t) => (
            <li
              key={t.id}
              className="rounded-xl bg-white border border-slate-200 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#003087]">
                      {t.transferNo}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusTone[t.status]}`}
                    >
                      {statusLabel[t.status]}
                    </span>
                  </div>
                  <div className="text-sm text-slate-800 mt-1">
                    {t.fromWarehouse.code} → {t.toWarehouse.code}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t.items.length} item{t.items.length === 1 ? "" : "s"}
                    {t.productionOrder
                      ? ` · MO ${t.productionOrder.orderNo}`
                      : ""}
                    {t.assignedTo
                      ? ` · claimed by ${t.assignedTo.name}`
                      : ""}
                  </div>
                </div>
              </div>
              {prettyNotes(t.notes) && (
                <div className="mt-2 text-[11px] text-slate-500 italic">
                  {prettyNotes(t.notes)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
