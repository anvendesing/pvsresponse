import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import { isMoClosed } from "@/lib/mo-utils";
import type { ProductionOrder } from "@/data/types";

interface Props {
  order: {
    id: string;
    orderNo: string;
    plannedQty: number;
    actualQty: number;
    scrapQty: number;
    reworkQty: number;
    status: string;
  };
  onSaved: (msg: string) => void | Promise<void>;
}

export const CorrectOutputForm = ({ order, onSaved }: Props) => {
  const closed = isMoClosed(order.status as ProductionOrder["status"]);

  const [actualQty, setActualQty] = useState(order.actualQty);
  const [scrapQty, setScrapQty] = useState(order.scrapQty);
  const [reworkQty, setReworkQty] = useState(order.reworkQty);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActualQty(order.actualQty);
    setScrapQty(order.scrapQty);
    setReworkQty(order.reworkQty);
    setReason("");
    setError(null);
  }, [order.id, order.actualQty, order.scrapQty, order.reworkQty]);

  const dirty =
    actualQty !== order.actualQty ||
    scrapQty !== order.scrapQty ||
    reworkQty !== order.reworkQty;

  const completion =
    order.plannedQty > 0 ? Math.round((actualQty / order.plannedQty) * 1000) / 10 : 0;

  const hasLogged =
    order.actualQty > 0 || order.scrapQty > 0 || order.reworkQty > 0;

  const submit = async () => {
    if (!dirty) return;
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
        scrapQty !== order.scrapQty ? `scrap ${num(order.scrapQty)} → ${num(scrapQty)}` : null,
        reworkQty !== order.reworkQty ? `rework ${num(order.reworkQty)} → ${num(reworkQty)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      await onSaved(`Corrected ${order.orderNo} totals (${summary}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
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

  if (closed) return null;

  return (
    <Card
      title="Correct output totals"
      subtitle="Set absolute running totals when a batch was logged incorrectly"
      actions={
        <Button
          size="sm"
          variant="outline"
          icon={<RotateCcw size={14} />}
          onClick={reset}
          disabled={busy || !dirty}
        >
          Reset
        </Button>
      }
    >
      {!hasLogged ? (
        <p className="text-body-sm text-ink-muted">
          Nothing logged yet. Use <strong>Log output</strong> above first.
        </p>
      ) : (
        <>
          <div className="mb-4 rounded-md border border-warning bg-warning-soft px-3 py-2 text-body-sm text-ink">
            These are <strong>absolute totals</strong>, not deltas. Finished goods post to
            inventory only on <strong>Complete MO</strong> (Status tab).
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-danger-soft border border-danger text-danger text-body-sm flex items-center gap-2 rounded-md">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                disabled={busy}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">was {num(order.actualQty)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Scrap</div>
              <Input
                type="number"
                min={0}
                step="any"
                value={scrapQty}
                onChange={(e) => setScrapQty(Number(e.target.value))}
                disabled={busy}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">was {num(order.scrapQty)}</div>
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Rework</div>
              <Input
                type="number"
                min={0}
                step="any"
                value={reworkQty}
                onChange={(e) => setReworkQty(Number(e.target.value))}
                disabled={busy}
              />
              <div className="text-caption text-ink-muted mt-1 tnum">was {num(order.reworkQty)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-border bg-canvas px-3 py-2 flex items-center justify-between text-body-sm">
            <span className="text-ink-muted">New completion</span>
            <span className="tnum font-semibold">
              {completion}% · {num(actualQty)} / {num(order.plannedQty)}
            </span>
          </div>

          <div className="mt-4">
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Reason <span className="lowercase font-normal">(optional)</span>
            </div>
            <Input
              type="text"
              placeholder="e.g. Logged twice by mistake"
              value={reason}
              maxLength={240}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              size="sm"
              icon={<CheckCircle2 size={14} />}
              onClick={() => void submit()}
              disabled={busy || !dirty}
            >
              {busy ? "Saving…" : "Save correction"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
};
