import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, auth } from "../../lib/api";
import { variantSkuLine } from "../../lib/variantAttrs";
import {
  consumePickScrollTarget,
  savePickScrollTarget,
  scrollPickItemIntoView,
} from "../pickScrollRestore";

// =====================================================================
// /m/picks/:id
// =====================================================================
// Shows the lines for a claimed pick list, in walk-path order. Each
// line has a tappable row that drills into MobilePickLine for the
// scan-confirm flow. A "Complete" button at the bottom finalises the
// pick once every line has qtyPicked > 0.

interface PickItem {
  id: string;
  qtyToPick: number;
  qtyPicked: number;
  notes?: string | null;
  product?: { sku?: string; name?: string; uom?: string };
  variant?: { sku?: string; uom?: string; size?: string; color?: string; grade?: string } | null;
  bin?: { id?: string; code?: string; zone?: string; shelf?: string; bin?: string; qty?: number };
}

interface PickList {
  id: string;
  pickListNo: string;
  status: string;
  assignedToId?: string | null;
  salesOrder?: { soNo?: string; customer?: { name?: string; city?: string | null } };
  items: PickItem[];
  packingSlip?: { id: string; packingSlipNo: string; status: string } | null;
}

export const MobilePick = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const nav = useNavigate();
  const [pl, setPl] = useState<PickList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const scrolledRef = useRef(false);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => { window.removeEventListener("online", onUp); window.removeEventListener("offline", onDown); };
  }, []);
  // Item ids the backend told us are stale (qtyPicked > 0 but the
  // variant has since been drained by another in-flight pick). Set
  // when /complete returns code=pick_blocked. Resolved by tapping
  // "Reset stale lines" -> calls /reset for each id, then a fresh
  // /complete attempt. See backend reset endpoint.
  const [staleItemIds, setStaleItemIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/pick-lists/${id}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new ApiError(r.status, body?.error?.message ?? `${r.status}`, body?.error);
      }
      setPl(await r.json() as PickList);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    scrolledRef.current = false;
  }, [id]);

  // After returning from a line screen, scroll the list back to the
  // line the worker was on (or the next unpicked line after confirm).
  useEffect(() => {
    if (!pl || !id || scrolledRef.current) return;
    const fromState = (location.state as { scrollToItemId?: string } | null)
      ?.scrollToItemId;
    const fromStorage = consumePickScrollTarget(id);
    const targetId = fromState ?? fromStorage;
    if (!targetId) return;
    scrolledRef.current = true;
    scrollPickItemIntoView(targetId);
  }, [pl, id, location.state]);

  const release = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.releasePickList(id);
      nav("/m/tasks", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!id) return;
    if (!navigator.onLine) {
      setError("You're offline. Reconnect and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    setStaleItemIds([]);
    try {
      const r = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/pick-lists/${id}/complete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token()}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new ApiError(r.status, body?.error?.message ?? `${r.status}`, body?.error);
      }
      nav("/m/tasks", { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      // /complete reports pick_blocked with a per-line list of issues.
      // Pull out item ids whose reason mentions "variant ... only has"
      // - those are the stale rows we can repair via /reset.
      const details = apiErr.details as
        | { code?: string; details?: { itemId: string; reason: string }[] }
        | undefined;
      if (apiErr.status === 409 && details?.code === "pick_blocked") {
        const stale = (details.details ?? [])
          .filter((d) => d.reason.startsWith("variant "))
          .map((d) => d.itemId);
        setStaleItemIds(stale);
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Reset every stale line back to qtyPicked=0, refresh, and immediately
  // re-attempt /complete. If the user only had stale lines blocking the
  // finish, this single tap moves the slip to "picked" and frees the
  // worker; if other issues remain, the new error will explain.
  const resetStale = async () => {
    if (!id || staleItemIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const itemId of staleItemIds) {
        await api.resetPickItem(id, itemId);
      }
      setStaleItemIds([]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!pl) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-sm text-slate-500">{error ?? "Loading…"}</div>
      </div>
    );
  }

  // An item is "done" when it has been picked OR there was nothing to pick.
  // We only count items with qtyToPick > 0 as "requiring" a scan.
  const pickableItems = pl.items.filter((i) => i.qtyToPick > 0);
  const pickedCount = pickableItems.filter((i) => i.qtyPicked > 0).length;
  const allConfirmed = pickableItems.length > 0 && pickedCount === pickableItems.length;
  const remaining = pickableItems.length - pickedCount;
  // Once a pick crosses into 'picked' or 'cancelled' nothing on this
  // page can do useful work - scans, resets, releases all 409 with
  // bad_state. Detect the locked state once so we can disable line
  // drilldown, hide the Release/Complete buttons, and surface a clear
  // "what now" banner pointing at the packing slip.
  const locked = pl.status === "picked" || pl.status === "cancelled";

  return (
    // pb-44 reserves room for the FIXED action bar (~140px) so the
    // last line in a long pick list can scroll clear of the buttons.
    // Previously `pb-4` + a sticky bar meant lines beyond the first
    // two were trapped behind the bar with no way to reach them.
    <div className="px-4 pt-4 pb-44">
      <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-base font-semibold text-[#003087]">
            {pl.pickListNo}
          </span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              pl.status === "picked"
                ? "bg-emerald-100 text-emerald-800"
                : pl.status === "cancelled"
                  ? "bg-slate-200 text-slate-700"
                  : "bg-amber-100 text-amber-800",
            ].join(" ")}
          >
            {pl.status}
          </span>
        </div>
        <div className="mt-1 text-base font-medium text-slate-900">
          {pl.salesOrder?.customer?.name ?? "—"}
        </div>
        <div className="text-xs text-slate-500">
          SO {pl.salesOrder?.soNo} · {pl.items.length} line{pl.items.length === 1 ? "" : "s"}
        </div>
      </div>

      {!online && (
        <div className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200 flex items-center gap-2">
          <span className="font-bold">Offline</span>
          <span>Changes won't save until you reconnect.</span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <div className="font-semibold">Error</div>
          <div className="mt-0.5">{error}</div>
          <button
            type="button"
            onClick={() => { setError(null); void refresh(); }}
            className="mt-2 text-xs text-red-600 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Locked-state banner. When the pick has already crossed into
          'picked' or 'cancelled', no scan / release / complete will
          succeed - the action bar is hidden and the lines below are
          render-only. We surface the next step instead: open the
          packing slip if there is one, otherwise return to tasks. */}
      {locked && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <div className="font-semibold">
            {pl.status === "picked"
              ? "This pick is complete."
              : "This pick was cancelled."}
          </div>
          {pl.status === "picked" && (
            <div className="mt-1 text-xs">
              {pl.packingSlip
                ? `A packing slip has been issued - the next scan happens there.`
                : "A packing slip will be issued shortly."}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => nav("/m/tasks", { replace: true })}
              className="flex-1 rounded-xl border border-emerald-300 bg-white py-2 text-sm font-medium text-emerald-800"
            >
              Back to tasks
            </button>
            {pl.status === "picked" && pl.packingSlip && (
              <button
                type="button"
                onClick={() =>
                  nav(`/m/packs/${pl.packingSlip!.id}`, { replace: true })
                }
                className="flex-[2] rounded-xl bg-emerald-500 py-2 text-sm font-bold text-white"
              >
                Open packing slip {pl.packingSlip.packingSlipNo}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stale-line recovery. Surfaces when /complete returned
          pick_blocked. We list the affected SKUs so the worker knows
          exactly which lines we're about to reset, then a single tap
          zeroes their qtyPicked and re-attempts complete. The lines
          stay on the slip (qtyToPick is unchanged) so a supervisor
          can re-pick them later from a different bin or amend the SO. */}
      {staleItemIds.length > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <div className="font-semibold">
            {staleItemIds.length} line{staleItemIds.length === 1 ? "" : "s"} can't be completed
          </div>
          <div className="mt-1 text-xs">
            Stock for the SKUs below was drained by another pick before this one
            finished. Reset to clear the confirmation and either rescan with the
            available qty or release this pick for amendment.
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {staleItemIds.map((iid) => {
              const it = pl.items.find((i) => i.id === iid);
              const sku = it?.variant?.sku ?? it?.product?.sku ?? iid;
              return (
                <li key={iid}>
                  <span className="font-mono">{sku}</span>
                  {it ? ` — confirmed ${it.qtyPicked}, on hand 0` : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={resetStale}
            className="mt-3 w-full rounded-xl bg-amber-500 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Reset stale line{staleItemIds.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Lines (in walk order)
        </span>
        <span className="text-xs font-semibold text-slate-600">
          {pickedCount}/{pickableItems.length} picked
        </span>
      </div>

      <div className="space-y-2">
        {pl.items.map((it) => {
          const sku = it.variant?.sku ?? it.product?.sku ?? "?";
          const skuLine = variantSkuLine(sku, it.variant);
          const uom = it.variant?.uom ?? it.product?.uom ?? "pcs";
          const binLabel = it.bin
            ? `${it.bin.zone}/${it.bin.shelf}/${it.bin.bin}`
            : "no bin";
          // An item with qtyToPick === 0 has nothing to pick; treat as N/A.
          const skipped = it.qtyToPick === 0;
          // done = this specific item has been picked (qtyPicked > 0).
          const done = it.qtyPicked > 0;
          const stale = staleItemIds.includes(it.id);
          // Lines turn into static cards once the pick is locked; no
          // point letting the worker drill into a scan form they
          // can't submit.
          const RowEl: React.ElementType = locked || skipped ? "div" : Link;
          const rowProps: Record<string, unknown> =
            locked || skipped
              ? {}
              : {
                  to: `/m/picks/${pl.id}/line/${it.id}`,
                  onClick: () => savePickScrollTarget(pl.id, it.id),
                };
          return (
            <RowEl
              key={it.id}
              data-pick-item-id={it.id}
              {...rowProps}
              className={[
                "flex items-stretch overflow-hidden rounded-xl ring-1 transition",
                locked || skipped
                  ? "bg-white ring-slate-200 opacity-80"
                  : stale
                    ? "bg-amber-50 ring-amber-300"
                    : done
                      ? "bg-emerald-50 ring-emerald-300"
                      : "bg-white ring-slate-200 active:bg-slate-50",
              ].join(" ")}
            >
              {/* Left colour strip — unique per status so there's no ambiguity */}
              <div
                className={[
                  "flex w-2 flex-shrink-0",
                  stale
                    ? "bg-amber-500"
                    : done
                      ? "bg-emerald-500"
                      : skipped
                        ? "bg-slate-300"
                        : "bg-amber-400",
                ].join(" ")}
              />
              <div className="min-w-0 flex-1 px-3 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {it.product?.name ?? "—"}
                  </span>
                  <span
                    className={[
                      "shrink-0 text-xs font-semibold",
                      done ? "text-emerald-700" : "text-slate-500",
                    ].join(" ")}
                  >
                    {it.qtyPicked}/{it.qtyToPick} {uom}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                  {skuLine}
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
                    {binLabel}
                  </span>
                  {stale ? (
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                      ⚠ stale — reset needed
                    </span>
                  ) : done ? (
                    <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white">
                      ✓ Picked
                    </span>
                  ) : skipped ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500">
                      N/A
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Pending
                    </span>
                  )}
                </div>
              </div>
              {!locked && !skipped && (
                <div
                  className={[
                    "flex items-center px-3 text-lg font-bold",
                    done ? "text-emerald-400" : "text-slate-400",
                  ].join(" ")}
                >
                  ›
                </div>
              )}
            </RowEl>
          );
        })}
      </div>

      {/* Action bar is FIXED to the viewport (sat above the bottom
          tab nav via `bottom: 72px + safe-area`). We pin it instead
          of using sticky because sticky inside <main> required the
          sibling content to be tall enough to push the bar to its
          natural position; on shorter lists or when scrolling started
          mid-page the bar overlapped the lines and nothing scrolled
          past it. Fixed positioning + the parent's pb-44 reservation
          gives every line clear scrolling room above the buttons.
          Hidden once the pick is locked - nothing the bar offers can
          succeed against a 'picked' / 'cancelled' pick list. */}
      {!locked && (
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <div className="mb-2 text-xs text-slate-500">
          {remaining === 0
            ? `All ${pickableItems.length} line${pickableItems.length === 1 ? "" : "s"} picked — ready to complete.`
            : `${pickedCount} of ${pickableItems.length} picked · ${remaining} line${remaining === 1 ? "" : "s"} still need a scan.`}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={release}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
          >
            Release
          </button>
          <button
            type="button"
            disabled={busy || !allConfirmed}
            onClick={complete}
            className="flex-[2] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Complete pick
          </button>
        </div>
      </div>
      )}
    </div>
  );
};
