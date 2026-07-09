import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import type { ProductionOrder } from "@/data/types";

interface SplitRow {
  key: string;
  lineId: string;
  machineId: string;
  qty: number;
}

export interface SplitOperationFormProps {
  mo: ProductionOrder;
  bomOperationId: string;
  operationLabel: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  /** When true, omits outer card chrome (for use inside a modal shell). */
  bare?: boolean;
}

export const SplitOperationForm = ({
  mo,
  bomOperationId,
  operationLabel,
  onCancel,
  onSaved,
  bare = false,
}: SplitOperationFormProps) => {
  const facilityId = mo.facilityId ?? "";
  const linesResp = useApi(
    () => api.productionLines({ facilityId: facilityId || undefined, active: true }),
    [facilityId]
  );
  const machinesResp = useApi(
    () =>
      facilityId
        ? api.machines({ facilityId, active: true })
        : Promise.resolve([]),
    [facilityId]
  );
  const lines =
    (linesResp.data as Array<{ id: string; code: string; name: string }> | null) ?? [];
  const allMachines =
    (machinesResp.data as Array<{
      id: string;
      code: string;
      name: string;
      productionLineId: string;
    }> | null) ?? [];

  const [rows, setRows] = useState<SplitRow[]>([
    { key: "a", lineId: "", machineId: "", qty: mo.plannedQty / 2 },
    { key: "b", lineId: "", machineId: "", qty: mo.plannedQty / 2 },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lines.length >= 2 && rows.every((r) => !r.lineId)) {
      setRows((prev) =>
        prev.map((r, i) => ({
          ...r,
          lineId: lines[i]?.id ?? r.lineId,
        }))
      );
    }
  }, [lines, rows]);

  const total = rows.reduce((s, r) => s + r.qty, 0);

  const submit = async () => {
    if (rows.some((r) => !r.lineId)) {
      setError("Pick a line for each split.");
      return;
    }
    if (Math.abs(total - mo.plannedQty) > 0.001) {
      setError(`Splits must sum to MO qty ${num(mo.plannedQty)} (currently ${num(total)}).`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.splitMoOperation(mo.id, {
        bomOperationId,
        splits: rows.map((r) => ({
          lineId: r.lineId,
          machineId: r.machineId || null,
          qty: r.qty,
        })),
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const body = (
    <>
      {error && (
        <div className="px-4 py-2 bg-danger-soft text-danger text-body-sm border border-danger rounded-lg">
          {error}
        </div>
      )}

      <p className="text-caption text-ink-muted">
        Divide {num(mo.plannedQty)} units across parallel production lines for{" "}
        <strong>{operationLabel}</strong>.
      </p>

      {rows.map((row, idx) => (
        <div key={row.key} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-border p-3 bg-canvas/40">
          <div className="col-span-6">
            <label className="text-caption text-ink-muted">Line</label>
            <select
              value={row.lineId}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r, i) =>
                    i === idx ? { ...r, lineId: e.target.value, machineId: "" } : r
                  )
                )
              }
              className="h-9 w-full border border-border rounded-md px-2 text-body-sm"
            >
              <option value="">— Select —</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <label className="text-caption text-ink-muted">Qty</label>
            <Input
              type="number"
              min={0}
              step="any"
              value={row.qty}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r, i) =>
                    i === idx ? { ...r, qty: parseFloat(e.target.value) || 0 } : r
                  )
                )
              }
            />
          </div>
          <div className="col-span-12">
            <label className="text-caption text-ink-muted">Machine (optional)</label>
            <select
              value={row.machineId}
              disabled={!row.lineId}
              onChange={(e) =>
                setRows((prev) =>
                  prev.map((r, i) =>
                    i === idx ? { ...r, machineId: e.target.value } : r
                  )
                )
              }
              className="h-9 w-full border border-border rounded-md px-2 text-body-sm disabled:opacity-60"
            >
              <option value="">— Any machine on line —</option>
              {allMachines
                .filter((m) => m.productionLineId === row.lineId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="col-span-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              disabled={rows.length <= 1}
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
            />
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        icon={<Plus size={14} />}
        onClick={() =>
          setRows((prev) => [
            ...prev,
            {
              key: Math.random().toString(36).slice(2),
              lineId: "",
              machineId: "",
              qty: 0,
            },
          ])
        }
      >
        Add line
      </Button>

      <div className="text-caption text-ink-muted tnum">
        Total: {num(total)} / {num(mo.plannedQty)}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Apply split"}
        </Button>
      </div>
    </>
  );

  if (bare) return <div className="p-5 space-y-3">{body}</div>;

  return (
    <div className="rounded-lg border border-border bg-white p-4 space-y-3">
      <div>
        <div className="text-caption text-ink-muted uppercase font-semibold">Split operation</div>
        <div className="text-body-sm font-medium">
          {operationLabel} · {mo.orderNo}
        </div>
      </div>
      {body}
    </div>
  );
};
