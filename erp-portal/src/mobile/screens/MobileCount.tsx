import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../../lib/api";

// =====================================================================
// /m/count — bin cycle count / stock adjustment
// =====================================================================
// Lets warehouse staff:
//   1. Search for a bin by scanning its location code
//      (GET /v1/locations/scan?code=...) to resolve the binId.
//   2. Recount the bin (POST /v1/bins/:id/recount) — corrects physical
//      qty with an audit trail.
//   3. Reassign the bin to a different product
//      (POST /v1/bins/:id/reassign).
//   4. Quick-adjust product stock
//      (POST /v1/inventory/adjust).
//
// All mutating calls send a clientOpId (UUID) for idempotent retries.

import { BarcodeScanner } from "../BarcodeScanner";

type Mode = "scan" | "recount" | "reassign" | "adjust";

interface ResolvedBin {
  binId: string;
  location: string;
  zone: string;
  shelf: string;
  bin: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  product?: { id: string; sku: string; name: string; uom: string } | null;
  qty?: number;
}

interface ResolvedProduct {
  id: string;
  sku: string;
  name: string;
  uom: string;
}

type RecountReason = "physical_match" | "damage" | "found_elsewhere" | "product_swap" | "spillage" | "expired" | "other";

const RECOUNT_REASONS: { value: RecountReason; label: string }[] = [
  { value: "physical_match", label: "Physical recount matches" },
  { value: "damage", label: "Damage / loss" },
  { value: "found_elsewhere", label: "Found in wrong bin" },
  { value: "spillage", label: "Spillage" },
  { value: "expired", label: "Expired / destroyed" },
  { value: "other", label: "Other" },
];

const randomOpId = () => `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const MobileCount = () => {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("scan");
  const [scannerOpen, setScannerOpen] = useState(false);

  // Resolved bin state
  const [binCode, setBinCode] = useState("");
  const [bin, setBin] = useState<ResolvedBin | null>(null);
  const [binError, setBinError] = useState<string | null>(null);
  const [binLoading, setBinLoading] = useState(false);

  // Recount state
  const [recountQty, setRecountQty] = useState("");
  const [recountReason, setRecountReason] = useState<RecountReason>("physical_match");
  const [recountRemarks, setRecountRemarks] = useState("");

  // Reassign state
  const [newProductCode, setNewProductCode] = useState("");
  const [newProduct, setNewProduct] = useState<ResolvedProduct | null>(null);
  const [reassignQty, setReassignQty] = useState("");
  const [reassignReason, setReassignReason] = useState<RecountReason>("product_swap");
  const [reassignRemarks, setReassignRemarks] = useState("");

  // Quick adjust state
  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustWarehouse, setAdjustWarehouse] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("physical_match");

  // Shared result state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const lookupBin = useCallback(async (code: string) => {
    const c = code.trim();
    if (!c) return;
    setBinLoading(true);
    setBinError(null);
    setBin(null);
    setSuccess(null);
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/locations/scan?code=${encodeURIComponent(c)}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      if (resp.kind === "bin") {
        setBin(resp as ResolvedBin);
        setRecountQty(String(resp.qty ?? ""));
        setMode("recount");
      } else {
        setBinError("That code didn't resolve to a bin. Try a bin location like A/1/1.");
      }
    } catch (e) {
      setBinError((e as Error).message);
    } finally {
      setBinLoading(false);
    }
  }, []);

  const lookupProduct = useCallback(async (code: string) => {
    const c = code.trim();
    if (!c) return;
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/products/by-sku/${encodeURIComponent(c)}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      if (resp?.id) setNewProduct(resp as ResolvedProduct);
      else setNewProduct(null);
    } catch {
      setNewProduct(null);
    }
  }, []);

  useEffect(() => {
    if (newProductCode.length > 1) void lookupProduct(newProductCode);
    else setNewProduct(null);
  }, [newProductCode, lookupProduct]);

  const doRecount = async () => {
    if (!bin) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.recountBin(bin.binId, {
        qtyAfter: Number(recountQty),
        reasonCode: recountReason,
        remarks: recountRemarks || undefined,
        clientOpId: randomOpId(),
      });
      setSuccess(`Bin ${bin.location} recounted to ${recountQty} — ledger updated.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doReassign = async () => {
    if (!bin || !newProduct) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.reassignBin(bin.binId, {
        productId: newProduct.id,
        qty: Number(reassignQty),
        reasonCode: reassignReason,
        remarks: reassignRemarks || undefined,
        clientOpId: randomOpId(),
      });
      setSuccess(`Bin ${bin.location} reassigned to ${newProduct.sku} with qty ${reassignQty}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doAdjust = async () => {
    if (!adjustProduct || !adjustWarehouse || !adjustQty) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.adjustStock({
        productId: adjustProduct,
        warehouseId: adjustWarehouse,
        qty: Number(adjustQty),
        reason: adjustReason,
      });
      setSuccess("Stock adjusted successfully.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setBin(null);
    setBinCode("");
    setBinError(null);
    setSuccess(null);
    setError(null);
    setMode("scan");
  };

  return (
    <div className="px-4 pt-4 pb-8">
      {/* Mode switcher */}
      <div className="mb-4 flex rounded-2xl bg-slate-200 p-1 gap-0.5">
        {(["scan", "adjust"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setSuccess(null); setError(null); }}
            className={[
              "flex-1 rounded-xl py-2 text-sm font-semibold transition capitalize",
              mode === m || (m === "scan" && (mode === "recount" || mode === "reassign"))
                ? "bg-white text-[#003087] shadow-sm"
                : "text-slate-600",
            ].join(" ")}
          >
            {m === "scan" ? "Bin scan" : "Quick adjust"}
          </button>
        ))}
      </div>

      {success && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <div className="font-semibold">Done</div>
          <div>{success}</div>
          <button
            type="button"
            onClick={reset}
            className="mt-2 text-xs text-emerald-700 underline"
          >
            Scan another bin
          </button>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {/* ── Bin scan mode ── */}
      {(mode === "scan" || mode === "recount" || mode === "reassign") && (
        <div>
          {/* Bin code input */}
          {!bin && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Bin location code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={binCode}
                  onChange={(e) => setBinCode(e.target.value)}
                  placeholder="e.g. A/1/1 or scan below"
                  className="flex-1 h-10 rounded-xl border border-slate-300 px-3 text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") void lookupBin(binCode); }}
                />
                <button
                  type="button"
                  onClick={() => void lookupBin(binCode)}
                  disabled={binLoading || !binCode.trim()}
                  className="rounded-xl bg-[#003087] px-4 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {binLoading ? "…" : "Go"}
                </button>
              </div>
              {binError && <div className="mt-1 text-xs text-red-600">{binError}</div>}

              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-medium text-slate-500"
              >
                📷 Scan barcode / QR
              </button>
            </div>
          )}

          {/* Bin resolved */}
          {bin && (
            <div className="mb-4 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
              <div className="bg-[#003087] px-4 py-3">
                <div className="font-mono text-base font-bold text-white">{bin.location}</div>
                <div className="text-sm text-blue-100">{bin.warehouseCode} — {bin.warehouseName}</div>
              </div>
              <div className="px-4 py-3 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Product</span>
                  <span className="font-mono font-semibold">{bin.product?.sku ?? "Empty"}</span>
                </div>
                {bin.product?.name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Name</span>
                    <span className="truncate ml-4">{bin.product.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Qty on record</span>
                  <span className="font-semibold">{bin.qty ?? 0}</span>
                </div>
              </div>
              {/* Sub-mode tabs */}
              <div className="flex border-t border-slate-100">
                {(["recount", "reassign"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setSuccess(null); setError(null); }}
                    className={[
                      "flex-1 py-2 text-xs font-semibold capitalize border-r last:border-r-0 border-slate-100",
                      mode === m ? "bg-[#003087] text-white" : "text-slate-600",
                    ].join(" ")}
                  >
                    {m === "recount" ? "Recount" : "Reassign"}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  className="flex-1 py-2 text-xs font-semibold text-red-500"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* ── Recount form ── */}
          {mode === "recount" && bin && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actual qty (physical count)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={recountQty}
                  onChange={(e) => setRecountQty(e.target.value)}
                  className="w-full h-14 rounded-xl border border-slate-300 bg-slate-50 px-4 text-2xl font-bold text-center"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Reason
                </label>
                <select
                  value={recountReason}
                  onChange={(e) => setRecountReason(e.target.value as RecountReason)}
                  className="w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  {RECOUNT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Remarks (optional)
                </label>
                <textarea
                  value={recountRemarks}
                  onChange={(e) => setRecountRemarks(e.target.value)}
                  rows={2}
                  placeholder="e.g. shelf label damaged"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={busy || recountQty === ""}
                onClick={() => void doRecount()}
                className="w-full rounded-xl bg-emerald-500 py-4 text-base font-bold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Confirm recount"}
              </button>
            </div>
          )}

          {/* ── Reassign form ── */}
          {mode === "reassign" && bin && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  New product SKU
                </label>
                <input
                  type="text"
                  value={newProductCode}
                  onChange={(e) => setNewProductCode(e.target.value)}
                  placeholder="Type SKU or scan"
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                />
                {newProduct && (
                  <div className="mt-1 text-xs text-emerald-700 font-semibold">
                    ✓ {newProduct.sku} — {newProduct.name}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Qty to place in bin
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={reassignQty}
                  onChange={(e) => setReassignQty(e.target.value)}
                  className="w-full h-12 rounded-xl border border-slate-300 bg-slate-50 px-4 text-xl font-bold text-center"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Reason
                </label>
                <select
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value as RecountReason)}
                  className="w-full h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="product_swap">Product swap</option>
                  <option value="found_elsewhere">Found in wrong bin</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Remarks (optional)
                </label>
                <textarea
                  value={reassignRemarks}
                  onChange={(e) => setReassignRemarks(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                disabled={busy || !newProduct || !reassignQty}
                onClick={() => void doReassign()}
                className="w-full rounded-xl bg-[#003087] py-4 text-base font-bold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Reassign bin"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Quick adjust mode ── */}
      {mode === "adjust" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Direct stock adjustment — sets an absolute qty delta for audit.
            Use "Bin scan → Recount" for per-bin physical counts.
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Product ID
            </label>
            <input
              type="text"
              value={adjustProduct}
              onChange={(e) => setAdjustProduct(e.target.value)}
              placeholder="Paste product ID"
              className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Warehouse ID
            </label>
            <input
              type="text"
              value={adjustWarehouse}
              onChange={(e) => setAdjustWarehouse(e.target.value)}
              placeholder="Paste warehouse ID"
              className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm font-mono"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Qty (+ add / − remove)
            </label>
            <input
              type="number"
              step={1}
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              className="w-full h-12 rounded-xl border border-slate-300 bg-slate-50 px-4 text-xl font-bold text-center"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Reason
            </label>
            <input
              type="text"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="min 2 chars"
              className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy || !adjustProduct || !adjustWarehouse || !adjustQty || adjustReason.length < 2}
            onClick={() => void doAdjust()}
            className="w-full rounded-xl bg-amber-500 py-4 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? "Adjusting…" : "Post adjustment"}
          </button>
        </div>
      )}

      {/* Barcode scanner overlay */}
      <BarcodeScanner
        active={scannerOpen}
        onResult={(code) => {
          setScannerOpen(false);
          setBinCode(code);
          void lookupBin(code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
};
