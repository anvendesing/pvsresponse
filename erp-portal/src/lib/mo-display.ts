import type { ProductionOrder } from "@/data/types";

/** Primary MO label — variant scent/size when BOM is variant-scoped. */
export function moPrimaryLabel(order: ProductionOrder): string {
  if (order.variantSku) {
    const scent = order.variantColor?.trim();
    const size = order.variantSize?.trim();
    if (scent && size) return `${scent} · ${size}`;
    if (scent) return scent;
    if (size) return size;
    return order.variantSku;
  }
  return order.product;
}

/** Muted parent product + variant SKU (or product SKU only). */
export function moSecondaryLabel(order: ProductionOrder): string {
  if (order.variantSku) {
    return `${order.product} · ${order.variantSku}`;
  }
  return order.sku || order.product;
}

/** Search haystack for command palette / filters. */
export function moSearchText(order: ProductionOrder): string {
  return [
    order.orderNo,
    order.product,
    order.sku,
    order.variantSku,
    order.variantColor,
    order.variantSize,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
