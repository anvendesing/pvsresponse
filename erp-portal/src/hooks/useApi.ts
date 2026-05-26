import { useCallback, useEffect, useState } from "react";
import { apiEnabled } from "@/lib/api";

export const useApi = <T>(loader: () => Promise<T>, deps: unknown[] = []) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(apiEnabled);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!apiEnabled) {
      setError(new Error("VITE_API_URL is not set; portal cannot reach the API."));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = await loader();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { data, loading, error, apiEnabled, refetch: fetch };
};
