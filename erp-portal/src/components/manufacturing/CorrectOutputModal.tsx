// "Correct production totals" modal.
//
// Used when an operator wrong-logs production (e.g. clicks Log output
// twice and ends up with actual=90 instead of 40). Unlike Log output,
// which adds a delta on top of the running total, this modal SETS the
// totals to absolute values via POST /production-orders/:id/adjust-output.
//
// Refused server-side once the MO is completed (FG already in stock).

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { num } from "@/lib/format";

interface Props {
  order: {
    id: string;
    orderNo: string;
    plannedQty: number;
    actualQty: number;
    scrapQty: number;
    reworkQty: number;
  };
  onClose: () => void;
  onSaved: (msg: string) => void;
}

export const CorrectOutputModal = ({ order, onClose, onSaved }: Props) => {
  const [actualQty, setActualQty] = useState(order.actualQty);
  const [scrapQty, setScrapQty] = useState(order.scrapQty);
  const [reworkQty, setReworkQty] = useState(order.reworkQty);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the underlying order changes (e.g. user opens the
  // modal twice for different MOs without unmounting).
  useEffect(() => {
    setActualQty(order.actualQty);
    setScrapQty(order.scrapQty);
    setReworkQty(order.reworkQty);
  }, [order.id, order.actualQty, order.scrapQty, order.reworkQty]);

  const dirty =
    actualQty !== order.actualQty ||
    scrapQty !== order.scrapQty ||
    reworkQty !== order.reworkQty;

  const completion =
    order.plannedQty > 0
      ? Math.round((actualQty / order.plannedQty) * 1000) / 10
      : 0;

  const submit = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (
      !Number.isFinite(actualQty) ||
      !Number.isFinite(scrapQty) ||
      !Number.isFinite(reworkQty) ||
      actualQty < 0 ||
      scrapQty < 0 ||
      reworkQty < 0
    ) {
      setError("All quantities must be non-negative numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.adjustOutput(order.id, {
        actualQty,
        scrapQty,
        reworkQty,
        reason: reason.trim() || undefined,
      });
      const summary = [
        `actual ${num(order.actualQty)} → ${num(actualQty)}`,
        scrapQty !== order.scrapQty
          ? `scrap ${num(order.scrapQty)} → ${num(scrapQty)}`
          : null,
        reworkQty !== order.reworkQty
          ? `rework ${num(order.reworkQty)} → ${num(reworkQty)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
      onSaved(`Corrected ${order.orderNo} totals (${summary}).`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const reset = () => {
    setActualQty(order.actualQty);
    setScrapQty(order.scrapQty);
    setReworkQty(order.reworkQty);
    setReason("");
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-[560px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-warning-soft text-warning rounded-md">
              <RotateCcw size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Correct production totals
              </div>
              <div className="text-body-sm">
                <span className="font-mono">{order.orderNo}</span> · Set the
                running totals to the right values
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
          <div className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-body-sm text-ink">
            These are <strong>absolute totals</strong>, not deltas. Use this
            when you wrong-logged a batch (e.g. double-clicked Log output).
            Inventory hasn&apos;t moved yet — finished goods only post on{" "}
            <strong>Complete</strong>.
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Actual (good)
              </div>
              <Input
                type="number"
                min={0}
                step="any"
                value={actualQty}
                onChange={(e) => setActualQty(Number(e.target.value))}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">
                was {num(order.actualQty)}
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
                was {num(order.scrapQty)}
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
                was {num(order.reworkQty)}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-canvas px-3 py-2 flex items-center justify-between text-body-sm">
            <span className="text-ink-muted">New completion</span>
            <span className="tnum font-semibold">
              {completion}% · {num(actualQty)} / {num(order.plannedQty)}
            </span>
          </div>

          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Reason <span className="lowercase font-normal">(optional, kept in audit log)</span>
            </div>
            <Input
              type="text"
              placeholder="e.g. Logged twice by mistake"
              value={reason}
              maxLength={240}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-between gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy || !dirty}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={submit}
              disabled={busy || !dirty}
            >
              {busy ? "Saving…" : "Save correction"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
