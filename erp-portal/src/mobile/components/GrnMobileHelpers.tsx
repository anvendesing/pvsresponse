import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { GrnReceiveHint } from "../../lib/api";

export type MobileGrnAllocation = { binId: string; qty: number; label?: string };

export const GrnMobileAllocation = ({
  acceptedQty,
  hint,
  allocations,
  onChange,
}: {
  acceptedQty: number;
  hint: GrnReceiveHint | undefined;
  allocations: MobileGrnAllocation[];
  onChange: (next: MobileGrnAllocation[]) => void;
}) => {
  const allocated = useMemo(
    () => allocations.reduce((s, a) => s + a.qty, 0),
    [allocations]
  );
  const remaining = acceptedQty - allocated;

  if (acceptedQty <= 0) return null;

  const setRow = (idx: number, patch: Partial<MobileGrnAllocation>) =>
    onChange(allocations.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

  const lookupBin = async (idx: number, code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const res = (await api.resolveLocation(trimmed)) as {
        kind: string;
        bin?: { id: string };
      };
      if (res.kind === "bin" && res.bin?.id) {
        const opt = hint?.bins.find((b) => b.id === res.bin!.id);
        setRow(idx, { binId: res.bin.id, label: opt?.label ?? trimmed });
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Put in bin
        {hint ? ` · ${hint.warehouseName}` : ""}
      </div>
      {allocations.map((row, idx) => (
        <div key={idx} className="mt-2 space-y-1">
          <select
            value={row.binId}
            onChange={(e) => {
              const opt = hint?.bins.find((b) => b.id === e.target.value);
              setRow(idx, { binId: e.target.value, label: opt?.label });
            }}
            className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
          >
            <option value="">Select bin…</option>
            {hint?.bins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
                {b.qty > 0 ? ` (${b.qty})` : ""}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Scan bin code"
              className="flex-1 h-8 rounded-lg border border-slate-200 px-2 text-xs font-mono"
              onBlur={(e) => void lookupBin(idx, e.target.value)}
            />
            <input
              type="number"
              min={0}
              value={row.qty}
              onChange={(e) => setRow(idx, { qty: Number(e.target.value) || 0 })}
              className="w-20 h-8 rounded-lg border border-slate-200 px-2 text-sm font-semibold text-right"
            />
          </div>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            if (allocations.length === 1) {
              const first = allocations[0]!;
              const half = Math.floor(acceptedQty / 2);
              onChange([
                { ...first, qty: half },
                {
                  binId: hint?.bins.find((b) => b.id !== first.binId)?.id ?? "",
                  qty: acceptedQty - half,
                },
              ]);
              return;
            }
            onChange([
              ...allocations,
              { binId: hint?.defaultBinId ?? "", qty: Math.max(0, remaining) },
            ]);
          }}
          className="text-xs font-semibold text-[#003087]"
        >
          + Split bin
        </button>
        <span
          className={
            Math.abs(remaining) < 0.001
              ? "text-[10px] font-semibold text-emerald-700"
              : "text-[10px] font-semibold text-red-600"
          }
        >
          {Math.abs(remaining) < 0.001 ? "Allocated" : `${remaining} left`}
        </span>
      </div>
    </div>
  );
};

export const useGrnReceiveHints = (productIds: string[]) => {
  const [hints, setHints] = useState<Record<string, GrnReceiveHint>>({});
  const key = productIds.join(",");
  useEffect(() => {
    if (productIds.length === 0) return;
    void api.grnReceiveHints(productIds).then((r) => setHints(r.hints));
  }, [key, productIds.length]);
  return hints;
};

export const useGrnAllocationDefaults = (
  items: Array<{ id: string; productId: string; accepted: number }>,
  hints: Record<string, GrnReceiveHint>,
  setAllocations: React.Dispatch<
    React.SetStateAction<Record<string, MobileGrnAllocation[]>>
  >
) => {
  useEffect(() => {
    setAllocations((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (item.accepted <= 0) {
          delete next[item.id];
          continue;
        }
        const hint = hints[item.productId];
        if (!next[item.id]?.length && hint?.defaultBinId) {
          next[item.id] = [
            {
              binId: hint.defaultBinId,
              qty: item.accepted,
              label: hint.defaultBinLabel ?? hint.defaultBinCode ?? undefined,
            },
          ];
        } else if (next[item.id]?.length === 1) {
          next[item.id] = [{ ...next[item.id]![0]!, qty: item.accepted }];
        }
      }
      return next;
    });
  }, [hints, items, setAllocations]);
};

type GrnRow = Awaited<ReturnType<typeof api.grns>>[number];

export const MobileGrnQcList = () => {
  const nav = useNavigate();
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrns(await api.grns({ qcStatus: "pending" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Pending QC
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-xs text-[#003087] font-medium"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-sm text-slate-400 animate-pulse">
          Loading…
        </div>
      )}

      {!loading && grns.length === 0 && !error && (
        <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          No GRNs waiting for QC approval.
        </div>
      )}

      <div className="space-y-2">
        {grns.map((grn) => {
          const accepted = grn.items.reduce(
            (s, i) => s + i.receivedQty - i.rejectedQty,
            0
          );
          return (
            <button
              key={grn.id}
              type="button"
              onClick={() => nav(`/m/grn-qc/${grn.id}`)}
              className="w-full rounded-xl bg-white px-4 py-3 text-left ring-1 ring-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-[#003087]">
                  {grn.grnNo}
                </span>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-800">
                  Pending
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-700">{grn.po.vendor.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {grn.po.poNo} · {grn.items.length} line(s) · {accepted} accepted
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => nav("/m/grn")}
        className="mt-4 w-full rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-600"
      >
        ← Receive goods (GRN)
      </button>
    </div>
  );
};

export const MobileGrnQcDetail = () => {
  const { grnId } = useParams<{ grnId: string }>();
  const nav = useNavigate();
  const [grn, setGrn] = useState<GrnRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!grnId) return;
    setLoading(true);
    void api
      .grns()
      .then((rows) => {
        const found = rows.find((g) => g.id === grnId) ?? null;
        setGrn(found);
        if (!found) setError("GRN not found");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [grnId]);

  const decide = async (qcStatus: "pass" | "rework" | "reject") => {
    if (!grn) return;
    setBusy(qcStatus);
    setError(null);
    try {
      await api.updateGrnQc(grn.id, { qcStatus });
      nav("/m/grn-qc", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-sm text-slate-400 animate-pulse">
        Loading…
      </div>
    );
  }

  if (!grn) {
    return (
      <div className="px-4 pt-6">
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error ?? "GRN not found"}
        </div>
      </div>
    );
  }

  const totalAccepted = grn.items.reduce(
    (s, i) => s + i.receivedQty - i.rejectedQty,
    0
  );

  return (
    <div className="px-4 pt-4 pb-40">
      <div className="mb-4 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
        <div className="bg-[#003087] px-4 py-3">
          <button
            type="button"
            onClick={() => nav("/m/grn-qc")}
            className="text-xs text-blue-200 font-medium"
          >
            ← QC queue
          </button>
          <div className="mt-1 font-mono text-base font-bold text-white">{grn.grnNo}</div>
          <div className="text-sm text-blue-100">
            {grn.po.poNo} · {grn.po.vendor.name}
          </div>
        </div>
        <div className="px-4 py-3 text-sm text-slate-600">
          <div>
            Net accepted: <strong>{totalAccepted}</strong>
          </div>
          {grn.truckNo && <div>Truck: {grn.truckNo}</div>}
          {grn.receivedBy && <div>Received by: {grn.receivedBy}</div>}
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {grn.items.map((it) => (
          <div
            key={it.id}
            className="rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3"
          >
            <div className="font-mono text-sm font-semibold text-[#003087]">
              {it.poItem.product.sku}
            </div>
            <div className="text-sm text-slate-700">{it.poItem.product.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              Received {it.receivedQty - it.rejectedQty} {it.poItem.product.uom}
              {it.rejectedQty > 0 ? ` · ${it.rejectedQty} rejected` : ""}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <p className="mb-2 text-center text-[10px] text-slate-500">
          Inspect goods, then record QC decision. Stock was posted at receipt.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void decide("rework")}
            className="rounded-xl border border-amber-300 bg-amber-50 py-3 text-xs font-bold text-amber-800 disabled:opacity-50"
          >
            {busy === "rework" ? "…" : "Rework"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void decide("reject")}
            className="rounded-xl border border-red-300 bg-red-50 py-3 text-xs font-bold text-red-700 disabled:opacity-50"
          >
            {busy === "reject" ? "…" : "Reject"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void decide("pass")}
            className="rounded-xl bg-emerald-500 py-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === "pass" ? "…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
};
