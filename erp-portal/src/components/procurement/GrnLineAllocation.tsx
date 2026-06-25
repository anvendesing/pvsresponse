/**
 * Per-line bin allocation editor for GRN receive (portal).
 */

import { useMemo } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api, type GrnReceiveHint } from "@/lib/api";
import { num } from "@/lib/format";

export type GrnAllocationDraft = { binId: string; qty: number; binLabel?: string };

interface Props {
  productId: string;
  sku: string;
  uom: string;
  acceptedQty: number;
  hint: GrnReceiveHint | undefined;
  allocations: GrnAllocationDraft[];
  onChange: (next: GrnAllocationDraft[]) => void;
}

export const GrnLineAllocation = ({
  productId,
  sku,
  uom,
  acceptedQty,
  hint,
  allocations,
  onChange,
}: Props) => {
  const allocated = useMemo(
    () => allocations.reduce((s, a) => s + a.qty, 0),
    [allocations]
  );
  const remaining = acceptedQty - allocated;

  if (acceptedQty <= 0) return null;

  const setRow = (idx: number, patch: Partial<GrnAllocationDraft>) =>
    onChange(allocations.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

  const addSplit = () => {
    const half = Math.max(0, remaining / 2);
    const firstQty = allocations.length === 1 ? Math.floor(acceptedQty / 2) : half;
    if (allocations.length === 1) {
      const first = allocations[0]!;
      onChange([
        { ...first, qty: firstQty },
        {
          binId: hint?.bins.find((b) => b.id !== first.binId)?.id ?? first.binId,
          qty: acceptedQty - firstQty,
          binLabel: undefined,
        },
      ]);
      return;
    }
    onChange([
      ...allocations,
      {
        binId: hint?.defaultBinId ?? "",
        qty: remaining > 0 ? remaining : 0,
      },
    ]);
  };

  const lookupBin = async (idx: number, code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const res = (await api.resolveLocation(trimmed)) as {
        kind: string;
        bin?: { id: string; code?: string };
      };
      if (res.kind === "bin" && res.bin?.id) {
        const opt = hint?.bins.find((b) => b.id === res.bin!.id);
        setRow(idx, {
          binId: res.bin.id,
          binLabel: opt?.label ?? trimmed,
        });
      }
    } catch {
      /* operator can still pick from dropdown */
    }
  };

  return (
    <div className="col-span-12 px-3 pb-3 pt-1 border-t border-dashed border-border bg-canvas/60">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-caption text-ink-muted uppercase font-semibold">
          <MapPin size={12} />
          Storage · {sku}
        </div>
        {hint && (
          <span className="text-caption text-ink-muted">
            Default: {hint.warehouseName}
            {hint.defaultBinLabel ? ` · ${hint.defaultBinLabel}` : ""}
          </span>
        )}
      </div>

      {!hint && (
        <div className="text-caption text-warning mb-2">
          No putaway rule — pick a bin manually or add one in Settings → Putaway rules.
        </div>
      )}

      <div className="space-y-2">
        {allocations.map((row, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-7">
              <select
                value={row.binId}
                onChange={(e) => {
                  const opt = hint?.bins.find((b) => b.id === e.target.value);
                  setRow(idx, {
                    binId: e.target.value,
                    binLabel: opt?.label,
                  });
                }}
                className="h-9 w-full bg-white border border-border rounded-md px-2 text-caption outline-none focus:border-primary"
              >
                <option value="">Select bin…</option>
                {hint?.bins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                    {b.code ? ` · ${b.code}` : ""}
                    {b.qty > 0 ? ` (${b.qty})` : " · empty"}
                  </option>
                ))}
              </select>
              <Input
                size="sm"
                placeholder="Or scan / type bin code"
                className="mt-1 font-mono text-caption"
                onBlur={(e) => void lookupBin(idx, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookupBin(idx, (e.target as HTMLInputElement).value);
                  }
                }}
              />
            </div>
            <div className="col-span-3">
              <Input
                type="number"
                min={0}
                step={0.001}
                value={row.qty}
                onChange={(e) =>
                  setRow(idx, { qty: Number(e.target.value) || 0 })
                }
                className="text-right"
              />
              <div className="text-[10px] text-ink-muted text-right">{uom}</div>
            </div>
            <div className="col-span-2 flex justify-end">
              {allocations.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(allocations.filter((_, i) => i !== idx))}
                  className="h-8 w-8 grid place-items-center rounded-md text-danger hover:bg-danger-soft"
                  aria-label="Remove bin row"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={14} />}
          onClick={addSplit}
          disabled={!hint?.defaultBinId && (hint?.bins.length ?? 0) < 2}
        >
          Split across bins
        </Button>
        <span
          className={
            Math.abs(remaining) < 0.001
              ? "text-caption text-success font-semibold"
              : "text-caption text-danger font-semibold"
          }
        >
          {Math.abs(remaining) < 0.001
            ? `${num(acceptedQty, 3)} ${uom} allocated`
            : `${num(remaining, 3)} ${uom} still unallocated`}
        </span>
      </div>
    </div>
  );
};
