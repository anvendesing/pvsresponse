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
import { findCatalogLine, stockCapFor } from "@/lib/cartStock";
import { packagingFromName, variantLabelFrom } from "@/lib/format";
import { track } from "@/lib/activity";

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
  /** Merge multiple lines in one update; does not open the cart drawer. */
  addMany: (
    items: { product: CatalogProduct; variant: CatalogVariant | null; qty: number }[]
  ) => void;
  setQty: (lineKey: string, qty: number) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
  /** Refresh per-line stock caps from the live catalog. */
  syncStock: (products: CatalogProduct[]) => void;
  // The line key is variantId when the line is a variant, otherwise
  // productId. Callers should derive it via lineKeyFor().
}

export const lineKeyFor = (line: CartLine): string =>
  line.variantId ?? line.productId;

export const lineKeyForProduct = (
  productId: string,
  variantId: string | null
): string => variantId ?? productId;

const mergeLineInto = (
  prev: CartLine[],
  product: CatalogProduct,
  variant: CatalogVariant | null,
  qty: number
): CartLine[] => {
  const key = lineKeyForProduct(product.id, variant?.id ?? null);
  const idx = prev.findIndex((l) => (l.variantId ?? l.productId) === key);
  const available = stockCapFor(product, variant);
  if (idx >= 0) {
    const next = [...prev];
    const newQty = Math.min(next[idx].qty + qty, available || next[idx].qty + qty);
    next[idx] = {
      ...next[idx],
      qty: available > 0 ? newQty : next[idx].qty,
      available,
      rate: variant?.price ?? product.sellingPrice,
      imageUrl: product.imageUrl ?? next[idx].imageUrl,
      imageUpdatedAt: product.imageUpdatedAt ?? next[idx].imageUpdatedAt,
    };
    return next;
  }
  const rate = variant?.price ?? product.sellingPrice;
  return [
    ...prev,
    {
      productId: product.id,
      productName: product.name,
      variantId: variant?.id ?? null,
      variantSize: variant?.size ?? null,
      variantLabel: variantLabelFrom(variant),
      barcode: variant?.barcode?.trim() || product.barcode?.trim() || null,
      qty: available > 0 ? Math.min(qty, available) : qty,
      rate,
      available,
      packagingHint: packagingFromName(product.name),
      imageUrl: product.imageUrl ?? null,
      imageUpdatedAt: product.imageUpdatedAt ?? null,
    },
  ];
};

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
      setLines((prev) => mergeLineInto(prev, product, variant, qty));
      setDrawerOpen(true);
      track("add_to_cart", { productId: product.id, meta: { qty, variantId: variant?.id ?? null } });
    },
    []
  );

  const addMany = useCallback(
    (items: { product: CatalogProduct; variant: CatalogVariant | null; qty: number }[]) => {
      if (items.length === 0) return;
      setLines((prev) =>
        items.reduce(
          (acc, { product, variant, qty }) =>
            qty > 0 ? mergeLineInto(acc, product, variant, qty) : acc,
          prev
        )
      );
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
    setLines((prev) => {
      const target = prev.find((l) => (l.variantId ?? l.productId) === lineKey);
      if (target) track("remove_from_cart", { productId: target.productId });
      return prev.filter((l) => (l.variantId ?? l.productId) !== lineKey);
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const syncStock = useCallback((products: CatalogProduct[]) => {
    setLines((prev) =>
      prev.map((line) => {
        const match = findCatalogLine(products, line.productId, line.variantId);
        if (!match) return line;
        const available = stockCapFor(match.product, match.variant);
        const rate =
          match.variant?.price ?? match.product.sellingPrice;
        return {
          ...line,
          available,
          rate,
          qty: available > 0 ? Math.min(line.qty, available) : line.qty,
          productName: match.product.name,
          imageUrl: match.product.imageUrl ?? line.imageUrl,
          imageUpdatedAt: match.product.imageUpdatedAt ?? line.imageUpdatedAt,
        };
      })
    );
  }, []);

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
      addMany,
      setQty,
      remove,
      clear,
      syncStock,
    };
  }, [lines, drawerOpen, add, addMany, setQty, remove, clear, syncStock]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartContextValue => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
};
