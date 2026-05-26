import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, auth } from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";
import { newClientOpId } from "../clientOpId";

// =====================================================================
// /m/packs/:id
// =====================================================================
// Per-line scan-confirm with editable qtyPacked. The packer must scan
// each product to confirm it's actually in the box; qty defaults to
// qtyPicked but can be reduced (over-pack is rejected by the server).
//
// Final actions:
//   - Mark packed: hits /packing-slips/:id/pack (locks the slip).
//   - Release: drops the claim so a colleague can take over.

interface PackItem {
  id: string;
  qtyOrdered: number;
  qtyPicked: number;
  qtyPacked: number;
  rate: number;
  notes?: string | null;
  product?: { sku?: string; name?: string; uom?: string; barcode?: string | null };
  variant?: { sku?: string; uom?: string; barcode?: string | null } | null;
}

interface PackingSlip {
  id: string;
  packingSlipNo: string;
  status: string;
  salesOrder?: { soNo?: string; customer?: { name?: string } };
  items: PackItem[];
}

const REASON_LABELS: Record<string, string> = {
  ok: "All good",
  short_pack: "Short pack (less than picked)",
  damage: "Damaged - removed from pack",
  substitute: "Substitute SKU",
  other: "Other (see remarks)",
};

export const MobilePack = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [ps, setPs] = useState<PackingSlip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanFor, setScanFor] = useState<string | null>(null);
  // Per-line transient state (qty + product code + reason).
  const [draft, setDraft] = useState<
    Record<string, { qty: number; productCode: string; reason: keyof typeof REASON_LABELS; remarks: string }>
  >({});
  // One clientOpId per line, regenerated only on full success so a
  // network retry replays the same call.
  const opIds = useRef<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const result: PackingSlip = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/packing-slips/${id}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      setPs(result);
      // Initialise drafts.
      const init: Record<string, { qty: number; productCode: string; reason: keyof typeof REASON_LABELS; remarks: string }> = {};
      for (const it of result.items) {
        init[it.id] = {
          qty: it.qtyPacked > 0 ? it.qtyPacked : it.qtyPicked,
          productCode: "",
          reason: "ok",
          remarks: "",
        };
        if (!opIds.current[it.id]) opIds.current[it.id] = newClientOpId();
      }
      setDraft(init);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const release = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.releasePackingSlip(id);
      nav("/m/tasks", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scanLine = async (item: PackItem) => {
    if (!id) return;
    const d = draft[item.id];
    if (!d) return;
    setBusy(true);
    setError(null);
    try {
      await api.scanPackItem(id, item.id, {
        productCode: d.productCode.trim() || undefined,
        qty: d.qty,
        reasonCode: d.reason,
        remarks: d.remarks.trim() || null,
        clientOpId: opIds.current[item.id],
      });
      // success - regenerate the opId so a future correction is a fresh call.
      opIds.current[item.id] = newClientOpId();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finalisePack = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await fetch(
        `${import.meta.env.VITE_API_URL}/v1/packing-slips/${id}/pack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token()}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      ).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new ApiError(r.status, body?.error?.message ?? `${r.status}`, body?.error);
        }
      });
      nav("/m/tasks", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!ps) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-slate-500">
        {error ?? "Loading…"}
      </div>
    );
  }

  const allConfirmed = ps.items.every((i) => i.qtyPacked > 0 || i.qtyPicked === 0);

  return (
    // pb-44 reserves clear scroll room for the FIXED action bar so
    // every line in a long packing slip can be reached. Bar is fixed
    // to the viewport (above the bottom tab nav) instead of sticky
    // so it doesn't trap content behind it on shorter lists.
    <div className="px-4 pt-4 pb-44">
      <div className="mb-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-base font-semibold text-[#003087]">
            {ps.packingSlipNo}
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
            {ps.status}
          </span>
        </div>
        <div className="mt-1 text-base font-medium text-slate-900">
          {ps.salesOrder?.customer?.name ?? "—"}
        </div>
        <div className="text-xs text-slate-500">
          SO {ps.salesOrder?.soNo} · {ps.items.length} line{ps.items.length === 1 ? "" : "s"}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {ps.items.map((it) => {
          const sku = it.variant?.sku ?? it.product?.sku ?? "?";
          const uom = it.variant?.uom ?? it.product?.uom ?? "pcs";
          const d = draft[it.id] ?? {
            qty: it.qtyPicked,
            productCode: "",
            reason: "ok" as const,
            remarks: "",
          };
          const productExpected = (it.variant?.sku ?? it.product?.sku ?? "").toUpperCase();
          const productMismatch =
            !!d.productCode && d.productCode.trim().toUpperCase() !== productExpected;
          const shortPack = d.qty < it.qtyPicked;
          const showReason = productMismatch || shortPack || it.qtyPicked === 0;
          const confirmed = it.qtyPacked > 0;
          return (
            <div
              key={it.id}
              className={[
                "rounded-2xl bg-white p-4 ring-1 shadow-sm",
                confirmed ? "ring-emerald-300" : "ring-slate-200",
              ].join(" ")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-[#003087]">{sku}</span>
                <span className="text-xs text-slate-500">
                  picked {it.qtyPicked} {uom}
                </span>
              </div>
              <div className="mt-1 truncate text-sm text-slate-900">{it.product?.name}</div>

              <div className="mt-3 flex items-stretch gap-2">
                <div className="flex flex-1 items-stretch overflow-hidden rounded-xl border border-slate-300">
                  <input
                    value={d.productCode}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [it.id]: { ...prev[it.id], productCode: e.target.value },
                      }))
                    }
                    placeholder="scan product"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    className="flex-1 bg-white px-3 py-2 font-mono text-sm focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setScanFor(it.id)}
                    className="bg-[#003087] px-3 text-xs font-semibold text-white"
                  >
                    Scan
                  </button>
                </div>
                <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        [it.id]: { ...p[it.id], qty: Math.max(0, p[it.id].qty - 1) },
                      }))
                    }
                    className="px-3 text-xl text-slate-600"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    value={d.qty}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        [it.id]: { ...p[it.id], qty: parseFloat(e.target.value) || 0 },
                      }))
                    }
                    className="w-16 bg-white text-center text-base font-semibold focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        [it.id]: {
                          ...p[it.id],
                          qty: Math.min(it.qtyPicked, p[it.id].qty + 1),
                        },
                      }))
                    }
                    className="px-3 text-xl text-slate-600"
                  >
                    +
                  </button>
                </div>
              </div>

              {showReason && !confirmed && (
                <div className="mt-3 rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                    Reason for variance
                  </div>
                  <select
                    value={d.reason}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        [it.id]: {
                          ...p[it.id],
                          reason: e.target.value as keyof typeof REASON_LABELS,
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs"
                  >
                    {Object.entries(REASON_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {confirmed
                    ? `confirmed ${it.qtyPacked} ${uom}`
                    : `pending ${d.qty}/${it.qtyPicked} ${uom}`}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void scanLine(it)}
                  className={[
                    "rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50",
                    confirmed ? "bg-slate-500" : "bg-emerald-500",
                  ].join(" ")}
                >
                  {confirmed ? "Update" : "Confirm"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <div className="mb-2 text-xs text-slate-500">
          {allConfirmed
            ? "All lines confirmed - ready to seal the pack."
            : "Confirm every line before marking the pack complete."}
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
            onClick={finalisePack}
            className="flex-[2] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Mark packed
          </button>
        </div>
      </div>

      <BarcodeScanner
        active={scanFor !== null}
        onResult={(text) => {
          if (scanFor)
            setDraft((p) => ({
              ...p,
              [scanFor]: { ...p[scanFor], productCode: text },
            }));
          setScanFor(null);
        }}
        onClose={() => setScanFor(null)}
      />
    </div>
  );
};
