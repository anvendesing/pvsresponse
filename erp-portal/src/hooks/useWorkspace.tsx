import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

export interface WorkspaceTab {
  id: string;
  title: string;
  path: string;
  icon?: string;
  pinned?: boolean;
}

interface WorkspaceContextValue {
  tabs: WorkspaceTab[];
  activeId: string | null;
  openTab: (tab: WorkspaceTab) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const DEFAULT_TABS: WorkspaceTab[] = [
  { id: "dashboard", title: "Dashboard", path: "/dashboard", icon: "LayoutDashboard", pinned: true },
];

// Known routes -> tab metadata. Used by the URL-sync effect so that
// refreshing or deep-linking to any of these paths auto-opens the
// corresponding workspace tab. Keep this in sync with LeftNavigation.
const ROUTE_TABS: Record<string, Omit<WorkspaceTab, "pinned">> = {
  "/dashboard":     { id: "dashboard",     title: "Dashboard",     path: "/dashboard",     icon: "LayoutDashboard" },
  "/products":      { id: "products",      title: "Products",      path: "/products",      icon: "Package" },
  "/customers":     { id: "customers",     title: "Customers",     path: "/customers",     icon: "Building2" },
  "/procurement":   { id: "procurement",   title: "Procurement",   path: "/procurement",   icon: "ShoppingCart" },
  "/price-lists":   { id: "price-lists",   title: "Price Lists",   path: "/price-lists",   icon: "Tags" },
  "/quotes":        { id: "quotes",        title: "Quotes",        path: "/quotes",        icon: "FileText" },
  "/sales-orders":  { id: "sales-orders",  title: "Sales Orders",  path: "/sales-orders",  icon: "ScrollText" },
  "/picking":       { id: "picking",       title: "Picking",       path: "/picking",       icon: "Package" },
  "/packing":       { id: "packing",       title: "Packing",       path: "/packing",       icon: "PackageCheck" },
  "/returns":       { id: "returns",       title: "Returns",       path: "/returns",       icon: "RotateCcw" },
  "/inventory":     { id: "inventory",     title: "Inventory",     path: "/inventory",     icon: "Boxes" },
  "/warehouse":     { id: "warehouse",     title: "Warehouse",     path: "/warehouse",     icon: "Warehouse" },
  "/manufacturing": { id: "manufacturing", title: "Manufacturing", path: "/manufacturing", icon: "Factory" },
  "/productivity":  { id: "productivity",  title: "Productivity",  path: "/productivity",  icon: "Users" },
  "/transport":     { id: "transport",     title: "Transport",     path: "/transport",     icon: "Truck" },
  "/billing":       { id: "billing",       title: "Billing",       path: "/billing",       icon: "Receipt" },
  "/reports":       { id: "reports",       title: "Reports",       path: "/reports",       icon: "BarChart3" },
  "/approvals":     { id: "approvals",     title: "Approvals",     path: "/approvals",     icon: "ClipboardList" },
  "/settings":      { id: "settings",      title: "Settings",      path: "/settings",      icon: "Settings" },
};

const STORAGE_KEY = "novaerp.workspace.v1";

interface PersistedState {
  tabs: WorkspaceTab[];
  activeId: string | null;
}

const loadPersisted = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.tabs)) return null;
    // Re-pin the dashboard in case the user serialised an unpinned copy
    // before the pinned flag was introduced; also dedupe by id.
    const seen = new Set<string>();
    const tabs = parsed.tabs.filter((t) => {
      if (!t || typeof t.id !== "string" || typeof t.path !== "string") return false;
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    if (!tabs.some((t) => t.id === "dashboard")) {
      tabs.unshift(DEFAULT_TABS[0]);
    } else {
      // Make sure dashboard tab is marked pinned, even on legacy state.
      for (const t of tabs) if (t.id === "dashboard") t.pinned = true;
    }
    return { tabs, activeId: parsed.activeId ?? tabs[0]?.id ?? null };
  } catch {
    return null;
  }
};

export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const persisted = useRef<PersistedState | null>(loadPersisted()).current;
  const [tabs, setTabs] = useState<WorkspaceTab[]>(persisted?.tabs ?? DEFAULT_TABS);
  const [activeId, setActiveId] = useState<string | null>(
    persisted?.activeId ?? "dashboard"
  );

  const location = useLocation();

  const openTab = useCallback((tab: WorkspaceTab) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveId(tab.id);
  }, []);

  // Keep the workspace tab in sync with the current URL. Without this, a
  // page refresh on (say) /quotes resets the tab strip to just Dashboard
  // even though the page content is correct, which looks like the tab was
  // closed. We auto-open / auto-activate the matching tab on every route
  // change.
  useEffect(() => {
    const match = ROUTE_TABS[location.pathname];
    if (!match) return;
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === match.id);
      if (existing) return prev;
      return [...prev, { ...match }];
    });
    setActiveId(match.id);
  }, [location.pathname]);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const t = prev.find((x) => x.id === id);
        if (t?.pinned) return prev;
        const next = prev.filter((x) => x.id !== id);
        if (activeId === id) {
          const idx = prev.findIndex((x) => x.id === id);
          const fallback = next[idx] ?? next[idx - 1] ?? next[0] ?? null;
          setActiveId(fallback ? fallback.id : null);
        }
        return next;
      });
    },
    [activeId]
  );

  const activate = useCallback((id: string) => setActiveId(id), []);

  const closeOthers = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id === id || t.pinned));
    setActiveId(id);
  }, []);

  const closeAll = useCallback(() => {
    setTabs((prev) => prev.filter((t) => t.pinned));
    setActiveId(() => DEFAULT_TABS[0].id);
  }, []);

  // Persist tab state. We intentionally write on every change (cheap; this
  // is a tiny payload) so that closing the browser mid-session restores
  // exactly what the user had open.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: PersistedState = { tabs, activeId };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be disabled (private mode, quota); ignore.
    }
  }, [tabs, activeId]);

  const value = useMemo(
    () => ({ tabs, activeId, openTab, closeTab, activate, closeOthers, closeAll }),
    [tabs, activeId, openTab, closeTab, activate, closeOthers, closeAll]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be inside WorkspaceProvider");
  return ctx;
};
