// Cart state. Lives entirely in localStorage so a page reload doesn't
// drop what the customer added. The cart shape is exactly what
// /storefront-mock/order accepts - the checkout page stringifies it
// straight to the backend.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CartLine, CatalogProduct, CatalogVariant } from "@/lib/api";
import { packagingFromName } from "@/lib/format";

const STORAGE_KEY = "pv_cart_v1";

const readStored = (): CartLine[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as CartLine).productId === "string" &&
        typeof (l as CartLine).qty === "number"
    );
  } catch {
    return [];
  }
};

interface CartContextValue {
  lines: CartLine[];
  count: number;
  subTotal: number;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  add: (product: CatalogProduct, variant: CatalogVariant | null, qty?: number) => void;
  setQty: (lineKey: string, qty: number) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
  // The line key is variantId when the line is a variant, otherwise
  // productId. Callers should derive it via lineKeyFor().
}

export const lineKeyFor = (line: CartLine): string =>
  line.variantId ?? line.productId;

const CartContext = createContext<CartContextValue | null>(null);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [lines, setLines] = useState<CartLine[]>(() => readStored());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Storage might be full or blocked - cart will reset on reload,
      // but the page itself keeps working.
    }
  }, [lines]);

  const add = useCallback(
    (product: CatalogProduct, variant: CatalogVariant | null, qty = 1) => {
      setLines((prev) => {
        const key = variant?.id ?? product.id;
        const idx = prev.findIndex(
          (l) => (l.variantId ?? l.productId) === key
        );
        const available = variant
          ? variant.stockOnHand
          : product.stockOnHand;
        if (idx >= 0) {
          const next = [...prev];
          const want = Math.min(next[idx].qty + qty, available);
          next[idx] = { ...next[idx], qty: want };
          return next;
        }
        const rate = variant?.price ?? product.sellingPrice;
        return [
          ...prev,
          {
            productId: product.id,
            productSku: product.sku,
            productName: product.name,
            variantId: variant?.id ?? null,
            variantSku: variant?.sku ?? null,
            variantSize: variant?.size ?? null,
            qty: Math.min(qty, available),
            rate,
            available,
            packagingHint: packagingFromName(product.name),
          },
        ];
      });
      setDrawerOpen(true);
    },
    []
  );

  const setQty = useCallback((lineKey: string, qty: number) => {
    setLines((prev) => {
      if (qty <= 0) {
        return prev.filter((l) => (l.variantId ?? l.productId) !== lineKey);
      }
      return prev.map((l) =>
        (l.variantId ?? l.productId) === lineKey
          ? { ...l, qty: Math.min(qty, l.available) }
          : l
      );
    });
  }, []);

  const remove = useCallback((lineKey: string) => {
    setLines((prev) =>
      prev.filter((l) => (l.variantId ?? l.productId) !== lineKey)
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    const subTotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const count = lines.reduce((s, l) => s + l.qty, 0);
    return {
      lines,
      count,
      subTotal,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      add,
      setQty,
      remove,
      clear,
    };
  }, [lines, drawerOpen, add, setQty, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextValue => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
};
