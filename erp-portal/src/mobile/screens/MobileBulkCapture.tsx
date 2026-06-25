import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";

// =====================================================================
// /m/bulk-capture - Stock Room Zone PR bulk variant capture
// =====================================================================
// Walk through every variant covered by an STR Zone PR putaway rule.
// For each PENDING variant: scan the destination bin, enter a count,
// hit Save - the bin is assigned to that variant and the row flips to
// the CAPTURED tab. Captured rows are reference-only with a "Clear &
// redo" action that zeroes the bin so the variant flows back to
// pending for re-scan.
//
// Backend wiring:
//   GET  /v1/zone-pr-variants            list with status + bin/qty
//   GET  /v1/locations/scan              resolve a scanned bin code
//   POST /v1/bins/:id/reassign           commit variant + qty to bin
//   POST /v1/bins/:id/recount            "Clear & redo" (qtyAfter=0)

interface VariantRow {
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
  status: "pending" | "captured";
  binId: string | null;
  binCode: string | null;
  binQty: number;
}

interface ZonePrPayload {
  warehouse: { id: string; code: string; name: string } | null;
  counts: { total: number; captured: number; pending: number };
  variants: VariantRow[];
}

const inputCls =
  "w-full h-11 rounded-xl border border-slate-300 px-3 text-sm bg-white";

// Describe a variant in one short phrase: SKU + size/uom + parent name.
// Mirrors the existing line-item formatter style without importing the
// desktop helper (this bundle is mobile-only).
const variantDescription = (v: VariantRow): string => {
  const tail = [v.variantSize, v.variantUom].filter(Boolean).join(" ");
  const base = v.productName;
  return tail ? `${base} - ${tail}` : base;
};

export const MobileBulkCapture = () => {
  const [tab, setTab] = useState<"pending" | "captured">("pending");
  const [data, setData] = useState<ZonePrPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Selection / scan state for the active variant in the Pending list.
  // Only one variant has its scan form open at a time; tapping another
  // closes the previous draft. This keeps the UI focused (operators
  // get distracted easily) and avoids accidentally saving the wrong
  // qty against the wrong row when the list reorders after a refresh.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [scanBinCode, setScanBinCode] = useState("");
  const [scanQty, setScanQty] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = (await api.zonePrVariants()) as ZonePrPayload;
      setData(res);
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

  const { pending, captured } = useMemo(() => {
    const p: VariantRow[] = [];
    const c: VariantRow[] = [];
    for (const v of variants) {
      if (v.status === "captured") c.push(v);
      else p.push(v);
    }
    return { pending: p, captured: c };
  }, [variants]);

  const filterVariant = useCallback(
    (rows: VariantRow[]) => {
      const term = filter.trim().toLowerCase();
      if (!term) return rows;
      return rows.filter((v) => {
        return (
          v.variantSku.toLowerCase().includes(term) ||
          v.productName.toLowerCase().includes(term) ||
          (v.variantBarcode ?? "").toLowerCase().includes(term) ||
          v.productSku.toLowerCase().includes(term)
        );
      });
    },
    [filter]
  );

  const visiblePending = useMemo(() => filterVariant(pending), [pending, filterVariant]);
  const visibleCaptured = useMemo(
    () => filterVariant(captured),
    [captured, filterVariant]
  );

  const openScanFor = (variantId: string) => {
    setActiveVariantId(variantId);
    setScanBinCode("");
    setScanQty("");
    setScanError(null);
  };

  const closeScan = () => {
    setActiveVariantId(null);
    setScanBinCode("");
    setScanQty("");
    setScanError(null);
  };

  // Scanned a bin barcode - validate it lives in STR Zone PR before we
  // accept it (a wrong-warehouse bin would be a silent disaster).
  const applyBinScan = async (raw: string) => {
    setScannerOpen(false);
    const code = raw.trim();
    if (!code) return;
    setScanBinCode(code);
    setScanError(null);
    try {
      const res = (await api.resolveLocation(code)) as {
        kind: string;
        zone?: string;
        bin?: { id: string; code: string };
        warehouse?: { code?: string };
      };
      if (res.kind !== "bin" || !res.bin) {
        setScanError("Scan a bin barcode, not a zone or shelf label.");
        return;
      }
      if (
        data?.warehouse?.code &&
        res.warehouse?.code &&
        res.warehouse.code !== data.warehouse.code
      ) {
        setScanError(
          `Bin is in ${res.warehouse.code}; this capture is for ${data.warehouse.code}.`
        );
        return;
      }
      if (res.zone && res.zone !== "PR") {
        setScanError(
          `Bin is in zone ${res.zone}. Pick a bin inside Zone PR.`
        );
        return;
      }
    } catch (e) {
      setScanError((e as Error).message);
    }
  };

  const onSave = async () => {
    if (!activeVariantId) return;
    const variant = pending.find((v) => v.variantId === activeVariantId);
    if (!variant) {
      setScanError("Variant no longer pending. Refresh and try again.");
      return;
    }
    if (!scanBinCode.trim()) {
      setScanError("Scan or type a bin barcode first.");
      return;
    }
    const qty = Number(scanQty);
    if (!Number.isFinite(qty) || qty < 0) {
      setScanError("Enter a non-negative count.");
      return;
    }
    setBusy(activeVariantId);
    setScanError(null);
    try {
      // Resolve the bin code to an id. We deliberately do this on save
      // (not on scan) so a manual barcode typed without a scan event
      // still works.
      const loc = (await api.resolveLocation(scanBinCode.trim())) as {
        kind: string;
        bin?: { id: string; code: string };
        zone?: string;
        warehouse?: { code?: string };
      };
      if (loc.kind !== "bin" || !loc.bin) {
        throw new Error("That code is not a bin.");
      }
      if (
        data?.warehouse?.code &&
        loc.warehouse?.code &&
        loc.warehouse.code !== data.warehouse.code
      ) {
        throw new Error(
          `Bin is in ${loc.warehouse.code}; capture is for ${data.warehouse.code}.`
        );
      }
      if (loc.zone && loc.zone !== "PR") {
        throw new Error(`Bin is in zone ${loc.zone}. Use a Zone PR bin.`);
      }

      await api.reassignBin(loc.bin.id, {
        productId: variant.productId,
        variantId: variant.variantId,
        qty,
        reasonCode: "physical_match",
        remarks: `Zone PR bulk capture (${variant.variantSku})`,
        clientOpId: `pr-capture-${variant.variantId}-${Date.now()}`,
      });

      setBanner(
        `Captured ${variant.variantSku} → ${loc.bin.code} (qty ${qty})`
      );
      closeScan();
      await refresh();
      setTab("pending");
    } catch (e) {
      setScanError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Captured tab "Clear & redo": zero out the bin so the variant
  // returns to Pending on next refresh. We keep the bin row (no
  // delete) so operators get a clean re-scan workflow.
  const onClearCaptured = async (variant: VariantRow) => {
    if (!variant.binId) return;
    const ok = window.confirm(
      `Clear ${variant.variantSku} from ${variant.binCode ?? "this bin"}?\n\nQty will be set to 0 and the variant will move back to Pending.`
    );
    if (!ok) return;
    setBusy(variant.variantId);
    try {
      await api.recountBin(variant.binId, {
        qtyAfter: 0,
        reasonCode: "physical_match",
        remarks: `Zone PR bulk capture: cleared for re-scan`,
        clientOpId: `pr-capture-clear-${variant.variantId}-${Date.now()}`,
      });
      setBanner(`Cleared ${variant.variantSku} - now pending.`);
      await refresh();
    } catch (e) {
      setBanner(`Clear failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const counts = data?.counts ?? { total: 0, captured: 0, pending: 0 };

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 pt-4 pb-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900">
              Bulk capture - Zone PR
            </h1>
            <p className="text-xs text-slate-500 truncate">
              {data?.warehouse
                ? `${data.warehouse.code} - ${data.warehouse.name}`
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

        {/* Tab strip */}
        <div className="mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={
              "rounded-lg py-2 transition-colors " +
              (tab === "pending"
                ? "bg-[#003087] text-white shadow"
                : "text-slate-600")
            }
          >
            Pending ({counts.pending})
          </button>
          <button
            type="button"
            onClick={() => setTab("captured")}
            className={
              "rounded-lg py-2 transition-colors " +
              (tab === "captured"
                ? "bg-emerald-600 text-white shadow"
                : "text-slate-600")
            }
          >
            Captured ({counts.captured})
          </button>
        </div>

        {/* Filter */}
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

        {tab === "pending" && !loading && (
          <PendingList
            rows={visiblePending}
            activeVariantId={activeVariantId}
            scanBinCode={scanBinCode}
            scanQty={scanQty}
            scanError={scanError}
            busy={busy}
            onOpen={openScanFor}
            onClose={closeScan}
            onBinChange={setScanBinCode}
            onQtyChange={setScanQty}
            onScanRequest={() => setScannerOpen(true)}
            onSave={onSave}
          />
        )}

        {tab === "captured" && !loading && (
          <CapturedList
            rows={visibleCaptured}
            busy={busy}
            onClear={onClearCaptured}
          />
        )}
      </div>

      {scannerOpen && (
        <BarcodeScanner
          active
          onClose={() => setScannerOpen(false)}
          onResult={(text) => void applyBinScan(text)}
        />
      )}
    </div>
  );
};

// =====================================================================
// Pending tab
// =====================================================================

interface PendingProps {
  rows: VariantRow[];
  activeVariantId: string | null;
  scanBinCode: string;
  scanQty: string;
  scanError: string | null;
  busy: string | null;
  onOpen: (variantId: string) => void;
  onClose: () => void;
  onBinChange: (v: string) => void;
  onQtyChange: (v: string) => void;
  onScanRequest: () => void;
  onSave: () => void;
}

const PendingList = ({
  rows,
  activeVariantId,
  scanBinCode,
  scanQty,
  scanError,
  busy,
  onOpen,
  onClose,
  onBinChange,
  onQtyChange,
  onScanRequest,
  onSave,
}: PendingProps) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        Nothing pending. All Zone PR variants have been captured.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((v) => {
        const active = v.variantId === activeVariantId;
        const desc = variantDescription(v);
        return (
          <li
            key={v.variantId}
            className={
              "rounded-xl bg-white p-3 ring-1 shadow-sm " +
              (active ? "ring-[#003087] ring-2" : "ring-slate-200")
            }
          >
            <button
              type="button"
              onClick={() => (active ? onClose() : onOpen(v.variantId))}
              className="block w-full text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 leading-tight">
                    {desc}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 leading-tight">
                    SKU{" "}
                    <span className="font-mono text-slate-700">
                      {v.variantSku}
                    </span>
                  </div>
                  {v.variantBarcode && (
                    <div className="mt-0.5 text-xs text-slate-500 leading-tight">
                      Barcode{" "}
                      <span className="font-mono text-slate-700">
                        {v.variantBarcode}
                      </span>
                    </div>
                  )}
                </div>
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide " +
                    (active
                      ? "bg-[#003087] text-white"
                      : "bg-amber-100 text-amber-800")
                  }
                >
                  {active ? "Capturing" : "Pending"}
                </span>
              </div>
            </button>

            {active && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Bin barcode
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    type="text"
                    value={scanBinCode}
                    onChange={(e) => onBinChange(e.target.value)}
                    placeholder="STR.PR.<SKU>.00"
                    className={inputCls}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={onScanRequest}
                    className="h-11 w-11 shrink-0 rounded-xl border border-slate-300 bg-slate-50 text-lg"
                    aria-label="Scan bin barcode"
                  >
                    📷
                  </button>
                </div>

                <label className="mt-3 mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Count
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={scanQty}
                  onChange={(e) => onQtyChange(e.target.value)}
                  placeholder="Qty in this bin"
                  className={inputCls}
                />

                {scanError && (
                  <div className="mt-2 text-xs text-red-600">{scanError}</div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={busy === v.variantId}
                    className="rounded-xl bg-[#003087] py-3 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy === v.variantId ? "Saving..." : "Save & next"}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// =====================================================================
// Captured tab - reference only, with "Clear & redo"
// =====================================================================

interface CapturedProps {
  rows: VariantRow[];
  busy: string | null;
  onClear: (variant: VariantRow) => void;
}

const CapturedList = ({ rows, busy, onClear }: CapturedProps) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        Nothing captured yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((v) => {
        const desc = variantDescription(v);
        return (
          <li
            key={v.variantId}
            className="rounded-xl bg-white p-3 ring-1 ring-emerald-200 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900 leading-tight">
                  {desc}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 leading-tight">
                  SKU{" "}
                  <span className="font-mono text-slate-700">
                    {v.variantSku}
                  </span>
                  {v.variantBarcode ? (
                    <>
                      {" \u00b7 "}Barcode{" "}
                      <span className="font-mono text-slate-700">
                        {v.variantBarcode}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-xs ring-1 ring-emerald-200">
                  <span className="font-mono font-semibold text-emerald-800">
                    {v.binCode ?? "(no code)"}
                  </span>
                  <span className="text-emerald-600">qty</span>
                  <span className="font-bold tabular-nums text-emerald-900">
                    {v.binQty}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onClear(v)}
                disabled={busy === v.variantId}
                className="shrink-0 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
              >
                {busy === v.variantId ? "..." : "Clear & redo"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
