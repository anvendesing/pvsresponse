import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Factory,
  Network,
  PackageCheck,
  Pause,
  Play,
  Plus,
  Square,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip, StatusDot } from "@/components/common/Chip";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api, type MoRequirements, type TransferOrderRow } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { EmptyState } from "@/components/common/EmptyState";
import type { Bom, ProductionOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { dd, num } from "@/lib/format";
import { BomEditor } from "@/components/manufacturing/BomEditor";
import { BomListPanel } from "@/components/manufacturing/BomListPanel";
import { NewMoModal } from "@/components/manufacturing/NewMoModal";

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
  }
};

export const Manufacturing = () => {
  const liveMo = useApi(() => api.productionOrdersWithWO(), []);
  const liveBoms = useApi(() => api.boms(), []);
  const liveWorkers = useApi(() => api.workers(), []);
  const liveProducts = useApi(() => api.products(), []);
  // Live per-WorkCenter rollup with machines + active orders. Drives
  // the right-rail "Production lines" panel; replaces the seeded mock
  // machine list that used to ship in this page.
  const liveLines = useApi(() => api.productionLines(), []);

  const productionOrders = liveMo.data?.orders ?? [];
  const workOrders = liveMo.data?.workOrders ?? [];
  const boms = liveBoms.data ?? [];
  const workers = liveWorkers.data ?? [];
  const products = liveProducts.data ?? [];
  const lines = liveLines.data?.lines ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBomList, setShowBomList] = useState(false);
  const [showNewMo, setShowNewMo] = useState(false);
  const [bomEditing, setBomEditing] = useState<{
    bom: Bom | null;
    seedProductId?: string;
  } | null>(null);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Live requirements (multi-level explosion + on-hand) for the
  // currently-selected MO. Refreshed when the selection or output
  // counts change.
  const [requirements, setRequirements] = useState<MoRequirements | null>(null);
  // Transfer orders linked to the currently-selected MO.
  const [linkedTOs, setLinkedTOs] = useState<TransferOrderRow[]>([]);

  const refreshAll = async () => {
    liveMo.refetch();
    liveBoms.refetch();
    liveLines.refetch();
  };

  const loading = liveMo.loading || liveBoms.loading || liveWorkers.loading;
  const errorObj = liveMo.error ?? liveBoms.error ?? liveWorkers.error;

  const order =
    productionOrders.find((p) => p.id === selectedId) ?? productionOrders[0];

  // Fetch requirements + linked TOs when the selected MO changes.
  useEffect(() => {
    if (!order) {
      setRequirements(null);
      setLinkedTOs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [r, tos] = await Promise.all([
          api.productionOrderRequirements(order.id),
          api.transferOrders({ productionOrderId: order.id }),
        ]);
        if (!cancelled) {
          setRequirements(r);
          setLinkedTOs(tos);
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

  if (loading || errorObj || productionOrders.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          loading={loading}
          error={errorObj}
          empty={!loading && !errorObj && productionOrders.length === 0}
          emptyTitle="No production orders"
          emptyDescription="Create a Manufacturing Order or seed sample data via the backend."
          onRetry={() => {
            liveMo.refetch();
            liveBoms.refetch();
            liveWorkers.refetch();
          }}
        />
      </div>
    );
  }
  const wos = workOrders.filter((w) => w.productionOrderId === order.id);
  // BOMs may not have loaded (or none exist) - never crash on
  // bom.product / bom.revision; the requirements card already has
  // its own empty state for the missing data.
  const bom = boms.find((b) => b.sku === order.sku) ?? boms[0];

  const totalActual = productionOrders.reduce((s, p) => s + p.actualQty, 0);
  const totalPlanned = productionOrders.reduce((s, p) => s + p.plannedQty, 0);
  const eff = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;
  const inProgress = productionOrders.filter((p) => p.status === "in-progress").length;
  const delayed = productionOrders.filter((p) => p.status === "delayed").length;

  // ---- MO actions ------------------------------------------------
  const onIssueMaterials = async () => {
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
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onLogOutput = async () => {
    const goodInput = prompt(
      "Good qty produced this batch (integer):",
      String(Math.max(1, Math.round(order.plannedQty / 4)))
    );
    if (!goodInput) return;
    const good = Number(goodInput);
    if (!Number.isFinite(good) || good < 0) {
      setErrBanner("Good qty must be a non-negative number.");
      return;
    }
    const scrapInput = prompt("Scrap qty (defaults to 0):", "0");
    const scrap = Number(scrapInput ?? "0");
    setBusy("log");
    try {
      await api.logOutput(order.id, { goodQty: good, scrapQty: Number.isFinite(scrap) ? scrap : 0 });
      setOkBanner(`Logged ${num(good)} good, ${num(scrap || 0)} scrap.`);
      await refreshAll();
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onReleaseMo = async () => {
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
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCompleteMo = async () => {
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
    } catch (e) {
      setErrBanner((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
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
              onClick={() => setShowBomList(true)}
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

      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 bg-canvas border-b border-border">
        <Kpi label="Plant Efficiency" value={`${eff.toFixed(1)}%`} delta={1.2} icon={<TrendingUp size={14} />} accent="success" />
        <Kpi label="In Progress" value={String(inProgress)} deltaSuffix="" delta={1} icon={<Play size={14} />} accent="primary" />
        <Kpi label="Delayed" value={String(delayed)} deltaSuffix="" delta={-1} icon={<AlertTriangle size={14} />} accent="danger" />
        <Kpi label="Output Today" value={num(totalActual)} delta={6.4} accent="primary" hint={`Target ${num(totalPlanned)}`} />
      </div>

      <div className="flex-1 grid grid-cols-12 min-h-0">
        {/* Left: orders list */}
        <aside className="col-span-3 bg-surface border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-body-sm font-bold">Active Orders</span>
            <Chip size="sm" tone="neutral">{productionOrders.length}</Chip>
          </div>
          <div className="flex-1 overflow-y-auto">
            {productionOrders.map((p) => {
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
                  <div className="text-body-sm font-semibold mt-1 truncate">{p.product}</div>
                  <div className="text-caption text-ink-muted flex items-center justify-between mt-1">
                    <span>{p.station}</span>
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

        {/* Center: current work order */}
        <section className="col-span-6 flex flex-col bg-canvas overflow-y-auto">
          <div className="p-4 space-y-4">
            <Card
              title={
                <div className="flex items-center gap-2">
                  <span className="font-mono text-caption text-ink-muted">{order.orderNo}</span>
                  <span>{order.product}</span>
                </div>
              }
              subtitle={`${order.sku} · ${order.station} · Due ${dd(order.dueDate)}`}
              actions={
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip tone={statusTone(order.status)}>{order.status}</Chip>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<ArrowRightLeft size={14} />}
                    onClick={onReleaseMo}
                    disabled={busy === "release" || order.status === "completed"}
                    title="Check material availability at production line and create replenishment transfers if short"
                  >
                    {busy === "release" ? "Releasing…" : "Release"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<PackageCheck size={14} />}
                    onClick={onIssueMaterials}
                    disabled={busy === "issue" || order.status === "completed"}
                  >
                    {busy === "issue" ? "Issuing…" : "Issue materials"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Plus size={14} />}
                    onClick={onLogOutput}
                    disabled={busy === "log" || order.status === "completed"}
                  >
                    Log output
                  </Button>
                  <Button
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    onClick={onCompleteMo}
                    disabled={
                      busy === "complete" ||
                      order.status === "completed" ||
                      order.actualQty <= 0
                    }
                  >
                    {busy === "complete" ? "Closing…" : "Complete · F8"}
                  </Button>
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

            <Card title="Work Orders" subtitle="Stages and live progress" noPadding>
              <div className="divide-y divide-border">
                {wos.map((wo) => {
                  const pct = Math.round((wo.output / wo.target) * 100);
                  const tone =
                    wo.status === "complete"
                      ? "success"
                      : wo.status === "running"
                        ? "primary"
                        : wo.status === "paused"
                          ? "warning"
                          : "neutral";
                  return (
                    <div key={wo.id} className="px-4 py-3 hover:bg-canvas">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "h-9 w-9 grid place-items-center rounded-md",
                            wo.status === "running"
                              ? "bg-primary text-white"
                              : wo.status === "complete"
                                ? "bg-success-soft text-success"
                                : "bg-canvas text-ink-muted"
                          )}
                        >
                          {wo.status === "running" ? (
                            <Play size={14} />
                          ) : wo.status === "paused" ? (
                            <Pause size={14} />
                          ) : wo.status === "complete" ? (
                            <CheckCircle2 size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-body-sm">{wo.station}</span>
                            <Chip tone={tone} size="sm">{wo.status}</Chip>
                            <span className="text-caption text-ink-muted font-mono">
                              {wo.machine}
                            </span>
                          </div>
                          <div className="text-caption text-ink-muted mt-0.5 flex items-center gap-1.5">
                            <Users size={11} />
                            {wo.workers.join(", ")}
                          </div>
                        </div>
                        <div className="text-right tnum">
                          <div className="text-body-sm font-bold">
                            {num(wo.output)} / {num(wo.target)}
                          </div>
                          <div className="text-caption text-ink-muted">{pct}%</div>
                        </div>
                      </div>
                      <div className="mt-2 h-1 bg-canvas rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            tone === "success"
                              ? "bg-success"
                              : tone === "warning"
                                ? "bg-warning"
                                : "bg-primary"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
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

            <Card
              title="Material requirements (multi-level)"
              subtitle={
                requirements
                  ? `For remaining ${num(requirements.plannedFor)} units · ${requirements.lines.length} raw components`
                  : bom
                    ? `${bom.product} · ${bom.revision}`
                    : "Loading BOM…"
              }
              actions={
                requirements?.anyShortage ? (
                  <Chip tone="danger" icon={<AlertTriangle size={12} />}>
                    Shortages
                  </Chip>
                ) : requirements && requirements.lines.length > 0 ? (
                  <Chip tone="success" icon={<CheckCircle2 size={12} />}>
                    All in stock
                  </Chip>
                ) : null
              }
              noPadding
            >
              <div className="grid grid-cols-12 grid-header-cell">
                <div className="col-span-2">SKU</div>
                <div className="col-span-3">Component</div>
                <div className="col-span-3">Path</div>
                <div className="col-span-2 text-right">Required</div>
                <div className="col-span-2 text-right">Free / Short</div>
              </div>
              {!requirements ? (
                <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  Computing multi-level requirements…
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
                      <div className="col-span-3 font-semibold truncate">
                        {l.name}
                      </div>
                      <div className="col-span-3 text-caption text-ink-muted truncate">
                        {l.path.join(" → ") || "(direct)"}
                      </div>
                      <div className="col-span-2 text-right tnum">
                        {num(l.required, 2)} {l.uom}
                      </div>
                      <div
                        className={cn(
                          "col-span-2 text-right tnum font-semibold",
                          l.shortage > 0 ? "text-danger" : "text-success"
                        )}
                      >
                        {l.shortage > 0
                          ? `short ${num(l.shortage, 2)}`
                          : `free ${num(l.free, 2)}`}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          </div>
        </section>

        {/* Right rail: live workers + production-line rollup. The
            machine list and per-line status used to be hardcoded here;
            both are now sourced from /reports/production-lines, which
            aggregates active MOs and machine.status flips from
            issue-materials / complete. */}
        <aside className="col-span-3 bg-surface border-l border-border flex flex-col overflow-y-auto">
          <Card noPadding className="!rounded-none !border-0 !border-b !border-border !shadow-none">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-body-sm font-bold">Workers on Line</span>
              <Chip
                size="sm"
                tone="success"
                icon={<StatusDot tone="success" />}
              >
                {workers.filter((w) => w.status === "in").length} active
              </Chip>
            </div>
            <div className="divide-y divide-border">
              {workers.length === 0 && (
                <div className="px-3 py-4 text-caption text-ink-muted text-center">
                  No workers configured.
                </div>
              )}
              {workers.slice(0, 5).map((w) => {
                const eff = w.efficiency;
                return (
                  <div key={w.id} className="px-3 py-2.5 flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary-50 text-primary grid place-items-center font-bold text-caption">
                      {w.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-body-sm font-semibold truncate">{w.name}</div>
                      <div className="text-caption text-ink-muted">
                        {w.empNo} · Shift {w.shift}
                      </div>
                    </div>
                    <div className="text-right">
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

          <Card noPadding className="!rounded-none !border-0 !shadow-none">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-body-sm font-bold">Production lines</span>
              <Chip size="sm" tone="neutral">
                {lines.length}
              </Chip>
            </div>
            {lines.length === 0 && (
              <div className="px-3 py-6 text-caption text-ink-muted text-center">
                No work centers yet.
                <div className="mt-1">Add them in <strong>Settings &raquo; Production lines</strong>.</div>
              </div>
            )}
            <div className="divide-y divide-border">
              {lines.map((line) => {
                const utilTone =
                  line.utilisationPct === null
                    ? "neutral"
                    : line.utilisationPct >= 80
                      ? "success"
                      : line.utilisationPct >= 30
                        ? "warning"
                        : "neutral";
                const lineRunning = line.machines.some(
                  (m) => m.status === "running" || m.busy
                );
                return (
                  <div key={line.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div
                        className={cn(
                          "h-8 w-8 rounded-md grid place-items-center",
                          lineRunning
                            ? "bg-success-soft text-success"
                            : "bg-canvas text-ink-muted"
                        )}
                      >
                        <Factory size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-body-sm font-semibold truncate">
                          {line.name}
                        </div>
                        <div className="text-caption text-ink-muted font-mono">
                          {line.code}
                        </div>
                      </div>
                      {line.activeOrders > 0 ? (
                        <Chip size="sm" tone="primary">
                          {line.activeOrders} MO
                        </Chip>
                      ) : (
                        <Chip size="sm" tone="neutral">
                          idle
                        </Chip>
                      )}
                    </div>
                    {/* Output today vs daily capacity bar. We hide it
                        when capacity isn't set since "x of unknown" is
                        not actionable. */}
                    {line.dailyCapacity !== null && (
                      <div className="px-1">
                        <div className="flex items-center justify-between text-caption text-ink-muted mb-1">
                          <span>Output today</span>
                          <span className="tnum">
                            {num(line.outputToday)} /{" "}
                            {num(line.dailyCapacity)}
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
                            style={{
                              width: `${Math.min(100, line.utilisationPct ?? 0)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {/* Machines on this line. Each machine is rendered
                        as a slim row showing its operational status
                        plus a "busy" hint when an active WO has it. */}
                    <div className="mt-2 space-y-1">
                      {line.machines.length === 0 ? (
                        <div className="text-caption text-ink-muted px-1">
                          No machines configured.
                        </div>
                      ) : (
                        line.machines.map((m) => {
                          const statusTone =
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
                              className="flex items-center gap-2 px-1 py-1 rounded bg-canvas/40"
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
                              <span className="text-caption flex-1 truncate">
                                {m.name}
                              </span>
                              <Chip size="sm" tone={statusTone}>
                                {m.status}
                              </Chip>
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
        </aside>
      </div>

      {showBomList && (
        <BomListPanel
          boms={boms}
          products={products}
          onClose={() => setShowBomList(false)}
          onEdit={(b) => {
            setBomEditing({ bom: b });
            setShowBomList(false);
          }}
          onCreate={(seedProductId) => {
            setBomEditing({ bom: null, seedProductId });
            setShowBomList(false);
          }}
          onClone={async (b) => {
            // Quick clone: bump revision, keep the same variant
            // scope. The user can then tweak items in the editor or
            // re-clone to other variants from inside it.
            try {
              const cloned = (await api.cloneBom(b.id)) as { id: string };
              await liveBoms.refetch();
              const fresh = await api.getBom(cloned.id);
              setBomEditing({ bom: fresh });
              setShowBomList(false);
              setOkBanner(`Cloned BOM ${b.sku} - opened the new revision.`);
            } catch (e) {
              setErrBanner((e as Error).message);
            }
          }}
          onChanged={() => {
            void liveBoms.refetch();
            setOkBanner("BOM updated.");
          }}
        />
      )}

      {bomEditing && (
        <BomEditor
          bom={bomEditing.bom}
          seedProductId={bomEditing.seedProductId}
          products={products}
          onClose={() => setBomEditing(null)}
          onSaved={(_id, message) => {
            setBomEditing(null);
            setOkBanner(message);
            void liveBoms.refetch();
          }}
        />
      )}

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
