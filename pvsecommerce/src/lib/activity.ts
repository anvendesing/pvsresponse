// Lightweight, fire-and-forget storefront activity tracker.
//
//   track("pageview")
//   track("product_view", { productId: "abc123" })
//   track("add_to_cart", { productId: "abc123", meta: { qty: 2 } })
//
// - Calls are debounced per event type (250 ms). Back-to-back identical events
//   within the window are coalesced into a single request.
// - Never throws. Errors are silently swallowed.
// - Requires the api module to have already attached x-pv-anon-id.

import { api } from "@/lib/api";

export type TrackEvent =
  | "pageview"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "place_order"
  | "login"
  | "logout"
  | "search";

interface TrackPayload {
  productId?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

const DEBOUNCE_MS = 250;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function track(event: TrackEvent, payload?: TrackPayload): void {
  const key = event;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(key);
    void api.trackActivity({
      event,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
      productId: payload?.productId,
      sessionId: payload?.sessionId,
      meta: payload?.meta,
    });
  }, DEBOUNCE_MS);

  timers.set(key, timer);
}
