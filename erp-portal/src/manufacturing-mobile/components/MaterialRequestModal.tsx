import { useEffect, useMemo, useState } from "react";
import {
  api,
  type MoRequirements,
  type WarehouseRow,
} from "../../lib/api";
import type { ProductionOrder } from "../../data/types";
import type { DeviceFacility } from "../useDeviceFacility";

// Manual material-request modal.
// Operator picks a SOURCE warehouse (usually a stock/storage WH) and
// adjusts the qty per shortage line. We POST a TransferOrder with
// productionOrderId linked, destination = this room's production-line
// warehouse. The warehouse team can then claim → pick → drop the TRF
// from the existing /m/* warehouse PWA.

interface Props {
  mo: ProductionOrder;
  facility: DeviceFacility;
  requirements: MoRequirements;
  onClose: () => void;
  onCreated: (transferNo: string) => void;
}

export const MaterialRequestModal = ({
  mo,
  facility,
  requirements,
  onClose,
  onCreated,
}: Props) => {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .warehouses()
      .then((rows) => {
        if (cancelled) return;
        const eligible = rows.filter(
          (w) =>
            w.active &&
            w.id !== facility.productionLineWarehouseId &&
            // Hide other production-line WHs by default - operators
            // typically pull from storage. Backend still allows it.
            w.kind !== "production"
        );
        setWarehouses(eligible);
        if (eligible[0]) setSourceId(eligible[0].id);
      })
      .catch((e: unknown) =>
        setError((e as Error).message ?? "Could not load warehouses.")
      );
    return () => {
      cancelled = true;
    };
  }, [facility]);

  // Default qty = shortage. Operators can edit per line or zero a row
  // out to skip it.
  const lines = useMemo(() => {
    return requirements.lines
      .filter((l) => l.shortage > 0 || l.stillNeeded > 0)
      .map((l) => {
        const def = l.shortage > 0 ? l.shortage : l.stillNeeded;
        return { ...l, defaultQty: def };
      });
  }, [requirements]);

  useEffect(() => {
    setQtyByProduct((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, string> = {};
      for (const l of lines) next[l.productId] = String(l.defaultQty);
      return next;
    });
  }, [lines]);

  const validItems = useMemo(() => {
    return lines
      .map((l) => ({
        productId: l.productId,
        sku: l.sku,
        qtyRequested: Number(qtyByProduct[l.productId] ?? "0"),
      }))
      .filter((i) => i.qtyRequested > 0);
  }, [lines, qtyByProduct]);

  const submit = async () => {
    if (!facility.productionLineWarehouseId) {
      setError("This room has no production-line warehouse mapped. Ask a supervisor to set one in Settings → Production Facilities.");
      return;
    }
    if (!sourceId) {
      setError("Pick a source warehouse.");
      return;
    }
    if (validItems.length === 0) {
      setError("Add at least one item with a non-zero quantity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createTransferOrder({
        kind: "manual",
        fromWarehouseId: sourceId,
        toWarehouseId: facility.productionLineWarehouseId,
        productionOrderId: mo.id,
        notes: `Material request for MO ${mo.orderNo} (${facility.name})`,
        items: validItems.map((it) => ({
          productId: it.productId,
          qtyRequested: it.qtyRequested,
        })),
      });
      onCreated((created as unknown as { transferNo: string }).transferNo);
    } catch (e) {
      setError((e as Error).message ?? "Could not create transfer order.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Material request
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              For MO {mo.orderNo} → {facility.productionLineWarehouseCode ?? "line WH"}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 text-lg leading-none px-2">
            ×
          </button>
        </header>

        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-slate-500">
              Source warehouse
            </span>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              {warehouses.length === 0 && (
                <option value="">No warehouses available</option>
              )}
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No shortage — everything's already in stock or issued.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.productId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {l.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {l.sku}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {l.shortage > 0
                          ? `short ${l.shortage}`
                          : `still need ${l.stillNeeded}`}{" "}
                        {l.uom} · free {l.free}
                      </div>
                    </div>
                    <div className="shrink-0 w-24">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={qtyByProduct[l.productId] ?? ""}
                        onChange={(e) =>
                          setQtyByProduct((p) => ({
                            ...p,
                            [l.productId]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-right text-sm"
                      />
                      <div className="text-[10px] text-slate-400 text-right mt-0.5">
                        {l.uom}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <footer className="px-4 py-3 border-t border-slate-200 flex items-center gap-2 bg-white">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 border border-slate-300"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || lines.length === 0}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold bg-[#003087] text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : `Request ${validItems.length} item${validItems.length === 1 ? "" : "s"}`}
          </button>
        </footer>
      </div>
    </div>
  );
};
