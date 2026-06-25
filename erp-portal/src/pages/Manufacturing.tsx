import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  BarChart2,
  CheckCircle2,
  ClipboardList,
  Factory,
  GitBranch,
  MapPin,
  Network,
  Package,
  PackageCheck,
  Play,
  Plus,
  RotateCcw,
  TrendingUp,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { Kpi } from "@/components/common/Kpi";
import { CollapsibleStats } from "@/components/common/CollapsibleStats";
import { Toolbar } from "@/components/common/Toolbar";
import {
  api,
  type MoInventoryTrail,
  type MoRequirements,
  type TransferOrderRow,
} from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { EmptyState } from "@/components/common/EmptyState";
import type { Bom, ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { dd, num } from "@/lib/format";
import { moPrimaryLabel, moSecondaryLabel } from "@/lib/mo-display";
import { NewMoModal } from "@/components/manufacturing/NewMoModal";
import { CorrectOutputModal } from "@/components/manufacturing/CorrectOutputModal";
import { LogOutputModal } from "@/components/manufacturing/LogOutputModal";
import { AssignLineModal } from "@/components/manufacturing/AssignLineModal";
import { MoWorkOrdersPanel } from "@/components/manufacturing/MoWorkOrdersPanel";

const statusTone = (s: ProductionOrder["status"]) => {
  switch (s) {
    case "completed":
      return "success" as const;
    case "in-progress":
      return "primary" as const;
    case "qc":
      return "info" as const;
    case "delayed":
      return "danger" as const;
    case "planned":
      return "neutral" as const;
    case "cancelled":
      return "neutral" as const;
  }
};

export const Manufacturing = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const liveMo = useApi(() => api.productionOrdersWithWO(), []);
  const liveBoms = useApi(() => api.boms(), []);
  const liveWorkers = useApi(() => api.workers(), []);
  // Live per-WorkCenter rollup with machines + active orders. Drives
  // the right-rail "Production lines" panel; replaces the seeded mock
  // machine list that used to ship in this page.
  const liveLines = useApi(() => api.productionLinesReport(), []);

  const productionOrders = liveMo.data?.orders ?? [];
  const workOrders = liveMo.data?.workOrders ?? [];
  const boms = liveBoms.data ?? [];
  const workers = liveWorkers.data ?? [];
  const lines = liveLines.data?.lines ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deep-link: /manufacturing?moId=… selects that MO in the list.
  useEffect(() => {
    const moId = searchParams.get("moId");
    if (!moId) return;
    setSelectedId(moId);
    const next = new URLSearchParams(searchParams);
    next.delete("moId");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  // Tabs: Orders = active MOs you're working on right now, History =
  // closed (completed/cancelled) MOs kept available for lookup without
  // cluttering the active rail, Productivity = plant/line dashboard.
  const [activeTab, setActiveTab] = useState<"orders" | "history" | "productivity">(
    "orders"
  );
  const [showNewMo, setShowNewMo] = useState(false);
  const [showCorrect, setShowCorrect] = useState(false);
  const [showLogOutput, setShowLogOutput] = useState(false);
  const [showAssignLine, setShowAssignLine] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Live requirements (direct BOM components + on-hand) for the
  // currently-selected MO. Refreshed when the selection or output
  // counts change.
  const [requirements, setRequirements] = useState<MoRequirements | null>(null);
  // Transfer orders linked to the currently-selected MO.
  const [linkedTOs, setLinkedTOs] = useState<TransferOrderRow[]>([]);
  const [inventoryTrail, setInventoryTrail] = useState<MoInventoryTrail | null>(
    null
  );

  const refreshAll = async () => {
    liveMo.refetch();
    liveBoms.refetch();
    liveLines.refetch();
  };

  const refreshRequirements = async (orderId: string) => {
    const r = await api.productionOrderRequirements(orderId);
    setRequirements(r);
    return r;
  };

  const refreshInventoryTrail = async (orderId: string) => {
    const t = await api.productionOrderInventoryTrail(orderId);
    setInventoryTrail(t);
    return t;
  };

  const loading = liveMo.loading || liveBoms.loading || liveWorkers.loading;
  const errorObj = liveMo.error ?? liveBoms.error ?? liveWorkers.error;

  // Newest-first ordering by orderNo desc (MO-YYYY-NNNN is monotonic
  // per year). Falls back to startDate when orderNo ties — belt and
  // braces. Used for both the Active rail and History rail below.
  const ordersNewestFirst = useMemo(() => {
    const arr = [...productionOrders];
    arr.sort((a, b) => {
      if (a.orderNo !== b.orderNo) return b.orderNo.localeCompare(a.orderNo);
      return (b.startDate ?? "").localeCompare(a.startDate ?? "");
    });
    return arr;
  }, [productionOrders]);

  // "Closed" = lifecycle dead-ends (completed, cancelled). Everything
  // else is still actionable and stays in Active.
  const isClosedStatus = (s: ProductionOrder["status"]): boolean =>
    s === "completed" || (s as string) === "cancelled";

  const activeOrders = useMemo(
    () => ordersNewestFirst.filter((p) => !isClosedStatus(p.status)),
    [ordersNewestFirst]
  );
  const closedOrders = useMemo(
    () => ordersNewestFirst.filter((p) => isClosedStatus(p.status)),
    [ordersNewestFirst]
  );

  // Left rail follows the active top tab. Productivity reuses the
  // Active rail so users can still jump straight to an in-flight MO.
  const railOrders = activeTab === "history" ? closedOrders : activeOrders;
  const railLabel = activeTab === "history" ? "Closed Orders" : "Active Orders";

  // Detail pane follows the left rail only — never show a completed MO
  // on the Active tab because selectedId still points at it.
  const order = useMemo(() => {
    if (selectedId) {
      const picked = railOrders.find((p) => p.id === selectedId);
      if (picked) return picked;
    }
    return railOrders[0] ?? null;
  }, [selectedId, railOrders]);

  // Fetch requirements + linked TOs when the selected MO changes.
  useEffect(() => {
    if (!order) {
      setRequirements(null);
      setLinkedTOs([]);
      setInventoryTrail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [r, tos, trail] = await Promise.all([
          api.productionOrderRequirements(order.id),
          api.transferOrders({ productionOrderId: order.id }),
          api.productionOrderInventoryTrail(order.id),
        ]);
        if (!cancelled) {
          setRequirements(r);
          setLinkedTOs(tos);
          setInventoryTrail(trail);
        }
      } catch (e) {
        if (!cancelled) setErrBanner((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order?.id, order?.actualQty, order?.status]);

  // IMPORTANT: every hook must run on every render or React throws
  // "Rendered fewer hooks than expected". Keep this useMemo (and any
  // future hooks) above the loading/empty early-return below.
  const completion = useMemo(() => {
    if (!order || !order.plannedQty) return 0;
    return Math.round((order.actualQty / order.plannedQty) * 100);
  }, [order]);

  const activeBoms = boms.filter((b) => b.active);
  const isEmpty = !loading && !errorObj && productionOrders.length === 0;

  // Keep selection aligned with the visible rail. Clear when empty.
  useEffect(() => {
    if (railOrders.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !railOrders.some((p) => p.id === selectedId)) {
      setSelectedId(railOrders[0].id);
    }
  }, [activeTab, railOrders, selectedId]);

  const moToolbar = (
    <Toolbar
      left={<h2 className="text-h3 font-bold">Manufacturing</h2>}
      right={
        <>
          <Button
            variant="outline"
            size="sm"
            icon={<BarChart2 size={14} />}
            onClick={() => navigate("/manufacturing/log")}
          >
            Production Log
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Network size={14} />}
            onClick={() => navigate("/manufacturing/boms")}
          >
            Manage BOMs
          </Button>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setShowNewMo(true)}
            disabled={activeBoms.length === 0}
            title={
              activeBoms.length === 0
                ? "Create an active BOM before starting a manufacturing order"
                : undefined
            }
          >
            New Order
          </Button>
        </>
      }
    />
  );

  const newMoModal = showNewMo ? (
    <NewMoModal
      boms={boms}
      onClose={() => setShowNewMo(false)}
      onCreated={(orderNo, productionOrderId) => {
        setShowNewMo(false);
        setSelectedId(productionOrderId);
        setOkBanner(`MO ${orderNo} created.`);
        void liveMo.refetch();
      }}
    />
  ) : null;

  if (loading || errorObj) {
    return (
      <div className="h-full flex flex-col">
        {moToolbar}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            loading={loading}
            error={errorObj}
            onRetry={() => {
              liveMo.refetch();
              liveBoms.refetch();
              liveWorkers.refetch();
            }}
          />
        </div>
        {newMoModal}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="h-full flex flex-col">
        {moToolbar}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            empty
            emptyTitle="No production orders"
            emptyDescription={
              activeBoms.length === 0
                ? "You need at least one active BOM before you can create a manufacturing order."
                : "Create your first manufacturing order from a BOM, or open New Order in the toolbar."
            }
            action={
              <>
                <Button
                  size="sm"
                  icon={<Plus size={14} />}
                  onClick={() => setShowNewMo(true)}
                  disabled={activeBoms.length === 0}
                >
                  New manufacturing order
                </Button>
                {activeBoms.length === 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Network size={14} />}
                    onClick={() => navigate("/manufacturing/boms/new")}
                  >
                    Create BOM
                  </Button>
                ) : null}
              </>
            }
          />
        </div>
        {newMoModal}
      </div>
    );
  }
  const wos = order ? workOrders.filter((w) => w.productionOrderId === order.id) : [];
  const wosNeedLine = wos.some(
    (w) =>
      !w.lineId &&
      w.status !== "complete" &&
      w.status !== "running"
  );
  // BOMs may not have loaded (or none exist) - never crash on
  // bom.product / bom.revision; the requirements card already has
  // its own empty state for the missing data.
  const bom = order ? boms.find((b) => b.sku === order.sku) ?? boms[0] : boms[0];

  const totalActual = productionOrders.reduce((s, p) => s + p.actualQty, 0);
  const totalPlanned = productionOrders.reduce((s, p) => s + p.plannedQty, 0);
  const eff = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;
  const inProgress = productionOrders.filter((p) => p.status === "in-progress").length;
  const delayed = productionOrders.filter((p) => p.status === "delayed").length;

  const moComplete = order?.status === "completed";
  const moCancelled = order ? (order.status as string) === "cancelled" : false;
  const canRelease = order?.status === "planned";
  const canIssue =
    !moComplete && !moCancelled && !(requirements?.allFullyIssued ?? false);
  const canLogOutput =
    !!order &&
    !moComplete &&
    !moCancelled &&
    (order.status === "in-progress" || order.status === "qc");
  const releaseTitle = canRelease
    ? "Check material availability at production line and create replenishment transfers if short"
    : order
      ? `Release only applies while MO is planned (current: ${order.status})`
      : "";
  const issueTitle = requirements?.allFullyIssued
    ? "All BOM materials are already issued for this MO"
    : moComplete
      ? "MO is completed"
      : "Consume raw materials from bins per BOM explosion";

  // ---- MO actions ------------------------------------------------
  const onIssueMaterials = async () => {
    if (!order) return;
    setBusy("issue");
    try {
      const res = await api.issueMaterials(order.id, { allowShort: true });
      const totals = res.issued.reduce(
        (acc, l) => ({
          requested: acc.requested + l.requested,
          issued: acc.issued + l.issued,
        }),
        { requested: 0, issued: 0 }
      );
      setOkBanner(
        res.anyShort
          ? `Issued ${num(totals.issued)} of ${num(totals.requested)} units. Some lines are short - check the requirements panel.`
          : `Issued all ${num(totals.issued)} units across ${res.issued.length} components.`
      );
      await refreshAll();
      await Promise.all([
        refreshRequirements(order.id),
        refreshInventoryTrail(order.id),
      ]);
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onLogOutput = () => setShowLogOutput(true);

  const onReleaseMo = async () => {
    if (!order) return;
    setBusy("release");
    try {
      const res = await api.releaseMo(order.id);
      if (res.allMet) {
        setOkBanner(`MO ${order.orderNo} released. All materials available at production line.`);
      } else {
        setOkBanner(
          `MO ${order.orderNo} released. ${res.shortages.length} shortage(s) found. ${res.transferOrderIds.length} replenishment transfer(s) created.`
        );
      }
      await refreshAll();
      await Promise.all([
        refreshRequirements(order.id),
        refreshInventoryTrail(order.id),
      ]);
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCompleteMo = async () => {
    if (!order) return;
    if (
      !confirm(
        `Complete ${order.orderNo}? Finished goods (${num(order.actualQty)}) will be posted to inventory.`
      )
    )
      return;
    setBusy("complete");
    try {
      const res = await api.completeProductionOrder(order.id);
      const toMsg = res.putawayTransferOrderId
        ? " Putaway transfer order created."
        : "";
      setOkBanner(
        res.putaway
          ? `MO ${order.orderNo} closed. ${num(res.putaway.qty)} posted to production-line bin.${toMsg}`
          : `MO ${order.orderNo} closed. (No FG bin available - transfer manually.)`
      );
      await refreshAll();
      await Promise.all([
        refreshRequirements(order.id),
        refreshInventoryTrail(order.id),
      ]);
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCancelMo = async () => {
    if (!order) return;
    if (
      !confirm(
        `Cancel ${order.orderNo}? Linked replenishment transfers will be cancelled and any issued materials will be returned to bins.`
      )
    )
      return;
    setBusy("cancel");
    try {
      const res = await api.cancelMo(order.id);
      const parts = [
        res.transfersCancelled > 0
          ? `${res.transfersCancelled} transfer(s) cancelled`
          : null,
        res.issuesReversed > 0
          ? `${res.issuesReversed} material issue(s) reversed`
          : null,
      ].filter(Boolean);
      setOkBanner(
        parts.length > 0
          ? `MO ${res.orderNo} cancelled. ${parts.join("; ")}.`
          : `MO ${res.orderNo} cancelled.`
      );
      setActiveTab("history");
      await refreshAll();
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const locLabel = (
    whCode: string,
    whKind: string,
    binPath: string
  ) => `${whCode} (${whKind}) · ${binPath}`;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar
        left={
          <>
            <h2 className="text-h3 font-bold mr-2">Manufacturing</h2>
            <Chip tone="primary" icon={<Factory size={12} />}>4 lines active</Chip>
          </>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Network size={14} />}
              onClick={() => navigate("/manufacturing/boms")}
            >
              Manage BOMs
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setShowNewMo(true)}
            >
              New Order · F2
            </Button>
          </>
        }
      />

      {(okBanner || errBanner) && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm flex items-center gap-2",
            okBanner
              ? "bg-success-soft border-success text-success"
              : "bg-danger-soft border-danger text-danger"
          )}
        >
          {okBanner ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span className="flex-1">{okBanner ?? errBanner}</span>
          <button
            className="underline text-caption"
            onClick={() => {
              setOkBanner(null);
              setErrBanner(null);
            }}
          >
            dismiss
          </button>
        </div>
      )}

      <CollapsibleStats
        storageKey="manufacturing"
        summary={
          <>
            Efficiency {eff.toFixed(1)}% · {inProgress} in-progress · {delayed} delayed · output {num(totalActual)} / target {num(totalPlanned)}
          </>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Plant Efficiency" value={`${eff.toFixed(1)}%`} delta={1.2} icon={<TrendingUp size={14} />} accent="success" />
          <Kpi label="In Progress" value={String(inProgress)} deltaSuffix="" delta={1} icon={<Play size={14} />} accent="primary" />
          <Kpi label="Delayed" value={String(delayed)} deltaSuffix="" delta={-1} icon={<AlertTriangle size={14} />} accent="danger" />
          <Kpi label="Output Today" value={num(totalActual)} delta={6.4} accent="primary" hint={`Target ${num(totalPlanned)}`} />
        </div>
      </CollapsibleStats>

      {/* Tab bar */}
      <div className="border-b border-border bg-surface flex items-center px-4 gap-1 shrink-0">
        {(
          [
            {
              id: "orders",
              label: "Orders",
              icon: <ClipboardList size={13} />,
              count: activeOrders.length,
            },
            {
              id: "history",
              label: "History",
              icon: <CheckCircle2 size={13} />,
              count: closedOrders.length,
            },
            {
              id: "productivity",
              label: "Productivity",
              icon: <BarChart2 size={13} />,
              count: null as number | null,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-body-sm border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-ink-muted hover:text-ink"
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && (
              <span
                className={cn(
                  "ml-1 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tnum",
                  activeTab === tab.id
                    ? "bg-primary text-white"
                    : "bg-canvas text-ink-muted"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">
        {/* Left: orders list — content depends on which top tab is
            active (Active vs Closed). Newest-first within each list. */}
        <aside className="col-span-3 bg-surface border-r border-border flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
            <span className="text-body-sm font-bold">{railLabel}</span>
            <Chip size="sm" tone="neutral">{railOrders.length}</Chip>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {railOrders.length === 0 && (
              <div className="px-3 py-6 text-center text-caption text-ink-muted">
                {activeTab === "history"
                  ? "No closed orders yet. Completed MOs land here."
                  : "No active orders. Use \"New MO\" to create one."}
              </div>
            )}
            {railOrders.map((p) => {
              const sel = p.id === selectedId;
              const pct = Math.round((p.actualQty / p.plannedQty) * 100);
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors",
                    sel ? "bg-primary-50" : "hover:bg-canvas"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-caption font-semibold text-primary">
                      {p.orderNo}
                    </span>
                    <Chip tone={statusTone(p.status)} size="sm">
                      {p.status}
                    </Chip>
                  </div>
                  <div className="text-body-sm font-semibold mt-1 truncate">{moPrimaryLabel(p)}</div>
                  {p.variantSku && (
                    <div className="text-caption text-ink-muted truncate">{moSecondaryLabel(p)}</div>
                  )}
                  <div className="text-caption text-ink-muted flex items-center justify-between mt-1">
                    <span className="truncate max-w-[60%]">
                      {p.facility?.name ?? p.station ?? "—"}
                      {p.lineId === null && !isClosedStatus(p.status) && (
                        <span className="ml-1 text-warning font-semibold">· awaiting line</span>
                      )}
                      {p.line && (
                        <span className="text-ink-muted"> · {p.line.name}</span>
                      )}
                    </span>
                    <span className="tnum">{num(p.actualQty)}/{num(p.plannedQty)}</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-canvas rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        p.status === "delayed"
                          ? "bg-danger"
                          : p.status === "completed"
                            ? "bg-success"
                            : "bg-primary"
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right side: swaps between Orders detail and Productivity.
            History reuses the order-detail layout so closed MOs render
            with the same context (work orders, requirements, trail). */}
        <div className="col-span-9 flex flex-col min-h-0 overflow-y-auto">
          {(activeTab === "orders" || activeTab === "history") &&
            (order ? (
            <div className="p-4 space-y-4">
            <Card
              title={
                <div className="flex items-center gap-2">
                  <span className="font-mono text-caption text-ink-muted">{order.orderNo}</span>
                  <span>{moPrimaryLabel(order)}</span>
                </div>
              }
              subtitle={
                <span>
                  {moSecondaryLabel(order)} ·{" "}
                  {order.facility?.name ?? order.station ?? "—"}
                  {wosNeedLine && !isClosedStatus(order.status) ? (
                    <span className="ml-1 text-warning font-semibold">awaiting line / machine</span>
                  ) : order.line ? (
                    <span className="text-ink-muted"> › {order.line.name}</span>
                  ) : null}
                  {" · "}Due {dd(order.dueDate)}
                </span>
              }
              actions={
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip tone={statusTone(order.status)}>{order.status}</Chip>
                  {!isClosedStatus(order.status) && (
                    <>
                  {(wosNeedLine || order.lineId === null) && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<GitBranch size={14} />}
                        onClick={() => setShowAssignLine(true)}
                        title="Assign production lines and machines to work orders"
                      >
                        Assign line / machine
                      </Button>
                    )}
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<ArrowRightLeft size={14} />}
                    onClick={onReleaseMo}
                    disabled={busy === "release" || !canRelease}
                    title={releaseTitle}
                  >
                    {busy === "release" ? "Releasing…" : "Release"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<PackageCheck size={14} />}
                    onClick={onIssueMaterials}
                    disabled={busy === "issue" || !canIssue}
                    title={issueTitle}
                  >
                    {busy === "issue" ? "Issuing…" : "Issue materials"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Plus size={14} />}
                    onClick={onLogOutput}
                    disabled={!canLogOutput}
                    title={
                      canLogOutput
                        ? "Record good and scrap qty for this batch"
                        : "Log output after materials are issued (MO in progress)"
                    }
                  >
                    Log output
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<RotateCcw size={14} />}
                    onClick={() => setShowCorrect(true)}
                    disabled={
                      order.actualQty === 0 &&
                      order.scrapQty === 0 &&
                      order.reworkQty === 0
                    }
                    title="Fix wrong-logged totals (e.g. Log output clicked twice)"
                  >
                    Correct
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<XCircle size={14} />}
                    onClick={onCancelMo}
                    disabled={busy === "cancel"}
                    title="Cancel MO, reverse issued materials, and cancel replenishment transfers"
                  >
                    {busy === "cancel" ? "Cancelling…" : "Cancel MO"}
                  </Button>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    onClick={onCompleteMo}
                    disabled={
                      busy === "complete" ||
                      order.actualQty <= 0
                    }
                  >
                    {busy === "complete" ? "Closing…" : "Complete · F8"}
                  </Button>
                    </>
                  )}
                </div>
              }
              accent="primary"
            >
              <div className="grid grid-cols-4 gap-3">
                <BigStat label="Planned" value={num(order.plannedQty)} />
                <BigStat label="Actual" value={num(order.actualQty)} tone="primary" />
                <BigStat label="Scrap" value={num(order.scrapQty)} tone="danger" />
                <BigStat label="Rework" value={num(order.reworkQty)} tone="warning" />
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-caption font-medium">
                  <span>Completion</span>
                  <span className="tnum text-ink-muted">{completion}% · {num(order.actualQty)} / {num(order.plannedQty)}</span>
                </div>
                <div className="mt-1.5 h-2.5 bg-canvas rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      order.status === "delayed" ? "bg-danger" : "bg-primary"
                    )}
                    style={{ width: `${completion}%` }}
                  />
                </div>
              </div>
            </Card>

            <MoWorkOrdersPanel
              order={order}
              workOrders={wos}
              moComplete={moComplete}
              onRefresh={refreshAll}
              onMessage={(msg, tone) => {
                if (tone === "err") setErrBanner(msg);
                else setOkBanner(msg);
              }}
            />

            <Card
              title="Inventory locations"
              subtitle="Where materials were issued from and where finished goods were posted (from stock ledger)"
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setInventoryTrail(null);
                    if (order) {
                      void refreshInventoryTrail(order.id).catch(() => {});
                    }
                  }}
                  disabled={!order}
                >
                  Refresh
                </Button>
              }
              noPadding
            >
              {!inventoryTrail ? (
                <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  Loading inventory trail…
                </div>
              ) : !inventoryTrail.hasActivity ? (
                <div className="px-4 py-6 text-body-sm text-ink-muted">
                  <MapPin size={16} className="inline mr-1.5 -mt-0.5 text-ink-muted" />
                  No bin movements yet for this MO.{" "}
                  <strong>Issue materials</strong> records source bins;{" "}
                  <strong>Complete</strong> records where{" "}
                  {inventoryTrail.finishedGood.variantSku ?? inventoryTrail.finishedGood.sku} was received.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {inventoryTrail.finishedGood.variantSku && (
                    <div className="px-4 py-2.5 bg-primary/5 text-caption text-ink">
                      Producing variant:{" "}
                      <span className="font-mono font-semibold">
                        {inventoryTrail.finishedGood.variantSku}
                      </span>{" "}
                      <span className="text-ink-muted">
                        ({inventoryTrail.finishedGood.name}
                        {inventoryTrail.finishedGood.variantSize
                          ? ` · ${inventoryTrail.finishedGood.variantSize}`
                          : ""}
                        )
                      </span>
                      {inventoryTrail.finishedGood.variantPackSize &&
                        inventoryTrail.finishedGood.variantPackSize !== 1 && (
                          <span className="text-ink-muted">
                            {" "}
                            · 1 {inventoryTrail.finishedGood.variantUom} ={" "}
                            <strong>{inventoryTrail.finishedGood.variantPackSize}</strong>{" "}
                            {inventoryTrail.finishedGood.parentUom}
                          </span>
                        )}
                    </div>
                  )}
                  {inventoryTrail.productionLineWarehouse && (
                    <div className="px-4 py-2.5 bg-canvas text-caption text-ink-muted">
                      BOM production line:{" "}
                      <span className="font-semibold text-ink">
                        {inventoryTrail.productionLineWarehouse.code}
                      </span>{" "}
                      ({inventoryTrail.productionLineWarehouse.name})
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                    <div className="p-4">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink mb-2">
                        <ArrowDownToLine size={16} className="text-warning shrink-0" />
                        Materials consumed (from bins)
                      </div>
                      {inventoryTrail.materialsConsumed.length === 0 ? (
                        <p className="text-caption text-ink-muted">Not issued yet.</p>
                      ) : (
                        <ul className="space-y-2">
                          {inventoryTrail.materialsConsumed.map((m) => (
                            <li
                              key={`${m.productId}-${m.variantId ?? "p"}-${m.warehouseCode}-${m.binPath}`}
                              className="text-body-sm"
                            >
                              <span className="font-mono text-caption text-ink-muted">
                                {m.variantSku ?? m.sku}
                              </span>{" "}
                              <span className="font-semibold">{m.name}</span>
                              {m.variantSize ? (
                                <Chip size="sm" tone="neutral" className="ml-1">
                                  {m.variantSize}
                                </Chip>
                              ) : !m.variantId ? (
                                <Chip size="sm" tone="neutral" className="ml-1">
                                  bulk
                                </Chip>
                              ) : null}
                              <div className="text-caption text-ink-muted mt-0.5 flex items-start gap-1">
                                <MapPin size={12} className="mt-0.5 shrink-0" />
                                {locLabel(m.warehouseCode, m.warehouseKind, m.binPath)}
                              </div>
                              <div className="text-caption tnum text-ink-muted">
                                −{num(m.qty)}
                                {m.variantUom ? ` ${m.variantUom}` : ""} · {m.txnTypes.join(", ")}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink mb-2">
                        <ArrowUpFromLine size={16} className="text-success shrink-0" />
                        Finished goods stored at
                      </div>
                      {inventoryTrail.finishedGoodsPosted.length === 0 ? (
                        <p className="text-caption text-ink-muted">
                          Not posted yet. Complete the MO after logging output.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {inventoryTrail.finishedGoodsPosted.map((f) => (
                            <li
                              key={`${f.variantId ?? "p"}-${f.warehouseCode}-${f.binPath}`}
                              className="text-body-sm"
                            >
                              <span className="font-semibold">
                                {f.name}{" "}
                                <span className="font-mono text-caption text-ink-muted">
                                  ({f.variantSku ?? f.sku})
                                </span>
                              </span>
                              {f.variantSize ? (
                                <Chip size="sm" tone="primary" className="ml-1">
                                  {f.variantSize}
                                </Chip>
                              ) : !f.variantId ? (
                                <Chip size="sm" tone="neutral" className="ml-1">
                                  bulk
                                </Chip>
                              ) : null}
                              <div className="text-caption text-primary mt-0.5 flex items-start gap-1 font-medium">
                                <MapPin size={12} className="mt-0.5 shrink-0" />
                                {locLabel(f.warehouseCode, f.warehouseKind, f.binPath)}
                              </div>
                              <div className="text-caption tnum text-ink-muted">
                                +{num(f.qty)}{" "}
                                {f.variantUom ?? inventoryTrail.finishedGood.uom} ·{" "}
                                {f.txnTypes.join(", ")}
                              </div>
                              <Link
                                to={`/inventory?productId=${encodeURIComponent(f.productId)}${f.variantId ? `&variantId=${encodeURIComponent(f.variantId)}` : ""}`}
                                className="text-caption text-primary hover:underline mt-0.5 inline-block"
                              >
                                View in Inventory →
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  {inventoryTrail.byproductsReleased.length > 0 && (
                    <div className="px-4 py-3 border-t border-border">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink mb-2">
                        <Package size={16} className="text-primary shrink-0" />
                        By-products released
                      </div>
                      <ul className="space-y-2 md:grid md:grid-cols-2 md:gap-3">
                        {inventoryTrail.byproductsReleased.map((bp) => (
                          <li
                            key={`${bp.productId}-${bp.variantId ?? "p"}-${bp.warehouseCode}-${bp.binPath}`}
                            className="text-body-sm"
                          >
                            <span className="font-mono text-caption text-ink-muted">
                              {bp.variantSku ?? bp.sku}
                            </span>{" "}
                            <span className="font-semibold">{bp.name}</span>
                            {bp.variantSize ? (
                              <Chip size="sm" tone="neutral" className="ml-1">
                                {bp.variantSize}
                              </Chip>
                            ) : !bp.variantId ? (
                              <Chip size="sm" tone="neutral" className="ml-1">
                                bulk
                              </Chip>
                            ) : null}
                            <div className="text-caption text-primary mt-0.5 flex items-start gap-1 font-medium">
                              <MapPin size={12} className="mt-0.5 shrink-0" />
                              {locLabel(bp.warehouseCode, bp.warehouseKind, bp.binPath)}
                            </div>
                            <div className="text-caption tnum text-ink-muted">
                              +{num(bp.qty)}
                              {bp.variantUom ? ` ${bp.variantUom}` : ""} · {bp.txnTypes.join(", ")}
                            </div>
                            <Link
                              to={`/inventory?productId=${encodeURIComponent(bp.productId)}${bp.variantId ? `&variantId=${encodeURIComponent(bp.variantId)}` : ""}`}
                              className="text-caption text-primary hover:underline mt-0.5 inline-block"
                            >
                              View in Inventory →
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {inventoryTrail.transfers.length > 0 && (
                    <div className="px-4 py-3 bg-canvas">
                      <div className="text-caption font-semibold text-ink-muted uppercase tracking-wide mb-2">
                        Planned / in-flight moves (transfer orders)
                      </div>
                      <ul className="space-y-2">
                        {inventoryTrail.transfers.map((t) => (
                          <li key={t.id} className="text-body-sm">
                            <span className="font-mono text-caption text-primary font-semibold">
                              {t.transferNo}
                            </span>{" "}
                            <Chip size="sm" tone="neutral">
                              {t.kind}
                            </Chip>{" "}
                            <span className="text-caption text-ink-muted">
                              {t.fromWarehouseCode} → {t.toWarehouseCode} ({t.status})
                            </span>
                            {t.items.map((i, idx) => (
                              <div
                                key={idx}
                                className="text-caption text-ink-muted mt-0.5 pl-2 border-l-2 border-border"
                              >
                                {i.sku}: {num(i.qtyRequested)} req
                                {i.fromBinPath ? ` · from ${i.fromBinPath}` : ""}
                                {i.toBinPath ? ` → to ${i.toBinPath}` : ""}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Linked transfer orders (putaway + replenishment) */}
            {linkedTOs.length > 0 && (
              <Card
                title="Transfer orders"
                subtitle={`${linkedTOs.length} transfer(s) linked to this MO`}
                noPadding
              >
                <div className="divide-y divide-border">
                  {linkedTOs.map((to) => {
                    const kindColor =
                      to.kind === "putaway"
                        ? "bg-purple-50 text-purple-700 border-purple-200"
                        : to.kind === "replenishment"
                        ? "bg-orange-50 text-orange-700 border-orange-200"
                        : "bg-canvas text-ink-muted border-border";
                    const statusColor =
                      to.status === "done"
                        ? "success"
                        : to.status === "in_transit"
                        ? "primary"
                        : to.status === "cancelled"
                        ? "danger"
                        : "neutral";
                    return (
                      <div key={to.id} className="px-4 py-3 flex items-center gap-3">
                        <ArrowRightLeft size={14} className="text-ink-muted shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-caption text-primary font-semibold">{to.transferNo}</span>
                            <span className={cn("text-[10px] rounded-full px-2 py-0.5 border font-semibold uppercase tracking-wide", kindColor)}>
                              {to.kind}
                            </span>
                            <Chip size="sm" tone={statusColor as "neutral"}>{to.status.replace("_", " ")}</Chip>
                          </div>
                          <div className="text-caption text-ink-muted mt-0.5">
                            {to.fromWarehouse.code} → {to.toWarehouse.code} · {to.items.length} item(s)
                          </div>
                        </div>
                        {to.status !== "done" && to.status !== "cancelled" && (
                          <a
                            href={`/m/transfers/${to.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-caption text-primary hover:underline shrink-0"
                          >
                            Open mobile ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {(() => {
              const moClosed = order.status === "completed" || order.status === "cancelled";
              return (
            <Card
              title={moClosed ? "Materials snapshot" : "Material requirements"}
              subtitle={
                moClosed
                  ? `MO ${order.status} · historical BOM consumption (read-only)`
                  : requirements
                    ? `For remaining ${num(requirements.plannedFor)} units · ${requirements.lines.length} BOM component(s)`
                    : bom
                      ? `${bom.product} · ${bom.revision}`
                      : "Loading BOM…"
              }
              actions={
                <div className="flex items-center gap-2">
                  {moClosed ? (
                    <Chip
                      tone={order.status === "completed" ? "success" : "neutral"}
                      icon={<CheckCircle2 size={12} />}
                    >
                      {order.status === "completed" ? "MO completed" : "MO cancelled"}
                    </Chip>
                  ) : requirements?.allFullyIssued ? (
                    <Chip tone="success" icon={<PackageCheck size={12} />}>
                      Materials issued
                    </Chip>
                  ) : requirements?.anyShortage ? (
                    <Chip tone="danger" icon={<AlertTriangle size={12} />}>
                      Shortages
                    </Chip>
                  ) : requirements && requirements.lines.length > 0 ? (
                    <Chip tone="success" icon={<CheckCircle2 size={12} />}>
                      All in stock
                    </Chip>
                  ) : null}
                  {!moClosed && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRequirements(null);
                        if (order) {
                          void refreshRequirements(order.id).catch(() => {});
                        }
                      }}
                      title="Reload stock from bins"
                    >
                      Refresh
                    </Button>
                  )}
                </div>
              }
              noPadding
            >
              {!moClosed && requirements?.stockScope === "production_line" &&
                !requirements.allFullyIssued &&
                requirements.lines.some((l) => l.stillNeeded > 0 && l.shortage <= 0) && (
                <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200 flex items-start gap-2 text-body-sm text-blue-900">
                  <PackageCheck size={14} className="mt-0.5 shrink-0" />
                  <div>
                    Stock is at the production line after replenishment, but{" "}
                    <strong>To issue</strong> stays until you run <strong>Issue materials</strong>{" "}
                    (consumes from line bins into this MO).
                  </div>
                </div>
              )}
              {!moClosed && requirements?.allFullyIssued && (
                <div className="px-4 py-2.5 bg-success-soft border-b border-success/30 flex items-start gap-2 text-body-sm text-success">
                  <PackageCheck size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <span className="font-semibold">Materials issued to this MO.</span>{" "}
                    Issued quantities are tracked on the stock ledger; bin on-hand may be lower because components were consumed from storage.
                    Use <strong>Log output</strong> and <strong>Complete</strong> for the next steps.
                  </div>
                </div>
              )}
              {!moClosed && requirements?.anyShortage && !requirements.allFullyIssued && (() => {
                const topShort = requirements.lines
                  .filter((l) => l.shortage > 0 && l.stillNeeded > 0)
                  .sort((a, b) => b.shortage - a.shortage)[0];
                return (
                  <div className="px-4 py-2.5 bg-warning-soft border-b border-warning/30 flex items-start gap-3 text-body-sm text-[#8a6300]">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold">Stock shortage detected.</span>{" "}
                      Manufacturing uses <strong>In bins</strong> (physical bin qty), not the product counter alone.
                      <br />
                      <strong>To resolve:</strong> post a count correction for the short component (e.g. bulk{" "}
                      <strong>AJWN</strong> in kg), then <strong>Refresh</strong> below.
                      {order.status === "planned" && (
                        <>
                          {" "}
                          Or use <strong>Release</strong> to pull from storage bins into the production line.
                        </>
                      )}
                    </div>
                    {topShort && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/inventory?adjust=1&from=mfg&mode=count&reason=${encodeURIComponent("Physical recount")}&productId=${encodeURIComponent(topShort.productId)}`
                            )
                          }
                        >
                          Count correction · {topShort.sku}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/inventory?adjust=1&from=mfg&productId=${encodeURIComponent(topShort.productId)}&delta=${topShort.shortage}`
                            )
                          }
                        >
                          Add +{num(topShort.shortage, 2)} {topShort.uom}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="grid grid-cols-12 grid-header-cell text-caption">
                <div className="col-span-2">SKU</div>
                <div className="col-span-2">Component</div>
                <div className="col-span-2">Path</div>
                <div className="col-span-1 text-right">Req</div>
                <div className="col-span-1 text-right">Issued</div>
                <div className="col-span-1 text-right">{moClosed ? "—" : "To issue"}</div>
                <div className="col-span-2 text-right">
                  {moClosed
                    ? "Final"
                    : requirements?.stockScope === "production_line"
                      ? "At line"
                      : "In bins"}
                </div>
                <div className="col-span-1 text-right">{moClosed ? "Variance" : "Short"}</div>
                <div className="col-span-1" />
              </div>
              {!requirements ? (
                <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  Computing material requirements…
                </div>
              ) : requirements.lines.length === 0 ? (
                <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  This BOM has no leaf components.
                </div>
              ) : (
                requirements.lines.map((l) => {
                  return (
                    <div
                      key={l.productId}
                      className={cn(
                        "grid grid-cols-12 grid-cell items-center",
                        l.shortage > 0 && "bg-danger-soft/40"
                      )}
                    >
                      <div className="col-span-2 font-mono text-caption">
                        {l.sku}
                      </div>
                      <div className="col-span-2 font-semibold truncate">
                        {l.name}
                      </div>
                      <div className="col-span-2 text-caption text-ink-muted truncate">
                        {l.path.join(" → ") || "(direct)"}
                      </div>
                      <div className="col-span-1 text-right tnum">
                        {num(l.required, 2)}
                      </div>
                      <div className="col-span-1 text-right tnum text-ink-muted">
                        {num(l.issued, 2)}
                      </div>
                      <div
                        className={cn(
                          "col-span-1 text-right tnum",
                          l.stillNeeded > 0 ? "text-warning font-semibold" : "text-success"
                        )}
                      >
                        {num(l.stillNeeded, 2)}
                      </div>
                      <div className={cn("col-span-2 text-right tnum", l.onHand === 0 && l.stillNeeded > 0 ? "text-danger" : "text-ink-muted")}>
                        {num(l.onHand, 2)} {l.uom}
                      </div>
                      <div
                        className={cn(
                          "col-span-1 text-right tnum font-semibold",
                          l.shortage > 0 ? "text-danger" : "text-success"
                        )}
                      >
                        {l.shortage > 0
                          ? `−${num(l.shortage, 2)}`
                          : "✓"}
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {!moClosed && l.shortage > 0 && l.stillNeeded > 0 && (
                          <Link
                            to={`/inventory?adjust=1&from=mfg&productId=${encodeURIComponent(l.productId)}&delta=${l.shortage}`}
                            className="text-caption text-primary hover:underline whitespace-nowrap"
                            title="Open Inventory → Adjust with shortage qty prefilled"
                          >
                            Add stock
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
              );
            })()}
          </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <EmptyState
                  empty
                  emptyTitle={
                    activeTab === "history" ? "No closed orders" : "No active orders"
                  }
                  emptyDescription={
                    activeTab === "history"
                      ? "Completed and cancelled MOs appear here once you close them."
                      : "Create a manufacturing order from an active BOM, or switch to History to review closed MOs."
                  }
                  action={
                    activeTab === "orders" ? (
                      <Button
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => setShowNewMo(true)}
                        disabled={activeBoms.length === 0}
                      >
                        New manufacturing order
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ))}

          {activeTab === "productivity" && (
            <div className="p-4 grid grid-cols-2 gap-4 items-start">
              {/* Employee productivity */}
              <Card
                noPadding
                title={
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    <span>Employee productivity</span>
                  </div>
                }
                actions={
                  <Chip size="sm" tone="success" icon={<StatusDot tone="success" />}>
                    {workers.filter((w) => w.status === "in").length} active
                  </Chip>
                }
              >
                <div className="divide-y divide-border">
                  {workers.length === 0 && (
                    <div className="px-4 py-6 text-caption text-ink-muted text-center">
                      No workers configured.
                    </div>
                  )}
                  {workers.map((w) => {
                    const eff = w.efficiency;
                    return (
                      <div key={w.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary-50 text-primary grid place-items-center font-bold text-caption shrink-0">
                          {w.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-body-sm font-semibold truncate">{w.name}</div>
                          <div className="text-caption text-ink-muted">
                            {w.empNo} · Shift {w.shift}
                          </div>
                          <div className="mt-1.5 h-1 bg-canvas rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full",
                                eff > 95 ? "bg-success" : eff > 80 ? "bg-warning" : "bg-danger"
                              )}
                              style={{ width: `${eff}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={cn("text-body-sm font-bold tnum", eff > 95 ? "text-success" : eff > 80 ? "text-warning" : "text-danger")}>
                            {eff.toFixed(0)}%
                          </div>
                          <div className="text-caption text-ink-muted tnum">
                            {num(w.unitsToday)}/{num(w.targetToday)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Line productivity */}
              <Card
                noPadding
                title={
                  <div className="flex items-center gap-2">
                    <Factory size={14} />
                    <span>Line productivity</span>
                  </div>
                }
                actions={<Chip size="sm" tone="neutral">{lines.length} lines</Chip>}
              >
                {lines.length === 0 && (
                  <div className="px-4 py-6 text-caption text-ink-muted text-center">
                    No production lines yet.
                    <div className="mt-1">
                      Add them in <strong>Settings › Production facilities</strong>.
                    </div>
                  </div>
                )}
                <div className="divide-y divide-border">
                  {lines.map((line) => {
                    const machines = line.machines ?? [];
                    const utilTone =
                      line.utilisationPct === null
                        ? "neutral"
                        : line.utilisationPct >= 80
                          ? "success"
                          : line.utilisationPct >= 30
                            ? "warning"
                            : "neutral";
                    const lineRunning = machines.some(
                      (m) => m.status === "running" || m.busy
                    );
                    return (
                      <div key={line.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className={cn(
                              "h-8 w-8 rounded-md grid place-items-center shrink-0",
                              lineRunning
                                ? "bg-success-soft text-success"
                                : "bg-canvas text-ink-muted"
                            )}
                          >
                            <Factory size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-body-sm font-semibold truncate">{line.name}</div>
                            <div className="text-caption text-ink-muted font-mono">{line.code}</div>
                          </div>
                          {line.activeOrders > 0 ? (
                            <Chip size="sm" tone="primary">{line.activeOrders} MO</Chip>
                          ) : (
                            <Chip size="sm" tone="neutral">idle</Chip>
                          )}
                        </div>
                        {line.dailyCapacity !== null && (
                          <div className="mb-2">
                            <div className="flex items-center justify-between text-caption text-ink-muted mb-1">
                              <span>Output today</span>
                              <span className="tnum">
                                {num(line.outputToday)} / {num(line.dailyCapacity)}
                              </span>
                            </div>
                            <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full",
                                  utilTone === "success" && "bg-success",
                                  utilTone === "warning" && "bg-warning",
                                  utilTone === "neutral" && "bg-ink-muted/40"
                                )}
                                style={{ width: `${Math.min(100, line.utilisationPct ?? 0)}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <div className="space-y-1">
                          {machines.length === 0 ? (
                            <div className="text-caption text-ink-muted">No machines configured.</div>
                          ) : (
                            machines.map((m) => {
                              const st =
                                m.status === "running"
                                  ? "success"
                                  : m.status === "maintenance"
                                    ? "warning"
                                    : m.status === "broken"
                                      ? "danger"
                                      : "neutral";
                              return (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-2 px-2 py-1 rounded bg-canvas/60"
                                >
                                  <Wrench
                                    size={12}
                                    className={cn(
                                      m.status === "running"
                                        ? "text-success"
                                        : m.status === "broken"
                                          ? "text-danger"
                                          : "text-ink-muted"
                                    )}
                                  />
                                  <span className="text-caption flex-1 truncate">{m.name}</span>
                                  <Chip size="sm" tone={st as "neutral"}>{m.status}</Chip>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {showNewMo && (
        <NewMoModal
          boms={boms}
          onClose={() => setShowNewMo(false)}
          onCreated={(orderNo, productionOrderId) => {
            setShowNewMo(false);
            setSelectedId(productionOrderId);
            setOkBanner(`MO ${orderNo} created.`);
            void liveMo.refetch();
          }}
        />
      )}
      {showCorrect && order && (
        <CorrectOutputModal
          order={{
            id: order.id,
            orderNo: order.orderNo,
            plannedQty: order.plannedQty,
            actualQty: order.actualQty,
            scrapQty: order.scrapQty,
            reworkQty: order.reworkQty,
          }}
          onClose={() => setShowCorrect(false)}
          onSaved={async (msg) => {
            setShowCorrect(false);
            setOkBanner(msg);
            await refreshAll();
            await refreshRequirements(order.id);
          }}
        />
      )}
      {showLogOutput && order && (
        <LogOutputModal
          order={{
            id: order.id,
            orderNo: order.orderNo,
            plannedQty: order.plannedQty,
            actualQty: order.actualQty,
            scrapQty: order.scrapQty,
            reworkQty: order.reworkQty,
          }}
          bom={
            // Prefer matching by bomId (variant-aware); fall back to
            // sku for older data where bomId isn't set on the MO.
            (order.bomId ? boms.find((b) => b.id === order.bomId) : null) ??
            boms.find((b) => b.sku === order.sku) ??
            null
          }
          alreadyLogged={inventoryTrail?.byproductsReleased}
          onClose={() => setShowLogOutput(false)}
          onSaved={async (msg) => {
            setShowLogOutput(false);
            setOkBanner(msg);
            await refreshAll();
            await Promise.all([
              refreshRequirements(order.id),
              refreshInventoryTrail(order.id),
            ]);
          }}
        />
      )}
      {showAssignLine && order && (
        <AssignLineModal
          mo={order}
          onClose={() => setShowAssignLine(false)}
          onAssigned={async () => {
            setShowAssignLine(false);
            setOkBanner("Line assigned.");
            await refreshAll();
          }}
        />
      )}
    </div>
  );
};

const BigStat = ({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "primary" | "danger" | "warning" }) => {
  const map = {
    neutral: "border-border bg-canvas text-ink",
    primary: "border-primary/30 bg-primary-50 text-primary",
    danger: "border-danger/30 bg-danger-soft text-danger",
    warning: "border-warning/30 bg-warning-soft text-[#8a6300]",
  } as const;
  return (
    <div className={cn("border rounded-md p-3", map[tone])}>
      <div className="text-caption uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-h2 font-bold tnum mt-1">{value}</div>
    </div>
  );
};
