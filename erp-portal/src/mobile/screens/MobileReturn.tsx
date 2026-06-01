import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";

// =====================================================================
// /m/returns       — list of returns pending action
// /m/returns/:id   — per-line decide (accept/reject/credit) + finalize
// =====================================================================

// ── Types ─────────────────────────────────────────────────────────────

type ReturnDecision = "approved" | "rejected" | "credit_only";
type ReturnStatus = "pending" | "under_review" | "finalized" | "cancelled";

interface ReturnLine {
  id: string;
  product: { sku: string; name: string; uom: string };
  variant?: { sku: string } | null;
  qtyReturned: number;
  decision?: ReturnDecision | null;
  conditionCode?: string | null;
  remarks?: string | null;
}

interface ReturnDoc {
  id: string;
  returnNo: string;
  status: ReturnStatus;
  reason?: string | null;
  customer?: { name: string; code: string } | null;
  salesOrder?: { soNo: string } | null;
  lines: ReturnLine[];
  createdAt: string;
}

const DECISION_LABEL: Record<ReturnDecision, string> = {
  approved: "Accept & restock",
  rejected: "Reject",
  credit_only: "Credit only",
};
const DECISION_COLOR: Record<ReturnDecision, string> = {
  approved: "bg-emerald-500",
  rejected: "bg-red-500",
  credit_only: "bg-amber-500",
};

const STATUS_BADGE: Record<ReturnStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  under_review: "bg-blue-100 text-blue-800",
  finalized: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-700",
};

// ── Return list ───────────────────────────────────────────────────────

export const MobileReturnList = () => {
  const nav = useNavigate();
  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.returns({ status: "pending" });
      setReturns(result as unknown as ReturnDoc[]);
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
          Pending returns
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

      {returns.length === 0 && !loading && (
        <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          No returns awaiting review.
        </div>
      )}

      <div className="space-y-2">
        {returns.map((r) => {
          const undecided = r.lines.filter((l) => !l.decision).length;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => nav(`/m/returns/${r.id}`)}
              className="w-full rounded-xl bg-white px-4 py-3 text-left ring-1 ring-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-[#003087]">
                  {r.returnNo}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_BADGE[r.status]}`}>
                  {r.status.replace("_", " ")}
                </span>
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800 truncate">
                {r.customer?.name ?? "—"}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {r.salesOrder ? `SO ${r.salesOrder.soNo} · ` : ""}
                {r.lines.length} line{r.lines.length === 1 ? "" : "s"}
                {undecided > 0 && (
                  <span className="ml-1 text-amber-700 font-semibold">· {undecided} pending decision</span>
                )}
              </div>
              {r.reason && (
                <div className="mt-1 text-xs text-slate-400 truncate">Reason: {r.reason}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Return detail / decide + finalize ─────────────────────────────────

export const MobileReturnDetail = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [doc, setDoc] = useState<ReturnDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Per-line decision state (keyed by line id)
  const [decisions, setDecisions] = useState<Record<string, ReturnDecision>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [conditionCodes, setConditionCodes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.returnDoc(id);
      const d = result as unknown as ReturnDoc;
      setDoc(d);
      // Pre-fill existing decisions
      const dec: Record<string, ReturnDecision> = {};
      const rem: Record<string, string> = {};
      const cond: Record<string, string> = {};
      for (const l of d.lines) {
        if (l.decision) dec[l.id] = l.decision;
        if (l.remarks) rem[l.id] = l.remarks;
        if (l.conditionCode) cond[l.id] = l.conditionCode;
      }
      setDecisions(dec);
      setRemarks(rem);
      setConditionCodes(cond);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void refresh(); }, [refresh]);

  const decideLine = async (lineId: string) => {
    if (!id || !doc) return;
    const decision = decisions[lineId];
    if (!decision) { setError("Select a decision for this line first."); return; }
    setBusy(lineId);
    setError(null);
    setSuccess(null);
    try {
      // API accepts "approved" | "rejected" only. "credit_only" maps to "rejected" with a note.
      const apiDecision: "approved" | "rejected" = decision === "approved" ? "approved" : "rejected";
      const baseNotes = remarks[lineId] || undefined;
      const condNote = conditionCodes[lineId] ? `[${conditionCodes[lineId]}] ` : "";
      const apiNotes = decision === "credit_only"
        ? `[Credit only] ${condNote}${baseNotes ?? ""}`.trim()
        : `${condNote}${baseNotes ?? ""}`.trim() || undefined;
      await api.decideReturnLine(id, lineId, { decision: apiDecision, notes: apiNotes });
      setSuccess(`Line decision saved.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    if (!id || !doc) return;
    const undecided = doc.lines.filter((l) => !l.decision).length;
    if (undecided > 0) {
      setError(`${undecided} line${undecided === 1 ? " needs" : "s need"} a decision before finalizing.`);
      return;
    }
    setBusy("finalize");
    setError(null);
    setSuccess(null);
    try {
      await api.finalizeReturn(id, {});
      setSuccess("Return finalized — stock restocked where accepted.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!doc) return <ErrorBanner message={error ?? "Return not found"} />;

  const allDecided = doc.lines.every((l) => l.decision);
  const isFinalized = doc.status === "finalized" || doc.status === "cancelled";

  return (
    <div className="px-4 pt-4 pb-40">
      {/* Header */}
      <div className="mb-4 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
        <div className="bg-[#003087] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-base font-bold text-white">{doc.returnNo}</span>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_BADGE[doc.status]}`}>
                {doc.status.replace("_", " ")}
              </span>
              <button
                type="button"
                onClick={() => nav("/m/returns")}
                className="text-xs text-blue-200"
              >
                ← List
              </button>
            </div>
          </div>
          <div className="mt-0.5 text-sm text-blue-100">
            {doc.customer?.name ?? "—"}
            {doc.salesOrder ? ` · SO ${doc.salesOrder.soNo}` : ""}
          </div>
        </div>
        {doc.reason && (
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
            Reason: {doc.reason}
          </div>
        )}
      </div>

      {success && (
        <div className="mb-3 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {success}
        </div>
      )}
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      {isFinalized && (
        <div className="mb-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200 text-center">
          This return is {doc.status}. No further changes allowed.
        </div>
      )}

      {/* Lines */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Lines
      </div>
      <div className="space-y-3">
        {doc.lines.map((line) => {
          const sku = line.variant?.sku ?? line.product.sku;
          const decided = !!line.decision;
          const localDecision = decisions[line.id];

          return (
            <div
              key={line.id}
              className={[
                "rounded-xl bg-white ring-1 shadow-sm overflow-hidden",
                decided ? "ring-emerald-200" : "ring-slate-200",
              ].join(" ")}
            >
              <div className="px-4 py-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-semibold text-[#003087]">{sku}</div>
                  <div className="text-sm text-slate-700">{line.product.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Qty returned: {line.qtyReturned} {line.product.uom}
                  </div>
                </div>
                {decided && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${DECISION_COLOR[line.decision!]}`}>
                    {line.decision}
                  </span>
                )}
              </div>

              {!isFinalized && (
                <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                  {/* Decision selector */}
                  <div className="flex gap-1.5 flex-wrap">
                    {(Object.keys(DECISION_LABEL) as ReturnDecision[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDecisions((p) => ({ ...p, [line.id]: d }))}
                        className={[
                          "flex-1 min-w-[90px] rounded-lg py-1.5 text-[11px] font-semibold border transition",
                          localDecision === d
                            ? `${DECISION_COLOR[d]} text-white border-transparent`
                            : "bg-white border-slate-200 text-slate-600",
                        ].join(" ")}
                      >
                        {DECISION_LABEL[d]}
                      </button>
                    ))}
                  </div>
                  {/* Condition */}
                  <input
                    type="text"
                    value={conditionCodes[line.id] ?? ""}
                    onChange={(e) => setConditionCodes((p) => ({ ...p, [line.id]: e.target.value }))}
                    placeholder="Condition (e.g. damaged, sealed)"
                    className="w-full h-8 rounded-lg border border-slate-200 px-2 text-xs"
                  />
                  {/* Remarks */}
                  <input
                    type="text"
                    value={remarks[line.id] ?? ""}
                    onChange={(e) => setRemarks((p) => ({ ...p, [line.id]: e.target.value }))}
                    placeholder="Remarks (optional)"
                    className="w-full h-8 rounded-lg border border-slate-200 px-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy === line.id || !localDecision}
                    onClick={() => void decideLine(line.id)}
                    className="w-full rounded-lg bg-[#003087] py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {busy === line.id ? "Saving…" : "Save decision"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Fixed action bar */}
      {!isFinalized && (
        <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]">
          <div className="mb-1.5 text-xs text-slate-500">
            {allDecided
              ? "All lines decided — ready to finalize."
              : `${doc.lines.filter((l) => !l.decision).length} line${doc.lines.filter((l) => !l.decision).length === 1 ? "" : "s"} still need a decision.`}
          </div>
          <button
            type="button"
            disabled={busy === "finalize" || !allDecided}
            onClick={() => void finalize()}
            className="w-full rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white disabled:opacity-50"
          >
            {busy === "finalize" ? "Finalizing…" : "Finalize return"}
          </button>
        </div>
      )}
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
