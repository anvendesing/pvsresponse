import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  GitBranch,
  Package,
  Settings2,
  Truck,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { MoWorkOrdersPanel } from "@/components/manufacturing/MoWorkOrdersPanel";
import { AssignLineModal } from "@/components/manufacturing/AssignLineModal";
import { MoStatusTab } from "@/components/manufacturing/cards/tabs/MoStatusTab";
import { MoConsumptionTab } from "@/components/manufacturing/cards/tabs/MoConsumptionTab";
import { MoMaterialsTab } from "@/components/manufacturing/cards/tabs/MoMaterialsTab";
import { MoTransfersTab } from "@/components/manufacturing/cards/tabs/MoTransfersTab";
import {
  api,
  type MoInventoryTrail,
  type MoRequirements,
  type TransferOrderRow,
} from "@/lib/api";
import type { Bom, ProductionOrder, WorkOrder } from "@/data/types";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { moPrimaryLabel } from "@/lib/mo-display";
import { isMoClosed, moStatusTone } from "@/lib/mo-utils";

type MoWorkspaceTab = "status" | "work-orders" | "consumption" | "materials" | "transfers";

export type { MoWorkspaceTab };

const TABS: { id: MoWorkspaceTab; label: string; icon: React.ReactNode }[] = [
  { id: "status", label: "Status", icon: <Settings2 size={14} /> },
  { id: "work-orders", label: "Work orders", icon: <Wrench size={14} /> },
  { id: "consumption", label: "Consumption & output", icon: <Package size={14} /> },
  { id: "materials", label: "Materials", icon: <ClipboardList size={14} /> },
  { id: "transfers", label: "Transfers", icon: <Truck size={14} /> },
];

interface Props {
  order: ProductionOrder;
  workOrders: WorkOrder[];
  boms: Bom[];
  /** When provided with onTabChange, tab state is controlled by the parent (survives refetch remounts). */
  activeTab?: MoWorkspaceTab;
  onTabChange?: (tab: MoWorkspaceTab) => void;
  onClose: () => void;
  onRefreshList: () => Promise<void>;
  onBanner: (msg: string, tone: "ok" | "err") => void;
}

export const MoExpandedWorkspace = ({
  order,
  workOrders,
  boms,
  activeTab: activeTabProp,
  onTabChange,
  onClose,
  onRefreshList,
  onBanner,
}: Props) => {
  const [internalTab, setInternalTab] = useState<MoWorkspaceTab>("status");
  const isControlled = activeTabProp !== undefined && onTabChange !== undefined;
  const activeTab = isControlled ? activeTabProp : internalTab;
  const setActiveTab = (tab: MoWorkspaceTab) => {
    if (isControlled) onTabChange(tab);
    else setInternalTab(tab);
  };
  const [requirements, setRequirements] = useState<MoRequirements | null>(null);
  const [inventoryTrail, setInventoryTrail] = useState<MoInventoryTrail | null>(null);
  const [linkedTOs, setLinkedTOs] = useState<TransferOrderRow[] | null>(null);
  const [loadingReq, setLoadingReq] = useState(false);
  const [loadingTrail, setLoadingTrail] = useState(false);
  const [loadingTOs, setLoadingTOs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAssignLine, setShowAssignLine] = useState(false);

  // Keep banner callback stable — parent may pass a new function each render.
  const onBannerRef = useRef(onBanner);
  onBannerRef.current = onBanner;

  const wos = useMemo(
    () => workOrders.filter((w) => w.productionOrderId === order.id),
    [workOrders, order.id]
  );

  const orderBom = useMemo(() => {
    if (order.bomId) return boms.find((b) => b.id === order.bomId) ?? null;
    return boms.find((b) => b.sku === order.sku) ?? null;
  }, [boms, order]);

  const wosNeedLine = wos.some(
    (w) => !w.lineId && w.status !== "complete" && w.status !== "running"
  );

  const loadRequirements = useCallback(async () => {
    setLoadingReq(true);
    try {
      const r = await api.productionOrderRequirements(order.id);
      setRequirements(r);
    } catch (e) {
      onBannerRef.current((e as Error).message, "err");
    } finally {
      setLoadingReq(false);
    }
  }, [order.id]);

  const loadTrail = useCallback(async () => {
    setLoadingTrail(true);
    try {
      const t = await api.productionOrderInventoryTrail(order.id);
      setInventoryTrail(t);
    } catch (e) {
      onBannerRef.current((e as Error).message, "err");
    } finally {
      setLoadingTrail(false);
    }
  }, [order.id]);

  const loadTransfers = useCallback(async () => {
    setLoadingTOs(true);
    try {
      const tos = await api.transferOrders({ productionOrderId: order.id });
      setLinkedTOs(tos);
    } catch (e) {
      onBannerRef.current((e as Error).message, "err");
    } finally {
      setLoadingTOs(false);
    }
  }, [order.id]);

  // Reload tab data when MO changes. Tab selection is owned by the parent when
  // controlled — never force Status on refresh.
  useEffect(() => {
    if (!isControlled) setInternalTab("status");
    setRequirements(null);
    setInventoryTrail(null);
    setLinkedTOs(null);
    void loadRequirements();
  }, [order.id, loadRequirements, isControlled]);

  // Lazy-load tab data on first visit
  useEffect(() => {
    if (activeTab === "consumption" && !inventoryTrail && !loadingTrail) void loadTrail();
    if (activeTab === "materials" && !requirements && !loadingReq) void loadRequirements();
    if (activeTab === "transfers" && !linkedTOs && !loadingTOs) void loadTransfers();
  }, [
    activeTab,
    inventoryTrail,
    requirements,
    linkedTOs,
    loadingTrail,
    loadingReq,
    loadingTOs,
    loadTrail,
    loadRequirements,
    loadTransfers,
  ]);

  const refreshAfterAction = async () => {
    await onRefreshList();
    await Promise.all([
      loadRequirements(),
      activeTab === "consumption" || inventoryTrail ? loadTrail() : Promise.resolve(),
      activeTab === "transfers" || linkedTOs ? loadTransfers() : Promise.resolve(),
    ]);
  };

  const onRelease = async () => {
    setBusy("release");
    try {
      const res = await api.releaseMo(order.id);
      onBanner(
        res.allMet
          ? `MO ${order.orderNo} released. All materials at line.`
          : `MO released. ${res.shortages.length} shortage(s); ${res.transferOrderIds.length} TO(s) created.`,
        "ok"
      );
      await refreshAfterAction();
    } catch (e) {
      onBanner((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const onIssue = async () => {
    setBusy("issue");
    try {
      const res = await api.issueMaterials(order.id, { allowShort: true });
      onBanner(
        res.anyShort
          ? `Issued with shortages — check Materials tab.`
          : `Issued ${num(res.issued.reduce((s, l) => s + l.issued, 0))} units.`,
        "ok"
      );
      await refreshAfterAction();
    } catch (e) {
      onBanner((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const onComplete = async () => {
    if (!confirm(`Complete ${order.orderNo}? Finished goods will be posted to inventory.`)) return;
    setBusy("complete");
    try {
      const res = await api.completeProductionOrder(order.id);
      onBanner(
        res.putaway
          ? `MO closed. ${num(res.putaway.qty)} posted to bin.`
          : `MO closed.`,
        "ok"
      );
      await refreshAfterAction();
    } catch (e) {
      onBanner((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async () => {
    if (!confirm(`Cancel ${order.orderNo}? Issued materials will be reversed.`)) return;
    setBusy("cancel");
    try {
      const res = await api.cancelMo(order.id);
      onBanner(`MO ${res.orderNo} cancelled.`, "ok");
      await onRefreshList();
      onClose();
    } catch (e) {
      onBanner((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-canvas">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-white px-4 py-3">
        <div className="flex items-start gap-3">
          <Button size="sm" variant="outline" icon={<ArrowLeft size={14} />} onClick={onClose}>
            All orders
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-caption font-semibold text-primary">{order.orderNo}</span>
              <Chip tone={moStatusTone(order.status)} size="sm">
                {order.status}
              </Chip>
              {!isMoClosed(order.status) && requirements?.anyShortage && (
                <Chip tone="danger" size="sm">
                  shortages
                </Chip>
              )}
            </div>
            <h2 className="text-h3 font-bold truncate">{moPrimaryLabel(order)}</h2>
            <p className="text-caption text-ink-muted">
              {order.line?.name ?? order.facility?.name ?? "—"} · {num(order.actualQty)} /{" "}
              {num(order.plannedQty)} output
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-body-sm whitespace-nowrap border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary font-semibold bg-primary/5"
                  : "border-transparent text-ink-muted hover:text-ink hover:bg-canvas"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === "status" && (
          <MoStatusTab
            order={order}
            busy={busy}
            onCancel={onCancel}
            onComplete={onComplete}
          />
        )}

        {activeTab === "work-orders" && (
          <div className="space-y-4">
            {!isMoClosed(order.status) && (wosNeedLine || order.lineId === null) && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<GitBranch size={14} />}
                  onClick={() => setShowAssignLine(true)}
                >
                  Assign line / machine
                </Button>
              </div>
            )}
            <MoWorkOrdersPanel
              order={order}
              workOrders={wos}
              moComplete={order.status === "completed"}
              bomByproducts={orderBom?.byproducts ?? []}
              bomOutputQty={orderBom?.outputQty ?? 1}
              onRefresh={refreshAfterAction}
              onMessage={(msg, tone) => onBanner(msg, tone === "err" ? "err" : "ok")}
            />
          </div>
        )}

        {activeTab === "consumption" && (
          <MoConsumptionTab
            order={order}
            bom={orderBom}
            trail={inventoryTrail}
            loading={loadingTrail}
            onRefreshTrail={() => void loadTrail()}
            onSaved={async (msg) => {
              onBanner(msg, "ok");
              await refreshAfterAction();
            }}
          />
        )}

        {activeTab === "materials" && (
          <MoMaterialsTab
            order={order}
            requirements={requirements}
            loading={loadingReq}
            busy={busy}
            onRefresh={() => void loadRequirements()}
            onRelease={onRelease}
            onIssue={onIssue}
          />
        )}

        {activeTab === "transfers" && (
          <MoTransfersTab transfers={linkedTOs} loading={loadingTOs} />
        )}
      </div>

      {showAssignLine && (
        <AssignLineModal
          mo={order}
          onClose={() => setShowAssignLine(false)}
          onAssigned={() => {
            setShowAssignLine(false);
            void refreshAfterAction();
            onBanner("Line / machine assigned.", "ok");
          }}
        />
      )}
    </div>
  );
};
