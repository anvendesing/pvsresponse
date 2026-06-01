import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, auth } from "../../lib/api";

// =====================================================================
// /m/grn         — list of open purchase orders to receive against
// /m/grn/:poId   — receive lines for a specific PO
// =====================================================================
// NOTE: The backend gates GRN creation to the "procurement" role.
// Warehouse staff using this screen must have the "procurement" role
// assigned by an admin, or the backend role gate on POST /grns must be
// extended to include "warehouse" (supervisor/admin decision required).

// ── Types ─────────────────────────────────────────────────────────────

interface PoLine {
  id: string;
  productId: string;
  product: { sku: string; name: string; uom: string };
  variant?: { sku: string; size?: string | null } | null;
  qtyOrdered: number;
  qtyReceived: number;
}

interface PurchaseOrder {
  id: string;
  poNo: string;
  status: string;
  vendor?: { name: string } | null;
  items: PoLine[];
}

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

// ── PO list ───────────────────────────────────────────────────────────

export const MobileGrnList = () => {
  const nav = useNavigate();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.purchaseOrders({ status: "approved" });
      setPos(result as unknown as PurchaseOrder[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Open purchase orders
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-xs text-[#003087] font-medium"
        >
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {pos.length === 0 && !loading && (
        <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          No open purchase orders to receive.
        </div>
      )}

      <div className="space-y-2">
        {pos.map((po) => {
          const remaining = po.items.reduce(
            (s, l) => s + Math.max(0, l.qtyOrdered - l.qtyReceived),
            0
          );
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
                {po.vendor?.name ?? "—"}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {po.items.length} line{po.items.length === 1 ? "" : "s"} · {remaining} units to receive
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

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  // Per-line receive quantities (keyed by PO item id)
  const [received, setReceived] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [qcStatus, setQcStatus] = useState<QcStatus>("pending");
  const [truckNo, setTruckNo] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    if (!poId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/purchase-orders/${poId}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      const p = result as PurchaseOrder;
      setPo(p);
      // Pre-fill received qty = remaining to receive
      const initQtys: Record<string, string> = {};
      for (const item of p.items) {
        const rem = Math.max(0, item.qtyOrdered - item.qtyReceived);
        initQtys[item.id] = String(rem);
      }
      setReceived(initQtys);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    if (!po) return;
    setBusy(true);
    setError(null);
    try {
      const items = po.items
        .filter((item) => Number(received[item.id] ?? 0) > 0)
        .map((item) => ({
          poItemId: item.id,
          receivedQty: Number(received[item.id] ?? 0),
          rejectedQty: Number(rejected[item.id] ?? 0),
        }));

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
      } as Parameters<typeof api.createGrn>[0]);

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
      {/* Header */}
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
          <div className="mt-0.5 text-sm text-blue-100">{po.vendor?.name ?? "—"}</div>
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
                <option key={s} value={s}>{QC_LABEL[s]}</option>
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

      {/* Lines */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Lines
      </div>
      <div className="space-y-3">
        {po.items.map((item) => {
          const remaining = Math.max(0, item.qtyOrdered - item.qtyReceived);
          const sku = item.variant?.sku ?? item.product.sku;
          return (
            <div key={item.id} className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold text-[#003087]">{sku}</div>
                  <div className="text-sm text-slate-700 truncate">{item.product.name}</div>
                  {item.variant?.size && (
                    <div className="text-xs text-slate-500">{item.variant.size}</div>
                  )}
                </div>
                <div className="text-right shrink-0 text-xs text-slate-500">
                  <div>Ordered: {item.qtyOrdered} {item.product.uom}</div>
                  <div>Received: {item.qtyReceived}</div>
                  <div className={remaining > 0 ? "text-amber-700 font-semibold" : "text-emerald-700"}>
                    Remaining: {remaining}
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide">Receive qty</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={received[item.id] ?? ""}
                    onChange={(e) => setReceived((p) => ({ ...p, [item.id]: e.target.value }))}
                    className="mt-0.5 w-full h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base font-semibold"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wide">Reject qty</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={rejected[item.id] ?? "0"}
                    onChange={(e) => setRejected((p) => ({ ...p, [item.id]: e.target.value }))}
                    className="mt-0.5 w-full h-10 rounded-lg border border-slate-300 bg-slate-50 px-3 text-base"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}

      {/* Fixed action bar */}
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
          Requires procurement role — contact admin if you get a 403.
        </p>
      </div>
    </div>
  );
};

// ── Shared helpers ────────────────────────────────────────────────────

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
