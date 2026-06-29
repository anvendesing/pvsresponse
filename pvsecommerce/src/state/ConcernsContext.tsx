import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, resolveUploadUrl, type StorefrontConcern } from "@/lib/api";

interface ConcernsContextValue {
  concerns: StorefrontConcern[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  bySlug: Map<string, StorefrontConcern>;
  concernImageUrl: (c: StorefrontConcern) => string;
}

const ConcernsContext = createContext<ConcernsContextValue | null>(null);

export const ConcernsProvider = ({ children }: { children: ReactNode }) => {
  const [concerns, setConcerns] = useState<StorefrontConcern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.concerns();
      setConcerns(list);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : (e as Error).message ?? "Could not load concerns."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bySlug = useMemo(() => {
    const m = new Map<string, StorefrontConcern>();
    for (const c of concerns) m.set(c.slug, c);
    return m;
  }, [concerns]);

  const concernImageUrl = useCallback((c: StorefrontConcern): string => {
    return resolveUploadUrl(c.imageUrl) ?? "";
  }, []);

  const value = useMemo(
    () => ({ concerns, loading, error, refresh, bySlug, concernImageUrl }),
    [concerns, loading, error, refresh, bySlug, concernImageUrl]
  );

  return (
    <ConcernsContext.Provider value={value}>{children}</ConcernsContext.Provider>
  );
};

export const useConcerns = (): ConcernsContextValue => {
  const ctx = useContext(ConcernsContext);
  if (!ctx) throw new Error("useConcerns must be used inside <ConcernsProvider>");
  return ctx;
};
