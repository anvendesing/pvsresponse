import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, auth } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";
import { newClientOpId } from "../clientOpId";

// =====================================================================
// /m/picks/:id/line/:itemId
// =====================================================================
// Three-step scan-confirm:
//   1. Scan the bin (matches against item.bin.code).
//   2. Scan the product (matches the line's SKU/barcode).
//   3. Confirm qty - defaults to qtyToPick, can be reduced.
//
// On non-trivial mismatches (wrong bin / wrong product / qty < expected)
// the worker picks a reason code in a drawer before the POST goes
// through. The clientOpId is generated once per line and re-used on
// retries so a flaky network can't double-write.

interface PickItem {
  id: string;
  qtyToPick: number;
  qtyPicked: number;
  notes?: string | null;
  product?: { sku?: string; name?: string; uom?: string; barcode?: string | null };
  variant?: { sku?: string; uom?: string; size?: string; color?: string; barcode?: string | null } | null;
  bin?: { id?: string; code?: string; zone?: string; shelf?: string; bin?: string };
}

interface PickList {
  id: string;
  pickListNo: string;
  status: string;
  items: PickItem[];
  packingSlip?: { id: string; packingSlipNo: string; status: string } | null;
}

type PickReason =
  | "ok"
  | "short_pick"
  | "wrong_bin"
  | "damage"
  | "not_found"
  | "substitute"
  | "other";

const REASON_LABELS: Record<PickReason, string> = {
  ok: "All good",
  short_pick: "Short pick (less than expected)",
  wrong_bin: "Stock found in a different bin",
  damage: "Damaged - removed from pick",
  not_found: "Not on shelf",
  substitute: "Substitute SKU",
  other: "Other (see remarks)",
};

export const MobilePickLine = () => {
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const nav = useNavigate();
  const [pl, setPl] = useState<PickList | null>(null);
  const [scanTarget, setScanTarget] = useState<"bin" | "product" | null>(null);
  const [binCode, setBinCode] = useState("");
  const [productCode, setProductCode] = useState("");
  const [qty, setQty] = useState<number>(0);
  const [reason, setReason] = useState<PickReason>("ok");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opIdRef = useRef<string>(newClientOpId());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_URL}/v1/pick-lists/${id}`, {
      headers: { Authorization: `Bearer ${auth.token()}` },
    })
      .then((r) => r.json())
      .then((data: PickList) => {
        if (cancelled) return;
        setPl(data);
        const line = data.items.find((i) => i.id === itemId);
        if (line) {
          setQty(line.qtyToPick);
          if (line.bin?.code) setBinCode(line.bin.code);
        }
      })
      .catch((err) => setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id, itemId]);

  const line = useMemo(
    () => pl?.items.find((i) => i.id === itemId) ?? null,
    [pl, itemId]
  );

  // Derived values - computed even when `line` is null so we don't
  // change hook order between renders. Once `line` is null the values
  // are sensible defaults that the JSX never renders anyway.
  const expectedBinCode = line?.bin?.code ?? null;
  const productExpected = (line?.variant?.sku ?? line?.product?.sku ?? "").toUpperCase();
  const binMismatch = !!(
    expectedBinCode &&
    binCode &&
    binCode.trim().toUpperCase() !== expectedBinCode.toUpperCase()
  );
  const productMismatch =
    !!productCode && productCode.trim().toUpperCase() !== productExpected;
  const shortPick = !!line && qty < line.qtyToPick;

  // Suggest a reason if the worker is about to short-pick / has scanned
  // a wrong code, but hasn't picked a reason themselves. This MUST be
  // before any early return so the hook order stays stable.
  useEffect(() => {
    if (!line) return;
    if (binMismatch && reason === "ok") setReason("wrong_bin");
    else if (productMismatch && reason === "ok") setReason("substitute");
    else if (shortPick && reason === "ok" && qty === 0) setReason("not_found");
    else if (shortPick && reason === "ok") setReason("short_pick");
  }, [line, binMismatch, productMismatch, shortPick, qty, reason]);

  if (!line) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-slate-500">
        {error ?? "Loading…"}
      </div>
    );
  }

  // If the pick has already been completed (or cancelled) the scan
  // endpoint will return 409 bad_state on submit. Don't even let the
  // worker reach the form - explain what happened and route them to
  // the next document. Without this guard the user sees a generic
  // "Pick list is 'picked'." error only after tapping Confirm.
  if (pl && (pl.status === "picked" || pl.status === "cancelled")) {
    return (
      <div className="px-4 pt-4 pb-20">
        <button
          type="button"
          onClick={() => nav(`/m/picks/${id}`)}
          className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-slate-600"
        >
          <span>←</span> Back to pick list
        </button>
        <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <div className="text-base font-semibold text-emerald-900">
            {pl.status === "picked"
              ? "This pick is already complete."
              : "This pick was cancelled."}
          </div>
          {pl.status === "picked" && (
            <div className="mt-1 text-sm text-emerald-800">
              {pl.packingSlip
                ? `The next scan happens on packing slip ${pl.packingSlip.packingSlipNo}.`
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
                Open packing slip
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const sku = line.variant?.sku ?? line.product?.sku ?? "?";
  const uom = line.variant?.uom ?? line.product?.uom ?? "pcs";

  const submit = async () => {
    if (!id || !itemId) return;
    setBusy(true);
    setError(null);
    try {
      await api.scanPickItem(id, itemId, {
        binCode: binCode.trim() || undefined,
        productCode: productCode.trim() || undefined,
        qty,
        reasonCode: reason,
        remarks: remarks.trim() || null,
        clientOpId: opIdRef.current,
      });
      nav(`/m/picks/${id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-4 pb-20">
      <button
        type="button"
        onClick={() => nav(`/m/picks/${id}`)}
        className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-slate-600"
      >
        <span>←</span> Back to pick list
      </button>

      <div className="mb-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-base font-semibold text-[#003087]">{sku}</span>
          <span className="text-xs text-slate-500">to pick {line.qtyToPick} {uom}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-slate-900">{line.product?.name}</div>
        {expectedBinCode && (
          <div className="mt-2 text-[11px] text-slate-500">
            expected bin: <span className="font-mono">{expectedBinCode}</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <ScanField
          label="1. Scan bin"
          value={binCode}
          onChange={setBinCode}
          onScan={() => setScanTarget("bin")}
          mismatch={!!binMismatch}
          placeholder="B.WH-MAIN.A.R1.S1.B1"
        />
        <ScanField
          label="2. Scan product"
          value={productCode}
          onChange={setProductCode}
          onScan={() => setScanTarget("product")}
          mismatch={productMismatch}
          placeholder={sku}
        />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            3. Confirm qty ({uom})
          </label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(0, q - 1))}
              className="px-4 text-2xl font-bold text-slate-600"
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
              className="flex-1 bg-white py-3 text-center text-xl font-semibold focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="px-4 text-2xl font-bold text-slate-600"
            >
              +
            </button>
          </div>
          <div className="mt-1 flex justify-end gap-2 text-[11px] text-slate-500">
            <button type="button" onClick={() => setQty(0)} className="underline">0</button>
            <button
              type="button"
              onClick={() => setQty(line.qtyToPick)}
              className="underline"
            >
              full ({line.qtyToPick})
            </button>
          </div>
        </div>

        {(binMismatch || productMismatch || shortPick) && (
          <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
              Reason for variance
            </div>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as PickReason)}
              className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              {Object.entries(REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {reason === "other" && (
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="What happened?"
                rows={2}
                className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"
              />
            )}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] -mx-4 mt-6 border-t border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-12 w-full rounded-xl bg-emerald-500 text-base font-bold text-white disabled:opacity-50"
        >
          {busy ? "Confirming…" : "Confirm pick"}
        </button>
      </div>

      <BarcodeScanner
        active={scanTarget !== null}
        onResult={(text) => {
          if (scanTarget === "bin") setBinCode(text);
          if (scanTarget === "product") setProductCode(text);
          setScanTarget(null);
        }}
        onClose={() => setScanTarget(null)}
      />
    </div>
  );
};

const ScanField = ({
  label,
  value,
  onChange,
  onScan,
  mismatch,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  onScan: () => void;
  mismatch?: boolean;
  placeholder?: string;
}) => (
  <div>
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </label>
    <div
      className={[
        "flex items-stretch overflow-hidden rounded-xl border bg-white",
        mismatch ? "border-amber-400" : "border-slate-300",
      ].join(" ")}
    >
      <input
        type="text"
        autoCapitalize="characters"
        autoCorrect="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent px-3 py-3 font-mono text-sm focus:outline-none"
      />
      <button
        type="button"
        onClick={onScan}
        className="bg-[#003087] px-4 text-sm font-semibold text-white"
      >
        Scan
      </button>
    </div>
    {mismatch && (
      <div className="mt-1 text-[11px] text-amber-700">
        Doesn't match the expected value - pick a reason below.
      </div>
    )}
  </div>
);
