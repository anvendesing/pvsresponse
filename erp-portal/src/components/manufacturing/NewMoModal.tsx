// "New manufacturing order" wizard — shortage-driven produce qty.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, X, Zap } from "lucide-react";
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
  const [facilityId, setFacilityId] = useState<string>("");
  const [lineId, setLineId] = useState<string>("");
  const [showLineExpander, setShowLineExpander] = useState(false);
  const [plannedQty, setPlannedQty] = useState(100);
  const [startDate, setStartDate] = useState(isoDate(0));
  const [dueDate, setDueDate] = useState(isoDate(3));
  const plannedTouched = useRef(false);

  const facilitiesResp = useApi(() => api.productionFacilities({ active: true }), []);
  const linesResp = useApi(() => api.productionLines({ active: true }), []);
  const facilities =
    (facilitiesResp.data as Array<{ id: string; code: string; name: string }> | null) ?? [];
  const allLines =
    (linesResp.data as Array<{
      id: string;
      code: string;
      name: string;
      facilityId: string;
    }> | null) ?? [];
  const linesForFacility = facilityId
    ? allLines.filter((l) => l.facilityId === facilityId)
    : [];

  const [demandCtx, setDemandCtx] = useState<Awaited<
    ReturnType<typeof api.bomMoCreateContext>
  > | null>(null);
  const [leaves, setLeaves] = useState<BomLeafRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBom = activeBoms.find((b) => b.id === bomId);
  const outputUom = demandCtx?.outputUom ?? selectedBom?.items[0]?.uom ?? "unit";

  useEffect(() => {
    if (!selectedBom) return;
    setFacilityId(selectedBom.defaultFacilityId ?? "");
    setLineId(selectedBom.defaultLineId ?? "");
  }, [selectedBom?.id, selectedBom?.defaultFacilityId, selectedBom?.defaultLineId]);

  useEffect(() => {
    if (!lineId || !facilityId) return;
    const l = allLines.find((x) => x.id === lineId);
    if (l && l.facilityId !== facilityId) setLineId("");
  }, [facilityId, lineId, allLines]);

  useEffect(() => {
    if (!bomId) {
      setDemandCtx(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await api.bomMoCreateContext(bomId);
        if (cancelled) return;
        setDemandCtx(ctx);
        if (!plannedTouched.current) setPlannedQty(ctx.suggestedPlannedQty);
      } catch {
        if (!cancelled) setDemandCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bomId]);

  useEffect(() => {
    plannedTouched.current = false;
  }, [bomId]);

  useEffect(() => {
    if (!bomId || plannedQty <= 0) {
      setLeaves([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const exp = await api.bomExplode(bomId, plannedQty);
        if (!cancelled) {
          setLeaves(exp);
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
    if (!facilityId) return setError("Pick a production facility.");
    if (plannedQty <= 0) return setError("Produce qty must be > 0.");
    setBusy(true);
    setError(null);
    try {
      const created = (await api.createProductionOrder({
        bomId,
        facilityId,
        lineId: lineId || undefined,
        plannedQty,
        urgentQty: demandCtx?.urgentQty ?? 0,
        startDate,
        dueDate,
      })) as { id: string; orderNo: string };
      onCreated(created.orderNo, created.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const urgentQty = demandCtx?.urgentQty ?? 0;
  const batchSize = demandCtx?.batchSize ?? selectedBom?.outputQty ?? 0;

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-[820px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
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
                Set produce qty from order shortage or a full batch.
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
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">BOM</div>
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
                    {b.sku} {scope} · {b.product} · {b.revision} · batch {b.outputQty}
                  </option>
                );
              })}
            </select>
          </div>

          {demandCtx && (
            <div className="rounded-lg border border-border bg-canvas/60 p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-caption font-semibold uppercase text-ink-muted">
                  Demand vs stock
                </span>
                {urgentQty > 0 && (
                  <Chip size="sm" tone="warning" icon={<Zap size={11} />}>
                    Urgent · {num(urgentQty)} {outputUom} short
                  </Chip>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-body-sm">
                <Metric label="On hand" value={`${num(demandCtx.onHand)} ${outputUom}`} />
                <Metric
                  label="Committed (SO)"
                  value={`${num(demandCtx.committedSo)} ${outputUom}`}
                  tone={demandCtx.committedSo > 0 ? "warning" : undefined}
                />
                <Metric label="Open MOs" value={`${num(demandCtx.moPipeline)} ${outputUom}`} />
                <Metric
                  label="Order shortage"
                  value={`${num(urgentQty)} ${outputUom}`}
                  tone={urgentQty > 0 ? "danger" : "success"}
                  strong
                />
              </div>
              <p className="text-caption text-ink-muted leading-snug">
                Shortage = committed sales − on hand − qty still expected from other open MOs. On a
                busy day, produce only the shortage; use a full batch when you have capacity.
              </p>
            </div>
          )}

          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-5">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Produce qty
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.001}
                  step="any"
                  value={plannedQty}
                  onChange={(e) => {
                    plannedTouched.current = true;
                    setPlannedQty(Number(e.target.value) || 0);
                  }}
                  className="flex-1"
                />
                <span className="text-body-sm text-ink-muted shrink-0">{outputUom}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {urgentQty > 0 && (
                  <button
                    type="button"
                    className="text-caption px-2 py-0.5 rounded border border-warning bg-warning-soft text-ink hover:bg-warning/20"
                    onClick={() => {
                      plannedTouched.current = true;
                      setPlannedQty(urgentQty);
                    }}
                  >
                    Cover shortage ({num(urgentQty)})
                  </button>
                )}
                {batchSize > 0 && (
                  <button
                    type="button"
                    className="text-caption px-2 py-0.5 rounded border border-border bg-white text-ink-muted hover:bg-canvas"
                    onClick={() => {
                      plannedTouched.current = true;
                      setPlannedQty(batchSize);
                    }}
                  >
                    Full batch ({num(batchSize)})
                  </button>
                )}
              </div>
            </div>
            <div className="col-span-3">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Start date
              </div>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Due date
              </div>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Facility
              </div>
              <select
                value={facilityId}
                onChange={(e) => {
                  setFacilityId(e.target.value);
                  setLineId("");
                }}
                className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary"
              >
                <option value="">— Pick a facility —</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Production line <span className="normal-case font-normal">(optional)</span>
              </div>
              {showLineExpander || facilityId ? (
                <select
                  value={lineId}
                  onChange={(e) => setLineId(e.target.value)}
                  disabled={!facilityId}
                  className="h-10 w-full bg-white border border-border rounded-md px-3 text-body outline-none focus:border-primary disabled:bg-canvas"
                >
                  <option value="">
                    {facilityId ? "— Assign later —" : "— Pick a facility first —"}
                  </option>
                  {linesForFacility.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLineExpander(true)}
                  className="h-10 w-full text-left px-3 text-body-sm text-primary border border-dashed border-primary/30 rounded-md"
                >
                  + Set initial line (optional)
                </button>
              )}
            </div>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-border text-caption text-ink-muted uppercase font-semibold">
              Raw materials needed (for {num(plannedQty)} {outputUom} output)
            </div>
            {loading ? (
              <div className="p-4 text-center text-body-sm text-ink-muted">Computing…</div>
            ) : leaves.length === 0 ? (
              <div className="p-4 text-center text-body-sm text-ink-muted">
                Pick a BOM and produce qty to see components.
              </div>
            ) : (
              <div className="max-h-[220px] overflow-y-auto divide-y divide-border">
                {leaves.map((l) => (
                  <div
                    key={l.productId}
                    className="px-3 py-2 grid grid-cols-12 gap-2 text-body-sm items-center"
                  >
                    <div className="col-span-3 font-mono text-caption">{l.sku}</div>
                    <div className="col-span-5 truncate">{l.name}</div>
                    <div className="col-span-2 text-right tnum">
                      {num(l.qty, 3)} {l.uom}
                    </div>
                    <div className="col-span-2 text-caption text-ink-muted truncate">
                      {l.path.join(" → ")}
                    </div>
                  </div>
                ))}
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

const Metric = ({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger" | "success";
  strong?: boolean;
}) => (
  <div className="rounded-md border border-border bg-white px-2.5 py-2">
    <div className="text-[10px] uppercase font-semibold text-ink-muted">{label}</div>
    <div
      className={cn(
        "tnum mt-0.5",
        strong && "font-bold text-body",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "success" && "text-success",
        !tone && !strong && "text-ink"
      )}
    >
      {value}
    </div>
  </div>
);
