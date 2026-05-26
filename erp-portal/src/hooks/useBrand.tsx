// Brand context.
//
// Resolves the deployment-wide application brand (the string the user
// sees in the topbar, login screen, command palette, mobile login).
// Single source of truth = CompanyProfile.tradeName (falls back to
// legalName, then "NovaERP" if the public/company endpoint hasn't
// resolved yet or the deployment is brand-new).
//
// We hydrate from /v1/public/company so the brand is available BEFORE
// the user logs in (login page also uses it). After save in the
// company settings form we expose refresh() so the topbar updates
// instantly without a hard reload.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type PublicCompany } from "@/lib/api";

const DEFAULT_BRAND = "NovaERP";

const STORAGE_KEY = "erp.brand.cache.v1";

interface BrandShape {
  // Display name shown in the chrome (topbar, login, palette, etc).
  brandName: string;
  // Full legal entity name - used on documents/invoices, not chrome.
  legalName: string;
  // Optional logo URL (logoUrl on CompanyProfile).
  logoUrl: string | null;
  // Reload from the server. Called by the company settings form after
  // a successful save so the chrome reflects the new name immediately.
  refresh: () => Promise<void>;
}

const BrandContext = createContext<BrandShape | undefined>(undefined);

const readCache = (): Pick<BrandShape, "brandName" | "legalName" | "logoUrl"> => {
  if (typeof window === "undefined") {
    return { brandName: DEFAULT_BRAND, legalName: DEFAULT_BRAND, logoUrl: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { brandName: DEFAULT_BRAND, legalName: DEFAULT_BRAND, logoUrl: null };
    }
    const parsed = JSON.parse(raw) as Partial<BrandShape>;
    return {
      brandName:
        (parsed.brandName ?? "").trim() ||
        (parsed.legalName ?? "").trim() ||
        DEFAULT_BRAND,
      legalName: (parsed.legalName ?? "").trim() || DEFAULT_BRAND,
      logoUrl: parsed.logoUrl ?? null,
    };
  } catch {
    return { brandName: DEFAULT_BRAND, legalName: DEFAULT_BRAND, logoUrl: null };
  }
};

const writeCache = (
  v: Pick<BrandShape, "brandName" | "legalName" | "logoUrl">
) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* quota / private mode - ignore */
  }
};

const fromPublic = (
  p: PublicCompany
): Pick<BrandShape, "brandName" | "legalName" | "logoUrl"> => {
  const trade = (p.tradeName ?? "").trim();
  const legal = (p.legalName ?? "").trim();
  return {
    brandName: trade || legal || DEFAULT_BRAND,
    legalName: legal || trade || DEFAULT_BRAND,
    logoUrl: p.logoUrl ?? null,
  };
};

export const BrandProvider = ({ children }: { children: ReactNode }) => {
  // Seed from cache so the first paint never says "NovaERP" if the
  // tenant has already loaded the app once.
  const [state, setState] = useState(() => readCache());

  const refresh = useCallback(async () => {
    try {
      const p = await api.publicCompany();
      const fresh = fromPublic(p);
      setState(fresh);
      writeCache(fresh);
      // Update tab title so the browser tab also reflects the brand.
      if (typeof document !== "undefined") {
        document.title = fresh.brandName;
      }
    } catch {
      // /public/company is best-effort; if it fails we keep whatever
      // we had cached (or the default).
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync tab title on every state change (covers the cached path).
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = state.brandName;
    }
  }, [state.brandName]);

  const value = useMemo<BrandShape>(
    () => ({ ...state, refresh }),
    [state, refresh]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
};

export const useBrand = (): BrandShape => {
  const ctx = useContext(BrandContext);
  if (ctx) return ctx;
  // Defensive fallback when a component happens to render outside the
  // provider (e.g. an error boundary). We surface the cached brand and
  // a no-op refresh so the UI doesn't crash.
  const cached = readCache();
  return { ...cached, refresh: async () => {} };
};
