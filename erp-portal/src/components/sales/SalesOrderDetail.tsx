// Side drawer that shows a Sales Order with the fulfilment workflow.
// The only supported invoice path is Pick -> Pack -> Invoice (driven
// from the action ribbon at the top). Walk-in / cash-and-carry will
// be served by a dedicated POS screen rather than an inline shortcut
// here, which used to confuse operators by letting them issue a
// zero-line invoice or double-bill an already-fulfilled SO.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ListChecks,
  Lock,
  Package,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { primaryScanCode } from "@/lib/scanCode";
import {
  api,
  type PackingSlipRow,
  type PickListRow,
  type SalesOrderRow,
  type SalesOrderStatus,
} from "@/lib/api";
import { dt, dd, inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { resolveBillingTotals } from "@/lib/billingTotals";
import { BillingTotalsBreakdown } from "@/components/billing/BillingTotalsBreakdown";
import { fmtKg } from "@/lib/itemWeight";
import { PickListEditor } from "./PickListEditor";
import { PackingSlipEditor } from "./PackingSlipEditor";
import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";

interface Props {
  salesOrderId: string;
  onClose: () => void;
  onChanged?: () => void;
}

const statusTone = (s: SalesOrderStatus): "neutral" | "primary" | "success" | "warning" | "danger" => {
  switch (s) {
    case "confirmed":
      return "primary";
    case "partially_invoiced":
      return "warning";
    case "invoiced":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
    case "on_hold":
      return "warning";
  }
};

export const SalesOrderDetail = ({ salesOrderId, onClose, onChanged }: Props) => {
  const navigate = useNavigate();
  const [so, setSo] = useState<SalesOrderRow | null>(null);
  const [pickLists, setPickLists] = useState<PickListRow[]>([]);
  const [packingSlips, setPackingSlips] = useState<PackingSlipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The "Invoice direct" walk-in shortcut was removed; per-line
  // qty drafts, payment mode picker and inline issue highlights
  // belonged to that path and have been deleted with it. Errors
  // from pick/pack now surface in the top-of-drawer error banner.
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [openPickListId, setOpenPickListId] = useState<string | null>(null);
  const [openPackingSlipId, setOpenPackingSlipId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [fresh, pls, pss] = await Promise.all([
        api.salesOrder(salesOrderId),
        api.pickLists({ salesOrderId, limit: 50 }),
        api.packingSlips({ salesOrderId, limit: 50 }),
      ]);
      setSo(fresh);
      setPickLists(pls);
      setPackingSlips(pss);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ---- Fulfilment helpers ----
  const openPickList = pickLists.find(
    (p) => p.status === "draft" || p.status === "picking"
  );
  const openPackingSlip = packingSlips.find((p) => p.status === "open" || p.status === "packed");

  const startPicking = async () => {
    if (!so) return;
    setBusy(true);
    setError(null);
    try {
      const pl = await api.createPickList(so.id);
      setOpenPickListId(pl.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderId]);

  const orderedQty = so?.items.reduce((s, it) => s + it.qtyOrdered, 0) ?? 0;
  const invoicedQty = so?.items.reduce((s, it) => s + it.qtyInvoiced, 0) ?? 0;

  const transition = async (action: "cancel" | "hold" | "resume" | "close") => {
    if (!so) return;
    setBusy(true);
    setError(null);
    try {
      const fn =
        action === "cancel"
          ? api.cancelSalesOrder
          : action === "hold"
            ? api.holdSalesOrder
            : action === "resume"
              ? api.resumeSalesOrder
              : api.closeSalesOrder;
      await fn(so.id);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reserveStock = async () => {
    if (!so) return;
    setBusy(true);
    setError(null);
    setOkBanner(null);
    try {
      const result = await api.reserveSalesOrder(so.id);
      const totalReserved = result.reserved.reduce((s, r) => s + r.reserved, 0);
      const totalShort = result.reserved.reduce((s, r) => s + r.short, 0);
      setOkBanner(
        totalShort > 0
          ? `Reserved ${totalReserved} units across ${result.reserved.length} lines (short ${totalShort} — see flagged lines below).`
          : `Reserved ${totalReserved} units across ${result.reserved.length} lines.`
      );
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Reservation summary per line — used to render the Resv column and
  // decide whether to show the "Reserve stock" CTA.
  const lineReservation = useMemo(() => {
    const map = new Map<string, { reserved: number; outstanding: number }>();
    for (const it of so?.items ?? []) {
      const reserved = (it.reservations ?? []).reduce((s, r) => s + r.qty, 0);
      const outstanding = Math.max(
        0,
        Math.round(it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled)
      );
      map.set(it.id, { reserved, outstanding });
    }
    return map;
  }, [so]);

  const totalReserved = useMemo(
    () =>
      Array.from(lineReservation.values()).reduce((s, l) => s + l.reserved, 0),
    [lineReservation]
  );
  const totalOutstanding = useMemo(
    () =>
      Array.from(lineReservation.values()).reduce((s, l) => s + l.outstanding, 0),
    [lineReservation]
  );
  // True iff the SO is in a state where reservations are meaningful
  // and at least one line has outstanding qty that isn't fully
  // reserved (the user-visible "should we offer the Reserve button"
  // signal).
  const reservable =
    !!so &&
    (so.status === "confirmed" || so.status === "partially_invoiced") &&
    totalOutstanding > totalReserved;

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 grid place-items-end" {...backdropDismissProps(onClose)}>
      <div
        className="bg-surface w-full max-w-4xl h-full overflow-hidden flex flex-col elevation-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">Sales Order</div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {so?.soNo ?? "…"}
              {so && (
                <Chip size="sm" tone={statusTone(so.status)} className="capitalize">
                  {so.status.replace(/_/g, " ")}
                </Chip>
              )}
              {so?.quote && (
                <Chip size="sm" tone="info">
                  from {so.quote.quoteNo}
                </Chip>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {so && (
              <ShareDocumentMenu
                size="sm"
                descriptor={{
                  kind: "sales-order",
                  id: so.id,
                  docNo: so.soNo,
                  shareToken: so.shareToken ?? null,
                  customerName: so.customer.name,
                  customerContact: so.customer.contact ?? null,
                  total: so.total,
                  contextLine: `Order date: ${dt(so.orderDate)}`,
                  rotateToken: async (id) =>
                    (await api.rotateSalesOrderShareToken(id)).shareToken,
                  onTokenChanged: (token) =>
                    setSo((cur) => (cur ? { ...cur, shareToken: token } : cur)),
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
        ) : error && !so ? (
          <div className="flex-1 grid place-items-center text-danger">{error}</div>
        ) : so ? (
          <>
            {/* Fulfilment ribbon (Pick -> Pack -> Invoice) */}
            {(so.status === "confirmed" ||
              so.status === "partially_invoiced" ||
              so.status === "on_hold") && (
              <div className="bg-canvas border-b border-border px-5 py-3 flex items-center gap-3 flex-wrap">
                <div className="text-caption text-ink-muted uppercase font-semibold">
                  Fulfilment
                </div>
                <FulfilmentStep
                  done={pickLists.some((p) => p.status === "picked")}
                  active={!!openPickList}
                  label="Pick"
                />
                <Sep />
                <FulfilmentStep
                  done={packingSlips.some((p) => p.status === "invoiced")}
                  active={!!openPackingSlip}
                  label="Pack"
                />
                <Sep />
                <FulfilmentStep
                  done={false}
                  active={(so.invoices?.length ?? 0) > 0}
                  label="Invoice"
                />
                <div className="flex-1" />
                {reservable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Lock size={14} />}
                    onClick={reserveStock}
                    disabled={busy}
                    title={`Hard-reserve ${totalOutstanding - totalReserved} more unit(s) on bins so the warehouse view shows them as Reserved.`}
                  >
                    Reserve stock
                  </Button>
                )}
                {!openPickList && !openPackingSlip && (
                  <Button
                    size="sm"
                    icon={<Package size={14} />}
                    onClick={startPicking}
                    disabled={busy || so.status === "on_hold"}
                  >
                    Start picking
                  </Button>
                )}
                {openPickList && (
                  <Button
                    size="sm"
                    icon={<Package size={14} />}
                    onClick={() => setOpenPickListId(openPickList.id)}
                  >
                    Continue pick · {openPickList.pickListNo}
                  </Button>
                )}
                {!openPickList && openPackingSlip && (
                  <Button
                    size="sm"
                    icon={<PackageCheck size={14} />}
                    variant={openPackingSlip.status === "packed" ? "gold" : "primary"}
                    onClick={() => setOpenPackingSlipId(openPackingSlip.id)}
                  >
                    {openPackingSlip.status === "packed"
                      ? `Invoice · ${openPackingSlip.packingSlipNo}`
                      : `Pack · ${openPackingSlip.packingSlipNo}`}
                  </Button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section className="grid grid-cols-3 gap-3">
                <Card label="Customer">
                  <div className="font-bold">{so.customer.name}</div>
                  <div className="text-caption text-ink-muted">{so.customer.city ?? ""}</div>
                </Card>
                <Card label="Order date">
                  <div className="font-bold">{dd(so.orderDate)}</div>
                  <div className="text-caption text-ink-muted">{dt(so.orderDate)}</div>
                </Card>
                <Card label="Total">
                  {(() => {
                    const totals = resolveBillingTotals({
                      subTotal: so.subTotal,
                      tax: so.tax,
                      cgstTotal: so.cgstTotal,
                      sgstTotal: so.sgstTotal,
                      igstTotal: so.igstTotal,
                      taxKind: so.taxKind,
                      transportCharge: so.transportCharge,
                      transportTax: so.transportTax,
                      roundOff: so.roundOff,
                      total: so.total,
                    });
                    return (
                      <>
                        <div className="font-bold tnum text-h3 text-primary">
                          {inr(totals.grandTotal)}
                        </div>
                        <BillingTotalsBreakdown totals={totals} variant="inline" />
                        {so.totalWeightKg != null && so.totalWeightKg > 0 && (
                          <div className="text-caption text-ink-muted mt-0.5">
                            Est. weight {fmtKg(so.totalWeightKg)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </Card>
              </section>

              {(so.dispatchOption || (so.transportCharge ?? 0) > 0) && (
                <section className="rounded-md border border-border bg-canvas px-4 py-3 text-body-sm">
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                    Dispatch
                  </div>
                  <div className="font-medium">
                    {so.dispatchOption?.name ?? "—"}
                  </div>
                  {(so.transportCharge ?? 0) > 0 && (
                    <div className="text-caption text-ink-muted mt-0.5">
                      Transport {inr(so.transportCharge ?? 0)}
                      {(so.transportTax ?? 0) > 0 && (
                        <> + GST {inr(so.transportTax ?? 0)}</>
                      )}
                    </div>
                  )}
                </section>
              )}

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-caption text-ink-muted uppercase font-semibold">
                    Progress
                  </div>
                  <div className="text-caption tnum">
                    {invoicedQty} / {orderedQty} invoiced
                  </div>
                </div>
                <div className="h-2 bg-canvas rounded-full overflow-hidden">
                  <div
                    className="h-full bg-success transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((invoicedQty / Math.max(1, orderedQty)) * 100))}%`,
                    }}
                  />
                </div>
              </section>

              {okBanner && (
                <div className="bg-success-soft border border-success text-success px-3 py-2 rounded-md text-body-sm flex items-center gap-2">
                  <CheckCircle2 size={14} /> {okBanner}
                </div>
              )}
              {error && (
                <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
                  {error}
                </div>
              )}

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-caption text-ink-muted uppercase font-semibold">
                    Lines
                  </div>
                  {(so.status === "confirmed" ||
                    so.status === "partially_invoiced" ||
                    so.status === "on_hold") && (
                    <div className="text-caption text-ink-muted tnum flex items-center gap-1">
                      <Lock size={12} className="opacity-70" />
                      Reserved {totalReserved} / {totalOutstanding} outstanding
                    </div>
                  )}
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="grid grid-cols-12 grid-header-cell text-caption">
                    <div className="col-span-4">Product</div>
                    <div className="col-span-1 text-right">Ord</div>
                    <div className="col-span-1 text-right">Inv</div>
                    <div className="col-span-1 text-right">Rem</div>
                    <div
                      className="col-span-1 text-right"
                      title="Bin units hard-reserved against this line. Goes up at SO confirm and shifts to pick-list reservation at pick→picked."
                    >
                      Resv
                    </div>
                    <div className="col-span-1 text-right">Stock</div>
                    <div className="col-span-1 text-right">Rate</div>
                    <div className="col-span-2 text-right">Subtotal</div>
                  </div>
                  {so.items.map((it) => {
                    const remaining = Math.max(
                      0,
                      it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled
                    );
                    const stock = it.variant?.stockOnHand ?? it.product?.stockOnHand ?? 0;
                    const lr = lineReservation.get(it.id);
                    const reserved = lr?.reserved ?? 0;
                    const reservationTitle =
                      (it.reservations ?? []).length > 0
                        ? (it.reservations ?? [])
                            .map(
                              (r) =>
                                `${r.qty} on ${r.bin?.warehouse?.code ?? "?"} · ${r.bin?.zone}/${r.bin?.shelf}/${r.bin?.bin}`
                            )
                            .join("\n")
                        : remaining > 0
                          ? "No bin reservation yet. Confirm or click 'Reserve stock' to lock units."
                          : "";
                    return (
                      <div
                        key={it.id}
                        className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm"
                      >
                        <div className="col-span-4">
                          <div className="font-semibold">
                            {it.product?.name ?? it.productId}
                          </div>
                          <div className="text-caption text-ink-muted font-mono">
                            {it.variant
                              ? primaryScanCode(it.variant)
                              : primaryScanCode(it.product ?? { sku: "—", barcode: null })}
                            {it.variant &&
                              (it.variant.size || it.variant.color || it.variant.grade) && (
                                <span className="ml-2 text-ink-muted">
                                  ·{" "}
                                  {[it.variant.size, it.variant.color, it.variant.grade]
                                    .filter(Boolean)
                                    .join(" / ")}
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="col-span-1 text-right tnum">{it.qtyOrdered}</div>
                        <div className="col-span-1 text-right tnum">{it.qtyInvoiced}</div>
                        <div className="col-span-1 text-right tnum font-semibold">{remaining}</div>
                        <div
                          className={cn(
                            "col-span-1 text-right tnum",
                            remaining === 0
                              ? "text-ink-muted"
                              : reserved >= remaining
                                ? "text-success"
                                : reserved > 0
                                  ? "text-warning"
                                  : "text-danger"
                          )}
                          title={reservationTitle}
                        >
                          {reserved}
                        </div>
                        <div
                          className={cn(
                            "col-span-1 text-right tnum",
                            stock < remaining ? "text-danger" : "text-ink-muted"
                          )}
                        >
                          {stock}
                        </div>
                        <div className="col-span-1 text-right tnum">{inr(it.rate)}</div>
                        <div className="col-span-2 text-right tnum font-semibold">
                          {inr(it.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                  Fulfilment history
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-caption font-semibold mb-1.5">
                        Pick lists ({pickLists.length})
                      </div>
                      <div className="border border-border rounded-md overflow-hidden">
                        {pickLists.length === 0 ? (
                          <div className="p-3 text-caption text-ink-muted">None</div>
                        ) : (
                          pickLists.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setOpenPickListId(p.id)}
                              className="w-full px-3 py-2 border-b last:border-b-0 border-border hover:bg-canvas text-left flex items-center justify-between"
                            >
                              <div>
                                <div className="font-mono font-semibold text-primary">
                                  {p.pickListNo}
                                </div>
                                <div className="text-caption text-ink-muted">
                                  {dt(p.createdAt)}
                                </div>
                              </div>
                              <Chip size="sm" tone={pickTone(p.status)} className="capitalize">
                                {p.status}
                              </Chip>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-caption font-semibold mb-1.5">
                        Packing slips ({packingSlips.length})
                      </div>
                      <div className="border border-border rounded-md overflow-hidden">
                        {packingSlips.length === 0 ? (
                          <div className="p-3 text-caption text-ink-muted">None</div>
                        ) : (
                          packingSlips.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setOpenPackingSlipId(p.id)}
                              className="w-full px-3 py-2 border-b last:border-b-0 border-border hover:bg-canvas text-left flex items-center justify-between"
                            >
                              <div>
                                <div className="font-mono font-semibold text-primary">
                                  {p.packingSlipNo}
                                </div>
                                <div className="text-caption text-ink-muted">
                                  {dt(p.createdAt)}
                                </div>
                              </div>
                              <Chip size="sm" tone={packTone(p.status)} className="capitalize">
                                {p.status}
                              </Chip>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
              </section>

              <section>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                  Linked invoices
                </div>
                <div className="border border-border rounded-md overflow-hidden">
                  {(so.invoices ?? []).length === 0 ? (
                    <div className="p-3 text-caption text-ink-muted">
                      No invoice yet. The invoice is generated automatically
                      when the packing slip is locked at pack-complete.
                    </div>
                  ) : (
                    so.invoices?.map((iv) => (
                      <button
                        key={iv.id}
                        onClick={() => {
                          onClose();
                          navigate(`/billing?tab=invoices&focus=${iv.id}`);
                        }}
                        className="w-full text-left px-3 py-2 border-b last:border-b-0 border-border flex items-center justify-between text-body-sm hover:bg-primary-50 transition-colors"
                      >
                        <div>
                          <div className="font-mono font-semibold text-primary">
                            {iv.invoiceNo}
                          </div>
                          <div className="text-caption text-ink-muted">
                            {dt(iv.date)} · {iv.paymentMode} · open →
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold tnum">{inr(iv.amount)}</div>
                          <div className="text-caption text-ink-muted capitalize">
                            {iv.status}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className="border-t border-border p-3 flex items-center gap-2 justify-end">
              {so.status === "confirmed" &&
                /*
                 * With pre-generated invoices every confirmed SO has an
                 * invoice attached. The cancel guard only needs to block
                 * cancellation when one of those invoices is "real" (paid,
                 * packed, or otherwise actioned) - plain pre-gen 'issued'
                 * invoices with no packing slip yet are paperwork and the
                 * backend cancels them alongside the SO.
                 */
                !(so.invoices ?? []).some(
                  (iv) =>
                    iv.status !== "issued" || iv.packingSlipId !== null
                ) && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<XCircle size={14} />}
                    onClick={() => transition("cancel")}
                    disabled={busy}
                    className="border-danger text-danger hover:bg-danger-soft"
                  >
                    Cancel order
                  </Button>
                )}
              {so.status === "on_hold" ? (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<PlayCircle size={14} />}
                  onClick={() => transition("resume")}
                  disabled={busy}
                >
                  Resume
                </Button>
              ) : so.status === "confirmed" || so.status === "partially_invoiced" ? (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<PauseCircle size={14} />}
                  onClick={() => transition("hold")}
                  disabled={busy}
                >
                  Hold
                </Button>
              ) : null}
              {so.status === "invoiced" && (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<ListChecks size={14} />}
                  onClick={() => transition("close")}
                  disabled={busy}
                >
                  Close
                </Button>
              )}
              {so.status === "partially_invoiced" && (
                /*
                 * Partial fulfilment endpoint. When picking finished
                 * short (warehouse shortage / damaged stock), the
                 * un-invoiced remainder otherwise hangs on the
                 * customer's open AR as a future commitment. Closing
                 * accepts the shortfall: the backend bumps
                 * qtyCancelled on every line so soCommitment goes to
                 * 0 and the customer's Open Balance now matches the
                 * invoiced amount only.
                 */
                <Button
                  size="sm"
                  variant="outline"
                  icon={<ListChecks size={14} />}
                  onClick={() => transition("close")}
                  disabled={busy}
                  title="Accept what was actually invoiced and cancel the un-invoiced remainder. The customer's open AR will drop to the issued invoice total."
                >
                  Close (accept shortfall)
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {openPickListId && (
        <PickListEditor
          pickListId={openPickListId}
          onClose={() => setOpenPickListId(null)}
          onCompleted={(ps) => setOpenPackingSlipId(ps.id)}
          onChanged={() => {
            void refresh();
            onChanged?.();
          }}
        />
      )}
      {openPackingSlipId && (
        <PackingSlipEditor
          packingSlipId={openPackingSlipId}
          onClose={() => setOpenPackingSlipId(null)}
          onChanged={() => {
            void refresh();
            onChanged?.();
          }}
        />
      )}
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

const FulfilmentStep = ({
  done,
  active,
  label,
}: {
  done: boolean;
  active: boolean;
  label: string;
}) => (
  <div className="flex items-center gap-1.5">
    <span
      className={cn(
        "h-5 w-5 rounded-full grid place-items-center text-[10px] font-bold",
        done
          ? "bg-success text-white"
          : active
            ? "bg-primary text-white animate-pulse"
            : "bg-canvas border border-border text-ink-muted"
      )}
    >
      {done ? "✓" : ""}
    </span>
    <span
      className={cn(
        "text-body-sm font-semibold",
        done ? "text-success" : active ? "text-primary" : "text-ink-muted"
      )}
    >
      {label}
    </span>
  </div>
);

const Sep = () => <span className="text-ink-muted">→</span>;

const pickTone = (s: string): "neutral" | "primary" | "success" | "danger" => {
  if (s === "draft") return "neutral";
  if (s === "picking") return "primary";
  if (s === "picked") return "success";
  return "danger";
};

const packTone = (s: string): "neutral" | "primary" | "success" | "warning" | "danger" => {
  if (s === "open") return "primary";
  if (s === "packed") return "warning";
  if (s === "invoiced") return "success";
  return "danger";
};
