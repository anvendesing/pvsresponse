import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ClipboardList,
  Package,
  Settings2,
  Truck,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { MoWorkOrdersPanel } from "@/components/manufacturing/MoWorkOrdersPanel";
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

const SECTIONS = [
  { id: "overview", label: "Overview", icon: Settings2 },
  { id: "materials", label: "Materials", icon: ClipboardList },
  { id: "work-orders", label: "Work orders", icon: Wrench },
  { id: "output", label: "Output", icon: Package },
  { id: "transfers", label: "Transfers", icon: Truck },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface Props {
  order: ProductionOrder;
  workOrders: WorkOrder[];
  boms: Bom[];
  onClose: () => void;
  onRefreshList: () => Promise<void>;
  onBanner: (msg: string, tone: "ok" | "err") => void;
}

const SectionHeader = ({
  id,
  label,
  icon: Icon,
}: {
  id: SectionId;
  label: string;
  icon: typeof Settings2;
}) => (
  <div
    id={`mo-section-${id}`}
    className="flex items-center gap-2 pt-2 pb-1 scroll-mt-24"
  >
    <div className="h-8 w-8 grid place-items-center rounded-md bg-primary/10 text-primary shrink-0">
      <Icon size={16} />
    </div>
    <h3 className="text-body font-bold">{label}</h3>
  </div>
);

export const MoUnifiedWorkspace = ({
  order,
  workOrders,
  boms,
  onClose,
  onRefreshList,
  onBanner,
}: Props) => {
  const [requirements, setRequirements] = useState<MoRequirements | null>(null);
  const [inventoryTrail, setInventoryTrail] = useState<MoInventoryTrail | null>(null);
  const [linkedTOs, setLinkedTOs] = useState<TransferOrderRow[] | null>(null);
  const [loadingReq, setLoadingReq] = useState(false);
  const [loadingTrail, setLoadingTrail] = useState(false);
  const [loadingTOs, setLoadingTOs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setRequirements(null);
    setInventoryTrail(null);
    setLinkedTOs(null);
    void Promise.all([loadRequirements(), loadTrail(), loadTransfers()]);
  }, [order.id, loadRequirements, loadTrail, loadTransfers]);

  const refreshAfterAction = async () => {
    await onRefreshList();
    await Promise.all([loadRequirements(), loadTrail(), loadTransfers()]);
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
          ? "Issued with shortages — check Materials below."
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
          : "MO closed.",
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

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    document.getElementById(`mo-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id?.startsWith("mo-section-")) {
          setActiveSection(visible.target.id.replace("mo-section-", "") as SectionId);
        }
      },
      { root, rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5] }
    );

    for (const s of SECTIONS) {
      const el = document.getElementById(`mo-section-${s.id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [order.id]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-canvas">
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
              {num(order.plannedQty)} output · scroll to edit any section
            </p>
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption whitespace-nowrap transition-colors",
                activeSection === s.id
                  ? "bg-primary text-white font-semibold"
                  : "bg-canvas text-ink-muted hover:text-ink"
              )}
            >
              <s.icon size={13} />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-8">
        <section>
          <SectionHeader id="overview" label="Overview" icon={Settings2} />
          <MoStatusTab
            order={order}
            busy={busy}
            unified
            onCancel={onCancel}
            onComplete={onComplete}
          />
        </section>

        <section>
          <SectionHeader id="materials" label="Materials" icon={ClipboardList} />
          <MoMaterialsTab
            order={order}
            requirements={requirements}
            loading={loadingReq}
            busy={busy}
            onRefresh={() => void loadRequirements()}
            onRelease={onRelease}
            onIssue={onIssue}
          />
        </section>

        <section>
          <SectionHeader id="work-orders" label="Work orders" icon={Wrench} />
          <MoWorkOrdersPanel
            order={order}
            workOrders={wos}
            moComplete={order.status === "completed"}
            bomByproducts={orderBom?.byproducts ?? []}
            bomOutputQty={orderBom?.outputQty ?? 1}
            onRefresh={refreshAfterAction}
            onMessage={(msg, tone) => onBanner(msg, tone === "err" ? "err" : "ok")}
            inlineDialogs
          />
        </section>

        <section>
          <SectionHeader id="output" label="Output & consumption" icon={Package} />
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
            alwaysShowCorrection
          />
        </section>

        <section>
          <SectionHeader id="transfers" label="Transfers" icon={Truck} />
          <MoTransfersTab transfers={linkedTOs} loading={loadingTOs} />
        </section>
      </div>
    </div>
  );
};
