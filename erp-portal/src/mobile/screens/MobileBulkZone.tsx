import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Bin } from "../../data/types";
import { api } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";
import { useDeviceWarehouse } from "../useDeviceWarehouse";

type RowEdit = { barcode: string; qty: string };

type BulkResult = {
  applied: number;
  skipped: number;
  errors: number;
  results: Array<
    | { binId: string; status: "skipped"; reason: string }
    | { binId: string; status: "applied"; action: string; location: string }
    | { binId: string; status: "error"; message: string }
  >;
};

const inputCls =
  "w-full h-10 rounded-xl border border-slate-300 px-3 text-sm bg-white";

export const MobileBulkZone = () => {
  const deviceWh = useDeviceWarehouse();
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const b of bins) set.add(b.zone);
    return [...set].sort();
  }, [bins]);

  const [zone, setZone] = useState("");
  const effectiveZone = zone || zones[0] || "";

  const shelves = useMemo(() => {
    const set = new Set<string>();
    for (const b of bins) {
      if (b.zone === effectiveZone) set.add(b.shelf);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bins, effectiveZone]);

  const [shelfFilter, setShelfFilter] = useState<string>("");

  const zoneBins = useMemo(() => {
    return bins
      .filter(
        (b) =>
          b.zone === effectiveZone &&
          (!shelfFilter || b.shelf === shelfFilter)
      )
      .sort((a, b) =>
        `${a.shelf}/${a.bin}`.localeCompare(`${b.shelf}/${b.bin}`, undefined, {
          numeric: true,
        })
      );
  }, [bins, effectiveZone, shelfFilter]);

  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [scanBinId, setScanBinId] = useState<string | null>(null);

  const loadBins = useCallback(async () => {
    if (!deviceWh?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await api.bins(deviceWh.id);
      setBins(rows);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [deviceWh?.id]);

  useEffect(() => {
    void loadBins();
  }, [loadBins]);

  useEffect(() => {
    setShelfFilter("");
    setEdits({});
    setResult(null);
    setError(null);
  }, [effectiveZone]);

  const pendingCount = useMemo(() => {
    let n = 0;
    for (const b of zoneBins) {
      const row = edits[b.id];
      if (!row) continue;
      if (row.barcode.trim() || row.qty.trim()) n += 1;
    }
    return n;
  }, [zoneBins, edits]);

  const setRow = (binId: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [binId]: {
        barcode: prev[binId]?.barcode ?? "",
        qty: prev[binId]?.qty ?? "",
        ...patch,
      },
    }));
    setResult(null);
  };

  const clearInputs = () => {
    setEdits({});
    setResult(null);
    setError(null);
  };

  const onSave = async () => {
    if (!deviceWh || !effectiveZone) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const items: { binId: string; barcode?: string; qty?: number }[] = [];
      for (const b of zoneBins) {
        const row = edits[b.id];
        if (!row) continue;
        const barcode = row.barcode.trim();
        const qtyRaw = row.qty.trim();
        if (!barcode && !qtyRaw) continue;

        const item: { binId: string; barcode?: string; qty?: number } = {
          binId: b.id,
        };
        if (barcode) item.barcode = barcode;
        if (qtyRaw) {
          const qty = Number(qtyRaw);
          if (Number.isNaN(qty) || qty < 0) {
            throw new Error(`Invalid qty for ${b.shelf}/${b.bin}`);
          }
          item.qty = qty;
        }
        items.push(item);
      }

      if (items.length === 0) {
        setError("Enter a barcode and/or qty on at least one bin.");
        return;
      }

      const res = (await api.bulkZoneStock(deviceWh.id, effectiveZone, {
        reasonCode: "physical_match",
        items,
      })) as BulkResult;

      setResult(res);
      if (res.applied > 0) {
        await loadBins();
        setEdits((prev) => {
          const next = { ...prev };
          for (const r of res.results) {
            if (r.status === "applied") delete next[r.binId];
          }
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!deviceWh) {
    return (
      <div className="px-4 pt-4 text-sm text-slate-600">
        No warehouse selected.{" "}
        <Link to="/m/profile" className="text-[#003087] underline">
          Choose one in Profile
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 pt-4 pb-28">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Bulk zone update</h1>
            <p className="text-xs text-slate-500">
              {deviceWh.code} · leave blank to skip a bin
            </p>
          </div>
          <Link
            to="/m/count"
            className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
          >
            Single bin
          </Link>
        </div>

        {loadError && (
          <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {loadError}
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
            <div className="font-semibold">Save complete</div>
            <div>
              Updated {result.applied}, skipped {result.skipped}, {result.errors}{" "}
              error{result.errors === 1 ? "" : "s"}.
            </div>
          </div>
        )}

        {/* Zone picker */}
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Zone
          </span>
          <select
            className={inputCls}
            value={effectiveZone}
            onChange={(e) => setZone(e.target.value)}
            disabled={loading || zones.length === 0}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                Zone {z} ({bins.filter((b) => b.zone === z).length} bins)
              </option>
            ))}
          </select>
        </label>

        {/* Shelf filter chips */}
        {shelves.length > 1 && (
          <div className="mb-3">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Shelf filter
            </span>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setShelfFilter("")}
                className={[
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                  !shelfFilter
                    ? "bg-[#003087] text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200",
                ].join(" ")}
              >
                All
              </button>
              {shelves.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShelfFilter(s)}
                  className={[
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                    shelfFilter === s
                      ? "bg-[#003087] text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200",
                  ].join(" ")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            {loading ? "Loading bins…" : `${zoneBins.length} bins shown`}
          </span>
          <button
            type="button"
            onClick={clearInputs}
            className="font-semibold text-[#003087]"
          >
            Clear inputs
          </button>
        </div>

        <div className="space-y-2">
          {zoneBins.map((b) => {
            const row = edits[b.id] ?? { barcode: "", qty: "" };
            const loc = `${b.shelf}/${b.bin}`;
            const sku = b.variantSku ?? b.productSku;
            const rowResult = result?.results.find((r) => r.binId === b.id);
            const hasInput = row.barcode.trim() || row.qty.trim();
            return (
              <div
                key={b.id}
                className={[
                  "rounded-xl bg-white p-3 ring-1 shadow-sm",
                  rowResult?.status === "error"
                    ? "ring-red-300 bg-red-50/30"
                    : rowResult?.status === "applied"
                    ? "ring-emerald-300 bg-emerald-50/20"
                    : hasInput
                    ? "ring-[#003087]/40"
                    : "ring-slate-200",
                ].join(" ")}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold text-[#003087]">
                      {loc}
                    </div>
                    <div className="truncate text-xs text-slate-600">
                      {b.productName ?? "Empty"}
                      {sku ? ` · ${sku}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] uppercase text-slate-400">Now</div>
                    <div className="font-bold tabular-nums text-sm">{b.qty ?? 0}</div>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    type="text"
                    placeholder="Barcode / SKU"
                    value={row.barcode}
                    onChange={(e) => setRow(b.id, { barcode: e.target.value })}
                    className={inputCls}
                    aria-label={`Barcode ${loc}`}
                  />
                  <button
                    type="button"
                    onClick={() => setScanBinId(b.id)}
                    className="h-10 w-10 shrink-0 rounded-xl border border-slate-300 bg-slate-50 text-lg"
                    aria-label={`Scan barcode for ${loc}`}
                  >
                    📷
                  </button>
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="New qty"
                  value={row.qty}
                  onChange={(e) => setRow(b.id, { qty: e.target.value })}
                  className={[inputCls, "mt-2"].join(" ")}
                  aria-label={`Qty ${loc}`}
                />

                {rowResult?.status === "error" && (
                  <div className="mt-2 text-xs text-red-600">{rowResult.message}</div>
                )}
              </div>
            );
          })}

          {!loading && zoneBins.length === 0 && (
            <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No bins in this zone.
            </div>
          )}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || pendingCount === 0}
          className="w-full rounded-xl bg-[#003087] py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy
            ? "Saving…"
            : pendingCount > 0
            ? `Save ${pendingCount} change${pendingCount === 1 ? "" : "s"}`
            : "Save changes"}
        </button>
      </div>

      {scanBinId && (
        <BarcodeScanner
          active
          onClose={() => setScanBinId(null)}
          onResult={(text) => {
            setRow(scanBinId, { barcode: text.trim() });
            setScanBinId(null);
          }}
        />
      )}
    </div>
  );
};
