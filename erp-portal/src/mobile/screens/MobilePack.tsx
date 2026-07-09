import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  ApiError,
  auth,
  type ContainerKind,
  type ContainerTypeRow,
  type PackingContainerRow,
} from "../../lib/api";
import { BarcodeScanner } from "../BarcodeScanner";
import { newClientOpId } from "../clientOpId";
import { primaryScanCode, scanCodeSet } from "../../lib/scanCode";
import { variantAttrs } from "../../lib/variantAttrs";

// =====================================================================
// /m/packs/:id
// =====================================================================
// Mobile packing screen. Has two visual modes driven by the global
// CompanyProfile.packMultiContainerEnabled flag:
//
//   * Single-bundle (legacy): per-line scan-confirm with editable
//     qtyPacked. Same as before the multi-container rollout — kept so
//     tenants who haven't switched on the new flag keep their muscle
//     memory.
//   * Multi-container: same per-line Confirm step as legacy (tap item,
//     adjust qty, Confirm), then allocate confirmed units into
//     containers via +1 / scan / qty pad. Operator seals containers
//     one at a time, then taps "Mark packed" to lock the slip.
//
// The screen reads companyProfile once on mount and re-fetches the
// slip whenever a container mutation succeeds so the per-line
// allocation chips stay in sync with the server-side recompute.

interface PackItem {
  id: string;
  qtyOrdered: number;
  qtyPicked: number;
  qtyPacked: number;
  rate: number;
  notes?: string | null;
  product?: { sku?: string; name?: string; uom?: string; barcode?: string | null };
  variant?: {
    sku?: string;
    uom?: string;
    size?: string | null;
    color?: string | null;
    grade?: string | null;
    barcode?: string | null;
  } | null;
}

/** Barcode (or SKU fallback) plus variant size/color/grade.
 * The standalone SKU code is dropped on purpose — the barcode is the
 * scannable identity and the product name + variant attrs are enough
 * for visual confirmation on the mobile card. */
const packLineCode = (item: PackItem): string => {
  const ref = primaryScanCode(item.variant ?? item.product ?? { sku: "—", barcode: null });
  const attrs = variantAttrs(item.variant);
  return attrs ? `${ref} · ${attrs}` : ref;
};

interface PackingSlip {
  id: string;
  packingSlipNo: string;
  status: string;
  salesOrder?: { soNo?: string; customer?: { name?: string } };
  items: PackItem[];
  containers?: PackingContainerRow[];
}

type PackReason = "ok" | "short_pack" | "damage" | "substitute" | "other";

const REASON_LABELS: Record<PackReason, string> = {
  ok: "All good",
  short_pack: "Short pack (less than picked)",
  damage: "Damaged - removed from pack",
  substitute: "Substitute SKU",
  other: "Other (see remarks)",
};

const fmtKg = (n: number | null | undefined) =>
  n == null ? "—" : `${(Math.round(n * 100) / 100).toFixed(1)} kg`;

const kindEmoji = (k: ContainerKind | undefined) => {
  switch (k) {
    case "bag":
      return "👜";
    case "carton":
      return "📦";
    case "sack":
      return "🛍️";
    case "box":
      return "📦";
    default:
      return "📦";
  }
};

export const MobilePack = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [ps, setPs] = useState<PackingSlip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [multiContainer, setMultiContainer] = useState<boolean | null>(null);
  const [requireSealConfirm, setRequireSealConfirm] = useState(true);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getCompanyProfile()
      .then((p) => {
        if (!alive) return;
        setMultiContainer(p.packMultiContainerEnabled !== false);
        setRequireSealConfirm(p.packRequireSealConfirmation !== false);
      })
      .catch(() => {
        if (alive) setMultiContainer(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const resp = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/packing-slips/${id}`,
        { headers: { Authorization: `Bearer ${auth.token()}` } }
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new ApiError(resp.status, body?.error?.message ?? `${resp.status}`, body?.error);
      }
      const result: PackingSlip = await resp.json();
      setPs(result);
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

  const finalisePack = async () => {
    if (!id) return;
    if (!navigator.onLine) {
      setError("You're offline. Reconnect and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `${import.meta.env.VITE_API_URL}/v1/packing-slips/${id}/pack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token()}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new ApiError(r.status, body?.error?.message ?? `${r.status}`, body?.error);
      }
      nav("/m/tasks", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!ps || multiContainer == null) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-slate-500">
        {error ?? "Loading…"}
      </div>
    );
  }

  return (
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

      {!online && (
        <div className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-800 ring-1 ring-amber-200 flex items-center gap-2">
          <span className="font-bold">Offline</span>
          <span>Changes won't save until you reconnect.</span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <div className="font-semibold">Error</div>
          <div className="mt-0.5">{error}</div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void refresh();
            }}
            className="mt-2 text-xs text-red-600 underline"
          >
            Retry
          </button>
        </div>
      )}

      {multiContainer ? (
        <MultiContainerPack
          ps={ps}
          requireSealConfirm={requireSealConfirm}
          onRefresh={refresh}
          onError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      ) : (
        <LegacyPack
          ps={ps}
          scanFor={scanFor}
          setScanFor={setScanFor}
          onRefresh={refresh}
          onError={setError}
          busy={busy}
          setBusy={setBusy}
        />
      )}

      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
        <div className="mb-2 text-xs text-slate-500">
          {ps.status === "open"
            ? multiContainer
              ? "Seal every container, then mark packed."
              : "Confirm every line before marking the pack complete."
            : `Slip is ${ps.status}.`}
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
            disabled={busy}
            onClick={finalisePack}
            className="flex-[2] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Mark packed
          </button>
        </div>
      </div>
    </div>
  );
};

// Shared per-line confirm UI — used by legacy single-bundle packing and
// as step 1 of multi-container packing (confirm qty before allocating).
type PackDraft = {
  qty: number;
  productCode: string;
  reason: PackReason;
  remarks: string;
};

const PackLineConfirmCard = ({
  item,
  draft,
  onDraftChange,
  confirmed,
  busy,
  onConfirm,
  onScanRequest,
}: {
  item: PackItem;
  draft: PackDraft;
  onDraftChange: (patch: Partial<PackDraft>) => void;
  confirmed: boolean;
  busy: boolean;
  onConfirm: () => void;
  onScanRequest: () => void;
}) => {
  const codeLine = packLineCode(item);
  const uom = item.variant?.uom ?? item.product?.uom ?? "pc";
  const productExpected = scanCodeSet([item.variant, item.product]);
  const productMismatch =
    !!draft.productCode && !productExpected.has(draft.productCode.trim().toUpperCase());
  const shortPack = draft.qty < item.qtyPicked;
  const showReason = productMismatch || shortPack || item.qtyPicked === 0;

  return (
    <div
      className={[
        "rounded-2xl p-4 ring-1 shadow-sm",
        confirmed ? "bg-emerald-50 ring-emerald-300" : "bg-white ring-slate-200",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-slate-900">
          {item.product?.name ?? "—"}
        </span>
        {confirmed ? (
          <span className="shrink-0 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            ✓ Packed {item.qtyPacked} {uom}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-slate-500">
            picked {item.qtyPicked} {uom}
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-xs text-slate-500">{codeLine}</div>

      {!confirmed && (
        <>
          <div className="mt-3 flex items-stretch gap-2">
            <div className="flex flex-1 items-stretch overflow-hidden rounded-xl border border-slate-300">
              <input
                value={draft.productCode}
                onChange={(e) => onDraftChange({ productCode: e.target.value })}
                placeholder="scan product"
                autoCapitalize="characters"
                autoCorrect="off"
                className="flex-1 bg-transparent px-3 py-2 font-mono text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={onScanRequest}
                className="bg-[#003087] px-3 text-xs font-semibold text-white"
              >
                Scan
              </button>
            </div>
            <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300">
              <button
                type="button"
                onClick={() => onDraftChange({ qty: Math.max(0, draft.qty - 1) })}
                className="px-3 text-xl text-slate-600"
              >
                −
              </button>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={draft.qty}
                onChange={(e) => onDraftChange({ qty: parseFloat(e.target.value) || 0 })}
                className="w-16 bg-transparent text-center text-base font-semibold focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  onDraftChange({ qty: Math.min(item.qtyPicked, draft.qty + 1) })
                }
                className="px-3 text-xl text-slate-600"
              >
                +
              </button>
            </div>
          </div>

          {showReason && (
            <div className="mt-3 rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                Reason for variance
              </div>
              <select
                value={draft.reason}
                onChange={(e) => onDraftChange({ reason: e.target.value as PackReason })}
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
        </>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {confirmed
            ? `Packed ${item.qtyPacked} of ${item.qtyPicked} ${uom}`
            : `Pending · ${draft.qty}/${item.qtyPicked} ${uom}`}
        </div>
        <button
          type="button"
          disabled={confirmed || busy}
          onClick={onConfirm}
          className={[
            "rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors",
            confirmed
              ? "bg-emerald-400 cursor-not-allowed opacity-70"
              : "bg-emerald-500 active:bg-emerald-600 disabled:opacity-50",
          ].join(" ")}
        >
          {confirmed ? "Packed ✓" : "Confirm"}
        </button>
      </div>
    </div>
  );
};

// ======================================================== Multi-container ===

interface MultiPackProps {
  ps: PackingSlip;
  requireSealConfirm: boolean;
  onRefresh: () => Promise<void>;
  onError: (msg: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

const MultiContainerPack = ({
  ps,
  requireSealConfirm,
  onRefresh,
  onError,
  busy,
  setBusy,
}: MultiPackProps) => {
  const [types, setTypes] = useState<ContainerTypeRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showContainerPicker, setShowContainerPicker] = useState(false);
  const [pad, setPad] = useState<{ itemId: string; max: number } | null>(null);
  const [sealAsk, setSealAsk] = useState<PackingContainerRow | null>(null);
  const [scanMode, setScanMode] = useState(false);
  const [confirmScanFor, setConfirmScanFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, PackDraft>>({});
  const opIds = useRef<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, PackDraft> = {};
    for (const it of ps.items) {
      init[it.id] = {
        qty: it.qtyPacked > 0 ? it.qtyPacked : it.qtyPicked,
        productCode: "",
        reason: "ok",
        remarks: "",
      };
      if (!opIds.current[it.id]) opIds.current[it.id] = newClientOpId();
    }
    setDraft(init);
  }, [ps]);

  const confirmLine = async (item: PackItem) => {
    const d = draft[item.id];
    if (!d) return;
    setBusy(true);
    try {
      await api.scanPackItem(ps.id, item.id, {
        productCode: d.productCode.trim() || undefined,
        qty: d.qty,
        reasonCode: d.reason,
        remarks: d.remarks.trim() || null,
        clientOpId: opIds.current[item.id],
      });
      opIds.current[item.id] = newClientOpId();
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pendingConfirm = ps.items.some((it) => it.qtyPacked <= 0 && it.qtyPicked > 0);

  useEffect(() => {
    let alive = true;
    api
      .containerTypes()
      .then((t) => {
        if (alive) setTypes(t.filter((x) => x.active));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const containers = useMemo(
    () => [...(ps.containers ?? [])].sort((a, b) => a.seq - b.seq),
    [ps.containers]
  );

  // Default the active container to the first open one — packers expect
  // to keep filling whatever container is on the table without picking
  // it from a list every scan.
  useEffect(() => {
    if (containers.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !containers.find((c) => c.id === activeId)) {
      const firstOpen = containers.find((c) => c.status === "open");
      setActiveId((firstOpen ?? containers[0]).id);
    }
  }, [containers, activeId]);

  const active = containers.find((c) => c.id === activeId) ?? null;
  const isLocked = ps.status !== "open";

  // Per-line allocation across all containers — drives the badges and
  // the "remaining" hint on each line button.
  const allocPerLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of containers) {
      for (const it of c.items) {
        m.set(it.packingSlipItemId, (m.get(it.packingSlipItemId) ?? 0) + it.qty);
      }
    }
    return m;
  }, [containers]);

  const addContainer = async (typeId: string | null) => {
    setShowTypePicker(false);
    setBusy(true);
    try {
      const created = await api.createPackingContainer(ps.id, {
        containerTypeId: typeId,
      });
      setActiveId(created.id);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addToActive = async (lineId: string, qty: number) => {
    if (!active) {
      onError("Add a container first.");
      return;
    }
    if (active.status !== "open") {
      onError(`Container ${active.label} is sealed. Unseal it or start a new container.`);
      return;
    }
    setBusy(true);
    try {
      await api.addPackingContainerItem(ps.id, active.id, {
        packingSlipItemId: lineId,
        qty,
      });
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeAlloc = async (containerId: string, ciId: string) => {
    setBusy(true);
    try {
      await api.deletePackingContainerItem(ps.id, containerId, ciId);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sealActive = () => {
    if (!active) return;
    if (active.items.length === 0) {
      onError(`Container ${active.label} is empty.`);
      return;
    }
    if (requireSealConfirm) setSealAsk(active);
    else void doSeal(active.id, active.actualWeightKg ?? null);
  };

  const doSeal = async (containerId: string, actualKg: number | null) => {
    setSealAsk(null);
    setBusy(true);
    try {
      await api.sealPackingContainer(ps.id, containerId, { actualWeightKg: actualKg });
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unsealActive = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.unsealPackingContainer(ps.id, active.id);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeActiveContainer = async () => {
    if (!active) return;
    if (!confirm(`Remove container ${active.label}? Items return to the unallocated pool.`))
      return;
    setBusy(true);
    try {
      await api.deletePackingContainer(ps.id, active.id);
      setActiveId(null);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Scan handler: match the barcode against any line and +1 to active.
  const handleScan = async (text: string) => {
    setScanMode(false);
    const code = text.trim().toUpperCase();
    if (!code) return;
    const line = ps.items.find((it) =>
      scanCodeSet([it.variant, it.product]).has(code)
    );
    if (!line) {
      onError(`Scanned "${text}" — no line on this slip matches.`);
      return;
    }
    if (line.qtyPacked <= 0) {
      const code = primaryScanCode(
        (line.variant ?? line.product) ?? { sku: "—", barcode: null }
      );
      onError(`Confirm pack qty for ${code} first (tap Confirm on the line).`);
      return;
    }
    const remaining = line.qtyPacked - (allocPerLine.get(line.id) ?? 0);
    if (remaining <= 0) {
      onError(
        `Line ${primaryScanCode((line.variant ?? line.product) ?? { sku: "—", barcode: null })} is fully allocated.`
      );
      return;
    }
    await addToActive(line.id, 1);
  };

  const totalEst = containers.reduce((s, c) => s + c.estWeightKg, 0);

  return (
    <>
      {pendingConfirm && (
        <div className="mb-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          <strong>Step 1:</strong> Tap <strong>Confirm</strong> on each item to set how many
          you&apos;re packing. Then add confirmed items into containers below.
        </div>
      )}

      {/* Container chip strip ----------------------------------------------- */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
          <span className="font-semibold">Containers</span>
          <span>
            {containers.filter((c) => c.status === "sealed").length}/{containers.length}{" "}
            sealed · est {fmtKg(totalEst)}
          </span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {containers.map((c) => {
            const isActive = c.id === activeId;
            const isSealed = c.status === "sealed";
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={[
                  "flex shrink-0 flex-col items-center justify-center rounded-2xl px-4 py-3 min-w-[88px] ring-1 transition-colors",
                  isActive
                    ? "bg-[#003087] text-white ring-[#003087]"
                    : isSealed
                      ? "bg-emerald-50 text-emerald-800 ring-emerald-300"
                      : "bg-white text-slate-700 ring-slate-300",
                ].join(" ")}
              >
                <span className="text-2xl">{kindEmoji(c.containerType?.kind)}</span>
                <span className="mt-1 font-mono text-lg font-bold tnum">{c.label}</span>
                <span className={`text-[10px] ${isActive ? "text-white/80" : "text-slate-500"}`}>
                  {c.items.length} · {fmtKg(c.estWeightKg)}
                </span>
                {isSealed && (
                  <span className={`text-[10px] font-bold ${isActive ? "text-white" : "text-emerald-700"}`}>
                    SEALED
                  </span>
                )}
              </button>
            );
          })}
          {!isLocked && (
            <button
              onClick={() => setShowTypePicker(true)}
              className="flex shrink-0 flex-col items-center justify-center rounded-2xl px-4 py-3 min-w-[88px] bg-white text-[#003087] ring-1 ring-dashed ring-[#003087]"
            >
              <span className="text-3xl">＋</span>
              <span className="mt-1 text-xs font-semibold">New container</span>
            </button>
          )}
        </div>
      </div>

      {/* Active container header ------------------------------------------- */}
      {active && (
        <div className="mb-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{kindEmoji(active.containerType?.kind)}</span>
              <div>
                <div className="text-xs uppercase text-slate-500 tracking-wide">Active</div>
                <div className="font-mono text-lg font-bold tnum text-[#003087]">
                  Container {active.label}
                </div>
                <div className="text-xs text-slate-600">
                  {active.containerType?.name ?? "No type"} · {active.items.length} item
                  {active.items.length === 1 ? "" : "s"} · est {fmtKg(active.estWeightKg)}
                </div>
              </div>
            </div>
            {!isLocked && (
              active.status === "open" ? (
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={sealActive}
                    disabled={busy || active.items.length === 0}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Seal {active.label}
                  </button>
                  <button
                    onClick={removeActiveContainer}
                    disabled={busy}
                    className="rounded-xl border border-red-200 px-3 py-1 text-[10px] font-semibold text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  onClick={unsealActive}
                  disabled={busy}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  Unseal
                </button>
              )
            )}
          </div>
          <div className="mt-2 flex gap-1">
            <button
              onClick={() => setScanMode(true)}
              disabled={busy || active.status !== "open"}
              className="flex-1 rounded-xl bg-[#003087] py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              📷 Scan to add
            </button>
          </div>
        </div>
      )}

      {!active && !isLocked && (
        <div className="mb-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Tap <strong>New container</strong> to start.
        </div>
      )}

      {/* Line list ---------------------------------------------------------- */}
      <div className="space-y-2">
        {ps.items.map((it) => {
          const confirmed = it.qtyPacked > 0;
          const d = draft[it.id] ?? {
            qty: it.qtyPicked,
            productCode: "",
            reason: "ok" as const,
            remarks: "",
          };

          if (!confirmed) {
            return (
              <PackLineConfirmCard
                key={it.id}
                item={it}
                draft={d}
                confirmed={false}
                busy={busy}
                onDraftChange={(patch) =>
                  setDraft((prev) => ({
                    ...prev,
                    [it.id]: { ...prev[it.id], ...patch },
                  }))
                }
                onConfirm={() => void confirmLine(it)}
                onScanRequest={() => setConfirmScanFor(it.id)}
              />
            );
          }

          const codeLine = packLineCode(it);
          const uom = it.variant?.uom ?? it.product?.uom ?? "pc";
          const allocated = allocPerLine.get(it.id) ?? 0;
          const remaining = Math.max(0, it.qtyPacked - allocated);
          const inHere = active?.items.filter((ci) => ci.packingSlipItemId === it.id) ?? [];
          const myQty = inHere.reduce((s, ci) => s + ci.qty, 0);
          const done = remaining <= 0;
          return (
            <div
              key={it.id}
              className={[
                "rounded-2xl p-3 ring-1 shadow-sm",
                done ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {it.product?.name ?? "—"}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                    {codeLine}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Packed {it.qtyPacked} {uom} · in containers {allocated} · left {remaining}
                  </div>
                  {/* Allocation per container */}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(it.id && allocated > 0
                      ? containers
                          .map((c) => ({
                            c,
                            ci: c.items.find((x) => x.packingSlipItemId === it.id),
                          }))
                          .filter((x) => x.ci)
                      : []
                    ).map(({ c, ci }) => (
                      <button
                        key={ci!.id}
                        onClick={() =>
                          !isLocked && c.status === "open" && removeAlloc(c.id, ci!.id)
                        }
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                          c.id === activeId
                            ? "bg-[#003087] text-white ring-[#003087]"
                            : c.status === "sealed"
                              ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                              : "bg-amber-100 text-amber-800 ring-amber-200",
                        ].join(" ")}
                        title={c.status === "open" ? "Tap to remove from this container" : ""}
                      >
                        {c.label}: {ci!.qty}
                        {c.status === "open" && !isLocked ? " ✕" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {!isLocked && remaining > 0 && (
                <div className="mt-2 flex items-stretch gap-2">
                  <ActiveContainerSlot
                    active={active}
                    myQty={myQty}
                    onTap={() => setShowContainerPicker(true)}
                  />
                  {active && active.status === "open" ? (
                    <>
                      <button
                        onClick={() => void addToActive(it.id, 1)}
                        disabled={busy}
                        className="flex-[2] rounded-xl bg-emerald-500 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        +1
                      </button>
                      <button
                        onClick={() => setPad({ itemId: it.id, max: remaining })}
                        disabled={busy}
                        className="flex-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                      >
                        Qty…
                      </button>
                      <button
                        onClick={() => void addToActive(it.id, remaining)}
                        disabled={busy}
                        className="flex-1 rounded-xl border border-slate-300 py-2 text-xs font-semibold text-slate-700"
                      >
                        All ({remaining})
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center rounded-xl bg-amber-50 px-3 text-xs text-amber-800 ring-1 ring-amber-200">
                      {active
                        ? "Container is sealed — tap the box on the left to switch."
                        : "Add a container on the left before packing."}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom sheets ----------------------------------------------------- */}
      {showTypePicker && (
        <TypePickerSheet
          types={types}
          onPick={(id) => void addContainer(id)}
          onClose={() => setShowTypePicker(false)}
        />
      )}
      {showContainerPicker && (
        <ContainerPickerSheet
          containers={containers}
          activeId={activeId}
          onPick={(id) => setActiveId(id)}
          onAddNew={() => {
            setShowContainerPicker(false);
            setShowTypePicker(true);
          }}
          onClose={() => setShowContainerPicker(false)}
        />
      )}
      {pad && (
        <QtyPadSheet
          max={pad.max}
          onConfirm={(q) => {
            const lineId = pad.itemId;
            setPad(null);
            void addToActive(lineId, q);
          }}
          onClose={() => setPad(null)}
        />
      )}
      {sealAsk && (
        <SealConfirmSheet
          container={sealAsk}
          onConfirm={(kg) => void doSeal(sealAsk.id, kg)}
          onClose={() => setSealAsk(null)}
        />
      )}
      <BarcodeScanner
        active={scanMode}
        onResult={(text) => void handleScan(text)}
        onClose={() => setScanMode(false)}
      />
      <BarcodeScanner
        active={confirmScanFor !== null}
        onResult={(text) => {
          if (confirmScanFor) {
            setDraft((p) => ({
              ...p,
              [confirmScanFor]: { ...p[confirmScanFor], productCode: text },
            }));
          }
          setConfirmScanFor(null);
        }}
        onClose={() => setConfirmScanFor(null)}
      />
    </>
  );
};

// ----- Bottom sheets ---------------------------------------------------------

// Bottom sheets must sit above the shell tab bar (z-40) and the pack
// action strip (z-30) so Cancel / Add buttons stay tappable.
const SHEET_OVERLAY = "fixed inset-0 z-50 flex items-end bg-black/40";
const SHEET_PANEL =
  "w-full rounded-t-3xl bg-white p-4 pb-[calc(16px+env(safe-area-inset-bottom))]";

/** Left slot on each pack line — shows where +1 / scan will land. */
const ActiveContainerSlot = ({
  active,
  myQty,
  onTap,
}: {
  active: PackingContainerRow | null;
  myQty: number;
  onTap: () => void;
}) => {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onTap}
        className="flex shrink-0 flex-col items-center justify-center rounded-xl px-2.5 py-2 min-w-[76px] ring-2 ring-dashed ring-amber-400 bg-amber-50"
      >
        <span className="text-2xl leading-none">＋</span>
        <span className="mt-1 text-[10px] font-bold text-amber-800">Add container</span>
      </button>
    );
  }

  const sealed = active.status === "sealed";
  return (
    <button
      type="button"
      onClick={onTap}
      className={[
        "flex shrink-0 flex-col items-center justify-center rounded-xl px-2.5 py-2 min-w-[76px] ring-2 transition-colors",
        sealed
          ? "ring-emerald-400 bg-emerald-50"
          : "ring-[#003087] bg-[#003087]/5",
      ].join(" ")}
    >
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
        Packing into
      </span>
      <span className="text-xl leading-none">{kindEmoji(active.containerType?.kind)}</span>
      <span className="font-mono text-base font-bold tnum text-[#003087]">{active.label}</span>
      {myQty > 0 && (
        <span className="text-[9px] font-semibold text-[#003087]">{myQty} in here</span>
      )}
      <span className={`text-[9px] font-semibold ${sealed ? "text-emerald-700" : "text-slate-500"}`}>
        {sealed ? "Sealed · tap to switch" : "Tap to change"}
      </span>
    </button>
  );
};

const ContainerPickerSheet = ({
  containers,
  activeId,
  onPick,
  onAddNew,
  onClose,
}: {
  containers: PackingContainerRow[];
  activeId: string | null;
  onPick: (id: string) => void;
  onAddNew: () => void;
  onClose: () => void;
}) => (
  <div className={SHEET_OVERLAY} {...backdropDismissProps(onClose)}>
    <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
      <div className="text-lg font-bold text-slate-900">Active container</div>
      <div className="mt-1 mb-3 text-sm text-slate-600">
        Items you pack go into the selected container. Pick the box you are filling now.
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {containers.map((c) => {
          const isActive = c.id === activeId;
          const isSealed = c.status === "sealed";
          return (
            <button
              key={c.id}
              type="button"
              disabled={isSealed}
              onClick={() => {
                onPick(c.id);
                onClose();
              }}
              className={[
                "flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors",
                isActive
                  ? "bg-[#003087] text-white ring-[#003087]"
                  : isSealed
                    ? "bg-emerald-50 text-emerald-900 ring-emerald-200 opacity-70"
                    : "bg-white text-slate-800 ring-slate-200",
              ].join(" ")}
            >
              <span className="text-2xl">{kindEmoji(c.containerType?.kind)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-lg font-bold tnum">{c.label}</div>
                <div className={`text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>
                  {c.containerType?.name ?? "No type"} · {c.items.length} item
                  {c.items.length === 1 ? "" : "s"} · est {fmtKg(c.estWeightKg)}
                </div>
              </div>
              {isActive && !isSealed && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
                  ACTIVE
                </span>
              )}
              {isSealed && (
                <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                  SEALED
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onAddNew}
        className="mt-3 w-full rounded-2xl border border-dashed border-[#003087] py-3 text-sm font-semibold text-[#003087]"
      >
        ＋ New container
      </button>
    </div>
  </div>
);

const TypePickerSheet = ({
  types,
  onPick,
  onClose,
}: {
  types: ContainerTypeRow[];
  onPick: (id: string | null) => void;
  onClose: () => void;
}) => (
  <div className={SHEET_OVERLAY} {...backdropDismissProps(onClose)}>
    <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
      <div className="mb-2 text-sm font-bold text-slate-900">
        Choose container type
      </div>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {types.length === 0 ? (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
            No container types configured. Ask an admin to add them under
            Settings → Container types.
          </div>
        ) : (
          types.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200 active:bg-slate-50"
            >
              <span className="text-2xl">{kindEmoji(t.kind)}</span>
              <div className="flex-1 text-left">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-slate-500">
                  {t.code} · tare {fmtKg(t.tareKg)}
                  {t.maxKg ? ` · max ${fmtKg(t.maxKg)}` : ""}
                </div>
              </div>
            </button>
          ))
        )}
        <button
          onClick={() => onPick(null)}
          className="w-full rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-600"
        >
          No type / decide later
        </button>
      </div>
    </div>
  </div>
);

const QtyPadSheet = ({
  max,
  onConfirm,
  onClose,
}: {
  max: number;
  onConfirm: (q: number) => void;
  onClose: () => void;
}) => {
  const [val, setVal] = useState("");
  const append = (d: string) => setVal((v) => (v + d).slice(0, 6));
  const back = () => setVal((v) => v.slice(0, -1));
  const num = Number(val) || 0;
  const ok = num > 0 && num <= max;
  return (
    <div className={SHEET_OVERLAY} {...backdropDismissProps(onClose)}>
      <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
        <div className="mb-1 text-center text-xs text-slate-500">
          Up to {max} remaining
        </div>
        <div className="mb-3 text-center text-5xl font-bold tnum text-[#003087]">
          {val || "0"}
        </div>
        {/* Action row above the keypad so it is never hidden behind the
            shell tab bar on short screens. */}
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 py-3.5 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(num)}
            disabled={!ok}
            className="flex-[2] rounded-2xl bg-emerald-500 py-3.5 text-base font-bold text-white disabled:opacity-40"
          >
            {ok ? `Add ${num}` : "Enter qty"}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => (k === "←" ? back() : append(k))}
              className="h-12 rounded-2xl bg-slate-100 text-xl font-bold text-slate-800 active:bg-slate-200"
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const SealConfirmSheet = ({
  container,
  onConfirm,
  onClose,
}: {
  container: PackingContainerRow;
  onConfirm: (kg: number | null) => void;
  onClose: () => void;
}) => {
  const [val, setVal] = useState(
    container.actualWeightKg == null ? "" : String(container.actualWeightKg)
  );
  const units = container.items.reduce((s, ci) => s + ci.qty, 0);
  return (
    <div className={SHEET_OVERLAY} {...backdropDismissProps(onClose)}>
      <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300" />
        <div className="text-lg font-bold text-slate-900">
          Seal container {container.label}
        </div>
        <div className="mt-1 text-sm text-slate-600">
          {container.containerType?.name ?? "No type"} · {container.items.length} item
          {container.items.length === 1 ? "" : "s"} · {units} units · est {fmtKg(container.estWeightKg)}
        </div>
        <div className="mt-3">
          <label className="text-xs font-semibold text-slate-700">
            Actual weight (kg) — optional
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={`Default est ${fmtKg(container.estWeightKg)}`}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold tnum focus:outline-none"
          />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-300 py-3 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const n = val.trim() === "" ? null : Number(val);
              onConfirm(n != null && Number.isFinite(n) ? n : null);
            }}
            className="flex-[2] rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-white"
          >
            Seal container
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================== Legacy ======

interface LegacyPackProps {
  ps: PackingSlip;
  scanFor: string | null;
  setScanFor: (id: string | null) => void;
  onRefresh: () => Promise<void>;
  onError: (msg: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

const LegacyPack = ({
  ps,
  scanFor,
  setScanFor,
  onRefresh,
  onError,
  busy,
  setBusy,
}: LegacyPackProps) => {
  const [draft, setDraft] = useState<Record<string, PackDraft>>({});
  const opIds = useRef<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, PackDraft> = {};
    for (const it of ps.items) {
      init[it.id] = {
        qty: it.qtyPacked > 0 ? it.qtyPacked : it.qtyPicked,
        productCode: "",
        reason: "ok",
        remarks: "",
      };
      if (!opIds.current[it.id]) opIds.current[it.id] = newClientOpId();
    }
    setDraft(init);
  }, [ps]);

  const scanLine = async (item: PackItem) => {
    const d = draft[item.id];
    if (!d) return;
    setBusy(true);
    try {
      await api.scanPackItem(ps.id, item.id, {
        productCode: d.productCode.trim() || undefined,
        qty: d.qty,
        reasonCode: d.reason,
        remarks: d.remarks.trim() || null,
        clientOpId: opIds.current[item.id],
      });
      opIds.current[item.id] = newClientOpId();
      await onRefresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="space-y-3">
        {ps.items.map((it) => {
          const d = draft[it.id] ?? {
            qty: it.qtyPicked,
            productCode: "",
            reason: "ok" as const,
            remarks: "",
          };
          const confirmed = it.qtyPacked > 0;
          return (
            <PackLineConfirmCard
              key={it.id}
              item={it}
              draft={d}
              confirmed={confirmed}
              busy={busy}
              onDraftChange={(patch) =>
                setDraft((prev) => ({
                  ...prev,
                  [it.id]: { ...prev[it.id], ...patch },
                }))
              }
              onConfirm={() => void scanLine(it)}
              onScanRequest={() => setScanFor(it.id)}
            />
          );
        })}
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
    </>
  );
};
