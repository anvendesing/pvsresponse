// GRN receive modal.
//
// Opens against an approved or partial PO and lets the operator
// record what came in: qty per line + optional rejects + truck info
// + QC outcome. The backend posts the accepted qty to inventory
// (bins + ledger) on submit, and rolls up PO.received / status.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  PackageCheck,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import {
  GrnLineAllocation,
  type GrnAllocationDraft,
} from "@/components/procurement/GrnLineAllocation";
import type { GrnReceiveHint } from "@/lib/api";

interface PoDetail {
  id: string;
  poNo: string;
  status: string;
  vendor: { id: string; code: string; name: string; city: string };
  expectedDate: string;
  amount: number;
  receivedPct: number;
  items: Array<{
    id: string;
    productId: string;
    qty: number;
    rate: number;
    received: number;
    product: { id: string; sku: string; name: string; uom: string; type?: string; batchTracked?: boolean };
  }>;
}

interface ReceiveLineDraft {
  poItemId: string;
  receivedQty: number;
  rejectedQty: number;
  remarks: string;
  batchNo: string;
  expiryDate: string;
}

interface Props {
  po: PoDetail;
  onClose: () => void;
  onReceived: (message: string) => void;
}

export const GrnReceiveModal = ({ po, onClose, onReceived }: Props) => {
  const [qcStatus, setQcStatus] = useState<
    "pending" | "pass" | "rework" | "reject"
  >("pending");
  const [truckNo, setTruckNo] = useState("");
  const [driver, setDriver] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default each line to its outstanding qty so the common "receive
  // everything" case is one click.
  const [lines, setLines] = useState<ReceiveLineDraft[]>(
    po.items.map((i) => ({
      poItemId: i.id,
      receivedQty: Math.max(0, i.qty - i.received),
      rejectedQty: 0,
      remarks: "",
      batchNo: "",
      expiryDate: "",
    }))
  );
  const [hints, setHints] = useState<Record<string, GrnReceiveHint>>({});
  const [allocations, setAllocations] = useState<
    Record<string, GrnAllocationDraft[]>
  >({});

  useEffect(() => {
    const productIds = po.items.map((i) => i.productId);
    void api.grnReceiveHints(productIds).then((r) => setHints(r.hints));
  }, [po.id, po.items]);

  useEffect(() => {
    setAllocations((prev) => {
      const next = { ...prev };
      for (const poi of po.items) {
        const line = lines.find((l) => l.poItemId === poi.id);
        const accepted = line
          ? Math.max(0, line.receivedQty - line.rejectedQty)
          : 0;
        if (accepted <= 0) {
          delete next[poi.id];
          continue;
        }
        const hint = hints[poi.productId];
        if (!next[poi.id]?.length && hint?.defaultBinId) {
          next[poi.id] = [
            {
              binId: hint.defaultBinId,
              qty: accepted,
              binLabel: hint.defaultBinLabel ?? hint.defaultBinCode ?? undefined,
            },
          ];
        } else if (next[poi.id]?.length === 1) {
          next[poi.id] = [{ ...next[poi.id]![0]!, qty: accepted }];
        }
      }
      return next;
    });
  }, [hints, lines, po.items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalReceiving = lines.reduce(
    (s, l) => s + (l.receivedQty - l.rejectedQty),
    0
  );

  const setLine = (poItemId: string, patch: Partial<ReceiveLineDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.poItemId === poItemId ? { ...l, ...patch } : l))
    );

  const validate = (): string | null => {
    const anyAccepted = lines.some(
      (l) => l.receivedQty - l.rejectedQty > 0
    );
    if (!anyAccepted) {
      return "Receive at least one line (qty > rejected). Use cancel if you don't want to record this GRN.";
    }
    for (const l of lines) {
      const poItem = po.items.find((i) => i.id === l.poItemId);
      if (!poItem) continue;
      if (l.receivedQty < 0 || l.rejectedQty < 0) {
        return `Negative qty on ${poItem.product.sku}.`;
      }
      if (l.rejectedQty > l.receivedQty) {
        return `Rejected can't exceed received on ${poItem.product.sku}.`;
      }
      const remaining = poItem.qty - poItem.received;
      const accepted = l.receivedQty - l.rejectedQty;
      if (accepted > remaining + 0.0001) {
        return `${poItem.product.sku}: receiving ${accepted} ${poItem.product.uom} exceeds remaining ${num(
          remaining,
          3
        )}.`;
      }
      const rows = allocations[l.poItemId] ?? [];
      if (accepted > 0 && rows.length > 0) {
        const sum = rows.reduce((s, a) => s + a.qty, 0);
        if (Math.abs(sum - accepted) > 0.001) {
          return `${poItem.product.sku}: bin allocations (${num(sum, 3)}) must equal accepted qty (${num(accepted, 3)}).`;
        }
        if (rows.some((a) => !a.binId)) {
          return `${poItem.product.sku}: pick a bin for every allocation row.`;
        }
      }
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const r = (await api.createGrn({
        poId: po.id,
        qcStatus,
        truckNo: truckNo.trim() || null,
        driver: driver.trim() || null,
        notes: notes.trim() || null,
        items: lines
          // Drop zero-everything lines so the GRN row is compact;
          // the backend doesn't require every PO line.
          .filter((l) => l.receivedQty > 0 || l.rejectedQty > 0)
          .map((l) => {
            const rows = allocations[l.poItemId] ?? [];
            return {
              poItemId: l.poItemId,
              receivedQty: l.receivedQty,
              rejectedQty: l.rejectedQty,
              remarks: l.remarks.trim() || null,
              batchNo: l.batchNo.trim() || null,
              expiryDate: l.expiryDate.trim() || null,
              allocations:
                rows.length > 0
                  ? rows.map((a) => ({ binId: a.binId, qty: a.qty }))
                  : undefined,
            };
          }),
      })) as { grn: { grnNo: string }; postedToInventory: boolean };
      const verb = r.postedToInventory
        ? "posted to stock"
        : "recorded (QC rejected - no inventory posted)";
      onReceived(`${r.grn.grnNo} ${verb}.`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remainingPerLine = useMemo(
    () =>
      Object.fromEntries(po.items.map((i) => [i.id, i.qty - i.received])),
    [po]
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[920px] max-w-[95vw] max-h-[92vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Truck size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Receive against {po.poNo}
              </div>
              <div className="text-body-sm">
                {po.vendor.name} · expected {new Date(po.expectedDate).toLocaleDateString()}
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
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="underline text-caption"
            >
              dismiss
            </button>
          </div>
        )}

        <div className="px-5 py-3 grid grid-cols-12 gap-3 border-b border-border bg-canvas shrink-0">
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Truck no.
            </div>
            <Input
              value={truckNo}
              onChange={(e) => setTruckNo(e.target.value)}
              placeholder="MH-12-2210"
            />
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Driver
            </div>
            <Input
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              QC outcome
            </div>
            <select
              value={qcStatus}
              onChange={(e) =>
                setQcStatus(e.target.value as typeof qcStatus)
              }
              className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
            >
              <option value="pending">Pending QC</option>
              <option value="pass">Pass</option>
              <option value="rework">Rework</option>
              <option value="reject">Reject (no inventory posted)</option>
            </select>
          </div>
          <div className="col-span-3">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Total accepting
            </div>
            <div className="h-10 flex items-center text-h3 font-bold tnum text-primary">
              {num(totalReceiving, 3)}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-12 grid-header-cell text-caption sticky top-0 bg-surface z-10 border-b border-border">
            <div className="col-span-2 px-3 py-2">SKU</div>
            <div className="col-span-2 px-3 py-2">Product</div>
            <div className="col-span-1 px-3 py-2 text-right">Ordered</div>
            <div className="col-span-1 px-3 py-2 text-right">Pending</div>
            <div className="col-span-2 px-3 py-2 text-right">Received now</div>
            <div className="col-span-1 px-3 py-2 text-right">Rejected</div>
            <div className="col-span-2 px-3 py-2">Batch / lot</div>
            <div className="col-span-1 px-3 py-2">Expiry</div>
          </div>
          {po.items.map((poi) => {
            const line = lines.find((l) => l.poItemId === poi.id)!;
            const remaining = remainingPerLine[poi.id];
            const fullyReceived = remaining <= 0.0001;
            const accepted = Math.max(0, line.receivedQty - line.rejectedQty);
            return (
              <div key={poi.id} className="border-b border-border">
                <div className="grid grid-cols-12 items-center hover:bg-canvas/40">
                <div className="col-span-2 px-3 py-2 font-mono text-caption font-semibold">
                  {poi.product.sku}
                </div>
                <div className="col-span-2 px-3 py-2 truncate">
                  {poi.product.name}
                </div>
                <div className="col-span-1 px-3 py-2 text-right tnum">
                  {num(poi.qty, 3)} {poi.product.uom}
                </div>
                <div className="col-span-1 px-3 py-2 text-right tnum text-warning font-semibold">
                  {fullyReceived ? "—" : num(remaining, 3)}
                </div>
                <div className="col-span-2 px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    step={0.001}
                    value={line.receivedQty}
                    disabled={fullyReceived}
                    onChange={(e) =>
                      setLine(poi.id, {
                        receivedQty: Number(e.target.value) || 0,
                      })
                    }
                    className="text-right"
                  />
                </div>
                <div className="col-span-1 px-3 py-2">
                  <Input
                    type="number"
                    min={0}
                    max={line.receivedQty}
                    step={0.001}
                    value={line.rejectedQty}
                    disabled={fullyReceived}
                    onChange={(e) =>
                      setLine(poi.id, {
                        rejectedQty: Number(e.target.value) || 0,
                      })
                    }
                    className="text-right"
                  />
                </div>
                <div className="col-span-2 px-3 py-2">
                  <Input
                    value={line.batchNo}
                    disabled={fullyReceived || line.receivedQty <= 0}
                    onChange={(e) => setLine(poi.id, { batchNo: e.target.value })}
                    placeholder={
                      poi.product.type === "raw" || poi.product.batchTracked
                        ? "Auto if blank"
                        : "Optional"
                    }
                    className="font-mono text-caption"
                  />
                </div>
                <div className="col-span-1 px-3 py-2">
                  <Input
                    type="date"
                    value={line.expiryDate}
                    disabled={fullyReceived || line.receivedQty <= 0}
                    onChange={(e) => setLine(poi.id, { expiryDate: e.target.value })}
                    className="text-caption"
                  />
                </div>
                </div>
                <GrnLineAllocation
                  productId={poi.productId}
                  sku={poi.product.sku}
                  uom={poi.product.uom}
                  acceptedQty={accepted}
                  hint={hints[poi.productId]}
                  allocations={allocations[poi.id] ?? []}
                  onChange={(next) =>
                    setAllocations((prev) => ({ ...prev, [poi.id]: next }))
                  }
                />
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-canvas shrink-0">
          <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
            Notes (optional)
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="QC remarks, partial-receipt reason, etc."
            className="w-full bg-white border border-border rounded-md px-3 py-2 text-body outline-none focus:border-primary"
          />
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            icon={<PackageCheck size={14} />}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Receiving…" : "Record GRN"}
          </Button>
        </div>
      </div>
    </div>
  );
};
