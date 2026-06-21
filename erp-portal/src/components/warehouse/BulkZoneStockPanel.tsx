import { useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, Save } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import type { Bin } from "@/data/types";
import { api, type WarehouseRow } from "@/lib/api";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";

interface BulkZoneStockPanelProps {
  warehouses: WarehouseRow[];
  bins: Bin[];
  onClose: () => void;
  onSaved: () => void;
}

type RowEdit = { barcode: string; qty: string };

type BulkResult = {
  applied: number;
  skipped: number;
  errors: number;
  results: Array<
    | { binId: string; status: "skipped"; reason: string }
    | { binId: string; status: "applied"; action: string; location: string }
    | { binId: string; status: "error"; message: string }
  >;
};

const selectCls =
  "h-9 rounded-md border border-border bg-white px-3 text-body-sm text-ink min-w-[160px]";

export const BulkZoneStockPanel = ({
  warehouses,
  bins,
  onClose,
  onSaved,
}: BulkZoneStockPanelProps) => {
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active).sort((a, b) => a.code.localeCompare(b.code)),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState(activeWarehouses[0]?.id ?? "");
  const warehouse = activeWarehouses.find((w) => w.id === warehouseId);

  const zones = useMemo(() => {
    if (!warehouse) return [];
    const set = new Set<string>();
    for (const b of bins) {
      if (b.warehouse === warehouse.code) set.add(b.zone);
    }
    return [...set].sort();
  }, [bins, warehouse]);

  const [zone, setZone] = useState("");
  const effectiveZone = zone || zones[0] || "";

  const zoneBins = useMemo(() => {
    if (!warehouse || !effectiveZone) return [];
    return bins
      .filter((b) => b.warehouse === warehouse.code && b.zone === effectiveZone)
      .sort((a, b) =>
        `${a.shelf}/${a.bin}`.localeCompare(`${b.shelf}/${b.bin}`, undefined, {
          numeric: true,
        })
      );
  }, [bins, warehouse, effectiveZone]);

  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const pendingCount = useMemo(() => {
    let n = 0;
    for (const b of zoneBins) {
      const row = edits[b.id];
      if (!row) continue;
      const hasBarcode = row.barcode.trim().length > 0;
      const hasQty = row.qty.trim().length > 0;
      if (hasBarcode || hasQty) n += 1;
    }
    return n;
  }, [zoneBins, edits]);

  const setRow = (binId: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [binId]: { barcode: prev[binId]?.barcode ?? "", qty: prev[binId]?.qty ?? "", ...patch },
    }));
    setResult(null);
  };

  const clearZoneEdits = () => {
    setEdits({});
    setResult(null);
    setError(null);
  };

  const onSave = async () => {
    if (!warehouse || !effectiveZone) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const items: { binId: string; barcode?: string; qty?: number }[] = [];
      for (const b of zoneBins) {
        const row = edits[b.id];
        if (!row) continue;
        const barcode = row.barcode.trim();
        const qtyRaw = row.qty.trim();
        const hasBarcode = barcode.length > 0;
        const hasQty = qtyRaw.length > 0;
        if (!hasBarcode && !hasQty) continue;

        const item: { binId: string; barcode?: string; qty?: number } = { binId: b.id };
        if (hasBarcode) item.barcode = barcode;
        if (hasQty) {
          const qty = Number(qtyRaw);
          if (Number.isNaN(qty) || qty < 0) {
            throw new Error(`Invalid qty for ${b.shelf}/${b.bin}`);
          }
          item.qty = qty;
        }
        items.push(item);
      }

      if (items.length === 0) {
        setError("Enter a barcode and/or qty on at least one bin to save.");
        return;
      }

      const res = (await api.bulkZoneStock(warehouse.id, effectiveZone, {
        reasonCode: "physical_match",
        items,
      })) as BulkResult;

      setResult(res);
      if (res.applied > 0) {
        onSaved();
        // Clear rows that applied successfully
        setEdits((prev) => {
          const next = { ...prev };
          for (const r of res.results) {
            if (r.status === "applied") delete next[r.binId];
          }
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Toolbar
        left={
          <>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onClose}>
              Back
            </Button>
            <h2 className="text-h3 font-bold">Bulk zone stock update</h2>
          </>
        }
        right={
          <>
            <Button variant="outline" size="sm" onClick={clearZoneEdits} disabled={busy}>
              Clear inputs
            </Button>
            <Button
              size="sm"
              icon={<Save size={14} />}
              onClick={onSave}
              disabled={busy || pendingCount === 0}
            >
              {busy ? "Saving…" : `Save ${pendingCount > 0 ? `(${pendingCount})` : ""}`}
            </Button>
          </>
        }
      />

      <div className="px-4 py-3 border-b bg-canvas flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">Warehouse</span>
          <select
            className={selectCls}
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setZone("");
              clearZoneEdits();
            }}
          >
            {activeWarehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">Zone</span>
          <select
            className={selectCls}
            value={effectiveZone}
            onChange={(e) => {
              setZone(e.target.value);
              clearZoneEdits();
            }}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                Zone {z}
              </option>
            ))}
          </select>
        </label>
        <p className="text-body-sm text-ink-muted pb-1 flex items-center gap-2">
          <ClipboardList size={14} />
          {zoneBins.length} bins · leave a cell blank to skip that bin
        </p>
      </div>

      {(error || result) && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm",
            error ? "bg-danger-soft text-danger border-danger" : "bg-success-soft text-success border-success"
          )}
        >
          {error ??
            `Updated ${result!.applied} bin(s), skipped ${result!.skipped}, ${result!.errors} error(s).`}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <Card className="overflow-hidden">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas border-b border-border sticky top-0 z-10">
              <tr className="text-left text-caption text-ink-muted uppercase tracking-wide">
                <th className="px-3 py-2 font-semibold w-[140px]">Location</th>
                <th className="px-3 py-2 font-semibold">Current product</th>
                <th className="px-3 py-2 font-semibold w-[80px] text-right">Qty</th>
                <th className="px-3 py-2 font-semibold w-[180px]">Barcode / SKU</th>
                <th className="px-3 py-2 font-semibold w-[100px]">New qty</th>
              </tr>
            </thead>
            <tbody>
              {zoneBins.map((b) => {
                const row = edits[b.id] ?? { barcode: "", qty: "" };
                const loc = `${b.shelf}/${b.bin}`;
                const sku = b.variantSku ?? b.productSku;
                const rowResult = result?.results.find((r) => r.binId === b.id);
                return (
                  <tr
                    key={b.id}
                    className={cn(
                      "border-b border-border/60 hover:bg-canvas/50",
                      rowResult?.status === "error" && "bg-danger-soft/30",
                      rowResult?.status === "applied" && "bg-success-soft/20"
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-caption">{loc}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{b.productName ?? "—"}</div>
                      {sku && <div className="font-mono text-caption text-ink-muted">{sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tnum">{num(b.qty ?? 0)}</td>
                    <td className="px-3 py-2">
                      <Input
                        size="sm"
                        placeholder="Scan or type"
                        value={row.barcode}
                        onChange={(e) => setRow(b.id, { barcode: e.target.value })}
                        aria-label={`Barcode ${loc}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step={1}
                        placeholder="—"
                        value={row.qty}
                        onChange={(e) => setRow(b.id, { qty: e.target.value })}
                        aria-label={`Qty ${loc}`}
                      />
                    </td>
                  </tr>
                );
              })}
              {zoneBins.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-ink-muted">
                    No bins in this zone.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {result && result.errors > 0 && (
          <Card className="mt-4 p-4">
            <h3 className="text-body font-semibold text-danger mb-2">Errors</h3>
            <ul className="text-body-sm space-y-1">
              {result.results
                .filter((r) => r.status === "error")
                .map((r) => {
                  const b = zoneBins.find((x) => x.id === r.binId);
                  const loc = b ? `${b.shelf}/${b.bin}` : r.binId;
                  return (
                    <li key={r.binId}>
                      <span className="font-mono">{loc}</span>: {r.message}
                    </li>
                  );
                })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
};
