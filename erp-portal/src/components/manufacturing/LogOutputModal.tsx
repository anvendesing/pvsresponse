// Log output modal for a manufacturing order.
//
// Replaces the legacy chained `prompt()` flow. Lets the operator log:
//   * good qty / scrap / rework deltas (added to running totals)
//   * optional per-batch byproduct yields, drawn from the MO's BOM
//     "released components" list. Each byproduct row pre-fills with
//     the expected qty (BOM ratio × good qty) and posts straight to
//     inventory once submitted.
//
// Once any byproduct is logged here, the auto-yield path on
// /complete is skipped so released components are never double-posted.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Wand2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, type MoInventoryTrail } from "@/lib/api";
import type { Bom, BomByproductRow, ProductionOrder } from "@/data/types";
import { num } from "@/lib/format";

interface Props {
  order: Pick<
    ProductionOrder,
    "id" | "orderNo" | "plannedQty" | "actualQty" | "scrapQty" | "reworkQty"
  >;
  bom: Pick<Bom, "outputQty" | "byproducts"> | null;
  // Aggregated byproducts already posted for this MO (from
  // inventory-trail.byproductsReleased). Used to show "already logged"
  // hints next to each row.
  alreadyLogged?: MoInventoryTrail["byproductsReleased"];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

type ByproductRowState = {
  bomByproductId: string;
  qty: number;
  // True once the operator typed in this row; we stop auto-filling
  // from the BOM ratio so user-entered numbers stick.
  touched: boolean;
};

const expectedFor = (bp: BomByproductRow, goodQty: number, batchSize: number): number => {
  if (!batchSize || batchSize <= 0) return 0;
  const raw = (bp.qty / batchSize) * goodQty;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 1000) / 1000;
};

export const LogOutputModal = ({ order, bom, alreadyLogged, onClose, onSaved }: Props) => {
  const remaining = Math.max(0, order.plannedQty - order.actualQty);
  // Default a sensible batch size — remaining first, else a quarter
  // of planned (rounded up), else 1.
  const seedGood = remaining > 0 ? remaining : Math.max(1, Math.round(order.plannedQty / 4));

  const [goodQty, setGoodQty] = useState(seedGood);
  const [scrapQty, setScrapQty] = useState(0);
  const [reworkQty, setReworkQty] = useState(0);
  const [byproducts, setByproducts] = useState<ByproductRowState[]>(() =>
    (bom?.byproducts ?? []).map((bp) => ({
      bomByproductId: bp.id ?? "",
      qty: expectedFor(bp, seedGood, bom?.outputQty ?? 1),
      touched: false,
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseed byproducts when the BOM changes (e.g. modal stays mounted
  // across MO selections — defensive).
  useEffect(() => {
    setByproducts(
      (bom?.byproducts ?? []).map((bp) => ({
        bomByproductId: bp.id ?? "",
        qty: expectedFor(bp, goodQty, bom?.outputQty ?? 1),
        touched: false,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bom?.byproducts?.length, bom?.outputQty]);

  // When goodQty changes, refresh untouched byproduct rows from the
  // BOM ratio. Touched rows are left alone so manual entries persist.
  useEffect(() => {
    if (!bom) return;
    setByproducts((prev) =>
      prev.map((row, i) => {
        const bp = bom.byproducts?.[i];
        if (!bp || row.touched) return row;
        return {
          ...row,
          qty: expectedFor(bp, goodQty, bom.outputQty),
        };
      })
    );
  }, [goodQty, bom]);

  const loggedByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of alreadyLogged ?? []) {
      m.set(r.productId, (m.get(r.productId) ?? 0) + r.qty);
    }
    return m;
  }, [alreadyLogged]);

  const newCompletion =
    order.plannedQty > 0
      ? Math.round(((order.actualQty + goodQty) / order.plannedQty) * 1000) / 10
      : 0;

  const updateBp = (idx: number, qty: number) => {
    setByproducts((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, qty, touched: true } : row))
    );
  };

  const useRatioFor = (idx: number) => {
    if (!bom) return;
    const bp = bom.byproducts?.[idx];
    if (!bp) return;
    setByproducts((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              qty: expectedFor(bp, goodQty, bom.outputQty),
              touched: false,
            }
          : row
      )
    );
  };

  const submit = async () => {
    if (!Number.isFinite(goodQty) || goodQty < 0) {
      setError("Good qty must be a non-negative number.");
      return;
    }
    if (goodQty === 0 && scrapQty === 0 && reworkQty === 0 &&
      byproducts.every((r) => r.qty === 0)) {
      setError("Nothing to log. Enter at least one quantity.");
      return;
    }
    const bpPayload = byproducts
      .filter((r) => r.bomByproductId && r.qty > 0)
      .map((r) => ({ bomByproductId: r.bomByproductId, qty: r.qty }));

    setBusy(true);
    setError(null);
    try {
      const res = await api.logOutput(order.id, {
        goodQty,
        scrapQty,
        reworkQty,
        byproducts: bpPayload,
      });
      const bpCount = res.byproductPostings?.length ?? 0;
      const summary = [
        `${num(goodQty)} good`,
        scrapQty > 0 ? `${num(scrapQty)} scrap` : null,
        reworkQty > 0 ? `${num(reworkQty)} rework` : null,
        bpCount > 0 ? `${bpCount} byproduct${bpCount === 1 ? "" : "s"} posted` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      onSaved(`Logged on ${order.orderNo}: ${summary}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const bomBps = bom?.byproducts ?? [];
  const hasBps = bomBps.length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[680px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Plus size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Log production output
              </div>
              <div className="text-body-sm">
                <span className="font-mono">{order.orderNo}</span> · adds to
                running totals
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

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Good qty (this batch)
              </div>
              <Input
                type="number"
                min={0}
                step="any"
                value={goodQty}
                onChange={(e) => setGoodQty(Number(e.target.value))}
                autoFocus
              />
              <div className="text-caption text-ink-muted mt-1 tnum">
                running {num(order.actualQty)} / {num(order.plannedQty)}
                {remaining > 0 ? ` · ${num(remaining)} to go` : null}
              </div>
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Scrap
              </div>
              <Input
                type="number"
                min={0}
                step="any"
                value={scrapQty}
                onChange={(e) => setScrapQty(Number(e.target.value))}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">
                running {num(order.scrapQty)}
              </div>
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Rework
              </div>
              <Input
                type="number"
                min={0}
                step="any"
                value={reworkQty}
                onChange={(e) => setReworkQty(Number(e.target.value))}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">
                running {num(order.reworkQty)}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-canvas px-3 py-2 flex items-center justify-between text-body-sm">
            <span className="text-ink-muted">After this entry</span>
            <span className="tnum font-semibold">
              {newCompletion}% · {num(order.actualQty + goodQty)} / {num(order.plannedQty)}
            </span>
          </div>

          {/* Byproducts */}
          {hasBps ? (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="px-3 py-2 bg-canvas border-b border-border flex items-center justify-between">
                <div className="text-caption text-ink-muted uppercase font-semibold">
                  Byproducts (released components)
                </div>
                <Chip size="sm" tone="info">
                  Posted to inventory on save
                </Chip>
              </div>
              <div className="grid grid-cols-12 grid-header-cell text-caption">
                <div className="col-span-4">Component</div>
                <div className="col-span-2 text-right">Per batch</div>
                <div className="col-span-2 text-right">Expected</div>
                <div className="col-span-3">Actual qty</div>
                <div className="col-span-1"></div>
              </div>
              {bomBps.map((bp, i) => {
                const expected = expectedFor(bp, goodQty, bom?.outputQty ?? 1);
                const row = byproducts[i];
                const logged = bp.productId ? loggedByProductId.get(bp.productId) ?? 0 : 0;
                return (
                  <div
                    key={bp.id ?? bp.sku}
                    className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm border-t border-border"
                  >
                    <div className="col-span-4">
                      <div className="font-mono text-caption text-ink-muted">{bp.sku}</div>
                      <div className="truncate">{bp.name}</div>
                    </div>
                    <div className="col-span-2 text-right tnum text-ink-muted">
                      {num(bp.qty, 3)} {bp.uom}
                    </div>
                    <div className="col-span-2 text-right tnum">
                      {num(expected, 3)} {bp.uom}
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        size="sm"
                        value={row?.qty ?? 0}
                        onChange={(e) => updateBp(i, Number(e.target.value))}
                      />
                      {logged > 0 ? (
                        <div className="text-caption text-ink-muted mt-1 tnum">
                          already logged {num(logged)} {bp.uom}
                        </div>
                      ) : null}
                    </div>
                    <div className="col-span-1 flex items-center justify-end pr-2">
                      <button
                        type="button"
                        onClick={() => useRatioFor(i)}
                        className="h-7 w-7 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
                        title="Set to BOM-expected qty"
                      >
                        <Wand2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-caption text-ink-muted">
              No byproducts on this BOM. Add released components in the BOM
              editor to log them here.
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<CheckCircle2 size={14} />}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Saving…" : "Log output"}
          </Button>
        </div>
      </div>
    </div>
  );
};
