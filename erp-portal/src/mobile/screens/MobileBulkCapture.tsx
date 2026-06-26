import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";

// =====================================================================
// /m/bulk-capture - Zone PR putaway rule assignment
// =====================================================================
// Lists variants whose putaway rule still targets STR Zone PR (no fixed
// bin yet). For each row the operator scans a bin + enters a count.
// "Save all ready" commits every filled row in one shot:
//   1. Assigns variant + qty to the scanned bin
//   2. Pins the putaway rule to that bin (clears Zone PR)
//   3. Removes the variant from this list permanently
//
// Backend:
//   GET  /v1/zone-pr-variants         pending list
//   POST /v1/zone-pr-variants/capture batch assign + rule update

interface VariantRow {
  putawayRuleId: string;
  productId: string;
  productSku: string;
  productName: string;
  productType: string;
  variantId: string;
  variantSku: string;
  variantBarcode: string | null;
  variantSize: string | null;
  variantUom: string | null;
  stockOnHand: number;
}

interface ZonePrPayload {
  warehouse: { id: string; code: string; name: string } | null;
  counts: { total: number };
  variants: VariantRow[];
}

type Draft = { binCode: string; qty: string };

const inputCls =
  "w-full h-11 rounded-xl border border-slate-300 px-3 text-sm bg-white";

const variantDescription = (v: VariantRow): string => {
  const tail = [v.variantSize, v.variantUom].filter(Boolean).join(" ");
  const base = v.productName;
  return tail ? `${base} - ${tail}` : base;
};

export const MobileBulkCapture = () => {
  const [data, setData] = useState<ZonePrPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [defaultQty, setDefaultQty] = useState("1234");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [focusedVariantId, setFocusedVariantId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = (await api.zonePrVariants()) as ZonePrPayload;
      setData(res);
      setDrafts((prev) => {
        const next: Record<string, Draft> = {};
        for (const v of res.variants) {
          next[v.variantId] = prev[v.variantId] ?? { binCode: "", qty: "" };
        }
        return next;
      });
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const variants = data?.variants ?? [];

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return variants;
    return variants.filter((v) => {
      return (
        v.variantSku.toLowerCase().includes(term) ||
        v.productName.toLowerCase().includes(term) ||
        (v.variantBarcode ?? "").toLowerCase().includes(term) ||
        v.productSku.toLowerCase().includes(term)
      );
    });
  }, [variants, filter]);

  const readyItems = useMemo(() => {
    const defQty = defaultQty.trim();
    const items: Array<{ variantId: string; binCode: string; qty: number }> = [];
    for (const v of variants) {
      const d = drafts[v.variantId];
      if (!d?.binCode.trim()) continue;
      const qtyStr = d.qty.trim() || defQty;
      if (!qtyStr) continue;
      const qty = Number(qtyStr);
      if (!Number.isFinite(qty) || qty < 0) continue;
      items.push({ variantId: v.variantId, binCode: d.binCode.trim(), qty });
    }
    return items;
  }, [variants, drafts, defaultQty]);

  const patchDraft = (variantId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [variantId]: {
        ...(prev[variantId] ?? { binCode: "", qty: "" }),
        ...patch,
      },
    }));
  };

  const applyBinScan = (raw: string) => {
    setScannerOpen(false);
    const code = raw.trim();
    if (!code || !focusedVariantId) return;
    patchDraft(focusedVariantId, { binCode: code });
  };

  const onSaveAll = async () => {
    if (readyItems.length === 0) {
      setSaveError("Fill in a bin (and count) for at least one variant.");
      return;
    }
    setBusy(true);
    setSaveError(null);
    setBanner(null);
    try {
      const res = await api.captureZonePrVariants({
        items: readyItems.map((item) => ({
          ...item,
          clientOpId: `pr-batch-${item.variantId}-${Date.now()}`,
        })),
      });

      if (res.ok > 0) {
        setBanner(
          `Saved ${res.ok} variant${res.ok === 1 ? "" : "s"} — putaway rules updated.`
        );
      }
      if (res.failed.length > 0) {
        const msg = res.failed
          .map((f) => {
            const sku =
              variants.find((v) => v.variantId === f.variantId)?.variantSku ??
              f.variantId;
            return `${sku}: ${f.error}`;
          })
          .join("\n");
        setSaveError(msg);
      }
      await refresh();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const counts = data?.counts ?? { total: 0 };

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 pt-4 pb-[calc(88px+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">
              Bulk capture - Zone PR
            </h1>
            <p className="text-xs text-slate-500 truncate">
              {data?.warehouse
                ? `${data.warehouse.code} - assign bins & update putaway rules`
                : "Loading..."}
            </p>
          </div>
          <Link
            to="/m/tasks"
            className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
          >
            Back
          </Link>
        </div>

        {loadError && (
          <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {loadError}
          </div>
        )}
        {banner && (
          <div
            className="mb-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
            role="status"
          >
            {banner}
          </div>
        )}
        {saveError && (
          <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200 whitespace-pre-line">
            {saveError}
          </div>
        )}

        <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <span className="font-semibold text-slate-800">{counts.total}</span>{" "}
          variants still on Zone PR rules. Scan each bin, enter qty, then save
          all at once — each variant&apos;s putaway rule moves to its bin and
          drops off this list.
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Default count
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={defaultQty}
              onChange={(e) => setDefaultQty(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              onClick={() => void onSaveAll()}
              disabled={busy || readyItems.length === 0}
              className="h-11 w-full rounded-xl bg-[#003087] text-sm font-bold text-white disabled:opacity-40"
            >
              {busy
                ? "Saving..."
                : readyItems.length === 0
                  ? "Save"
                  : `Save (${readyItems.length})`}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              {loading ? "..." : "Refresh"}
            </button>
          </div>
        </div>

        <input
          type="search"
          placeholder="Filter by SKU, barcode, or name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={inputCls + " mb-3"}
        />

        {loading && (
          <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Loading variants...
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            {variants.length === 0
              ? "All Zone PR variants have been assigned to bins."
              : "No variants match your filter."}
          </div>
        )}

        {!loading && visible.length > 0 && (
          <ul className="space-y-2">
            {visible.map((v) => {
              const d = drafts[v.variantId] ?? { binCode: "", qty: "" };
              const focused = v.variantId === focusedVariantId;
              const hasBin = !!d.binCode.trim();
              const qtyStr = d.qty.trim() || defaultQty.trim();
              const ready = hasBin && qtyStr && Number(qtyStr) >= 0;
              const desc = variantDescription(v);

              return (
                <li
                  key={v.variantId}
                  className={
                    "rounded-xl bg-white p-3 ring-1 shadow-sm " +
                    (focused ? "ring-[#003087] ring-2" : "ring-slate-200")
                  }
                >
                  <div className="mb-2">
                    <div className="font-semibold text-slate-900 leading-tight">
                      {desc}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      SKU{" "}
                      <span className="font-mono text-slate-700">
                        {v.variantSku}
                      </span>
                    </div>
                    {v.variantBarcode && (
                      <div className="mt-0.5 text-xs text-slate-500">
                        Barcode{" "}
                        <span className="font-mono text-slate-700">
                          {v.variantBarcode}
                        </span>
                      </div>
                    )}
                  </div>

                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Bin barcode
                  </label>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="text"
                      value={d.binCode}
                      onFocus={() => setFocusedVariantId(v.variantId)}
                      onChange={(e) =>
                        patchDraft(v.variantId, { binCode: e.target.value })
                      }
                      placeholder="Scan or type bin code"
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedVariantId(v.variantId);
                        setScannerOpen(true);
                      }}
                      className="h-11 w-11 shrink-0 rounded-xl border border-slate-300 bg-slate-50 text-lg"
                      aria-label="Scan bin barcode"
                    >
                      📷
                    </button>
                  </div>

                  <label className="mt-2 mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Count
                    {!d.qty.trim() && defaultQty.trim() ? (
                      <span className="ml-1 font-normal normal-case text-slate-400">
                        (default {defaultQty})
                      </span>
                    ) : null}
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={d.qty}
                    onFocus={() => setFocusedVariantId(v.variantId)}
                    onChange={(e) =>
                      patchDraft(v.variantId, { qty: e.target.value })
                    }
                    placeholder={defaultQty.trim() || "Qty"}
                    className={inputCls}
                  />

                  {ready && (
                    <div className="mt-2 text-[11px] font-semibold text-emerald-700">
                      Ready to save
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sticky save bar — sits above the bottom tab nav (z-40 @ bottom-0). */}
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          onClick={() => void onSaveAll()}
          disabled={busy || readyItems.length === 0}
          className="w-full rounded-xl bg-[#003087] py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy
            ? "Saving..."
            : readyItems.length === 0
              ? "Save — scan a bin first"
              : `Save all (${readyItems.length})`}
        </button>
      </div>

      {scannerOpen && (
        <BarcodeScanner
          active
          onClose={() => setScannerOpen(false)}
          onResult={(text) => applyBinScan(text)}
        />
      )}
    </div>
  );
};
