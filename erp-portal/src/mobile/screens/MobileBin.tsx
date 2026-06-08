import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, auth } from "../../lib/api";
import type { Product } from "../../data/types";
import { searchProductsForBinAssign } from "../../lib/productSearch";
import { variantAttrs } from "../../lib/variantAttrs";
import { newClientOpId } from "../clientOpId";

// =====================================================================
// /m/bin/:binId
// =====================================================================
// The detail panel for a single bin: shows current product, qty,
// reservations, batch, and the last 5 cycle counts. Two big actions:
//   - Recount: adjust qty in place.
//   - Change product: empty + restock with a different SKU.
//
// Both modals require a reason code (industry standard) and any
// abnormal delta gets flagged on the BinCount row.

interface BinDetail {
  kind: string;
  warehouse?: { id: string; code: string; name: string };
  bin: {
    id: string;
    code: string;
    zone: string;
    shelf: string;
    bin: string;
    qty: number;
    reservedQty: number;
    capacity: number;
    batch: string | null;
    variantId?: string | null;
    product: {
      id: string;
      sku: string;
      name: string;
      uom?: string;
      stockOnHand?: number;
    } | null;
    variant: {
      id: string;
      sku: string;
      barcode: string | null;
      size: string | null;
      color: string | null;
      grade: string | null;
      uom: string | null;
      stockOnHand: number;
    } | null;
  };
  recentMoves: { id: string; date: string; txnType: string; ref: string; qty: number; balance: number }[];
  recentCounts: {
    id: string;
    qtyBefore: number;
    qtyAfter: number;
    delta: number;
    reason: string;
    flagged: boolean;
    createdAt: string;
    countedBy?: { name: string };
  }[];
}

interface BinAssignPick {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  uom: string;
  variantLabel?: string;
}

const REASON_LABELS: Record<string, string> = {
  physical_match: "Physical count matches",
  damage: "Damage / write-off",
  found_elsewhere: "Found stock elsewhere",
  product_swap: "Wrong product on shelf",
  spillage: "Spillage / loss",
  expired: "Expired - removed",
  other: "Other (see remarks)",
};

export const MobileBin = () => {
  const { binId } = useParams<{ binId: string }>();
  const nav = useNavigate();
  const [data, setData] = useState<BinDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRecount, setShowRecount] = useState(false);
  const [showReassign, setShowReassign] = useState(false);

  const refresh = useCallback(async () => {
    if (!binId) return;
    setError(null);
    try {
      // The bin detail comes from /v1/locations/scan?code=<bin.code>.
      // We need the bin's code first; cheapest path is to look it up in
      // /warehouses/:id/bins, but a simpler approach is to embed an
      // endpoint we already have. Strategy: fetch bin row to get its
      // code, then call resolveLocation.
      const all = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/warehouses`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      let code: string | null = null;
      for (const wh of all as { id: string; code: string }[]) {
        const bins = await fetch(
          `${import.meta.env.VITE_API_URL}/v1/warehouses/${wh.id}/bins?limit=1000`,
          { headers: { Authorization: `Bearer ${auth.token()}` } }
        ).then((r) => r.json());
        const found = (bins as { id: string; code: string }[]).find(
          (b) => b.id === binId
        );
        if (found) {
          code = found.code;
          break;
        }
      }
      if (!code) throw new Error("Bin not found");
      const detail = (await api.resolveLocation(code)) as unknown as BinDetail;
      setData(detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }, [binId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="px-4 pt-6">
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
        <button
          type="button"
          onClick={() => nav(-1)}
          className="mt-4 w-full rounded-xl bg-[#003087] py-3 text-sm font-semibold text-white"
        >
          Back
        </button>
      </div>
    );
  }
  if (!data) {
    return <div className="px-4 pt-6 text-sm text-slate-500">Loading…</div>;
  }

  const b = data.bin;
  const free = b.qty - b.reservedQty;
  const variant = b.variant;
  const sellUom = variant?.uom ?? b.product?.uom ?? "pcs";
  const attrs = variant ? variantAttrs(variant) : "";

  return (
    <div className="px-4 pt-4 pb-6">
      <button
        type="button"
        onClick={() => nav(-1)}
        className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-slate-600"
      >
        <span>←</span> Back
      </button>

      <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {data.warehouse?.code ?? ""} · {b.zone}/{b.shelf}
        </div>
        <div className="font-mono text-2xl font-bold text-[#003087]">
          {b.bin}
        </div>
        <div className="mt-1 text-[11px] font-mono text-slate-400">{b.code}</div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Qty" value={b.qty} suffix={sellUom} accent />
          <Stat label="Reserved" value={b.reservedQty} suffix={sellUom} />
          <Stat label="Free" value={free} suffix={sellUom} accent />
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          {b.product ? (
            <>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                {variant ? "Current variant" : "Current product"}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-[#003087]">
                  {variant ? variant.sku : b.product.sku}
                </span>
                <span
                  className="shrink-0 text-right text-xs text-slate-500"
                  title="System-wide on-hand total across all bins (not this bin only)"
                >
                  {variant ? "Variant SOH" : "Product SOH"}{" "}
                  {variant
                    ? variant.stockOnHand
                    : b.product.stockOnHand ?? 0}{" "}
                  {sellUom}
                </span>
              </div>
              {variant && attrs && (
                <div className="text-sm font-medium text-slate-800">{attrs}</div>
              )}
              <div className="text-sm text-slate-900">
                {b.product.name}
                {variant && (
                  <span className="text-slate-500"> · {b.product.sku}</span>
                )}
              </div>
              {variant?.barcode && (
                <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                  {variant.barcode}
                </div>
              )}
              {b.batch && (
                <div className="mt-1 text-[11px] text-slate-500">
                  batch {b.batch}
                </div>
              )}
              <div className="mt-2 text-[10px] leading-snug text-slate-400">
                Qty / Reserved / Free above = this bin only. SOH = catalog
                total{variant ? " for this variant" : ""} system-wide.
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Bin is empty.</div>
          )}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setShowRecount(true)}
          disabled={!b.product}
          className="flex-1 rounded-xl bg-[#003087] py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Recount
        </button>
        <button
          type="button"
          onClick={() => setShowReassign(true)}
          className="flex-1 rounded-xl border border-[#003087] bg-white py-3 text-sm font-semibold text-[#003087]"
        >
          Change product
        </button>
      </div>

      {data.recentCounts.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent cycle counts
          </h3>
          <div className="space-y-1">
            {data.recentCounts.map((c) => (
              <div
                key={c.id}
                className={[
                  "flex items-baseline justify-between rounded-xl px-3 py-2 text-xs ring-1",
                  c.flagged
                    ? "bg-amber-50 ring-amber-200"
                    : "bg-white ring-slate-200",
                ].join(" ")}
              >
                <div>
                  <div className="font-mono text-[11px] text-slate-500">
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div className="text-sm">
                    {c.qtyBefore} → {c.qtyAfter}
                    <span
                      className={
                        c.delta >= 0 ? "ml-1 text-emerald-700" : "ml-1 text-red-700"
                      }
                    >
                      ({c.delta >= 0 ? "+" : ""}
                      {c.delta})
                    </span>
                    {c.flagged && (
                      <span className="ml-2 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                        flagged
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {REASON_LABELS[c.reason] ?? c.reason} · {c.countedBy?.name ?? "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentMoves.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recent stock moves
          </h3>
          <div className="space-y-1">
            {data.recentMoves.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-slate-200"
              >
                <div>
                  <div className="text-[11px] text-slate-500">
                    {new Date(m.date).toLocaleString()}
                  </div>
                  <div className="text-sm">
                    <span className="font-mono">{m.txnType}</span>
                    <span className="ml-2 text-slate-500">{m.ref}</span>
                  </div>
                </div>
                <div
                  className={[
                    "tabular-nums text-sm font-semibold",
                    m.qty >= 0 ? "text-emerald-700" : "text-red-700",
                  ].join(" ")}
                >
                  {m.qty >= 0 ? "+" : ""}
                  {m.qty}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showRecount && (
        <RecountModal
          binId={b.id}
          currentQty={b.qty}
          uom={sellUom}
          onClose={() => setShowRecount(false)}
          onSuccess={() => {
            setShowRecount(false);
            void refresh();
          }}
        />
      )}
      {showReassign && (
        <ReassignModal
          binId={b.id}
          currentProductSku={variant?.sku ?? b.product?.sku ?? null}
          onClose={() => setShowReassign(false)}
          onSuccess={() => {
            setShowReassign(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
};

const Stat = ({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
}) => (
  <div className={[
    "rounded-xl border p-2 text-center",
    accent ? "border-[#003087]/20 bg-[#003087]/5" : "border-slate-200 bg-white",
  ].join(" ")}>
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </div>
    <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
    {suffix && (
      <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">
        {suffix}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------
// RecountModal
// ---------------------------------------------------------------------

const RecountModal = ({
  binId,
  currentQty,
  uom,
  onClose,
  onSuccess,
}: {
  binId: string;
  currentQty: number;
  uom: string;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [qty, setQty] = useState<number>(currentQty);
  const [reason, setReason] = useState<keyof typeof REASON_LABELS>("physical_match");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId] = useState(() => newClientOpId());

  const delta = qty - currentQty;
  const flagged = Math.abs(delta) > 50 || (currentQty > 0 && Math.abs(delta) / currentQty > 0.1);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.recountBin(binId, {
        qtyAfter: qty,
        reasonCode: reason as Parameters<typeof api.recountBin>[1]["reasonCode"],
        remarks: remarks.trim() || null,
        clientOpId: opId,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1rem)] sm:rounded-3xl"
      >
        <h2 className="mb-1 text-lg font-bold">Recount bin</h2>
        <p className="mb-4 text-xs text-slate-500">
          Current: {currentQty} {uom}
        </p>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          New count ({uom})
        </label>
        <div className="mb-3 flex items-stretch overflow-hidden rounded-xl border border-slate-300">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(0, q - 1))}
            className="px-4 text-2xl text-slate-600"
          >
            −
          </button>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={qty}
            onChange={(e) => setQty(parseFloat(e.target.value) || 0)}
            className="flex-1 bg-white text-center text-xl font-bold focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="px-4 text-2xl text-slate-600"
          >
            +
          </button>
        </div>
        <div className="mb-3 text-center text-sm">
          delta:{" "}
          <span
            className={[
              "font-semibold",
              delta === 0 ? "text-slate-500" : delta > 0 ? "text-emerald-700" : "text-red-700",
            ].join(" ")}
          >
            {delta >= 0 ? "+" : ""}
            {delta}
          </span>
          {flagged && (
            <span className="ml-2 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              will be flagged
            </span>
          )}
        </div>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Reason
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as keyof typeof REASON_LABELS)}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Remarks (optional)
        </label>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-[2] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Confirm count"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// ReassignModal
// ---------------------------------------------------------------------

const ReassignModal = ({
  binId,
  currentProductSku,
  onClose,
  onSuccess,
}: {
  binId: string;
  currentProductSku: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BinAssignPick[]>([]);
  const [picked, setPicked] = useState<BinAssignPick | null>(null);
  const [qty, setQty] = useState<number>(0);
  const [reason, setReason] = useState<keyof typeof REASON_LABELS>("product_swap");
  const [remarks, setRemarks] = useState("");
  const [batch, setBatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId] = useState(() => newClientOpId());

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (!search.trim()) {
        setResults([]);
        return;
      }
      api
        .products({ q: search.trim(), limit: 50 })
        .then((rows) => {
          if (cancelled) return;
          const { hits } = searchProductsForBinAssign(
            rows as Product[],
            search.trim(),
            { limit: 12 }
          );
          setResults(
            hits.map((h) => ({
              productId: h.product.id,
              variantId: h.variant?.id ?? null,
              sku: h.variant?.sku ?? h.product.sku,
              name: h.product.name,
              uom: h.variant?.uom ?? h.product.uom,
              variantLabel: h.variant ? h.label : undefined,
            }))
          );
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api.reassignBin(binId, {
        productId: picked.productId,
        variantId: picked.variantId,
        qty,
        reasonCode: reason as Parameters<typeof api.reassignBin>[1]["reasonCode"],
        remarks: remarks.trim() || null,
        batch: batch.trim() || null,
        clientOpId: opId,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1rem)] sm:rounded-3xl"
      >
        <h2 className="mb-1 text-lg font-bold">Change product on bin</h2>
        <p className="mb-3 text-xs text-slate-500">
          Currently:{" "}
          <span className="font-mono">{currentProductSku ?? "empty"}</span>
        </p>

        {!picked ? (
          <>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search variant SKU, barcode, or product name"
              className="mb-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="mb-3 max-h-60 space-y-1 overflow-y-auto">
              {results.map((p) => (
                <button
                  key={`${p.productId}-${p.variantId ?? "parent"}`}
                  type="button"
                  onClick={() => setPicked(p)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-[#003087]">
                      {p.sku}
                    </div>
                    <div className="truncate text-sm text-slate-900">{p.name}</div>
                    {p.variantLabel && (
                      <div className="text-[11px] text-slate-500">{p.variantLabel}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{p.uom}</span>
                </button>
              ))}
              {!results.length && search && (
                <div className="py-6 text-center text-xs text-slate-500">
                  No matches.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="font-mono text-xs text-emerald-800">{picked.sku}</div>
            <div className="text-sm font-semibold">{picked.name}</div>
            {picked.variantLabel && (
              <div className="text-xs text-emerald-700">{picked.variantLabel}</div>
            )}
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="mt-1 text-[11px] text-emerald-700 underline"
            >
              change
            </button>
          </div>
        )}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Qty in bin ({picked?.uom ?? "u"})
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={qty}
          onChange={(e) => setQty(parseFloat(e.target.value) || 0)}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-semibold"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Batch (optional)
        </label>
        <input
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Reason
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as keyof typeof REASON_LABELS)}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {Object.entries(REASON_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          Remarks (optional)
        </label>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !picked}
            className="flex-[2] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Reassign"}
          </button>
        </div>
      </div>
    </div>
  );
};
