// Odoo-style work orders tab on an MO: Waiting → Ready → Start → Done → QA.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { Fragment, useCallback, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GitBranch,
  Layers,
  Play,
  Plus,
  ShieldCheck,
  Split,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import type { BomByproductRow, ProductionOrder, WorkOrder, WorkOrderRun } from "@/data/types";
import { cn } from "@/lib/cn";
import { SplitOperationForm } from "./SplitOperationForm";
import { SplitOperationModal } from "./SplitOperationModal";
import {
  WoLineMachineFields,
  type MachineOption,
  type ProductionLineOption,
} from "./WoLineMachineFields";

const woStatusLabel = (wo: WorkOrder) => {
  if (wo.status === "waiting") return "Waiting for prior step";
  if (wo.status === "ready") return "Ready";
  if (wo.status === "running") return "In progress";
  if (wo.status === "paused") return "Paused";
  if (wo.status === "rework") return "Rework";
  if (wo.status === "complete" && wo.qaStatus === "pending") return "QA pending";
  if (wo.status === "complete" && wo.qaStatus === "fail") return "QA failed";
  if (wo.status === "complete") return "Done";
  return wo.status;
};

const woStatusTone = (wo: WorkOrder): "success" | "warning" | "danger" | "primary" | "neutral" => {
  if (wo.status === "waiting") return "neutral";
  if (wo.status === "ready") return "primary";
  if (wo.status === "running") return "primary";
  if (wo.status === "paused" || wo.status === "rework") return "warning";
  if (wo.qaStatus === "fail") return "danger";
  if (wo.status === "complete" && wo.qaStatus === "pending") return "warning";
  if (wo.status === "complete") return "success";
  return "neutral";
};

interface Props {
  order: ProductionOrder;
  workOrders: WorkOrder[];
  moComplete: boolean;
  bomByproducts: BomByproductRow[];
  bomOutputQty: number;
  onRefresh: () => Promise<void>;
  onMessage: (msg: string, tone?: "ok" | "err") => void;
  /** Inline QA / split forms instead of modal overlays (unified MO page). */
  inlineDialogs?: boolean;
}

export const MoWorkOrdersPanel = ({
  order,
  workOrders,
  moComplete,
  bomByproducts,
  bomOutputQty,
  onRefresh,
  onMessage,
  inlineDialogs = false,
}: Props) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [qaWoId, setQaWoId] = useState<string | null>(null);
  const [qaNotes, setQaNotes] = useState("");
  const [splitOpId, setSplitOpId] = useState<string | null>(null);
  // WOs whose runs panel is currently expanded.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  const dismissQa = useCallback(() => setQaWoId(null), []);

  const facilityId = order.facilityId ?? "";
  const linesResp = useApi(
    () =>
      facilityId
        ? api.productionLines({ facilityId, active: true })
        : Promise.resolve([]),
    [facilityId]
  );
  const machinesResp = useApi(
    () =>
      facilityId
        ? api.machines({ facilityId, active: true })
        : Promise.resolve([]),
    [facilityId]
  );

  const lines = (linesResp.data as ProductionLineOption[] | null) ?? [];
  const machines = useMemo(() => {
    const raw = (machinesResp.data as Array<{
      id: string;
      code: string;
      name: string;
      productionLineId: string;
    }> | null) ?? [];
    return raw.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      productionLineId: m.productionLineId,
    })) satisfies MachineOption[];
  }, [machinesResp.data]);

  const canAssign = (wo: WorkOrder) =>
    !moComplete && wo.status !== "running" && wo.status !== "complete";

  const assignWo = async (wo: WorkOrder, lineId: string, machineId: string) => {
    await api.assignMoWorkOrder(order.id, wo.id, {
      lineId: lineId || undefined,
      machineId: machineId || null,
    });
    await onRefresh();
    onMessage(`Updated ${wo.workOrderNo} line / machine.`, "ok");
  };

  const wos = useMemo(
    () =>
      [...workOrders].sort((a, b) => {
        const sa = a.bomOperation?.seq ?? 999;
        const sb = b.bomOperation?.seq ?? 999;
        if (sa !== sb) return sa - sb;
        return (a.splitSeq ?? 0) - (b.splitSeq ?? 0);
      }),
    [workOrders]
  );

  const splittableOps = useMemo(() => {
    const map = new Map<string, { id: string; name: string; seq: number }>();
    for (const wo of wos) {
      if (wo.bomOperationId && wo.bomOperation) {
        map.set(wo.bomOperationId, {
          id: wo.bomOperationId,
          name: wo.bomOperation.name,
          seq: wo.bomOperation.seq,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.seq - b.seq);
  }, [wos]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      onMessage((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const submitQa = async (pass: boolean) => {
    if (!qaWoId) return;
    await run(`qa-${pass}`, async () => {
      const res = await api.qaMoWorkOrder(order.id, qaWoId, {
        pass,
        notes: qaNotes.trim() || undefined,
      });
      onMessage(
        pass
          ? `QA passed for ${res.workOrder.workOrderNo ?? "work order"}.`
          : `QA failed — ${res.workOrder?.workOrderNo ?? "work order"} reopened for rework.`,
        pass ? "ok" : "err"
      );
      setQaWoId(null);
      setQaNotes("");
    });
  };

  return (
    <>
      <Card
        title="Work orders"
        subtitle="Routing steps · assign line & machine, then start / complete / QA"
        actions={
          !moComplete && splittableOps.length > 0 ? (
            <div className="flex items-center gap-1 flex-wrap">
              {splittableOps.map((op) => (
                <Button
                  key={op.id}
                  size="sm"
                  variant="outline"
                  icon={<Split size={14} />}
                  onClick={() => setSplitOpId(op.id)}
                  title={`Split ${op.name} across parallel lines`}
                >
                  Split {op.name}
                </Button>
              ))}
            </div>
          ) : null
        }
        noPadding
      >
        {wos.length === 0 ? (
          <div className="px-4 py-6 text-body-sm text-ink-muted text-center">
            No work orders on this MO.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {wos.map((wo) => {
              const pct =
                wo.target > 0 ? Math.min(100, Math.round((wo.output / wo.target) * 100)) : 0;
              const tone = woStatusTone(wo);
              const label = wo.bomOperation?.name ?? wo.station;
              const qtyTarget = wo.plannedSplitQty ?? wo.target;
              const editable = canAssign(wo) && lines.length > 0;

              return (
                <div key={wo.id} className="px-4 py-3 hover:bg-canvas/40">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div
                      className={cn(
                        "h-9 w-9 grid place-items-center rounded-md shrink-0",
                        wo.status === "running"
                          ? "bg-primary text-white"
                          : wo.status === "complete" && wo.qaStatus !== "pending"
                            ? "bg-success-soft text-success"
                            : "bg-canvas text-ink-muted"
                      )}
                    >
                      {wo.status === "running" ? (
                        <Play size={14} />
                      ) : wo.status === "complete" ? (
                        <CheckCircle2 size={14} />
                      ) : wo.status === "waiting" ? (
                        <Clock size={14} />
                      ) : (
                        <Square size={14} />
                      )}
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-caption text-primary">
                          {wo.workOrderNo}
                        </span>
                        {wo.bomOperation && (
                          <span className="text-caption text-ink-muted">
                            Step {wo.bomOperation.seq}
                          </span>
                        )}
                        <span className="font-semibold text-body-sm">{label}</span>
                        <Chip size="sm" tone={tone} icon={<StatusDot tone={tone} />}>
                          {woStatusLabel(wo)}
                        </Chip>
                      </div>
                      <div className="text-caption text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                        {(wo.line?.code || wo.machineRef?.code) && (
                          <span className="inline-flex items-center gap-1">
                            <GitBranch size={11} />
                            {[wo.line?.code, wo.machineRef?.code ?? wo.machine]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                        <span className="tnum">
                          {num(wo.output)} / {num(qtyTarget)}
                        </span>
                      </div>
                      {editable ? (
                        <WoLineMachineFields
                          compact
                          lines={lines}
                          machines={machines}
                          lineId={wo.lineId ?? ""}
                          machineId={wo.machineId ?? ""}
                          disabled={busy !== null}
                          onLineChange={(lineId) =>
                            void run(`line-${wo.id}`, () =>
                              assignWo(wo, lineId, "")
                            )
                          }
                          onMachineChange={(machineId) =>
                            void run(`machine-${wo.id}`, () =>
                              assignWo(wo, wo.lineId ?? "", machineId)
                            )
                          }
                        />
                      ) : !wo.lineId && !moComplete ? (
                        <div className="text-caption text-warning mt-1">
                          Assign a production line before starting this step.
                        </div>
                      ) : null}
                      {wo.qaNotes && (
                        <div className="text-caption text-warning mt-1">{wo.qaNotes}</div>
                      )}
                    </div>
                    {!moComplete && inlineDialogs && qaWoId === wo.id && (
                      <div className="w-full basis-full mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                        <div className="text-body-sm font-semibold">Quality check</div>
                        <div className="text-caption text-ink-muted">
                          Pass to unblock the next step. Fail reopens this step for rework.
                        </div>
                        <Input
                          placeholder="Notes (optional)"
                          value={qaNotes}
                          onChange={(e) => setQaNotes(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setQaWoId(null)}>
                            Cancel
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void submitQa(false)}
                          >
                            Fail · rework
                          </Button>
                          <Button disabled={busy !== null} onClick={() => void submitQa(true)}>
                            Pass
                          </Button>
                        </div>
                      </div>
                    )}
                    {!moComplete && (
                      <div className="flex items-center gap-1 shrink-0">
                        {(wo.status === "ready" || wo.status === "queued" || wo.status === "rework") && (
                          <Button
                            size="sm"
                            icon={<Play size={12} />}
                            disabled={busy !== null || !wo.lineId}
                            title={
                              wo.lineId
                                ? "Start this work order"
                                : "Select a production line first"
                            }
                            onClick={() =>
                              run(`start-${wo.id}`, async () => {
                                await api.startMoWorkOrder(order.id, wo.id);
                                onMessage(`Started ${wo.workOrderNo}.`, "ok");
                              })
                            }
                          >
                            Start
                          </Button>
                        )}
                        {wo.status === "running" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() =>
                              run(`done-${wo.id}`, async () => {
                                const res = await api.completeMoWorkOrder(order.id, wo.id);
                                onMessage(
                                  res.needsQa
                                    ? `${wo.workOrderNo} done — awaiting QA.`
                                    : `${wo.workOrderNo} completed.`,
                                  "ok"
                                );
                              })
                            }
                          >
                            Done
                          </Button>
                        )}
                        {wo.status === "complete" && wo.qaStatus === "pending" && (
                          <Button
                            size="sm"
                            icon={<ShieldCheck size={12} />}
                            disabled={busy !== null}
                            onClick={() => {
                              setQaWoId(wo.id);
                              setQaNotes("");
                            }}
                          >
                            QA
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 h-1 bg-canvas rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        tone === "success" && "bg-success",
                        tone === "warning" && "bg-warning",
                        tone === "danger" && "bg-danger",
                        (tone === "primary" || tone === "neutral") && "bg-primary"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {/* Multi-machine parallel runs toggle. Empty -> legacy
                      single-machine WO; clicking still opens the panel so
                      the operator can add a run and switch this WO into
                      parallel mode. */}
                  {!moComplete && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenRuns((prev) => {
                            const next = new Set(prev);
                            if (next.has(wo.id)) next.delete(wo.id);
                            else next.add(wo.id);
                            return next;
                          })
                        }
                        className="inline-flex items-center gap-1 text-caption text-ink-muted hover:text-primary"
                      >
                        {openRuns.has(wo.id) ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                        <Layers size={12} />
                        Machine runs
                        <span className="font-mono">
                          ({wo.runs?.length ?? 0})
                        </span>
                        {(wo.runs?.length ?? 0) > 0 && (
                          <span className="text-caption text-ink-muted">
                            · rollup {num(wo.runs!.reduce((s, r) => s + (r.goodQty ?? 0), 0))} /{" "}
                            {num(qtyTarget)}
                          </span>
                        )}
                      </button>
                      {openRuns.has(wo.id) && (
                        <WoRunsSection
                          moId={order.id}
                          wo={wo}
                          machines={machines}
                          lines={lines}
                          bomByproducts={bomByproducts}
                          bomOutputQty={bomOutputQty}
                          busy={busy}
                          onBusy={setBusy}
                          onRefresh={onRefresh}
                          onMessage={onMessage}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {qaWoId && !inlineDialogs && (
        <div
          className="fixed inset-0 z-[70] bg-ink/40 grid place-items-center"
          {...backdropDismissProps(dismissQa)}
        >
          <div
            className="bg-surface w-[440px] max-w-[95vw] rounded-lg elevation-3 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-body-sm font-semibold mb-1">Quality check</div>
            <div className="text-caption text-ink-muted mb-3">
              Pass to unblock the next step. Fail reopens this step for rework.
            </div>
            <Input
              placeholder="Notes (optional)"
              value={qaNotes}
              onChange={(e) => setQaNotes(e.target.value)}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setQaWoId(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => void submitQa(false)}
              >
                Fail · rework
              </Button>
              <Button disabled={busy !== null} onClick={() => void submitQa(true)}>
                Pass
              </Button>
            </div>
          </div>
        </div>
      )}

      {splitOpId && inlineDialogs && (
        <SplitOperationForm
          mo={order}
          bomOperationId={splitOpId}
          operationLabel={splittableOps.find((o) => o.id === splitOpId)?.name ?? "Operation"}
          onCancel={() => setSplitOpId(null)}
          onSaved={async () => {
            setSplitOpId(null);
            await onRefresh();
            onMessage("Operation split across lines.", "ok");
          }}
        />
      )}

      {splitOpId && !inlineDialogs && (
        <SplitOperationModal
          mo={order}
          bomOperationId={splitOpId}
          operationLabel={
            splittableOps.find((o) => o.id === splitOpId)?.name ?? "Operation"
          }
          onClose={() => setSplitOpId(null)}
          onSaved={async () => {
            setSplitOpId(null);
            await onRefresh();
            onMessage("Operation split across lines.", "ok");
          }}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------
// Machine-runs section — one WO can be processed by N machines in
// parallel. Each run captures the partial input consumed at that
// machine + the partial good/scrap qty it produced. WO.output is
// auto-rolled up server-side from sum(runs.goodQty) once any run exists.
// ---------------------------------------------------------------------

const runStatusTone = (s: WorkOrderRun["status"]): "neutral" | "primary" | "success" | "warning" => {
  if (s === "running") return "primary";
  if (s === "complete") return "success";
  if (s === "abandoned") return "warning";
  return "neutral";
};

const runStatusLabel = (s: WorkOrderRun["status"]) =>
  s === "running" ? "In progress" : s.charAt(0).toUpperCase() + s.slice(1);

const fmtRunTime = (run: WorkOrderRun) => {
  if (!run.startTime) return "—";
  const start = new Date(run.startTime);
  const end = run.endTime ? new Date(run.endTime) : null;
  if (!end) {
    const min = Math.max(0, Math.round((Date.now() - start.getTime()) / 60000));
    return `${min}m (running)`;
  }
  const min = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return `${min}m`;
};

interface WoRunsSectionProps {
  moId: string;
  wo: WorkOrder;
  machines: MachineOption[];
  lines: ProductionLineOption[];
  bomByproducts: BomByproductRow[];
  bomOutputQty: number;
  busy: string | null;
  onBusy: (key: string | null) => void;
  onRefresh: () => Promise<void>;
  onMessage: (msg: string, tone?: "ok" | "err") => void;
}

type RunDraft = {
  good?: string;
  scrap?: string;
  input?: string;
  byproducts?: Record<string, string>;
};

const expectedBpQty = (
  bp: BomByproductRow,
  goodQty: number,
  batchSize: number
): number => {
  if (!batchSize || batchSize <= 0 || goodQty <= 0) return 0;
  const raw = (bp.qty / batchSize) * goodQty;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 1000) / 1000;
};

const bpLabel = (bp: BomByproductRow) =>
  bp.variantSku ? `${bp.variantSku} · ${bp.name}` : `${bp.sku} · ${bp.name}`;

const WoRunsSection = ({
  moId,
  wo,
  machines,
  lines,
  bomByproducts,
  bomOutputQty,
  busy,
  onBusy,
  onRefresh,
  onMessage,
}: WoRunsSectionProps) => {
  const [addLineId, setAddLineId] = useState<string>(wo.lineId ?? "");
  const [addMachineId, setAddMachineId] = useState<string>("");
  const [addPlanned, setAddPlanned] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, RunDraft>>({});

  const runs = wo.runs ?? [];
  const activeMachineIds = new Set(
    runs.filter((r) => r.status === "queued" || r.status === "running").map((r) => r.machineId)
  );
  const availableMachines = machines.filter(
    (m) => (!addLineId || m.productionLineId === addLineId) && !activeMachineIds.has(m.id)
  );
  const totalGood = runs.reduce((s, r) => s + (r.goodQty ?? 0), 0);
  const remaining = Math.max(0, (wo.plannedSplitQty ?? wo.target) - totalGood);

  const exec = async (key: string, fn: () => Promise<void>) => {
    onBusy(key);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      onMessage((e as Error).message, "err");
    } finally {
      onBusy(null);
    }
  };

  const addRun = async () => {
    if (!addMachineId) return;
    await exec(`add-${wo.id}`, async () => {
      await api.addWorkOrderRun(moId, wo.id, {
        machineId: addMachineId,
        lineId: addLineId || null,
        plannedQty: addPlanned ? parseFloat(addPlanned) : null,
      });
      setAddMachineId("");
      setAddPlanned("");
      onMessage(`Added machine run to ${wo.workOrderNo}.`, "ok");
    });
  };

  const draftFor = (id: string) => drafts[id] ?? {};
  const setDraft = (id: string, patch: Partial<RunDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const runBpQty = (run: WorkOrderRun, bp: BomByproductRow): string => {
    const d = draftFor(run.id);
    if (d.byproducts?.[bp.id ?? ""] !== undefined) return d.byproducts[bp.id ?? ""];
    const saved = run.byproducts?.find((r) => r.bomByproductId === bp.id);
    if (saved) return String(saved.qty);
    const good =
      d.good !== undefined && d.good !== ""
        ? parseFloat(d.good) || 0
        : run.goodQty;
    return String(expectedBpQty(bp, good, bomOutputQty));
  };

  const draftToBody = (id: string, run: WorkOrderRun) => {
    const d = draftFor(id);
    const body: {
      goodQty?: number;
      scrapQty?: number;
      inputQty?: number;
      byproducts?: Array<{ bomByproductId: string; qty: number }>;
    } = {};
    if (d.good !== undefined && d.good !== "") body.goodQty = parseFloat(d.good) || 0;
    if (d.scrap !== undefined && d.scrap !== "") body.scrapQty = parseFloat(d.scrap) || 0;
    if (d.input !== undefined && d.input !== "") body.inputQty = parseFloat(d.input) || 0;
    if (Object.keys(body).length === 0) body.goodQty = run.goodQty;
    if (bomByproducts.length > 0) {
      body.byproducts = bomByproducts
        .filter((bp) => bp.id)
        .map((bp) => ({
          bomByproductId: bp.id!,
          qty: parseFloat(runBpQty(run, bp)) || 0,
        }));
    }
    return body;
  };

  const hasDraftChanges = (run: WorkOrderRun) => {
    const d = draftFor(run.id);
    return (
      d.good !== undefined ||
      d.scrap !== undefined ||
      d.input !== undefined ||
      (d.byproducts && Object.keys(d.byproducts).length > 0)
    );
  };

  return (
    <div className="mt-2 rounded border border-border bg-canvas/40 p-2">
      {runs.length === 0 ? (
        <div className="text-caption text-ink-muted px-1 py-1">
          No batches yet. Mark the step <strong>Done</strong> to record one full cycle on the
          assigned machine, or add batches below for partial / multi-machine runs.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-caption tnum">
            <thead>
              <tr className="text-ink-muted text-left">
                <th className="px-2 py-1 font-medium">Batch</th>
                <th className="px-2 py-1 font-medium">Machine</th>
                <th className="px-2 py-1 font-medium text-right">Plan</th>
                <th className="px-2 py-1 font-medium text-right">Input</th>
                <th className="px-2 py-1 font-medium text-right">Good</th>
                <th className="px-2 py-1 font-medium text-right">Scrap</th>
                <th className="px-2 py-1 font-medium">Status</th>
                <th className="px-2 py-1 font-medium">Time</th>
                <th className="px-2 py-1 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const editable = run.status === "queued" || run.status === "running";
                const d = draftFor(run.id);
                const colSpan = bomByproducts.length > 0 ? 9 : 9;
                return (
                  <Fragment key={run.id}>
                  <tr className="border-t border-border align-middle">
                    <td className="px-2 py-1.5 font-semibold text-ink-muted">#{run.batchSeq ?? 1}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-caption text-primary">
                        {run.machine.code}
                      </div>
                      <div className="text-ink-muted">{run.machine.name}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {run.plannedQty != null ? num(run.plannedQty) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {editable ? (
                        <Input
                          size="sm"
                          type="number"
                          min={0}
                          value={d.input ?? String(run.inputQty)}
                          onChange={(e) => setDraft(run.id, { input: e.target.value })}
                          className="w-16 text-right"
                        />
                      ) : (
                        num(run.inputQty)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {editable ? (
                        <Input
                          size="sm"
                          type="number"
                          min={0}
                          value={d.good ?? String(run.goodQty)}
                          onChange={(e) => setDraft(run.id, { good: e.target.value })}
                          className="w-16 text-right"
                        />
                      ) : (
                        num(run.goodQty)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {editable ? (
                        <Input
                          size="sm"
                          type="number"
                          min={0}
                          value={d.scrap ?? String(run.scrapQty)}
                          onChange={(e) => setDraft(run.id, { scrap: e.target.value })}
                          className="w-16 text-right"
                        />
                      ) : (
                        num(run.scrapQty)
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Chip size="sm" tone={runStatusTone(run.status)}>
                        {runStatusLabel(run.status)}
                      </Chip>
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">{fmtRunTime(run)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end flex-wrap">
                        {run.status === "queued" && (
                          <Button
                            size="sm"
                            icon={<Play size={11} />}
                            disabled={busy !== null}
                            onClick={() =>
                              exec(`run-start-${run.id}`, async () => {
                                await api.startWorkOrderRun(moId, wo.id, run.id);
                              })
                            }
                          >
                            Start
                          </Button>
                        )}
                        {editable && hasDraftChanges(run) && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() =>
                              exec(`run-log-${run.id}`, async () => {
                                await api.logWorkOrderRun(moId, wo.id, run.id, draftToBody(run.id, run));
                                setDrafts((prev) => ({ ...prev, [run.id]: {} }));
                                onMessage(`Saved batch #${run.batchSeq}.`, "ok");
                              })
                            }
                          >
                            Save
                          </Button>
                        )}
                        {run.status === "running" && (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<CheckCircle2 size={11} />}
                            disabled={busy !== null}
                            onClick={() =>
                              exec(`run-done-${run.id}`, async () => {
                                await api.completeWorkOrderRun(
                                  moId,
                                  wo.id,
                                  run.id,
                                  draftToBody(run.id, run)
                                );
                                setDrafts((prev) => ({ ...prev, [run.id]: {} }));
                                onMessage(`Completed batch #${run.batchSeq} on ${run.machine.code}.`, "ok");
                              })
                            }
                          >
                            Done
                          </Button>
                        )}
                        {run.status === "running" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<X size={11} />}
                            disabled={busy !== null}
                            title="Abandon this run (e.g. machine broke)"
                            onClick={() =>
                              exec(`run-abandon-${run.id}`, async () => {
                                await api.abandonWorkOrderRun(moId, wo.id, run.id);
                                onMessage(`Abandoned ${run.machine.code}.`, "err");
                              })
                            }
                          />
                        )}
                        {(run.status === "queued" || run.status === "abandoned") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={11} />}
                            disabled={busy !== null}
                            onClick={() =>
                              exec(`run-del-${run.id}`, async () => {
                                await api.deleteWorkOrderRun(moId, wo.id, run.id);
                                onMessage(`Removed run on ${run.machine.code}.`, "ok");
                              })
                            }
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                  {bomByproducts.length > 0 && (
                    <tr key={`${run.id}-bp`} className="border-t border-border/50 bg-canvas/30">
                      <td colSpan={colSpan} className="px-2 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
                          By-products {run.status === "complete" ? "(posted)" : "(this batch)"}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {bomByproducts.map((bp) => {
                            if (!bp.id) return null;
                            const posted = run.byproducts?.find(
                              (r) => r.bomByproductId === bp.id && r.posted
                            );
                            return (
                              <label
                                key={bp.id}
                                className="flex items-center gap-2 text-caption min-w-[140px]"
                              >
                                <span className="text-ink-muted truncate max-w-[120px]" title={bpLabel(bp)}>
                                  {bpLabel(bp)}
                                </span>
                                {editable && !posted ? (
                                  <Input
                                    size="sm"
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={runBpQty(run, bp)}
                                    onChange={(e) =>
                                      setDraft(run.id, {
                                        byproducts: {
                                          ...d.byproducts,
                                          [bp.id!]: e.target.value,
                                        },
                                      })
                                    }
                                    className="w-20 text-right"
                                  />
                                ) : (
                                  <span className="font-semibold tabular-nums">
                                    {num(posted?.qty ?? run.byproducts?.find((r) => r.bomByproductId === bp.id)?.qty ?? 0)}{" "}
                                    {bp.uom}
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
              <tr className="border-t border-border font-semibold">
                <td className="px-2 py-1.5">Rollup</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right">{num(wo.plannedSplitQty ?? wo.target)}</td>
                <td className="px-2 py-1.5 text-right">
                  {num(runs.reduce((s, r) => s + (r.inputQty ?? 0), 0))}
                </td>
                <td className="px-2 py-1.5 text-right">{num(totalGood)}</td>
                <td className="px-2 py-1.5 text-right">
                  {num(runs.reduce((s, r) => s + (r.scrapQty ?? 0), 0))}
                </td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {remaining > 0 ? `${num(remaining)} to go` : "Target met"}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Add-run form — only while the step is still open */}
      {wo.status !== "complete" && (
      <div className="mt-2 flex items-end gap-2 flex-wrap pt-2 border-t border-border">
        <div className="min-w-[100px]">
          <label className="text-caption text-ink-muted">Line</label>
          <select
            value={addLineId}
            onChange={(e) => {
              setAddLineId(e.target.value);
              setAddMachineId("");
            }}
            className="h-8 w-full border border-border rounded text-body-sm px-2"
          >
            <option value="">— Any —</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className="text-caption text-ink-muted">Machine</label>
          <select
            value={addMachineId}
            onChange={(e) => setAddMachineId(e.target.value)}
            className="h-8 w-full border border-border rounded text-body-sm px-2"
          >
            <option value="">
              {availableMachines.length === 0 ? "— No machines available —" : "— Pick machine —"}
            </option>
            {availableMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} · {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <label className="text-caption text-ink-muted">Planned</label>
          <Input
            size="sm"
            type="number"
            min={0}
            value={addPlanned}
            onChange={(e) => setAddPlanned(e.target.value)}
            placeholder={remaining > 0 ? num(remaining) : ""}
          />
        </div>
        <Button
          size="sm"
          icon={<Plus size={12} />}
          disabled={!addMachineId || busy !== null}
          onClick={() => void addRun()}
        >
          Add batch
        </Button>
      </div>
      )}
    </div>
  );
};
