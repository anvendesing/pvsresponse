// useUoms - fetch the canonical UoM master and cache it module-wide.
//
// The master is effectively static (seeded at deploy time) so we only
// hit the API once per session and share the result across every
// caller via a singleton promise. Components just call useUoms() and
// get { categories, byCode, loading, error }.
//
// The hook also exposes lookup helpers:
//   * byCode(code)  - resolve a single UoM
//   * sameCategory(a, b) - check two UoM codes share a category
//   * convert(qty, from, to) - in-process conversion using the cached
//     factors (matches the backend's POST /uoms/convert)
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Uom, UomCategory } from "@/data/types";

interface UomMaster {
  categories: UomCategory[];
  flat: Uom[];
  byCode: Map<string, Uom>;
}

let cachedPromise: Promise<UomMaster> | null = null;

const fetchMaster = async (): Promise<UomMaster> => {
  const categories = await api.uomCategories();
  const flat: Uom[] = [];
  const byCode = new Map<string, Uom>();
  for (const c of categories) {
    for (const u of c.uoms) {
      const enriched: Uom = {
        ...u,
        category: { code: c.code, name: c.name },
      };
      flat.push(enriched);
      byCode.set(u.code, enriched);
    }
  }
  return { categories, flat, byCode };
};

export const useUoms = () => {
  const [master, setMaster] = useState<UomMaster | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!cachedPromise) cachedPromise = fetchMaster();
    let cancelled = false;
    cachedPromise
      .then((m) => {
        if (!cancelled) setMaster(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e as Error);
        // Reset so a later mount can retry.
        cachedPromise = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byCode = (code: string): Uom | undefined => master?.byCode.get(code);
  const sameCategory = (a: string, b: string): boolean => {
    if (a === b) return true;
    const ua = byCode(a);
    const ub = byCode(b);
    return !!ua && !!ub && ua.category?.code === ub.category?.code;
  };
  const convert = (qty: number, from: string, to: string): number => {
    if (from === to) return qty;
    const ua = byCode(from);
    const ub = byCode(to);
    if (!ua || !ub) {
      throw new Error(`Unknown UoM in conversion: ${from} -> ${to}`);
    }
    if (ua.category?.code !== ub.category?.code) {
      throw new Error(
        `Cannot convert across categories (${from} -> ${to})`
      );
    }
    return (qty * ua.factor) / ub.factor;
  };

  return {
    loading: !master && !error,
    error,
    categories: master?.categories ?? [],
    flat: master?.flat ?? [],
    byCode,
    sameCategory,
    convert,
  };
};
