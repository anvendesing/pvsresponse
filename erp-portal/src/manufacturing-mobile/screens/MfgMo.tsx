import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type MoRequirements } from "../../lib/api";
import type { ProductionOrder, WorkOrder, WorkOrderRun } from "../../data/types";
import { useDeviceFacility } from "../useDeviceFacility";
import { MaterialRequestModal } from "../components/MaterialRequestModal";

type MachineOption = {
  id: string;
  code: string;
  name: string;
  productionLineId: string;
};

// =====================================================================
// MfgMo — operator view for a single production order
// =====================================================================
// Three big sections:
//   1. Materials   — required vs issued vs shortage, with two ways to
//                    move material to the line WH:
//                      - "Release for production" → backend uses
//                        replenishment rules to auto-create TRFs from
//                        configured source warehouses.
//                      - "Custom request" → operator picks source +
//                        items manually and creates a TRF.
//                    Once stock is at the line WH, "Issue materials"
//                    consumes it against this MO.
//   2. Work orders — list of operations with start / done buttons.
//   3. Log output  — record good / scrap / rework for this batch and
//                    finally "Complete MO" when the run is over.
// All actions hit existing backend endpoints; no new server code.

type Loaded = {
  order: ProductionOrder;
  workOrders: WorkOrder[];
};

const statusLabel: Record<ProductionOrder["status"], string> = {
  planned: "Planned",
  "in-progress": "In progress",
  qc: "Quality check",
  completed: "Completed",
  delayed: "Delayed",
  cancelled: "Cancelled",
};

const statusTone: Record<ProductionOrder["status"], string> = {
  planned: "bg-amber-100 text-amber-900 border-amber-200",
  "in-progress": "bg-emerald-100 text-emerald-900 border-emerald-200",
  qc: "bg-indigo-100 text-indigo-900 border-indigo-200",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
  delayed: "bg-red-100 text-red-900 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

export const MfgMo = () => {
  const { id } = useParams<{ id: string }>();
  const facility = useDeviceFacility();
  const nav = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [requirements, setRequirements] = useState<MoRequirements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);

  // Log-output drawer state
  const [logOpen, setLogOpen] = useState(false);
  const [goodQty, setGoodQty] = useState("");
  const [scrapQty, setScrapQty] = useState("");

  // Machines on this facility — used by the Add machine run picker.
  const [machines, setMachines] = useState<MachineOption[]>([]);
  useEffect(() => {
    if (!facility) return;
    let alive = true;
    api
      .machines({ facilityId: facility.id, active: true })
      .then((rows) => {
        if (!alive) return;
        const opts = (rows as MachineOption[]).map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          productionLineId: m.productionLineId,
        }));
        setMachines(opts);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [facility]);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [d, r] = await Promise.all([
        api.getProductionOrder(id),
        api.productionOrderRequirements(id).catch(() => null),
      ]);
      setData(d);
      setRequirements(r);
    } catch (e) {
      setError((e as Error).message ?? "Could not load MO.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const order = data?.order;
  const wos = data?.workOrders ?? [];

  const totalRequired = useMemo(
    () => requirements?.lines.reduce((s, l) => s + l.required, 0) ?? 0,
    [requirements]
  );
  const totalIssued = useMemo(
    () => requirements?.lines.reduce((s, l) => s + l.issued, 0) ?? 0,
    [requirements]
  );
  const shortageLines = useMemo(
    () => (requirements?.lines ?? []).filter((l) => l.shortage > 0),
    [requirements]
  );
  const anyToIssue = useMemo(
    () => (requirements?.lines ?? []).some((l) => l.stillNeeded > 0),
    [requirements]
  );

  const runAction = async (
    label: string,
    fn: () => Promise<string | void>
  ) => {
    setBusyAction(label);
    setError(null);
    try {
      const msg = await fn();
      if (typeof msg === "string") setToast(msg);
      await load();
    } catch (e) {
      setError((e as Error).message ?? `Failed: ${label}`);
    } finally {
      setBusyAction(null);
    }
  };

  if (!facility) return null;

  if (!order) {
    return (
      <div className="px-4 py-6">
        {error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="text-center text-sm text-slate-500">Loading…</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 pb-6">
      {/* Back + status */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => nav("/mfg/room")}
          className="text-xs text-[#003087] font-medium"
        >
          ← Back to room
        </button>
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${statusTone[order.status]}`}
        >
          {statusLabel[order.status]}
        </span>
      </div>

      {/* Header card */}
      <div className="rounded-xl bg-white border border-slate-200 p-4">
        <div className="text-xs font-mono text-[#003087] font-bold">
          {order.orderNo}
        </div>
        <div className="text-base font-semibold text-slate-800 mt-1">
          {order.product}
          {order.variantSku ? ` · ${order.variantSku}` : ""}
        </div>
        <div className="text-xs text-slate-500 font-mono mt-0.5">
          {order.sku}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Metric label="Planned" value={order.plannedQty} />
          <Metric label="Actual" value={order.actualQty} accent="text-emerald-700" />
          <Metric label="Scrap" value={order.scrapQty} accent={order.scrapQty > 0 ? "text-red-700" : ""} />
        </div>
      </div>

      {toast && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Materials */}
      <section className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Materials</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {requirements?.stockScope === "production_line"
                ? `Stock checked at ${facility.productionLineWarehouseCode ?? "line WH"}`
                : "Stock across all warehouses"}
            </p>
          </div>
          {requirements && (
            <div className="text-right text-[11px] text-slate-500">
              {totalIssued}/{totalRequired} issued
            </div>
          )}
        </header>
        {!requirements ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            Requirements unavailable.
          </div>
        ) : requirements.lines.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            No components on this MO.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requirements.lines.map((l) => {
              const isShort = l.shortage > 0;
              const fullyIssued = l.stillNeeded <= 0;
              return (
                <li key={l.productId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {l.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {l.sku}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-800">
                        {l.required} {l.uom}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        issued {l.issued}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    {fullyIssued ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        ✓ fully issued
                      </span>
                    ) : isShort ? (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200">
                        short by {l.shortage} {l.uom}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        {l.stillNeeded} {l.uom} to issue · {l.free} free
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Material actions */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col gap-2">
          {shortageLines.length > 0 && (
            <>
              <Button
                onClick={() =>
                  runAction("release", async () => {
                    if (!id) return;
                    const r = await api.releaseMo(id);
                    if (r.allMet) return "All materials available — ready to issue.";
                    if (r.transferOrderIds.length > 0)
                      return `Created ${r.transferOrderIds.length} transfer order${r.transferOrderIds.length === 1 ? "" : "s"} from replenishment sources.`;
                    if (r.shortages.length > 0)
                      return `Shortages remain. Use Custom request to pull from a different warehouse.`;
                    return "Release done.";
                  })
                }
                loading={busyAction === "release"}
                variant="primary"
              >
                Release for production → auto-create transfers
              </Button>
              <Button
                onClick={() => setShowRequestModal(true)}
                variant="outline"
              >
                Custom material request…
              </Button>
            </>
          )}
          {anyToIssue && shortageLines.length === 0 && (
            <Button
              onClick={() =>
                runAction("issue", async () => {
                  if (!id) return;
                  const res = await api.issueMaterials(id, {
                    warehouseId: facility.productionLineWarehouseId ?? undefined,
                  });
                  if (res.anyShort) return "Issued partial materials (some shortages).";
                  return "Materials issued to MO.";
                })
              }
              loading={busyAction === "issue"}
              variant="primary"
            >
              Issue materials to this MO
            </Button>
          )}
          {!anyToIssue && requirements && requirements.lines.length > 0 && (
            <div className="text-center text-xs text-emerald-700 font-medium py-1">
              ✓ All materials issued
            </div>
          )}
        </div>
      </section>

      {/* Work orders */}
      <section className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Work orders</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {wos.length === 0
              ? "This MO has no operations defined."
              : "Tap Start when you begin, Done when finished."}
          </p>
        </header>
        {requirements && !requirements.materialsIssued && wos.length > 0 && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900">
            Issue materials first — work orders are locked until then.
          </div>
        )}
        {wos.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {wos.map((wo) => (
              <WorkOrderRow
                key={wo.id}
                wo={wo}
                moId={id ?? ""}
                busy={busyAction?.startsWith(`wo-${wo.id}`) ?? false}
                busyKey={busyAction}
                materialsIssued={requirements?.materialsIssued ?? true}
                machines={machines}
                onAction={(label, fn) => runAction(label, fn)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Log output */}
      <section className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <button
          onClick={() => setLogOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <span className="text-sm font-semibold text-slate-800">
            Log batch output
          </span>
          <span className="text-xs text-slate-500">{logOpen ? "Hide" : "Show"}</span>
        </button>
        {logOpen && (
          <div className="px-4 pb-4 pt-1 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">
                  Good qty
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={goodQty}
                  onChange={(e) => setGoodQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">
                  Scrap qty
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={scrapQty}
                  onChange={(e) => setScrapQty(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
                />
              </label>
            </div>
            <Button
              onClick={() =>
                runAction("logOutput", async () => {
                  if (!id) return;
                  const g = Number(goodQty);
                  const s = Number(scrapQty);
                  if (!g && !s) return "Enter at least one quantity.";
                  await api.logOutput(id, {
                    goodQty: g > 0 ? g : undefined,
                    scrapQty: s > 0 ? s : undefined,
                  });
                  setGoodQty("");
                  setScrapQty("");
                  setLogOpen(false);
                  return "Batch logged.";
                })
              }
              loading={busyAction === "logOutput"}
              variant="primary"
            >
              Log batch
            </Button>
          </div>
        )}
      </section>

      {/* Complete MO */}
      {order.status !== "completed" && order.status !== "cancelled" && (
        <div className="pt-2">
          <Button
            onClick={() => {
              if (
                !confirm(
                  `Complete MO ${order.orderNo}? This will post the final yield (${order.actualQty}/${order.plannedQty}) to inventory.`
                )
              )
                return;
              void runAction("complete", async () => {
                if (!id) return;
                await api.completeProductionOrder(id);
                return "MO completed and yield posted.";
              });
            }}
            loading={busyAction === "complete"}
            variant="success"
          >
            Complete MO
          </Button>
        </div>
      )}

      <div className="pt-1 text-center">
        <Link
          to={`/mfg/transfers?moId=${order.id}`}
          className="text-xs text-[#003087] underline"
        >
          View transfer orders for this MO
        </Link>
      </div>

      {showRequestModal && requirements && (
        <MaterialRequestModal
          mo={order}
          facility={facility}
          requirements={requirements}
          onClose={() => setShowRequestModal(false)}
          onCreated={(transferNo) => {
            setShowRequestModal(false);
            setToast(`Transfer ${transferNo} created.`);
            void load();
          }}
        />
      )}
    </div>
  );
};

// --- Small UI helpers ------------------------------------------------

const Metric = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-slate-500">
      {label}
    </div>
    <div className={`text-lg font-bold ${accent ?? "text-slate-800"}`}>
      {value}
    </div>
  </div>
);

const Button = ({
  onClick,
  loading,
  variant,
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  variant: "primary" | "outline" | "success" | "danger";
  children: React.ReactNode;
}) => {
  const cls =
    variant === "primary"
      ? "bg-[#003087] text-white"
      : variant === "outline"
        ? "bg-white text-[#003087] border border-[#003087]"
        : variant === "success"
          ? "bg-emerald-600 text-white"
          : "bg-red-600 text-white";
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-opacity ${cls} ${
        loading ? "opacity-60" : "active:opacity-90"
      }`}
    >
      {loading ? "Working…" : children}
    </button>
  );
};

const WorkOrderRow = ({
  wo,
  moId,
  busy,
  busyKey,
  materialsIssued,
  machines,
  onAction,
}: {
  wo: WorkOrder;
  moId: string;
  busy: boolean;
  busyKey: string | null;
  materialsIssued: boolean;
  machines: MachineOption[];
  onAction: (label: string, fn: () => Promise<string | void>) => void;
}) => {
  const isRunning = wo.status === "running";
  const isComplete = wo.status === "complete";
  const isReady = wo.status === "ready" || wo.status === "queued";
  const isWaiting = wo.status === "waiting";
  const seqLabel = wo.bomOperation?.seq ? `Op ${wo.bomOperation.seq}` : "Op";
  const locked = !materialsIssued && (isReady || isRunning);
  const runs = wo.runs ?? [];
  const hasRuns = runs.length > 0;
  const [showRuns, setShowRuns] = useState(hasRuns);

  // When in run-mode the WO badge shows the rollup target, and Start /
  // Done buttons collapse — operator interacts with each machine run
  // directly.
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800 truncate">
            {seqLabel}: {wo.bomOperation?.name ?? wo.station ?? "Operation"}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {wo.machine || (hasRuns ? `${runs.length} machine${runs.length === 1 ? "" : "s"}` : "no machine")} · {wo.output}/{wo.target}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isComplete ? (
            <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              ✓ done
            </span>
          ) : isRunning && !hasRuns ? (
            <button
              onClick={() =>
                onAction(`wo-${wo.id}-done`, async () => {
                  await api.completeMoWorkOrder(moId, wo.id);
                  return "Work order marked done.";
                })
              }
              disabled={busy || locked}
              title={locked ? "Issue materials to the MO first." : undefined}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busyKey === `wo-${wo.id}-done` ? "…" : locked ? "Locked" : "Done"}
            </button>
          ) : isReady && !hasRuns ? (
            <button
              onClick={() =>
                onAction(`wo-${wo.id}-start`, async () => {
                  await api.startMoWorkOrder(moId, wo.id);
                  return "Work order started.";
                })
              }
              disabled={busy || locked}
              title={locked ? "Issue materials to the MO first." : undefined}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#003087] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busyKey === `wo-${wo.id}-start` ? "…" : locked ? "Locked" : "Start"}
            </button>
          ) : isWaiting ? (
            <span className="text-[11px] text-slate-500 italic">
              waiting on previous op
            </span>
          ) : !hasRuns ? (
            <span className="text-[11px] text-slate-500 italic">
              {wo.status}
            </span>
          ) : null}
        </div>
      </div>

      {/* Runs toggle / panel: always available unless WO is waiting or complete. */}
      {!isWaiting && !isComplete && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowRuns((v) => !v)}
            className="text-[11px] text-[#003087] font-medium underline"
          >
            {showRuns ? "Hide" : "Show"} machine runs
            {hasRuns ? ` (${runs.length})` : ""}
          </button>
          {showRuns && (
            <WoRunsPanel
              wo={wo}
              moId={moId}
              busy={busy}
              busyKey={busyKey}
              locked={locked}
              machines={machines}
              onAction={onAction}
            />
          )}
        </div>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------
// Multi-machine parallel runs panel (mobile)
// ---------------------------------------------------------------------
const WoRunsPanel = ({
  wo,
  moId,
  busy,
  busyKey,
  locked,
  machines,
  onAction,
}: {
  wo: WorkOrder;
  moId: string;
  busy: boolean;
  busyKey: string | null;
  locked: boolean;
  machines: MachineOption[];
  onAction: (label: string, fn: () => Promise<string | void>) => void;
}) => {
  const runs = wo.runs ?? [];
  const usedMachineIds = new Set(
    runs.filter((r) => r.status !== "abandoned").map((r) => r.machineId)
  );
  const target = wo.plannedSplitQty ?? wo.target;
  const totalGood = runs.reduce((s, r) => s + (r.goodQty ?? 0), 0);
  const remaining = Math.max(0, target - totalGood);
  const available = machines.filter((m) => !usedMachineIds.has(m.id));

  const [addMachineId, setAddMachineId] = useState("");
  const [addPlanned, setAddPlanned] = useState("");

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      {runs.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-slate-500">
          No machine runs yet. Add one below to log this step across multiple
          machines in parallel.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              woId={wo.id}
              moId={moId}
              busy={busy}
              busyKey={busyKey}
              locked={locked}
              onAction={onAction}
            />
          ))}
          <li className="px-3 py-2 text-[11px] text-slate-600 bg-slate-100 flex items-center justify-between">
            <span className="font-medium">Rollup</span>
            <span>
              good <b>{totalGood}</b> / target <b>{target}</b> ·{" "}
              {remaining > 0 ? `${remaining} to go` : "target met"}
            </span>
          </li>
        </ul>
      )}

      {/* Add run */}
      <div className="px-3 py-2 border-t border-slate-200 bg-white space-y-2">
        <div className="flex items-end gap-2">
          <label className="flex-1 block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              Machine
            </span>
            <select
              value={addMachineId}
              onChange={(e) => setAddMachineId(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white"
            >
              <option value="">
                {available.length === 0
                  ? "— No machine available —"
                  : "— Pick machine —"}
              </option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="w-20 block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              Plan
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={addPlanned}
              onChange={(e) => setAddPlanned(e.target.value)}
              placeholder={remaining > 0 ? String(remaining) : ""}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!addMachineId || busy}
          onClick={() =>
            onAction(`wo-${wo.id}-add`, async () => {
              const m = machines.find((x) => x.id === addMachineId);
              await api.addWorkOrderRun(moId, wo.id, {
                machineId: addMachineId,
                lineId: m?.productionLineId ?? null,
                plannedQty: addPlanned ? parseFloat(addPlanned) : null,
              });
              setAddMachineId("");
              setAddPlanned("");
              return "Machine run added.";
            })
          }
          className="w-full rounded-lg px-3 py-2 text-sm font-semibold bg-[#003087] text-white disabled:opacity-50"
        >
          {busyKey === `wo-${wo.id}-add` ? "Adding…" : "+ Add machine run"}
        </button>
      </div>
    </div>
  );
};

const RunRow = ({
  run,
  woId,
  moId,
  busy,
  busyKey,
  locked,
  onAction,
}: {
  run: WorkOrderRun;
  woId: string;
  moId: string;
  busy: boolean;
  busyKey: string | null;
  locked: boolean;
  onAction: (label: string, fn: () => Promise<string | void>) => void;
}) => {
  const [draftGood, setDraftGood] = useState("");
  const [draftScrap, setDraftScrap] = useState("");
  const editable = run.status === "queued" || run.status === "running";
  const isQueued = run.status === "queued";
  const isRunning = run.status === "running";
  const isComplete = run.status === "complete";
  const isAbandoned = run.status === "abandoned";

  const tone = isComplete
    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : isRunning
      ? "bg-[#003087]/10 text-[#003087] border-[#003087]/30"
      : isAbandoned
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";

  const fmtTime = () => {
    if (!run.startTime) return null;
    const start = new Date(run.startTime);
    const end = run.endTime ? new Date(run.endTime) : null;
    const min = Math.max(
      0,
      Math.round(((end ? end.getTime() : Date.now()) - start.getTime()) / 60000)
    );
    return `${min}m${end ? "" : " (running)"}`;
  };

  const draftBody = () => {
    const body: { goodQty?: number; scrapQty?: number } = {};
    if (draftGood !== "") body.goodQty = parseFloat(draftGood) || 0;
    if (draftScrap !== "") body.scrapQty = parseFloat(draftScrap) || 0;
    return body;
  };

  return (
    <li className="px-3 py-2 bg-white">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-mono font-bold text-[#003087] truncate">
            {run.machine.code}
          </div>
          <div className="text-[10px] text-slate-500 truncate">
            {run.machine.name}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${tone}`}
        >
          {run.status === "running"
            ? "Running"
            : run.status.charAt(0).toUpperCase() + run.status.slice(1)}
        </span>
      </div>

      {/* qty grid */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-slate-500">Plan</div>
          <div className="font-semibold text-slate-800">
            {run.plannedQty ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Good</div>
          <div className="font-semibold text-emerald-700">{run.goodQty}</div>
        </div>
        <div>
          <div className="text-slate-500">Scrap</div>
          <div
            className={`font-semibold ${run.scrapQty > 0 ? "text-red-700" : "text-slate-700"}`}
          >
            {run.scrapQty}
          </div>
        </div>
      </div>

      {fmtTime() && (
        <div className="mt-1 text-[10px] text-slate-500">{fmtTime()}</div>
      )}

      {/* editable qty inputs only when editable */}
      {editable && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              + Good
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={draftGood}
              onChange={(e) => setDraftGood(e.target.value)}
              placeholder={String(run.goodQty)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              + Scrap
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={draftScrap}
              onChange={(e) => setDraftScrap(e.target.value)}
              placeholder={String(run.scrapQty)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      {/* action buttons */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {isQueued && (
          <button
            onClick={() =>
              onAction(`wo-${woId}-run-${run.id}-start`, async () => {
                await api.startWorkOrderRun(moId, woId, run.id);
                return `${run.machine.code} started.`;
              })
            }
            disabled={busy || locked}
            title={locked ? "Issue materials first." : undefined}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#003087] text-white disabled:opacity-50"
          >
            {busyKey === `wo-${woId}-run-${run.id}-start` ? "…" : "Start"}
          </button>
        )}
        {editable && (draftGood !== "" || draftScrap !== "") && (
          <button
            onClick={() =>
              onAction(`wo-${woId}-run-${run.id}-log`, async () => {
                const body = draftBody();
                // Add deltas to current values so operators can type
                // "the last batch I produced" rather than re-typing totals.
                if (body.goodQty !== undefined)
                  body.goodQty = run.goodQty + body.goodQty;
                if (body.scrapQty !== undefined)
                  body.scrapQty = run.scrapQty + body.scrapQty;
                await api.logWorkOrderRun(moId, woId, run.id, body);
                setDraftGood("");
                setDraftScrap("");
                return `${run.machine.code} logged.`;
              })
            }
            disabled={busy}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-[#003087] text-[#003087] disabled:opacity-50"
          >
            {busyKey === `wo-${woId}-run-${run.id}-log` ? "…" : "Save"}
          </button>
        )}
        {isRunning && (
          <button
            onClick={() =>
              onAction(`wo-${woId}-run-${run.id}-done`, async () => {
                const body = draftBody();
                if (body.goodQty !== undefined)
                  body.goodQty = run.goodQty + body.goodQty;
                if (body.scrapQty !== undefined)
                  body.scrapQty = run.scrapQty + body.scrapQty;
                await api.completeWorkOrderRun(moId, woId, run.id, body);
                setDraftGood("");
                setDraftScrap("");
                return `${run.machine.code} done.`;
              })
            }
            disabled={busy}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
          >
            {busyKey === `wo-${woId}-run-${run.id}-done` ? "…" : "Done"}
          </button>
        )}
        {isRunning && (
          <button
            onClick={() =>
              onAction(`wo-${woId}-run-${run.id}-abandon`, async () => {
                if (!confirm(`Abandon ${run.machine.code}? (e.g. machine broke)`)) return;
                await api.abandonWorkOrderRun(moId, woId, run.id);
                return `${run.machine.code} abandoned.`;
              })
            }
            disabled={busy}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 disabled:opacity-50"
          >
            Abandon
          </button>
        )}
        {(isQueued || isAbandoned) && (
          <button
            onClick={() =>
              onAction(`wo-${woId}-run-${run.id}-del`, async () => {
                await api.deleteWorkOrderRun(moId, woId, run.id);
                return `${run.machine.code} removed.`;
              })
            }
            disabled={busy}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-red-300 text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
};
