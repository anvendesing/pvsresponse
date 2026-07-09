import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  LayoutGrid,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { EmptyState } from "@/components/common/EmptyState";
import { Toolbar } from "@/components/common/Toolbar";
import { MoCardGridItem } from "@/components/manufacturing/cards/MoCardGridItem";
import { MoExpandedWorkspace, type MoWorkspaceTab } from "@/components/manufacturing/cards/MoExpandedWorkspace";
import { NewMoModal } from "@/components/manufacturing/NewMoModal";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { moSearchText } from "@/lib/mo-display";
import { isMoClosed } from "@/lib/mo-utils";

export const ManufacturingCards = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const liveMo = useApi(() => api.productionOrdersWithWO(), []);
  const liveBoms = useApi(() => api.boms(), []);

  const productionOrders = liveMo.data?.orders ?? [];
  const workOrders = liveMo.data?.workOrders ?? [];
  const boms = liveBoms.data ?? [];
  const activeBoms = boms.filter((b) => b.active);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Persist workspace tab per MO so refetches don't reset the user's context. */
  const [tabByMo, setTabByMo] = useState<Record<string, MoWorkspaceTab>>({});
  const [listTab, setListTab] = useState<"active" | "history">("active");
  const [search, setSearch] = useState("");
  const [showNewMo, setShowNewMo] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [errBanner, setErrBanner] = useState<string | null>(null);

  // Deep-link: /manufacturing?moId=… (or ?focus=…) opens that MO expanded
  useEffect(() => {
    const moId = searchParams.get("moId") ?? searchParams.get("focus");
    if (!moId) return;
    setExpandedId(moId);
    const next = new URLSearchParams(searchParams);
    next.delete("moId");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const ordersNewestFirst = useMemo(() => {
    const arr = [...productionOrders];
    arr.sort((a, b) => {
      if (a.orderNo !== b.orderNo) return b.orderNo.localeCompare(a.orderNo);
      return (b.startDate ?? "").localeCompare(a.startDate ?? "");
    });
    return arr;
  }, [productionOrders]);

  const activeOrders = useMemo(
    () => ordersNewestFirst.filter((p) => !isMoClosed(p.status)),
    [ordersNewestFirst]
  );
  const closedOrders = useMemo(
    () => ordersNewestFirst.filter((p) => isMoClosed(p.status)),
    [ordersNewestFirst]
  );

  const railOrders = listTab === "history" ? closedOrders : activeOrders;

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = railOrders;
    if (q) list = list.filter((o) => moSearchText(o).includes(q));
    if (listTab === "active") {
      list = [...list].sort((a, b) => {
        const ua = a.urgentQty ?? 0;
        const ub = b.urgentQty ?? 0;
        if (ub !== ua) return ub - ua;
        return b.orderNo.localeCompare(a.orderNo);
      });
    }
    return list;
  }, [railOrders, search, listTab]);

  const expandedOrder = useMemo(
    () => (expandedId ? productionOrders.find((p) => p.id === expandedId) ?? null : null),
    [expandedId, productionOrders]
  );

  // Only block the page on the first load — background refetches (e.g. after
  // completing a work order) must not unmount the expanded workspace.
  const loading =
    (liveMo.loading && !liveMo.data) || (liveBoms.loading && !liveBoms.data);
  const errorObj = liveMo.error ?? liveBoms.error;

  const setBanner = useCallback((msg: string, tone: "ok" | "err") => {
    if (tone === "err") {
      setErrBanner(msg);
      setOkBanner(null);
    } else {
      setOkBanner(msg);
      setErrBanner(null);
    }
  }, []);

  const handleTabChange = useCallback((moId: string, tab: MoWorkspaceTab) => {
    setTabByMo((prev) => ({ ...prev, [moId]: tab }));
  }, []);

  if (loading || errorObj) {
    return (
      <div className="h-full flex flex-col">
        <Toolbar left={<h2 className="text-h3 font-bold">Manufacturing</h2>} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            loading={loading}
            error={errorObj}
            onRetry={() => {
              liveMo.refetch();
              liveBoms.refetch();
            }}
          />
        </div>
      </div>
    );
  }

  // Expanded workspace takes over the full content area
  if (expandedOrder) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {(okBanner || errBanner) && (
          <div
            className={cn(
              "px-4 py-2 border-b text-body-sm flex items-center gap-2 shrink-0",
              okBanner ? "bg-success-soft border-success text-success" : "bg-danger-soft border-danger text-danger"
            )}
          >
            {okBanner ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span className="flex-1">{okBanner ?? errBanner}</span>
            <button
              type="button"
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
        <MoExpandedWorkspace
          order={expandedOrder}
          workOrders={workOrders}
          boms={boms}
          activeTab={tabByMo[expandedOrder.id] ?? "status"}
          onTabChange={(tab) => handleTabChange(expandedOrder.id, tab)}
          onClose={() => setExpandedId(null)}
          onRefreshList={async () => {
            await liveMo.refetch();
          }}
          onBanner={setBanner}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Toolbar
        left={
          <h2 className="text-h3 font-bold flex items-center gap-2">
            <LayoutGrid size={20} className="text-primary" />
            Manufacturing
          </h2>
        }
        right={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/manufacturing")}
            >
              Unified view
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Network size={14} />}
              onClick={() => navigate("/manufacturing/boms")}
            >
              BOMs
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setShowNewMo(true)}
              disabled={activeBoms.length === 0}
            >
              New order
            </Button>
          </>
        }
      />

      {(okBanner || errBanner) && (
        <div
          className={cn(
            "px-4 py-2 border-b text-body-sm flex items-center gap-2",
            okBanner ? "bg-success-soft border-success text-success" : "bg-danger-soft border-danger text-danger"
          )}
        >
          {okBanner ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <span className="flex-1">{okBanner ?? errBanner}</span>
          <button type="button" className="underline text-caption" onClick={() => { setOkBanner(null); setErrBanner(null); }}>
            dismiss
          </button>
        </div>
      )}

      {/* List controls */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(
            [
              { id: "active" as const, label: "Active", count: activeOrders.length },
              { id: "history" as const, label: "History", count: closedOrders.length },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setListTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-sm transition-colors",
                listTab === tab.id
                  ? "bg-primary text-white font-semibold"
                  : "bg-canvas text-ink-muted hover:text-ink"
              )}
            >
              {tab.label}
              <span className="text-[10px] tnum opacity-80">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-muted pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, SKU, product…"
            className="h-9 w-full pl-8 pr-3 rounded-lg border border-border bg-white text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <Chip tone="neutral" size="sm" icon={<ClipboardList size={12} />}>
          {filteredOrders.length} shown
        </Chip>
      </div>

      {/* Card grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-canvas">
        {filteredOrders.length === 0 ? (
          <EmptyState
            empty
            emptyTitle={listTab === "history" ? "No closed orders" : "No active orders"}
            emptyDescription={
              listTab === "history"
                ? "Completed and cancelled MOs appear here."
                : "Create a manufacturing order or switch to History."
            }
            action={
              listTab === "active" ? (
                <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowNewMo(true)}>
                  New order
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredOrders.map((order) => (
              <MoCardGridItem
                key={order.id}
                order={order}
                onClick={() => setExpandedId(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showNewMo && (
        <NewMoModal
          boms={boms}
          onClose={() => setShowNewMo(false)}
          onCreated={(orderNo, productionOrderId) => {
            setShowNewMo(false);
            setExpandedId(productionOrderId);
            setBanner(`MO ${orderNo} created.`, "ok");
            void liveMo.refetch();
          }}
        />
      )}
    </div>
  );
};
