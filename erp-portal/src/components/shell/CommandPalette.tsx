import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CornerDownLeft,
  Factory,
  LayoutDashboard,
  Network,
  Package,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useBrand } from "@/hooks/useBrand";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { moPrimaryLabel, moSearchText } from "@/lib/mo-display";
import type { Invoice, Product, ProductionOrder, Vendor, Worker } from "@/data/types";

interface CmdItem {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette = ({ open, onClose }: Props) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { openTab } = useWorkspace();
  const { brandName } = useBrand();
  const [activeIdx, setActiveIdx] = useState(0);

  const [products, setProducts] = useState<Product[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
      // Lazy fetch live data on open (cached after first time)
      void Promise.allSettled([
        products.length === 0
          ? api.products({ limit: 200 }).then(setProducts)
          : Promise.resolve(),
        invoices.length === 0 ? api.invoices().then(setInvoices) : Promise.resolve(),
        vendors.length === 0 ? api.vendors().then(setVendors) : Promise.resolve(),
        workers.length === 0 ? api.workers().then(setWorkers) : Promise.resolve(),
        productionOrders.length === 0
          ? api
              .productionOrdersWithWO()
              .then((d) => setProductionOrders(d.orders))
          : Promise.resolve(),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const navItems: CmdItem[] = useMemo(
    () =>
      [
        { id: "go-dashboard", title: "Go to Dashboard", path: "/dashboard", icon: <LayoutDashboard size={16} />, tabId: "dashboard" },
        { id: "go-products", title: "Go to Products", path: "/products", icon: <Package size={16} />, tabId: "products" },
        { id: "go-customers", title: "Go to Customers", path: "/customers", icon: <Building2 size={16} />, tabId: "customers" },
        { id: "go-procurement", title: "Go to Procurement", path: "/procurement", icon: <ShoppingCart size={16} />, tabId: "procurement" },
        { id: "go-inventory", title: "Go to Inventory", path: "/inventory", icon: <Boxes size={16} />, tabId: "inventory" },
        {
          id: "go-inventory-locations",
          title: "Find stock locations",
          path: "/inventory?tab=locations",
          icon: <Boxes size={16} />,
          tabId: "inventory",
        },
        { id: "go-warehouse", title: "Go to Warehouse", path: "/warehouse", icon: <Warehouse size={16} />, tabId: "warehouse" },
        { id: "go-mfg", title: "Go to Manufacturing", path: "/manufacturing", icon: <Factory size={16} />, tabId: "manufacturing" },
        { id: "go-boms", title: "Go to BOMs", path: "/manufacturing/boms", icon: <Network size={16} />, tabId: "boms" },
        { id: "go-prod", title: "Go to Productivity", path: "/productivity", icon: <Users size={16} />, tabId: "productivity" },
        { id: "go-tx", title: "Go to Transport", path: "/transport", icon: <Truck size={16} />, tabId: "transport" },
        { id: "go-billing", title: "Go to Billing", path: "/billing", icon: <Receipt size={16} />, tabId: "billing" },
        { id: "go-reports", title: "Go to Reports", path: "/reports", icon: <BarChart3 size={16} />, tabId: "reports" },
        { id: "go-container-reports", title: "Go to Container reports", path: "/reports/containers", icon: <Boxes size={16} />, tabId: "container-reports" },
        { id: "go-approvals", title: "Go to Approvals", path: "/approvals", icon: <ClipboardList size={16} />, tabId: "approvals" },
        { id: "go-settings", title: "Go to Settings", path: "/settings", icon: <Settings size={16} />, tabId: "settings" },
        {
          id: "go-putaway-rules",
          title: "Go to Putaway rules",
          path: "/putaway-rules",
          icon: <ArrowRightLeft size={16} />,
          tabId: "putaway-rules",
        },
      ].map((x) => ({
        id: x.id,
        group: "Navigation",
        title: x.title,
        icon: x.icon,
        action: () => {
          openTab({ id: x.tabId, title: x.title.replace("Go to ", ""), path: x.path });
          navigate(x.path);
          onClose();
        },
      })),
    [navigate, onClose, openTab]
  );

  const actionItems: CmdItem[] = useMemo(
    () => [
      {
        id: "act-invoice",
        group: "Quick Actions",
        title: "New Invoice",
        hint: "F2",
        icon: <Receipt size={16} />,
        action: () => {
          openTab({ id: "billing", title: "Billing", path: "/billing" });
          navigate("/billing");
          onClose();
        },
      },
      {
        id: "act-po",
        group: "Quick Actions",
        title: "New Purchase Order",
        icon: <ShoppingCart size={16} />,
        action: () => {
          openTab({ id: "procurement", title: "Procurement", path: "/procurement" });
          navigate("/procurement");
          onClose();
        },
      },
      {
        id: "act-transfer",
        group: "Quick Actions",
        title: "Stock Transfer",
        icon: <Boxes size={16} />,
        action: () => {
          openTab({ id: "warehouse", title: "Warehouse", path: "/warehouse" });
          navigate("/warehouse");
          onClose();
        },
      },
      {
        id: "act-mo",
        group: "Quick Actions",
        title: "New Production Order",
        icon: <Factory size={16} />,
        action: () => {
          openTab({ id: "manufacturing", title: "Manufacturing", path: "/manufacturing" });
          navigate("/manufacturing");
          onClose();
        },
      },
    ],
    [navigate, onClose, openTab]
  );

  const records: CmdItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: CmdItem[] = [];
    for (const p of products) {
      const variantHit = (p.variants ?? []).find(
        (v) =>
          v.sku.toLowerCase().includes(q) ||
          (v.barcode ?? "").toLowerCase().includes(q)
      );
      if (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        variantHit
      ) {
        const code = variantHit?.barcode?.trim() || variantHit?.sku || p.barcode || p.sku;
        out.push({
          id: `p-${p.id}${variantHit ? `-${variantHit.id}` : ""}`,
          group: "Products",
          title: `${code} — ${p.name}${variantHit ? ` · ${[variantHit.size, variantHit.color, variantHit.grade].filter(Boolean).join(" · ")}` : ""}`,
          hint: variantHit?.barcode ?? p.barcode,
          icon: <Package size={16} />,
          action: () => {
            openTab({ id: "products", title: "Products", path: "/products" });
            navigate("/products");
            onClose();
          },
        });
        if (out.length >= 6) break;
      }
    }
    for (const inv of invoices) {
      if (inv.invoiceNo.toLowerCase().includes(q) || inv.customer.toLowerCase().includes(q)) {
        out.push({
          id: `i-${inv.id}`,
          group: "Invoices",
          title: `${inv.invoiceNo} — ${inv.customer}`,
          icon: <Receipt size={16} />,
          action: () => {
            openTab({ id: "billing", title: "Billing", path: "/billing" });
            navigate("/billing");
            onClose();
          },
        });
        if (out.filter((x) => x.group === "Invoices").length >= 4) break;
      }
    }
    for (const v of vendors) {
      if (v.name.toLowerCase().includes(q)) {
        out.push({
          id: `v-${v.id}`,
          group: "Vendors",
          title: v.name,
          hint: v.city,
          icon: <ShoppingCart size={16} />,
          action: () => {
            openTab({ id: "procurement", title: "Procurement", path: "/procurement" });
            navigate("/procurement");
            onClose();
          },
        });
        if (out.filter((x) => x.group === "Vendors").length >= 3) break;
      }
    }
    for (const w of workers) {
      if (w.name.toLowerCase().includes(q) || w.empNo.toLowerCase().includes(q)) {
        out.push({
          id: `w-${w.id}`,
          group: "Workers",
          title: `${w.empNo} — ${w.name}`,
          icon: <Users size={16} />,
          action: () => {
            openTab({ id: "productivity", title: "Productivity", path: "/productivity" });
            navigate("/productivity");
            onClose();
          },
        });
        if (out.filter((x) => x.group === "Workers").length >= 3) break;
      }
    }
    for (const po of productionOrders) {
      if (moSearchText(po).includes(q)) {
        out.push({
          id: `mo-${po.id}`,
          group: "Production Orders",
          title: `${po.orderNo} — ${moPrimaryLabel(po)}`,
          icon: <Factory size={16} />,
          action: () => {
            openTab({ id: "manufacturing", title: "Manufacturing", path: "/manufacturing" });
            navigate("/manufacturing");
            onClose();
          },
        });
        if (out.filter((x) => x.group === "Production Orders").length >= 3) break;
      }
    }
    return out;
  }, [query, navigate, onClose, openTab]);

  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...actionItems, ...navItems];
    const filterFn = (i: CmdItem) => i.title.toLowerCase().includes(q);
    return [...records, ...actionItems.filter(filterFn), ...navItems.filter(filterFn)];
  }, [query, actionItems, navItems, records]);

  useEffect(() => setActiveIdx(0), [query]);

  if (!open) return null;

  const groups = all.reduce<Record<string, CmdItem[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item);
    return acc;
  }, {});

  const flatActiveItem = all[activeIdx];

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] animate-fade-in"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="w-full max-w-[640px] bg-surface rounded-xl shadow-e3 border border-border overflow-hidden mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
          <Search size={18} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, all.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                flatActiveItem?.action();
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Type a command, search products, invoices, workers, orders…"
            className="flex-1 bg-transparent outline-none text-body text-ink placeholder:text-ink-muted/70"
          />
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                {group}
              </div>
              {items.map((item) => {
                const idx = all.indexOf(item);
                const active = idx === activeIdx;
                return (
                  <button
                    key={item.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => item.action()}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 h-10 text-left text-body-sm transition-colors",
                      active ? "bg-primary-50 text-primary" : "text-ink hover:bg-canvas"
                    )}
                  >
                    <span className={cn("shrink-0", active ? "text-primary" : "text-ink-muted")}>
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.hint && (
                      <span className="text-caption text-ink-muted font-mono">{item.hint}</span>
                    )}
                    {active && <ArrowRight size={14} className="text-primary" />}
                  </button>
                );
              })}
            </div>
          ))}
          {all.length === 0 && (
            <div className="px-4 py-12 text-center text-ink-muted text-body-sm">
              No results for “{query}”
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 h-9 flex items-center justify-between text-caption text-ink-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={11} /> select
            </span>
            <span className="flex items-center gap-1">
              <span className="kbd">Esc</span> close
            </span>
          </div>
          <span>{brandName} Command Palette</span>
        </div>
      </div>
    </div>
  );
};
