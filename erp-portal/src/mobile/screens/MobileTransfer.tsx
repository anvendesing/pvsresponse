import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, auth, type TransferOrderItem, type TransferOrderRow } from "../../lib/api";

// =====================================================================
// /m/transfers/:id
// =====================================================================
// Sequential pick-then-drop flow for a TransferOrder.
//
// Step 1 (status=ready):      Pick — confirm source bin + qty for each line.
// Step 2 (status=in_transit): Drop — confirm destination bin + qty for each line.
// Step 3 (status=done):       Read-only confirmation.
//
// The worker can also cancel from any non-done state.

type Step = "pick" | "drop" | "done";

const stepFor = (status: string): Step => {
  if (status === "done") return "done";
  if (status === "in_transit") return "drop";
  return "pick";
};

const KIND_LABEL: Record<string, string> = {
  putaway: "Putaway",
  replenishment: "Replenishment",
  manual: "Transfer",
};

const STATUS_COLOR: Record<string, string> = {
  ready: "bg-amber-100 text-amber-800",
  in_transit: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-700",
};

export const MobileTransfer = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [to, setTo] = useState<TransferOrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Per-line qty overrides the worker can edit before confirming.
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const result = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/transfer-orders/${id}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      ).then((r) => r.json());
      setTo(result as TransferOrderRow);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!id) return null;

  if (!to && !error) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      </div>
    );
  }

  if (!to) return null;

  const step = stepFor(to.status);

  const getQty = (item: TransferOrderItem, step: Step) => {
    const key = item.id;
    if (qtys[key] !== undefined) return qtys[key];
    if (step === "pick") return String(item.qtyRequested);
    return String(item.qtyPicked);
  };

  const getBin = (item: TransferOrderItem, step: Step) => {
    if (step === "pick") {
      return item.fromBin
        ? `${item.fromBin.zone}/${item.fromBin.shelf}/${item.fromBin.bin}`
        : null;
    }
    return item.tobin
      ? `${item.tobin.zone}/${item.tobin.shelf}/${item.tobin.bin}`
      : null;
  };

  const confirmPick = async () => {
    if (!to) return;
    setBusy(true);
    setError(null);
    try {
      const lines = to.items.map((item) => ({
        itemId: item.id,
        qtyPicked: Number(getQty(item, "pick")) || item.qtyRequested,
        fromBinId: item.fromBinId ?? item.fromBin?.id ?? "",
      })).filter((l) => l.fromBinId);

      if (lines.length === 0) {
        setError("No source bins assigned. Cannot pick. Contact supervisor.");
        return;
      }

      await api.pickTransferOrder(to.id, lines);
      setQtys({});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDrop = async () => {
    if (!to) return;
    setBusy(true);
    setError(null);
    try {
      // Send every picked line. The server auto-assigns a bin in the
      // destination warehouse when toBinId is null (consolidates onto an
      // existing product bin, otherwise picks an empty one). It returns
      // a clear 409 message if the destination warehouse has no bins.
      const lines = to.items
        .filter((item) => item.qtyPicked > 0)
        .map((item) => ({
          itemId: item.id,
          qtyDropped: Number(getQty(item, "drop")) || item.qtyPicked,
          toBinId: item.toBinId ?? item.tobin?.id ?? null,
        }));

      if (lines.length === 0) {
        setError("Nothing picked yet — go back to the pick step first.");
        return;
      }

      await api.dropTransferOrder(to.id, lines);
      setQtys({});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelTO = async () => {
    if (!confirm("Cancel this transfer order?")) return;
    setBusy(true);
    try {
      await api.cancelTransferOrder(to.id);
      nav("/m/tasks");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {/* Header card */}
      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
        <div className="bg-[#003087] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-base font-bold text-white">{to.transferNo}</span>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                STATUS_COLOR[to.status] ?? "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              {to.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-1 text-sm text-blue-100">
            {KIND_LABEL[to.kind] ?? to.kind}
          </div>
        </div>
        <div className="px-4 py-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">From</span>
            <span className="font-medium">{to.fromWarehouse.code} — {to.fromWarehouse.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">To</span>
            <span className="font-medium">{to.toWarehouse.code} — {to.toWarehouse.name}</span>
          </div>
          {to.productionOrder && (
            <div className="flex justify-between">
              <span className="text-slate-500">MO</span>
              <span className="font-medium">{to.productionOrder.orderNo}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Lines</span>
            <span className="font-medium">{to.items.length}</span>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      {step !== "done" && (
        <div className="flex gap-2">
          <StepDot label="1. Pick" active={step === "pick"} done={step === "drop"} />
          <div className="flex-1 border-t border-slate-300 self-center" />
          <StepDot label="2. Drop" active={step === "drop"} done={false} />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {/* Lines */}
      <div className="space-y-3">
        {to.items.map((item) => {
          const binLabel = getBin(item, step);
          return (
            <div key={item.id} className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-[#003087]">
                    {item.product.sku}
                  </div>
                  <div className="text-sm text-slate-700 truncate">{item.product.name}</div>
                  {item.variant && (
                    <div className="text-xs text-slate-500">{item.variant.size ?? item.variant.sku}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-500">
                    {step === "pick" ? "to pick" : step === "drop" ? "to drop" : "picked"}
                  </div>
                  <div className="font-semibold text-sm">
                    {step === "pick" ? item.qtyRequested : item.qtyPicked} {item.product.uom}
                  </div>
                </div>
              </div>

              {step !== "done" && (
                <div className="space-y-1">
                  {binLabel && (
                    <div className="text-xs text-slate-500">
                      {step === "pick" ? "Source bin:" : "Dest. bin:"}{" "}
                      <span className="font-mono font-medium text-slate-800">{binLabel}</span>
                    </div>
                  )}
                  {!binLabel && (
                    <div className="text-xs text-amber-600">
                      {step === "pick"
                        ? "No source bin assigned - supervisor must assign."
                        : `No dest. bin set - system will auto-pick a bin in ${to.toWarehouse.code} on drop.`}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500 shrink-0">Qty:</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="flex-1 h-8 rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm"
                      value={getQty(item, step)}
                      onChange={(e) => setQtys((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {step === "done" && (
                <div className="text-xs text-slate-500">
                  Picked: {item.qtyPicked} · Dropped: {item.qtyDropped}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {step === "pick" && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={confirmPick}
            className="w-full rounded-2xl bg-[#003087] py-4 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? "Confirming pick…" : "Confirm pick"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={cancelTO}
            className="w-full rounded-2xl border border-red-300 py-3 text-sm font-semibold text-red-600 bg-white"
          >
            Cancel transfer
          </button>
        </div>
      )}

      {step === "drop" && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={confirmDrop}
            className="w-full rounded-2xl bg-emerald-600 py-4 text-base font-bold text-white disabled:opacity-50"
          >
            {busy ? "Confirming drop…" : "Confirm drop"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={cancelTO}
            className="w-full rounded-2xl border border-red-300 py-3 text-sm font-semibold text-red-600 bg-white"
          >
            Cancel transfer
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-4 text-center">
          <div className="text-lg font-bold text-emerald-700">Transfer complete</div>
          <div className="text-sm text-emerald-600 mt-1">
            All items have been moved to {to.toWarehouse.name}.
          </div>
          <button
            type="button"
            onClick={() => nav("/m/tasks")}
            className="mt-3 rounded-xl bg-[#003087] px-6 py-2 text-sm font-semibold text-white"
          >
            Back to tasks
          </button>
        </div>
      )}
    </div>
  );
};

const StepDot = ({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) => (
  <div className="flex flex-col items-center gap-1">
    <div
      className={[
        "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold",
        active
          ? "bg-[#003087] text-white"
          : done
          ? "bg-emerald-500 text-white"
          : "bg-slate-200 text-slate-500",
      ].join(" ")}
    >
      {done ? "✓" : active ? "●" : "○"}
    </div>
    <span className="text-[10px] text-slate-500 whitespace-nowrap">{label}</span>
  </div>
);
