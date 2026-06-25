import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { GrnPurchaseOrder } from "../../lib/api";
import {
  GrnMobileAllocation,
  useGrnAllocationDefaults,
  useGrnReceiveHints,
  type MobileGrnAllocation,
} from "../components/GrnMobileHelpers";

// =====================================================================
// /m/grn         — open POs ready to receive (approved + partial)
// /m/grn/:poId   — receive lines for a specific PO
// =====================================================================

type QcStatus = "pending" | "pass" | "rework" | "reject";

const QC_LABEL: Record<QcStatus, string> = {
  pending: "Pending QC",
  pass: "Pass",
  rework: "Rework",
  reject: "Reject",
};
const QC_COLOR: Record<QcStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  pass: "bg-emerald-100 text-emerald-800",
  rework: "bg-amber-100 text-amber-800",
  reject: "bg-red-100 text-red-700",
};

const poRemaining = (po: GrnPurchaseOrder) =>
  po.items.reduce((s, l) => s + Math.max(0, l.qty - l.received), 0);

// ── PO list ───────────────────────────────────────────────────────────

export const MobileGrnList = () => {
  const nav = useNavigate();
  const [pos, setPos] = useState<GrnPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.purchaseOrdersForGrn();
      setPos(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Open purchase orders
        </h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => nav("/m/grn-qc")}
            className="text-xs text-[#003087] font-medium"
          >
            QC queue
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs text-[#003087] font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {pos.length === 0 && !error && (
        <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          No approved or partial POs with qty left to receive.
        </div>
      )}

      <div className="space-y-2">
        {pos.map((po) => {
          const remaining = poRemaining(po);
          return (
            <button
              key={po.id}
              type="button"
              onClick={() => nav(`/m/grn/${po.id}`)}
              className="w-full rounded-xl bg-white px-4 py-3 text-left ring-1 ring-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-[#003087]">
                  {po.poNo}
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                  {po.status}
                </span>
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800 truncate">
                {po.vendorName}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {po.items.length} line{po.items.length === 1 ? "" : "s"} · {remaining}{" "}
                units to receive
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── GRN receive form ──────────────────────────────────────────────────

export const MobileGrnReceive = () => {
  const { poId } = useParams<{ poId: string }>();
  const nav = useNavigate();

  const [po, setPo] = useState<GrnPurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const [received, setReceived] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<Record<string, string>>({});
  const [qcStatus, setQcStatus] = useState<QcStatus>("pending");
  const [truckNo, setTruckNo] = useState("");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<
    Record<string, MobileGrnAllocation[]>
  >({});

  const productIds = useMemo(
    () => (po?.items ?? []).map((i) => i.productId),
    [po?.items]
  );
  const hints = useGrnReceiveHints(productIds);

  const allocationItems = useMemo(
    () =>
      (po?.items ?? []).map((item) => {
        const recv = Number(received[item.id] ?? 0);
        const rej = Number(rejected[item.id] ?? 0);
        return {
          id: item.id,
          productId: item.productId,
          accepted: Math.max(0, recv - rej),
        };
      }),
    [po?.items, received, rejected]
  );

  useGrnAllocationDefaults(allocationItems, hints, setAllocations);

  const refresh = useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api.getPurchaseOrderForGrn(poId);
      setPo(p);
      const initQtys: Record<string, string> = {};
      for (const item of p.items) {
        const rem = Math.max(0, item.qty - item.received);
        initQtys[item.id] = rem > 0 ? String(rem) : "0";
      }
      setReceived(initQtys);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!po) return;
    setBusy(true);
    setError(null);
    try {
      const items = po.items
        .filter((item) => Number(received[item.id] ?? 0) > 0)
        .map((item) => {
          const recv = Number(received[item.id] ?? 0);
          const rej = Number(rejected[item.id] ?? 0);
          const accepted = Math.max(0, recv - rej);
          const rows = allocations[item.id] ?? [];
          if (accepted > 0 && rows.length > 0) {
            const sum = rows.reduce((s, a) => s + a.qty, 0);
            if (Math.abs(sum - accepted) > 0.001) {
              throw new Error(
                `${item.product.sku}: bin qty (${sum}) must equal accepted (${accepted}).`
              );
            }
            if (rows.some((a) => !a.binId)) {
              throw new Error(`${item.product.sku}: pick a bin for every row.`);
            }
          }
          return {
            poItemId: item.id,
            receivedQty: recv,
            rejectedQty: rej,
            batchNo: batches[item.id]?.trim() || null,
            allocations:
              rows.length > 0
                ? rows.map((a) => ({ binId: a.binId, qty: a.qty }))
                : undefined,
          };
        });

      if (items.length === 0) {
        setError("Enter a received quantity for at least one line.");
        return;
      }

      await api.createGrn({
        poId: po.id,
        qcStatus,
        truckNo: truckNo.trim() || undefined,
        notes: notes.trim() || undefined,
        items,
      });

      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!po) return <ErrorBanner message={error ?? "PO not found"} />;

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 gap-4">
        <div className="text-4xl">✓</div>
        <div className="text-lg font-bold text-emerald-700 text-center">GRN posted</div>
        <div className="text-sm text-slate-500 text-center">
          Stock has been received and updated.
        </div>
        <button
          type="button"
          onClick={() => nav("/m/grn")}
          className="mt-2 rounded-xl bg-[#003087] px-8 py-3 text-sm font-bold text-white"
        >
          Back to PO list
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-40">
      <div className="mb-4 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
        <div className="bg-[#003087] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-base font-bold text-white">{po.poNo}</span>
            <button
              type="button"
              onClick={() => nav("/m/grn")}
              className="text-xs text-blue-200 font-medium"
            >
              ← POs
            </button>
          </div>
          <div className="mt-0.5 text-sm text-blue-100">{po.vendorName}</div>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 w-16 shrink-0">Truck no.</label>
            <input
              type="text"
              value={truckNo}
              onChange={(e) => setTruckNo(e.target.value)}
              placeholder="optional"
              className="flex-1 h-8 rounded-lg border border-slate-200 px-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500 w-16 shrink-0">QC</label>
            <select
              value={qcStatus}
              onChange={(e) => setQcStatus(e.target.value as QcStatus)}
              className={`flex-1 h-8 rounded-lg border border-slate-200 px-2 text-sm font-semibold ${QC_COLOR[qcStatus]}`}
            >
              {(Object.keys(QC_LABEL) as QcStatus[]).map((s) => (
                <option key={s} value={s}>
                  {QC_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-start gap-2">
            <label className="text-xs text-slate-500 w-16 shrink-0 pt-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="optional"
              className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Lines
      </div>
      <div className="space-y-3">
        {po.items.map((item) => {
          const remaining = Math.max(0, item.qty - item.received);
          const recv = Number(received[item.id] ?? 0);
          const rej = Number(rejected[item.id] ?? 0);
          const accepted = Math.max(0, recv - rej);
          return (
            <div
              key={item.id}
              className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm px-4 py-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold text-[#003087]">
                    {item.product.sku}
                  </div>
                  <div className="text-sm text-slate-700 truncate">{item.product.name}</div>
                </div>
                <div className="text-right shrink-0 text-xs text-slate-500">
                  <div>
                    Ordered: {item.qty} {item.product.uom}
                  </div>
                  <div>Received: {item.received}</div>
                  <div
                    className={
                      remaining > 0 ? "text-amber-700 font-semibold" : "text-emerald-700"
                    }
                  >
                    Remaining: {remaining}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Receive qty
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={received[item.id] ?? ""}
                    onChange={(e) =>
                      setReceived((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                    className="mt-0.5 w-full h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base font-semibold"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Reject qty
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={rejected[item.id] ?? "0"}
                    onChange={(e) =>
                      setRejected((p) => ({ ...p, [item.id]: e.target.value }))
                    }
                    className="mt-0.5 w-full h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base"
                  />
                </div>
              </div>
              {Number(received[item.id] ?? 0) > 0 && (
                <div>
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide">
                    Batch / lot
                  </label>
                  <input
                    type="text"
                    value={batches[item.id] ?? ""}
                    onChange={(e) => setBatches((p) => ({ ...p, [item.id]: e.target.value }))}
                    placeholder="Auto if blank"
                    className="mt-0.5 w-full h-9 rounded-lg border border-slate-200 px-3 text-sm font-mono"
                  />
                </div>
              )}
              <GrnMobileAllocation
                acceptedQty={accepted}
                hint={hints[item.productId]}
                allocations={allocations[item.id] ?? []}
                onChange={(next) =>
                  setAllocations((prev) => ({ ...prev, [item.id]: next }))
                }
              />
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white disabled:opacity-50"
        >
          {busy ? "Posting GRN…" : "Post GRN"}
        </button>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          Requires procurement or warehouse role — contact admin if you get a 403.
        </p>
      </div>
    </div>
  );
};

const LoadingScreen = () => (
  <div className="flex h-[50vh] items-center justify-center text-sm text-slate-400 animate-pulse">
    Loading…
  </div>
);

const ErrorBanner = ({ message }: { message: string }) => (
  <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
    {message}
  </div>
);
