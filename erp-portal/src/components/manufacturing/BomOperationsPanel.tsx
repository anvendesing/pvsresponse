import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import type { BomOperation } from "@/data/types";
import { cn } from "@/lib/cn";

export type EditableOperation = BomOperation & { tempKey: string };

export const freshOperation = (seq: number): EditableOperation => ({
  tempKey: Math.random().toString(36).slice(2),
  seq,
  name: seq === 1 ? "Manufacture" : `Step ${seq}`,
  description: null,
  facilityId: null,
  lineId: null,
  machineId: null,
  durationMinutes: null,
  requiresQa: true,
  blockedBySeq: seq > 1 ? seq - 1 : null,
  eligibleLineIds: [],
});

interface Props {
  operations: EditableOperation[];
  operationDependencies: boolean;
  lineOptions: Array<{ id: string; code: string; name: string; facilityId?: string }>;
  machineOptions?: Array<{ id: string; code: string; name: string; productionLineId: string }>;
  onChange: (ops: EditableOperation[]) => void;
  onDependenciesChange: (v: boolean) => void;
}

export const BomOperationsPanel = ({
  operations,
  operationDependencies,
  lineOptions,
  machineOptions,
  onChange,
  onDependenciesChange,
}: Props) => {
  const sorted = [...operations].sort((a, b) => a.seq - b.seq);

  const resequence = (ops: EditableOperation[]) =>
    ops.map((o, i) => ({ ...o, seq: i + 1 }));

  const update = (key: string, patch: Partial<EditableOperation>) => {
    onChange(operations.map((o) => (o.tempKey === key ? { ...o, ...patch } : o)));
  };

  const move = (key: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((o) => o.tempKey === key);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= sorted.length) return;
    const copy = [...sorted];
    [copy[idx], copy[next]] = [copy[next]!, copy[idx]!];
    onChange(resequence(copy));
  };

  const remove = (key: string) => {
    if (operations.length <= 1) return;
    onChange(resequence(operations.filter((o) => o.tempKey !== key)));
  };

  const add = () => {
    const nextSeq = operations.length + 1;
    onChange([
      ...operations,
      freshOperation(nextSeq),
    ]);
  };

  const toggleEligibleLine = (key: string, lineId: string) => {
    const op = operations.find((o) => o.tempKey === key);
    if (!op) return;
    const set = new Set(op.eligibleLineIds ?? []);
    if (set.has(lineId)) set.delete(lineId);
    else set.add(lineId);
    update(key, { eligibleLineIds: [...set] });
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-body-sm cursor-pointer">
          <input
            type="checkbox"
            checked={operationDependencies}
            onChange={(e) => onDependenciesChange(e.target.checked)}
          />
          Operation dependencies (blocked-by, Odoo-style)
        </label>
        <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={add}>
          Add step
        </Button>
      </div>
      <div className="divide-y divide-border overflow-y-auto flex-1 min-h-0">
        {sorted.map((op) => (
          <div key={op.tempKey} className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-caption font-bold text-primary w-8">
                {op.seq}
              </span>
              <Input
                size="sm"
                value={op.name}
                onChange={(e) => update(op.tempKey, { name: e.target.value })}
                className="flex-1"
                placeholder="Operation name (Extract, Filter…)"
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowUp size={14} />}
                onClick={() => move(op.tempKey, -1)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowDown size={14} />}
                onClick={() => move(op.tempKey, 1)}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                disabled={operations.length <= 1}
                onClick={() => remove(op.tempKey)}
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pl-10">
              <div>
                <label className="text-caption text-ink-muted">Default line</label>
                <select
                  value={op.lineId ?? ""}
                  onChange={(e) => {
                    const nextLineId = e.target.value || null;
                    // If the previously-chosen default machine no longer
                    // belongs to the new line, clear it so the operator
                    // can pick a fresh one for this step.
                    const m = (machineOptions ?? []).find((x) => x.id === op.machineId);
                    const clearMachine =
                      op.machineId && (!nextLineId || (m && m.productionLineId !== nextLineId));
                    update(op.tempKey, {
                      lineId: nextLineId,
                      ...(clearMachine ? { machineId: null } : {}),
                    });
                  }}
                  className="h-8 w-full border border-border rounded text-body-sm px-2"
                >
                  <option value="">— Any —</option>
                  {lineOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-caption text-ink-muted">Default machine</label>
                <select
                  value={op.machineId ?? ""}
                  onChange={(e) =>
                    update(op.tempKey, { machineId: e.target.value || null })
                  }
                  className="h-8 w-full border border-border rounded text-body-sm px-2"
                  title={
                    op.lineId
                      ? "Default machine for this step. Operators can still log against multiple machines at MO time."
                      : "Pick a line first to see its machines."
                  }
                >
                  <option value="">
                    {op.lineId ? "— Any on line —" : "— Pick a line first —"}
                  </option>
                  {(machineOptions ?? [])
                    .filter((m) => !op.lineId || m.productionLineId === op.lineId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} · {m.name}
                      </option>
                    ))}
                </select>
              </div>
              {operationDependencies && (
                <div>
                  <label className="text-caption text-ink-muted">Blocked by step</label>
                  <select
                    value={op.blockedBySeq ?? ""}
                    onChange={(e) =>
                      update(op.tempKey, {
                        blockedBySeq: e.target.value
                          ? parseInt(e.target.value, 10)
                          : null,
                      })
                    }
                    className="h-8 w-full border border-border rounded text-body-sm px-2"
                  >
                    <option value="">— None —</option>
                    {sorted
                      .filter((x) => x.seq < op.seq)
                      .map((x) => (
                        <option key={x.tempKey} value={x.seq}>
                          {x.seq}. {x.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-caption text-ink-muted">Duration (min)</label>
                <Input
                  size="sm"
                  type="number"
                  min={0}
                  value={op.durationMinutes ?? ""}
                  onChange={(e) =>
                    update(op.tempKey, {
                      durationMinutes: e.target.value
                        ? parseFloat(e.target.value)
                        : null,
                    })
                  }
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-caption">
                  <input
                    type="checkbox"
                    checked={op.requiresQa}
                    onChange={(e) =>
                      update(op.tempKey, { requiresQa: e.target.checked })
                    }
                  />
                  Requires QA
                </label>
              </div>
            </div>
            {lineOptions.length > 0 && (
              <div className="pl-10">
                <div className="text-caption text-ink-muted mb-1">
                  Eligible lines (parallel runs)
                </div>
                <div className="flex flex-wrap gap-1">
                  {lineOptions.map((l) => {
                    const on = (op.eligibleLineIds ?? []).includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleEligibleLine(op.tempKey, l.id)}
                        className={cn(
                          "px-2 py-0.5 rounded text-caption font-mono border",
                          on
                            ? "bg-primary text-white border-primary"
                            : "border-border text-ink-muted hover:border-primary"
                        )}
                      >
                        {l.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
