import { NavLink, useNavigate } from "react-router-dom";
import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  FileText,
  Factory,
  KanbanSquare,
  LayoutDashboard,
  Network,
  Package,
  PackageCheck,
  Receipt,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Tags,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useWorkspace } from "@/hooks/useWorkspace";
import { auth } from "@/lib/api";

// Which roles can see each nav item. "admin" always passes (checked in canSee).
// A missing entry means all authenticated users can see it.
const NAV_ROLES: Record<string, string[]> = {
  products:      ["admin", "supervisor", "procurement"],
  procurement:   ["admin", "procurement"],
  "price-lists": ["admin", "procurement"],
  customers:     ["admin", "supervisor", "billing"],
  enquiries:     ["admin", "supervisor", "billing"],
  quotes:        ["admin", "supervisor", "billing"],
  "sales-orders":["admin", "supervisor", "billing"],
  picking:       ["admin", "supervisor", "warehouse", "billing"],
  packing:       ["admin", "supervisor", "warehouse", "billing"],
  returns:       ["admin", "supervisor", "billing", "warehouse"],
  inventory:     ["admin", "supervisor", "warehouse", "procurement"],
  warehouse:     ["admin", "supervisor", "warehouse"],
  transfers:     ["admin", "supervisor", "warehouse"],
  "warehouse-audit": ["admin", "warehouse"],
  manufacturing: ["admin", "supervisor"],
  boms:          ["admin", "supervisor"],
  productivity:  ["admin", "supervisor"],
  transport:     ["admin", "supervisor", "warehouse"],
  billing:       ["admin", "billing"],
  reports:       ["admin", "supervisor", "billing", "procurement"],
  "container-reports": ["admin", "supervisor", "billing", "warehouse"],
};

const BOTTOM_ROLES: Record<string, string[]> = {
  approvals:     ["admin", "supervisor", "billing"],
  settings:      ["admin"],
};

const canSee = (id: string, roleMap: Record<string, string[]>): boolean => {
  const role = auth.user()?.role ?? "";
  if (role === "admin") return true;
  const allowed = roleMap[id];
  if (!allowed) return true; // no restriction = dashboard (visible to all)
  return allowed.includes(role);
};

const ALL_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { id: "products", label: "Products", icon: Package, path: "/products" },
  { id: "procurement", label: "Procurement", icon: ShoppingCart, path: "/procurement" },
  { id: "price-lists", label: "Price Lists", icon: Tags, path: "/price-lists" },
  { id: "customers", label: "Customers", icon: Building2, path: "/customers" },
  { id: "enquiries", label: "Enquiries", icon: KanbanSquare, path: "/enquiries" },
  { id: "quotes", label: "Quotes", icon: FileText, path: "/quotes" },
  { id: "sales-orders", label: "Sales Orders", icon: ScrollText, path: "/sales-orders" },
  { id: "picking", label: "Picking", icon: Package, path: "/picking" },
  { id: "packing", label: "Packing", icon: PackageCheck, path: "/packing" },
  { id: "returns", label: "Returns", icon: RotateCcw, path: "/returns" },
  { id: "inventory", label: "Inventory", icon: Boxes, path: "/inventory" },
  { id: "warehouse", label: "Warehouse", icon: Warehouse, path: "/warehouse" },
  { id: "transfers", label: "Transfers", icon: ArrowRightLeft, path: "/transfers" },
  // `end` = exact path only (avoids /manufacturing also matching /manufacturing/boms)
  { id: "manufacturing", label: "Manufacturing", icon: Factory, path: "/manufacturing", end: true },
  { id: "boms", label: "BOMs", icon: Network, path: "/manufacturing/boms" },
  { id: "productivity", label: "Productivity", icon: Users, path: "/productivity" },
  { id: "transport", label: "Transport", icon: Truck, path: "/transport" },
  { id: "billing", label: "Billing", icon: Receipt, path: "/billing" },
  { id: "reports", label: "Reports", icon: BarChart3, path: "/reports" },
  { id: "container-reports", label: "Containers", icon: Boxes, path: "/reports/containers" },
  { id: "warehouse-audit", label: "WH Audit", icon: ShieldAlert, path: "/warehouse-audit" },
];

const ALL_BOTTOM = [
  { id: "approvals", label: "Approvals", icon: ClipboardList, path: "/approvals" },
  { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
];

export const LeftNavigation = ({ collapsed }: { collapsed: boolean }) => {
  const { openTab } = useWorkspace();
  const navigate = useNavigate();

  // Filter to items visible for the current user's role
  const items = ALL_ITEMS.filter((item) => canSee(item.id, NAV_ROLES));
  const bottom = ALL_BOTTOM.filter((item) => canSee(item.id, BOTTOM_ROLES));

  const handleNav = (item: (typeof ALL_ITEMS)[number] | (typeof ALL_BOTTOM)[number]) => {
    openTab({ id: item.id, title: item.label, path: item.path, icon: item.icon.name });
    navigate(item.path);
  };

  return (
    <nav
      className={cn(
        "flex flex-col bg-surface border-r border-border h-full transition-[width] duration-150",
        collapsed ? "w-14" : "w-56"
      )}
    >
      <div className="flex-1 overflow-y-auto py-2">
        {items.map((item) => {
          const Icon = item.icon;
          const exactOnly = "end" in item && item.end === true;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              end={exactOnly}
              onClick={(e) => {
                e.preventDefault();
                handleNav(item);
              }}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 mx-2 my-0.5 px-2.5 h-9 rounded-md text-body-sm font-medium transition-colors",
                  collapsed && "justify-center",
                  isActive
                    ? "bg-primary text-white"
                    : "text-ink hover:bg-canvas hover:text-primary"
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </div>
      <div className="border-t border-border py-2">
        {bottom.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              onClick={(e) => {
                e.preventDefault();
                handleNav(item);
              }}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 mx-2 my-0.5 px-2.5 h-9 rounded-md text-body-sm font-medium",
                  collapsed && "justify-center",
                  isActive ? "bg-primary text-white" : "text-ink-muted hover:bg-canvas hover:text-primary"
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
