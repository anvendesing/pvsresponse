// Single shared fetch of /storefront-mock/catalog. Pages that need
// products (HomePage, CategoryPage, CartPage stock guard) all read
// from this context so we don't fan out duplicate network requests
// just because the user navigated client-side.
//
// Refetched on first mount and exposed via `refresh()`. Errors are
// surfaced as `error` so the consuming page can render a friendly
// banner rather than blowing up.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type CatalogProduct } from "@/lib/api";

interface CatalogContextValue {
  products: CatalogProduct[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  byId: Map<string, CatalogProduct>;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export const CatalogProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.catalog();
      setProducts(list);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : (e as Error).message ?? "Could not load catalog."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => {
    const m = new Map<string, CatalogProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const value = useMemo<CatalogContextValue>(
    () => ({ products, loading, error, refresh, byId }),
    [products, loading, error, refresh, byId]
  );

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
};

export const useCatalog = (): CatalogContextValue => {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used inside <CatalogProvider>");
  return ctx;
};
