// Drawer for working a packing slip. The packer enters qtyPacked per
// line — this is the explicit deviation point: actual packed qty CAN
// differ from picked qty (damage, weight variance, short count) and
// becomes the source of truth for invoicing.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  Printer,
  Receipt,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import {
  api,
  ApiError,
  type PackingSlipRow,
  type PackingSlipStatus,
} from "@/lib/api";
import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";
import { dt, inr } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Props {
  packingSlipId: string;
  onClose: () => void;
  onChanged?: () => void;
}

const statusTone = (s: PackingSlipStatus): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "open":
      return "primary";
    case "packed":
      return "warning";
    case "invoiced":
      return "success";
    case "cancelled":
      return "danger";
  }
};

export const PackingSlipEditor = ({ packingSlipId, onClose, onChanged }: Props) => {
  const navigate = useNavigate();
  const [ps, setPs] = useState<PackingSlipRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<{ id: string; reason: string }[]>([]);
  // Per-line short-stock entries returned by the server when a pack-to-
  // invoice attempt would oversell. Cleared on every save / re-open.
  const [oversells, setOversells] = useState<
    {
      sku: string;
      requested: number;
      available: number;
      kind?: "variant" | "product" | "bin";
      location?: string;
    }[]
  >([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [paymentMode, setPaymentMode] = useState<"cash" | "card" | "upi" | "credit" | "split">(
    "credit"
  );
  const [okBanner, setOkBanner] = useState<string | null>(null);
  // Mismatches reported by the auto-pack endpoint - one row per line
  // where the operator had hand-edited qtyPacked away from qtyPicked
  // before clicking the auto button. We keep the qtyPicked value but
  // surface the original qtyPacked + variance so the row can be
  // tinted and the banner explains what changed.
  const [autoPackMismatches, setAutoPackMismatches] = useState<
    {
      itemId: string;
      sku: string;
      qtyPicked: number;
      qtyPacked: number;
      variance: number;
    }[]
  >([]);

  const refresh = async () => {
    setLoading(true);
    try {
      const fresh = await api.packingSlip(packingSlipId);
      setPs(fresh);
      setDrafts(Object.fromEntries(fresh.items.map((it) => [it.id, it.qtyPacked])));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packingSlipId]);

  const isLocked = ps && ps.status !== "open";

  const subTotal = useMemo(() => {
    if (!ps) return 0;
    return ps.items.reduce((s, it) => s + (drafts[it.id] ?? it.qtyPacked) * it.rate, 0);
  }, [ps, drafts]);
  const tax = Math.round(subTotal * 0.18);
  const total = subTotal + tax;

  const totalPicked = ps?.items.reduce((s, it) => s + it.qtyPicked, 0) ?? 0;
  const totalPacked = useMemo(
    () => Object.values(drafts).reduce((s, q) => s + (q || 0), 0),
    [drafts]
  );
  const variance = totalPacked - totalPicked;

  const save = async () => {
    if (!ps || isLocked) return;
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const items = Object.entries(drafts).map(([id, qtyPacked]) => ({ id, qtyPacked }));
      await api.updatePackingSlip(ps.id, { items });
      await refresh();
      onChanged?.();
    } catch (e) {
      const err = e as { details?: { details?: typeof issues }; message?: string };
      const det = err.details?.details;
      if (Array.isArray(det)) setIssues(det);
      setError(err.message ?? "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const lockPack = async () => {
    if (!ps || isLocked) return;
    setBusy(true);
    setError(null);
    setOversells([]);
    try {
      const items = Object.entries(drafts).map(([id, qtyPacked]) => ({ id, qtyPacked }));
      await api.updatePackingSlip(ps.id, { items });
      const updated = await api.packPackingSlip(ps.id);
      setPs(updated);
      // /pack now attaches the pre-generated invoice and goes
      // straight to status='invoiced'. Surface the invoice so the
      // packer can confirm settlement happened in one keystroke.
      if (updated.invoice?.invoiceNo) {
        setOkBanner(`Invoice ${updated.invoice.invoiceNo} settled · ${inr(updated.invoice.amount ?? total)}`);
      }
      onChanged?.();
    } catch (e) {
      // /pack now does the oversell pre-flight that /invoice used
      // to do, so handle the same insufficient_stock 409 shape here.
      if (e instanceof ApiError && e.status === 409) {
        const det = e.details as
          | { code?: string; details?: { sku: string; requested: number; available: number }[] }
          | undefined;
        if (det?.code === "insufficient_stock" && Array.isArray(det.details)) {
          setOversells(det.details);
        }
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // One-click pack: server copies qtyPicked into qtyPacked and locks
  // the slip in a single transaction. The common case has no
  // mismatches because the slip is auto-seeded with qtyPacked === qtyPicked
  // at pick-complete time. If the operator hand-edited a row and then
  // hit auto, we keep the picked qty (source of truth) but surface the
  // original qtyPacked the operator had typed.
  const autoPack = async () => {
    if (!ps || isLocked) return;
    setBusy(true);
    setError(null);
    setAutoPackMismatches([]);
    try {
      const result = await api.autoPackPackingSlip(ps.id);
      setAutoPackMismatches(result.mismatches ?? []);
      setPs(result.packingSlip);
      setDrafts(
        Object.fromEntries(result.packingSlip.items.map((it) => [it.id, it.qtyPacked]))
      );
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const printPackingSlip = () => {
    if (!ps) return;
    window.open(`/print/packing-slip/${ps.id}?print=1`, "_blank", "noopener");
  };

  const generateInvoice = async () => {
    if (!ps) return;
    setBusy(true);
    setError(null);
    setOkBanner(null);
    setOversells([]);
    try {
      const inv = (await api.invoicePackingSlip(ps.id, paymentMode)) as {
        id?: string;
        invoiceNo?: string;
      };
      setOkBanner(`Invoice ${inv.invoiceNo} generated · ${inr(total)}`);
      onChanged?.();
      if (inv.id) {
        onClose();
        navigate(`/billing?tab=invoices&focus=${inv.id}`);
        return;
      }
      await refresh();
    } catch (e) {
      // Server rejects pack-to-invoice with code "insufficient_stock" if
      // qtyPacked > stockOnHand (variant/product) or > bin.qty. Render
      // the per-line breakdown so the packer can fix qtyPacked instead
      // of guessing.
      if (e instanceof ApiError && e.status === 409) {
        const det = e.details as
          | {
              code?: string;
              details?: {
                sku: string;
                requested: number;
                available: number;
                kind?: "variant" | "product" | "bin";
                location?: string;
              }[];
            }
          | undefined;
        if (det?.code === "insufficient_stock" && det.details) {
          setOversells(det.details);
          setError(e.message);
          return;
        }
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!ps || ps.status === "invoiced" || ps.status === "cancelled") return;
    if (!confirm("Cancel this packing slip? Bin reservations from the linked pick will be released.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelPackingSlip(ps.id);
      onChanged?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-4xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">Packing Slip</div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {ps?.packingSlipNo ?? "…"}
              {ps && (
                <Chip size="sm" tone={statusTone(ps.status)} className="capitalize">
                  {ps.status}
                </Chip>
              )}
              {ps?.salesOrder && (
                <Chip size="sm" tone="info">
                  {ps.salesOrder.soNo} · {ps.salesOrder.customer?.name}
                </Chip>
              )}
              {ps?.pickList && (
                <Chip size="sm" tone="neutral">
                  from {ps.pickList.pickListNo}
                </Chip>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ps?.salesOrder && (
              <ShareDocumentMenu
                size="sm"
                descriptor={{
                  kind: "packing-slip",
                  id: ps.id,
                  docNo: ps.packingSlipNo,
                  shareToken: ps.shareToken ?? null,
                  customerName: ps.salesOrder.customer?.name ?? "Customer",
                  customerContact: ps.salesOrder.customer?.contact ?? null,
                  contextLine: `Sales order: ${ps.salesOrder.soNo}`,
                  rotateToken: async (id) =>
                    (await api.rotatePackingSlipShareToken(id)).shareToken,
                  onTokenChanged: (token) =>
                    setPs((cur) => (cur ? { ...cur, shareToken: token } : cur)),
                }}
              />
            )}
            <button
              onClick={onClose}
              className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 grid place-items-center text-ink-muted">Loading…</div>
        ) : error && !ps ? (
          <div className="flex-1 grid place-items-center text-danger">{error}</div>
        ) : ps ? (
          <>
            {ps.status === "open" && (
              <div className="bg-warning-soft border-b border-warning text-ink px-5 py-2 text-body-sm">
                Pack the actual physical units. <strong>qtyPacked</strong> can differ from
                qtyPicked (damaged, short on count, weight variance) and is what gets invoiced.
              </div>
            )}
            {okBanner && (
              <div className="bg-success-soft border-b border-success text-success px-5 py-2 text-body-sm flex items-center gap-2">
                <CheckCircle2 size={14} /> {okBanner}
              </div>
            )}
            {autoPackMismatches.length > 0 && (
              <div className="bg-warning-soft border-b border-warning px-5 py-2 text-body-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-ink">
                      Auto-pack overrode {autoPackMismatches.length} hand-edited line
                      {autoPackMismatches.length === 1 ? "" : "s"}
                    </div>
                    <div className="text-caption text-ink-muted mb-1">
                      qtyPacked was set to qtyPicked. The originally entered
                      values are shown below for review.
                    </div>
                    <div className="space-y-1">
                      {autoPackMismatches.map((m) => (
                        <div
                          key={m.itemId}
                          className="flex items-center justify-between gap-3 bg-white/60 rounded px-2 py-1 text-caption"
                        >
                          <span className="font-mono font-semibold">{m.sku}</span>
                          <span>
                            you typed <b className="tnum">{m.qtyPacked}</b> ·
                            picked <b className="tnum">{m.qtyPicked}</b> ·{" "}
                            <b
                              className={cn(
                                "tnum",
                                m.variance < 0 ? "text-warning" : "text-danger"
                              )}
                            >
                              {m.variance > 0 ? "+" : ""}
                              {m.variance}
                            </b>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setAutoPackMismatches([])}
                    className="text-caption text-ink-muted hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="bg-danger-soft border-b border-danger text-danger px-5 py-2 text-body-sm">
                <div>{error}</div>
                {oversells.length > 0 && (
                  <div className="mt-2 space-y-1 text-caption">
                    {oversells.map((o, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 bg-white/50 rounded px-2 py-1"
                      >
                        <span className="font-mono font-semibold">
                          {o.sku}
                          {o.kind === "bin" && o.location && (
                            <span className="text-ink-muted ml-1 font-normal">
                              (bin {o.location})
                            </span>
                          )}
                          {o.kind === "variant" && (
                            <span className="text-ink-muted ml-1 font-normal">(variant)</span>
                          )}
                        </span>
                        <span>
                          packed <b className="tnum">{o.requested}</b> · available{" "}
                          <b className="tnum">{o.available}</b> · short by{" "}
                          <b className="tnum text-danger">
                            {o.requested - o.available}
                          </b>
                        </span>
                      </div>
                    ))}
                    <div className="text-ink-muted">
                      Reduce qtyPacked on these lines, split the slip, or run a stock
                      adjustment in Inventory before retrying.
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <Card label="Lines">
                  <div className="text-h3 font-bold tnum">{ps.items.length}</div>
                </Card>
                <Card label="Total picked">
                  <div className="text-h3 font-bold tnum">{totalPicked}</div>
                </Card>
                <Card label="Total packed">
                  <div className="text-h3 font-bold tnum text-primary">{totalPacked}</div>
                </Card>
                <Card label="Variance">
                  <div
                    className={cn(
                      "text-h3 font-bold tnum",
                      variance < 0 ? "text-warning" : variance > 0 ? "text-danger" : "text-success"
                    )}
                  >
                    {variance > 0 ? "+" : ""}
                    {variance}
                  </div>
                </Card>
              </div>

              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                  Lines
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="grid grid-cols-12 grid-header-cell text-caption">
                    <div className="col-span-4">Product</div>
                    <div className="col-span-1 text-right">Ord</div>
                    <div className="col-span-1 text-right">Picked</div>
                    <div className="col-span-2 text-right">Packed</div>
                    <div className="col-span-2 text-right">Rate</div>
                    <div className="col-span-2 text-right">Amount</div>
                  </div>
                  {ps.items.map((it) => {
                    const draftQty = drafts[it.id] ?? it.qtyPacked;
                    const issue = issues.find((x) => x.id === it.id);
                    const mismatch = autoPackMismatches.find((x) => x.itemId === it.id);
                    const variance = draftQty - it.qtyPicked;
                    return (
                      <div
                        key={it.id}
                        className={cn(
                          "grid grid-cols-12 grid-cell items-center !py-2 text-body-sm",
                          issue && "bg-danger-soft",
                          !issue && mismatch && "bg-warning-soft"
                        )}
                      >
                        <div className="col-span-4">
                          <div className="font-semibold">{it.product?.name}</div>
                          <div className="text-caption text-ink-muted font-mono">
                            {it.variant?.sku ?? it.product?.sku}
                          </div>
                          {issue && (
                            <div className="text-caption text-danger mt-0.5">{issue.reason}</div>
                          )}
                          {variance !== 0 && (
                            <div className="text-caption text-warning mt-0.5">
                              {variance > 0
                                ? `+${variance} above picked`
                                : `${variance} short of picked`}
                            </div>
                          )}
                        </div>
                        <div className="col-span-1 text-right tnum text-ink-muted">{it.qtyOrdered}</div>
                        <div className="col-span-1 text-right tnum">{it.qtyPicked}</div>
                        <div className="col-span-2">
                          <Input
                            type="number"
                            disabled={!!isLocked}
                            value={String(draftQty)}
                            onChange={(e) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [it.id]: Math.max(0, Math.min(it.qtyPicked, Number(e.target.value))),
                              }))
                            }
                            className="!h-7 !text-right tnum"
                          />
                        </div>
                        <div className="col-span-2 text-right tnum">{inr(it.rate)}</div>
                        <div className="col-span-2 text-right tnum font-semibold">
                          {inr(draftQty * it.rate)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                    Linked invoice
                  </div>
                  {ps.invoice ? (
                    <button
                      onClick={() => {
                        onClose();
                        navigate(`/billing?tab=invoices&focus=${ps.invoice!.id}`);
                      }}
                      className="w-full text-left border border-border rounded-md p-3 bg-canvas flex items-center justify-between hover:border-primary hover:bg-primary-50 transition-colors"
                    >
                      <div>
                        <div className="font-mono font-semibold text-primary">
                          {ps.invoice.invoiceNo}
                        </div>
                        <div className="text-caption text-ink-muted">
                          {dt(ps.invoice.date)} · {ps.invoice.status} · open →
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold tnum">{inr(ps.invoice.amount)}</div>
                      </div>
                    </button>
                  ) : (
                    <div className="border border-border rounded-md p-3 bg-canvas text-caption text-ink-muted">
                      Invoice is generated automatically when the Sales Order
                      is confirmed. It attaches to this slip the moment you
                      <strong> Lock pack</strong>, no extra step required.
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                    Invoice summary
                  </div>
                  <div className="border border-border rounded-md p-3 bg-canvas space-y-2">
                    <Row k="Subtotal (from packed)" v={inr(subTotal)} />
                    <Row k="GST 18%" v={inr(tax)} />
                    <div className="border-t border-border pt-2">
                      <Row k="Total" v={inr(total)} big />
                    </div>
                    <div>
                      <div className="text-caption text-ink-muted mb-1">
                        Payment
                      </div>
                      {/*
                       * With pre-generated invoices, payment terms are set on
                       * the Customer record (or chosen on the Billing screen
                       * when marking the invoice paid), not at pack time. We
                       * keep the legacy state in scope for the back-compat
                       * "Generate invoice" button that still shows for
                       * status==='packed' slips left over from before the
                       * rollout - everything else just renders this hint.
                       */}
                      <div className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm flex items-center text-ink-muted">
                        Settled via invoice on the Billing screen
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border p-3 flex items-center gap-2 justify-end">
              {ps.status !== "invoiced" && ps.status !== "cancelled" && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<XCircle size={14} />}
                  onClick={cancel}
                  disabled={busy}
                  className="border-danger text-danger hover:bg-danger-soft"
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={<Printer size={14} />}
                onClick={printPackingSlip}
                disabled={busy}
                title="Open a print-friendly view (Save as PDF from the print dialog)"
              >
                Print / PDF
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              {ps.status === "open" && (
                <>
                  <Button size="sm" variant="outline" onClick={save} disabled={busy}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Wand2 size={14} />}
                    onClick={autoPack}
                    disabled={busy || totalPicked === 0}
                    title="Set qtyPacked = qtyPicked on every line and lock the pack"
                  >
                    Auto-pack all
                  </Button>
                  <Button
                    size="sm"
                    icon={<PackageCheck size={14} />}
                    onClick={lockPack}
                    disabled={busy || totalPacked === 0}
                  >
                    {busy ? "…" : "Lock pack"}
                  </Button>
                </>
              )}
              {ps.status === "packed" && (
                /*
                 * Legacy slips: "packed" used to be the resting state between
                 * pack-complete and invoice-from-pack. The new pack flow
                 * jumps straight from "open" -> "invoiced" (the invoice was
                 * pre-generated at SO confirmation), so this button is only
                 * here for slips left over from before the rollout. It calls
                 * /packing-slips/:id/invoice which now just attaches the
                 * existing pre-gen invoice and decrements stock - nothing
                 * actually creates a new invoice any more.
                 */
                <Button
                  size="sm"
                  variant="gold"
                  icon={<Receipt size={14} />}
                  onClick={generateInvoice}
                  disabled={busy}
                  title="Settle the pre-generated invoice and decrement stock for this legacy packed slip."
                >
                  {busy ? "…" : `Settle invoice ${inr(total)}`}
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border border-border rounded-md p-3 bg-canvas">
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold mb-1">
      {label}
    </div>
    <div>{children}</div>
  </div>
);

const Row = ({ k, v, big }: { k: string; v: string; big?: boolean }) => (
  <div className="flex items-center justify-between">
    <span className={cn(big ? "font-semibold" : "text-ink-muted text-body-sm")}>{k}</span>
    <span className={cn("tnum", big ? "text-h3 font-bold text-primary" : "font-semibold text-body-sm")}>
      {v}
    </span>
  </div>
);
