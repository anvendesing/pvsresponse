// ReturnDetail — right-side drawer that shows a CustomerReturn document.
//
// When status is "pending_approval":
//   • Each line can be individually approved or rejected.
//   • Finalize button (enabled once all lines have a decision) commits the
//     return, issues a CreditNote for approved lines, and closes the drawer.
//
// When status is "processed" or "cancelled" — read-only view.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { api, apiEnabled, type CustomerReturnRow } from "@/lib/api";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CreditNoteDetail } from "./CreditNoteDetail";

interface Props {
  returnId: string;
  onClose: () => void;
  onChanged: () => void;
}

const REASON_LABELS: Record<string, string> = {
  damaged: "Damaged",
  wrong_item: "Wrong item",
  defective: "Defective",
  not_as_described: "Not as described",
  expired: "Expired",
  changed_mind: "Changed mind",
  other: "Other",
};

const decisionTone = (d: string) => {
  if (d === "approved") return "success" as const;
  if (d === "rejected") return "danger" as const;
  return "warning" as const;
};

export const ReturnDetail = ({ returnId, onClose, onChanged }: Props) => {
  const [doc, setDoc] = useState<CustomerReturnRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [showCN, setShowCN] = useState(false);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const loadDoc = async () => {
    if (!apiEnabled) return;
    try {
      const d = await api.returnDoc(returnId);
      setDoc(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDoc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnId]);

  const decide = async (lineId: string, decision: "approved" | "rejected") => {
    if (!doc) return;
    setBusy(true);
    setDecidingId(lineId);
    try {
      await api.decideReturnLine(returnId, lineId, {
        decision,
        notes: decisionNotes[lineId] || undefined,
      });
      await loadDoc();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDecidingId(null);
    }
  };

  const finalize = async () => {
    if (!doc) return;
    const confirmed = window.confirm(
      "Finalize this return? Approved lines will generate a Credit Note and all decisions will be locked."
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.finalizeReturn(returnId, { decisions: [] });
      await loadDoc();
      onChanged();
      if (result.creditNote) {
        setActionBanner(`Finalized. Credit Note ${result.creditNote.creditNoteNo} (${inr(result.creditNote.total)}) issued.`);
      } else {
        setActionBanner("Finalized. All lines were rejected — no Credit Note issued.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!doc) return;
    const confirmed = window.confirm("Cancel this return? This action cannot be undone.");
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelReturn(returnId);
      await loadDoc();
      onChanged();
      setActionBanner("Return cancelled.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canFinalize =
    doc?.status === "pending_approval" &&
    (doc?.items ?? []).every((i) => i.decision !== "pending");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        {...backdropDismissProps(onClose)}
        aria-hidden
      />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-surface shadow-xl flex flex-col border-l border-border">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-canvas flex-shrink-0">
          <RotateCcw size={18} className="text-primary" />
          <div className="flex-1">
            <div className="font-semibold text-body-sm text-ink-strong flex items-center gap-2">
              {doc?.returnNo ?? "Loading…"}
              {doc && (
                <Chip
                  tone={
                    doc.status === "pending_approval"
                      ? "warning"
                      : doc.status === "processed"
                        ? "success"
                        : "neutral"
                  }
                  size="sm"
                >
                  {doc.status === "pending_approval"
                    ? "Pending approval"
                    : doc.status === "processed"
                      ? "Processed"
                      : "Cancelled"}
                </Chip>
              )}
            </div>
            {doc && (
              <div className="text-caption text-ink-muted">
                {doc.customer.name} · {doc.items.length} line(s) · {inr(doc.total)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        {/* Action banner */}
        {actionBanner && (
          <div className="px-5 py-2 bg-success-soft border-b border-success/40 text-body-sm text-ink flex items-center gap-2">
            <CheckCircle2 size={14} className="text-success shrink-0" />
            <span className="flex-1">{actionBanner}</span>
            <button className="text-caption text-ink-muted hover:text-ink" onClick={() => setActionBanner(null)}>
              dismiss
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-ink-muted text-body-sm">Loading…</div>
          ) : !doc ? (
            <div className="p-8 text-center text-danger text-body-sm">{error ?? "Not found"}</div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-3">
                <InfoBox label="Customer" value={`${doc.customer.code} · ${doc.customer.name}`} />
                {doc.invoice && (
                  <InfoBox label="Source Invoice" value={doc.invoice.invoiceNo} />
                )}
                <InfoBox label="Created" value={new Date(doc.createdAt).toLocaleString()} />
                {doc.finalizedAt && (
                  <InfoBox label="Finalized" value={new Date(doc.finalizedAt).toLocaleString()} />
                )}
                {doc.notes && (
                  <InfoBox label="Notes" value={doc.notes} className="col-span-2" />
                )}
              </div>

              {/* Credit note link */}
              {doc.creditNote && (
                <div className="border border-success/30 bg-success-soft rounded-md px-4 py-3 flex items-center gap-3">
                  <FileText size={16} className="text-success shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold text-body-sm">
                      {doc.creditNote.creditNoteNo}
                    </span>
                    <span className="text-caption text-ink-muted ml-2">
                      {inr(doc.creditNote.total)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCN(true)}
                  >
                    View Credit Note
                  </Button>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 text-danger text-body-sm bg-danger-soft border border-danger/30 rounded-md p-3">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Lines */}
              <div>
                <div className="text-body-sm font-semibold mb-2">Return lines</div>
                <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
                  {doc.items.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "px-4 py-3",
                        item.decision === "approved" && "bg-success-soft",
                        item.decision === "rejected" && "bg-danger-soft"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {/* Product */}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-body-sm truncate">
                            {item.product.name}
                          </div>
                          <div className="font-mono text-caption text-ink-muted">
                            {item.variant?.sku ?? item.product.sku}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-caption tnum">
                              Qty: <strong>{item.qty}</strong>
                            </span>
                            <span className="text-caption tnum">
                              Rate: {inr(item.rate)}
                            </span>
                            <span className="text-caption tnum font-semibold">
                              {inr(item.amount)}
                            </span>
                            <Chip tone="neutral" size="sm">
                              {REASON_LABELS[item.reason] ?? item.reason}
                            </Chip>
                          </div>
                          {item.reasonNotes && (
                            <div className="text-caption text-ink-muted mt-0.5 italic">
                              {item.reasonNotes}
                            </div>
                          )}
                          {item.decisionNotes && (
                            <div className="text-caption text-ink-muted mt-0.5">
                              Decision note: {item.decisionNotes}
                            </div>
                          )}
                        </div>

                        {/* Decision area */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-2">
                          {item.decision !== "pending" ? (
                            <Chip tone={decisionTone(item.decision)} size="sm" className="capitalize">
                              {item.decision === "approved" ? (
                                <><Check size={10} className="mr-1" />Approved</>
                              ) : (
                                <><X size={10} className="mr-1" />Rejected</>
                              )}
                            </Chip>
                          ) : doc.status === "pending_approval" ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                className="text-danger border-danger/30 hover:bg-danger-soft"
                                onClick={() => decide(item.id, "rejected")}
                              >
                                {decidingId === item.id ? "…" : <XCircle size={13} />}
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={busy}
                                className="bg-success text-white hover:bg-success/90"
                                onClick={() => decide(item.id, "approved")}
                              >
                                {decidingId === item.id ? "…" : <CheckCircle2 size={13} />}
                                Approve
                              </Button>
                            </div>
                          ) : (
                            <Chip tone="neutral" size="sm">Pending</Chip>
                          )}

                          {/* Decision notes input (only for pending lines in pending_approval) */}
                          {item.decision === "pending" && doc.status === "pending_approval" && (
                            <input
                              type="text"
                              placeholder="Note (optional)"
                              value={decisionNotes[item.id] ?? ""}
                              onChange={(e) =>
                                setDecisionNotes((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              className="w-44 border border-border rounded px-2 py-1 text-caption bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border border-border rounded-md px-4 py-3 bg-canvas space-y-1">
                <div className="flex justify-between text-body-sm">
                  <span className="text-ink-muted">Subtotal</span>
                  <span className="tnum">{inr(doc.subTotal)}</span>
                </div>
                <div className="flex justify-between text-body-sm">
                  <span className="text-ink-muted">Tax (18%)</span>
                  <span className="tnum">{inr(doc.tax)}</span>
                </div>
                <div className="flex justify-between text-body font-bold">
                  <span>Total</span>
                  <span className="tnum">{inr(doc.total)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {doc?.status === "pending_approval" && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-canvas flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={cancel}
              disabled={busy}
            >
              Cancel Return
            </Button>
            <Button
              size="sm"
              disabled={busy || !canFinalize}
              onClick={finalize}
              title={
                !canFinalize
                  ? "Decide all lines before finalizing"
                  : undefined
              }
            >
              {busy ? "Processing…" : "Finalize Return"}
            </Button>
          </div>
        )}
      </aside>

      {/* Credit note viewer overlay */}
      {showCN && doc?.creditNote && (
        <CreditNoteDetail
          creditNoteId={doc.creditNote.id}
          onClose={() => setShowCN(false)}
        />
      )}
    </>
  );
};

const InfoBox = ({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) => (
  <div className={cn("bg-canvas border border-border rounded-md p-3", className)}>
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold">
      {label}
    </div>
    <div className="text-body-sm font-semibold text-ink mt-1">{value}</div>
  </div>
);
