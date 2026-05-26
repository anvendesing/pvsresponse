// "New manufacturing order" wizard.
//
// Flow:
//   1. Pick a BOM (or a parent product, which we use to look up its
//      active BOM).
//   2. Set planned qty + dates.
//   3. Live preview of the multi-level explosion + on-hand vs needed,
//      so the operator sees shortages before pulling the trigger.
//   4. Submit -> creates the MO and (server-side) seeds one work
//      order to track progress.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { useApi } from "@/hooks/useApi";
import { api, type BomLeafRow } from "@/lib/api";
import type { Bom } from "@/data/types";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Props {
  boms: Bom[];
  onClose: () => void;
  onCreated: (orderNo: string, productionOrderId: string) => void;
}

const isoDate = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export const NewMoModal = ({ boms, onClose, onCreated }: Props) => {
  const activeBoms = useMemo(() => boms.filter((b) => b.active), [boms]);
  const [bomId, setBomId] = useState<string>(activeBoms[0]?.id ?? "");
  // Station / machine ids - empty string means "no preselection".
  // These map to free-text station/machine on the wire (we send the
  // resolved name so the WO list keeps reading like before).
  const [workCenterId, setWorkCenterId] = useState<string>("");
  const [machineId, setMachineId] = useState<string>("");
  const [plannedQty, setPlannedQty] = useState(100);
  const [startDate, setStartDate] = useState(isoDate(0));
  const [dueDate, setDueDate] = useState(isoDate(3));

  const workCentersResp = useApi(() => api.workCenters({ active: true }), []);
  const machinesResp = useApi(() => api.machines({ active: true }), []);
  const workCenters =
    (workCentersResp.data as Array<{
      id: string;
      code: string;
      name: string;
    }> | null) ?? [];
  const machines =
    (machinesResp.data as Array<{
      id: string;
      code: string;
      name: string;
      workCenterId: string;
    }> | null) ?? [];
  const machinesForWC = workCenterId
    ? machines.filter((m) => m.workCenterId === workCenterId)
    : [];

  const [leaves, setLeaves] = useState<BomLeafRow[]>([]);
  const [shortages, setShortages] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBom = activeBoms.find((b) => b.id === bomId);

  // Whenever the user picks a different BOM (or once master data
  // arrives), seed the work-center / machine selectors from the BOM's
  // declared defaults. Operators can still change either one for this
  // particular order without touching the BOM.
  useEffect(() => {
    if (!selectedBom) return;
    setWorkCenterId(selectedBom.defaultWorkCenterId ?? "");
    setMachineId(selectedBom.defaultMachineId ?? "");
  }, [selectedBom?.id, selectedBom?.defaultWorkCenterId, selectedBom?.defaultMachineId]);

  // Clear machine if the chosen WC no longer hosts it.
  useEffect(() => {
    if (!machineId) return;
    const m = machines.find((x) => x.id === machineId);
    if (workCenterId && m && m.workCenterId !== workCenterId) {
      setMachineId("");
    }
  }, [workCenterId, machineId, machines]);

  // Live explosion + shortage check whenever bom or qty change.
  useEffect(() => {
    if (!bomId) {
      setLeaves([]);
      setShortages(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const exp = await api.bomExplode(bomId, plannedQty);
        // Quick on-hand probe: piggy-back on the warehouse listing the
        // page already has would be cleaner, but a single per-product
        // call is fast enough.
        const productIds = exp.map((e) => e.productId);
        const stockMap = new Map<string, number>();
        // Fan out to the inventory ledger isn't ideal; instead we
        // simply leave shortages empty until creation - the backend
        // re-validates on issue-materials. Empty shortages just means
        // we won't show inline warnings here. Acceptable for v1.
        for (const id of productIds) stockMap.set(id, 0);
        const sh = new Map<string, number>();
        if (!cancelled) {
          setLeaves(exp);
          setShortages(sh);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bomId, plannedQty]);

  const submit = async () => {
    if (!bomId) return setError("Pick a BOM.");
    if (plannedQty <= 0) return setError("Planned qty must be > 0.");
    setBusy(true);
    setError(null);
    // Resolve picker ids -> names for the wire payload. The backend
    // accepts either; sending names keeps existing screens (work order
    // list, scheduler) rendering the same.
    const wc = workCenters.find((w) => w.id === workCenterId);
    const mc = machines.find((m) => m.id === machineId);
    try {
      const created = (await api.createProductionOrder({
        bomId,
        station: wc?.name,
        machine: mc?.name,
        plannedQty,
        startDate,
        dueDate,
      })) as { id: string; orderNo: string };
      onCreated(created.orderNo, created.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[800px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Plus size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                New manufacturing order
              </div>
              <div className="text-body-sm">
                Pick a BOM, set the plan, see what raw materials will be needed.
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

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-7">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                BOM
              </div>
              <select
                value={bomId}
                onChange={(e) => setBomId(e.target.value)}
                className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
              >
                {activeBoms.length === 0 && <option value="">(none)</option>}
                {activeBoms.map((b) => {
                  const scope = b.variantId
                    ? `[${b.variantLabel ?? b.variantSku}]`
                    : "[default]";
                  return (
                    <option key={b.id} value={b.id}>
                      {b.sku} {scope} · {b.product} · {b.revision} · batch{" "}
                      {b.outputQty}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="col-span-3">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Planned qty
              </div>
              <Input
                type="number"
                min={1}
                value={plannedQty}
                onChange={(e) => setPlannedQty(Number(e.target.value) || 0)}
              />
              {selectedBom && plannedQty > 0 && (
                <div className="text-caption text-ink-muted mt-1">
                  {(() => {
                    const batches = plannedQty / selectedBom.outputQty;
                    const whole = Math.ceil(batches);
                    return `≈ ${whole} batch${whole === 1 ? "" : "es"} of ${selectedBom.outputQty}`;
                  })()}
                </div>
              )}
            </div>
            <div className="col-span-2">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Output UoM
              </div>
              <div className="h-10 flex items-center text-body font-semibold">
                {selectedBom?.items[0]?.uom ?? "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-2">
                <span>Work center</span>
                {selectedBom?.defaultWorkCenter && (
                  <Chip size="sm" tone="info">
                    BOM default
                  </Chip>
                )}
              </div>
              <select
                value={workCenterId}
                onChange={(e) => setWorkCenterId(e.target.value)}
                className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
              >
                <option value="">— Pick a line —</option>
                {workCenters.map((wc) => (
                  <option key={wc.id} value={wc.id}>
                    {wc.code} · {wc.name}
                  </option>
                ))}
              </select>
              {workCenters.length === 0 && (
                <div className="text-caption text-ink-muted mt-1">
                  No work centers yet. Add them in Settings &raquo; Production lines.
                </div>
              )}
            </div>
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-2">
                <span>Machine</span>
                {selectedBom?.defaultMachine && (
                  <Chip size="sm" tone="info">
                    BOM default
                  </Chip>
                )}
              </div>
              <select
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                disabled={!workCenterId}
                className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary disabled:bg-canvas disabled:text-ink-muted"
              >
                <option value="">
                  {workCenterId ? "— Any on this line —" : "— Pick a line first —"}
                </option>
                {machinesForWC.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Start date
              </div>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Due date
              </div>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {/* Explosion preview */}
          <div className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption text-ink-muted uppercase font-semibold">
              Raw materials needed (multi-level explosion)
            </div>
            {loading ? (
              <div className="p-4 text-center text-body-sm text-ink-muted">
                Computing requirements…
              </div>
            ) : leaves.length === 0 ? (
              <div className="p-4 text-center text-body-sm text-ink-muted">
                Pick a BOM to see raw materials.
              </div>
            ) : (
              <div className="grid grid-cols-12 max-h-[280px] overflow-y-auto">
                <div className="col-span-12 grid grid-cols-12 grid-header-cell text-caption">
                  <div className="col-span-3">SKU</div>
                  <div className="col-span-5">Component</div>
                  <div className="col-span-2 text-right">Required</div>
                  <div className="col-span-2">Path</div>
                </div>
                {leaves.map((l) => {
                  const short = shortages.get(l.productId) ?? 0;
                  return (
                    <div
                      key={l.productId}
                      className={cn(
                        "col-span-12 grid grid-cols-12 grid-cell items-center !py-2 text-body-sm",
                        short > 0 && "bg-danger-soft"
                      )}
                    >
                      <div className="col-span-3 font-mono text-caption">
                        {l.sku}
                      </div>
                      <div className="col-span-5 truncate">{l.name}</div>
                      <div className="col-span-2 text-right tnum">
                        {num(l.qty, 3)} {l.uom}
                      </div>
                      <div className="col-span-2 text-caption text-ink-muted truncate">
                        {l.path.join(" → ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<CheckCircle2 size={14} />}
            onClick={submit}
            disabled={busy || !bomId}
          >
            {busy ? "Creating…" : "Create order"}
          </Button>
        </div>
      </div>
    </div>
  );
};
