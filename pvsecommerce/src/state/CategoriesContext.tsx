import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, resolveUploadUrl, type StorefrontCategory } from "@/lib/api";

interface CategoriesContextValue {
  categories: StorefrontCategory[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  bySlug: Map<string, StorefrontCategory>;
  categoryImageUrl: (c: StorefrontCategory) => string;
}

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

export const CategoriesProvider = ({ children }: { children: ReactNode }) => {
  const [categories, setCategories] = useState<StorefrontCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.categories();
      setCategories(list);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : (e as Error).message ?? "Could not load categories."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bySlug = useMemo(() => {
    const m = new Map<string, StorefrontCategory>();
    for (const c of categories) m.set(c.slug, c);
    return m;
  }, [categories]);

  const categoryImageUrl = useCallback((c: StorefrontCategory): string => {
    return resolveUploadUrl(c.imageUrl) ?? `/images/category_${c.slug}.png`;
  }, []);

  const value = useMemo(
    () => ({ categories, loading, error, refresh, bySlug, categoryImageUrl }),
    [categories, loading, error, refresh, bySlug, categoryImageUrl]
  );

  return (
    <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>
  );
};

export const useCategories = (): CategoriesContextValue => {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error("useCategories must be used inside <CategoriesProvider>");
  return ctx;
};
