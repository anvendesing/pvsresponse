import type { CartLine, OrderItemsSnapshot, StoredOrderResult } from "@/lib/api";

export const PAYU_CHECKOUT_SNAPSHOT_KEY = "pv_payu_checkout_snapshot";

export const orderItemsSnapshotFromCart = (lines: CartLine[]): OrderItemsSnapshot[] =>
  lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    variantId: l.variantId,
    variantSize: l.variantSize,
    barcode: l.barcode,
    qty: l.qty,
    rate: l.rate,
    amount: l.qty * l.rate,
  }));

export const stashPayuCheckoutSnapshot = (
  intentId: string,
  lines: CartLine[],
  customer: { name: string; phone: string }
): void => {
  try {
    window.localStorage.setItem(
      PAYU_CHECKOUT_SNAPSHOT_KEY,
      JSON.stringify({
        intentId,
        itemsSnapshot: orderItemsSnapshotFromCart(lines),
        customer,
      })
    );
  } catch {
    /* storage blocked */
  }
};

/** Promote a PayU pending snapshot into persisted order storage for guest success page. */
export const promotePayuPendingOrder = (soNo: string): StoredOrderResult | null => {
  try {
    const existing = window.localStorage.getItem(`pv_order_${soNo}`);
    if (existing) return JSON.parse(existing) as StoredOrderResult;

    const pendingRaw = window.localStorage.getItem(PAYU_CHECKOUT_SNAPSHOT_KEY);
    if (!pendingRaw) return null;

    const pending = JSON.parse(pendingRaw) as {
      itemsSnapshot: OrderItemsSnapshot[];
      customer?: { name: string; phone: string };
    };
    const total = pending.itemsSnapshot.reduce((sum, l) => sum + l.amount, 0);
    const stored: StoredOrderResult = {
      customer: {
        id: "",
        code: "",
        name: pending.customer?.name ?? "Guest",
      },
      customerAccount: {
        id: "",
        email: null,
        phone: pending.customer?.phone ?? null,
      },
      salesOrder: {
        id: "",
        soNo,
        status: "confirmed",
        total,
        shareToken: null,
      },
      invoice: {
        id: "",
        invoiceNo: "—",
        amount: total,
        status: "paid",
        shareToken: null,
      },
      pickList: { error: { code: "pending", message: "Pick list not available yet." } },
      itemsSnapshot: pending.itemsSnapshot,
    };
    window.localStorage.setItem(`pv_order_${soNo}`, JSON.stringify(stored));
    window.localStorage.removeItem(PAYU_CHECKOUT_SNAPSHOT_KEY);
    return stored;
  } catch {
    return null;
  }
};
