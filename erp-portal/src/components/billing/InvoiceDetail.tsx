// Side-drawer that opens when the user clicks an invoice on the
// Billing > Invoices tab. Shows everything operators need post-issue:
// line items, links back to the source SO/Packing slip, the share
// dropdown, and the list of transport drops already booked against
// this invoice. The "Assign to trip" action opens the TripPicker so
// the operator can drop this invoice on an existing trip (preferred)
// or create a new one - much faster than typing vehicle/driver/ETA
// per invoice.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  PackageCheck,
  Receipt,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { effectiveUom } from "@/data/types";
import { primaryScanCode } from "@/lib/scanCode";
import { ShareDocumentMenu } from "@/components/common/ShareDocumentMenu";
import { api, type InvoiceDetail as InvoiceDetailRow } from "@/lib/api";
import { formatCustomerSummary, formatCustomerAddress } from "@/lib/customerAddress";
import { dt, inr } from "@/lib/format";
import { resolveBillingTotals, sumLineAmounts } from "@/lib/billingTotals";
import { BillingTotalsBreakdown } from "@/components/billing/BillingTotalsBreakdown";
import { fmtKg } from "@/lib/itemWeight";
import { TripPicker } from "./TripPicker";
import { CourierPicker } from "./CourierPicker";

interface Props {
  invoiceId: string;
  onClose: () => void;
  onChanged?: () => void;
}

const statusTone = (s: InvoiceDetailRow["status"]) => {
  switch (s) {
    case "paid":
      return "success" as const;
    case "issued":
      return "primary" as const;
    case "partial":
      return "warning" as const;
    case "overdue":
      return "danger" as const;
    case "draft":
      return "neutral" as const;
  }
};

const dispatchTone = (s: InvoiceDetailRow["dispatches"][number]["status"]) => {
  switch (s) {
    case "delivered":
      return "success" as const;
    case "in-transit":
      return "primary" as const;
    case "loading":
      return "info" as const;
    case "delayed":
      return "danger" as const;
    case "planned":
      return "neutral" as const;
  }
};

export const InvoiceDetail = ({ invoiceId, onClose, onChanged }: Props) => {
  const navigate = useNavigate();
  const [inv, setInv] = useState<InvoiceDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTripPicker, setShowTripPicker] = useState(false);
  const [showCourierPicker, setShowCourierPicker] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const fresh = await api.getInvoice(invoiceId);
      setInv(fresh);
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
  }, [invoiceId]);

  const billingTotals = useMemo(() => {
    if (!inv) {
      return resolveBillingTotals({});
    }
    return resolveBillingTotals({
      goodsSubTotal: sumLineAmounts(inv.items),
      goodsTax: inv.tax,
      cgstTotal: inv.cgstTotal,
      sgstTotal: inv.sgstTotal,
      igstTotal: inv.igstTotal,
      taxKind: inv.taxKind,
      transportCharge: inv.transportCharge,
      transportTax: inv.transportTax,
      roundOff: inv.roundOff,
      total: inv.amount,
    });
  }, [inv]);

  const onConfirmDispatch = async (id: string) => {
    setBusy(id);
    try {
      await api.confirmDispatch(id);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Total weight across all line items, used to suggest a per-drop
  // weight when assigning to a trip.
  const estimatedWeightKg = useMemo(() => {
    if (!inv) return 0;
    return Math.round(
      inv.items.reduce((sum, it) => {
        const wt = (it.product as unknown as { weightKg?: number }).weightKg;
        return sum + (typeof wt === "number" ? wt : 0) * it.qty;
      }, 0)
    );
  }, [inv]);

  // After a trip is picked: create the dispatch with tripId, the
  // backend inherits vehicle/driver from the trip.
  const onAssignToTrip = async (tripId: string, tripNo: string) => {
    if (!inv) return;
    setBusy("assign");
    try {
      await api.createDispatch({
        invoiceId: inv.id,
        tripId,
        weightKg: estimatedWeightKg,
        destination: formatCustomerSummary(inv.customer) || undefined,
      });
      setShowTripPicker(false);
      setOkBanner(`Drop added to trip ${tripNo}.`);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Ecommerce orders ship via courier (mock ShiprocketAdapter +
  // catalogue) instead of in-house trips. The CourierPicker collects
  // a courier code + optional AWB and we POST it to the slip. The
  // server stamps carrier / awb / trackingUrl / dispatchedAt and
  // returns the updated slip; we just refresh the invoice detail.
  const onAssignCourier = async (assignment: { courier: string; awb: string }) => {
    if (!inv?.packingSlipId) return;
    setBusy("courier");
    try {
      await api.assignCourier(inv.packingSlipId, {
        courier: assignment.courier,
        awb: assignment.awb || undefined,
      });
      setShowCourierPicker(false);
      setOkBanner("Courier assigned.");
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Mark the courier-handed package delivered. Mirrors confirmDispatch
  // for trip-based dispatches - sets deliveredAt on the slip and the
  // UI flips the strip from "in transit" to "delivered" with a date.
  const onConfirmCourierDelivery = async () => {
    if (!inv?.packingSlipId) return;
    setBusy("delivery");
    try {
      await api.confirmCourierDelivery(inv.packingSlipId);
      setOkBanner("Delivery confirmed - order complete.");
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
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
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Tax invoice
            </div>
            <div className="text-h3 font-bold flex items-center gap-2">
              {inv?.invoiceNo ?? "…"}
              {inv && (
                <Chip size="sm" tone={statusTone(inv.status)} className="capitalize">
                  {inv.status}
                </Chip>
              )}
              {inv?.salesOrder && (
                <Chip size="sm" tone="info">
                  from {inv.salesOrder.soNo}
                </Chip>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {inv && (
              <ShareDocumentMenu
                size="sm"
                descriptor={{
                  kind: "invoice",
                  id: inv.id,
                  docNo: inv.invoiceNo,
                  shareToken: inv.shareToken ?? null,
                  customerName: inv.customer.name,
                  customerContact: inv.customer.contact ?? null,
                  total: inv.amount,
                  contextLine: `Payment mode: ${inv.paymentMode}\nIssued: ${dt(inv.date)}`,
                  rotateToken: async (id) =>
                    (await api.rotateInvoiceShareToken(id)).shareToken,
                  onTokenChanged: (token) =>
                    setInv((cur) => (cur ? { ...cur, shareToken: token } : cur)),
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
        ) : error && !inv ? (
          <div className="flex-1 grid place-items-center text-danger">{error}</div>
        ) : inv ? (
          <>
            <div className="flex-1 overflow-y-auto">
              {okBanner && (
                <div className="px-4 py-2 bg-success-soft border-b border-success text-success text-body-sm flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  {okBanner}
                  <button
                    className="ml-auto underline"
                    onClick={() => setOkBanner(null)}
                  >
                    dismiss
                  </button>
                </div>
              )}
              {error && (
                <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">
                  {error}
                </div>
              )}

              <div className="p-5 space-y-5">
                {/* Header strip: customer + totals */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 border border-border rounded-md p-3">
                    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                      Bill to
                    </div>
                    <div className="text-body font-bold">{inv.customer.name}</div>
                    <div className="text-body-sm text-ink-muted whitespace-pre-line">
                      {formatCustomerAddress(inv.customer)}
                      {inv.customer.gst && (
                        <span className="block mt-1">GSTIN {inv.customer.gst}</span>
                      )}
                    </div>
                    <div className="text-caption text-ink-muted mt-1 space-x-3">
                      <span>Issued: <strong>{dt(inv.date)}</strong></span>
                      <span>Payment: <strong className="capitalize">{inv.paymentMode}</strong></span>
                    </div>
                  </div>
                  <div className="border border-border rounded-md p-3 text-right">
                    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                      Amount due
                    </div>
                    <div className="text-h2 font-bold tnum">{inr(inv.amount)}</div>
                    <div className="text-caption text-ink-muted">
                      incl. tax {inr(inv.tax)}
                    </div>
                    {inv.totalWeightKg != null && inv.totalWeightKg > 0 && (
                      <div className="text-caption text-ink-muted mt-1">
                        Est. weight {fmtKg(inv.totalWeightKg)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Linked source documents */}
                {(inv.salesOrder || inv.packingSlip) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {inv.salesOrder && (
                      <button
                        onClick={() => navigate(`/sales-orders?focus=${inv.salesOrderId}`)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded-md hover:bg-canvas text-body-sm"
                      >
                        <ExternalLink size={12} />
                        SO {inv.salesOrder.soNo}
                      </button>
                    )}
                    {inv.packingSlip && (
                      <button
                        onClick={() => navigate(`/packing?focus=${inv.packingSlipId}`)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded-md hover:bg-canvas text-body-sm"
                      >
                        <ExternalLink size={12} />
                        Packing slip {inv.packingSlip.packingSlipNo}
                      </button>
                    )}
                  </div>
                )}

                {/* Line items */}
                <div>
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-2">
                    Line items
                  </div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <div className="grid grid-cols-12 grid-header-cell text-caption">
                      <div className="col-span-6">Item</div>
                      <div className="col-span-2 text-right">Qty</div>
                      <div className="col-span-2 text-right">Rate (excl.)</div>
                      <div className="col-span-2 text-right">Taxable</div>
                    </div>
                    {inv.items.map((it) => (
                      <div
                        key={it.id}
                        className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm"
                      >
                        <div className="col-span-6">
                          <div className="font-semibold">{it.product.name}</div>
                          <div className="text-caption text-ink-muted font-mono">
                            {it.variant
                              ? primaryScanCode(it.variant)
                              : primaryScanCode(it.product)}
                            {it.variant &&
                              (it.variant.size || it.variant.color || it.variant.grade) && (
                                <span className="ml-2">
                                  ·{" "}
                                  {[
                                    it.variant.size,
                                    it.variant.color,
                                    it.variant.grade,
                                  ]
                                    .filter(Boolean)
                                    .join(" / ")}
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="col-span-2 text-right tnum">
                          {it.qty}{" "}
                          <span className="text-ink-muted text-caption">
                            {effectiveUom(it.product, it.variant)}
                          </span>
                        </div>
                        <div className="col-span-2 text-right tnum">{inr(it.rate)}</div>
                        <div className="col-span-2 text-right tnum font-semibold">
                          {inr(it.taxableValue ?? it.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(inv.taxKind || inv.placeOfSupplyState) && (
                    <div className="text-caption text-ink-muted mt-2">
                      Place of supply: {inv.placeOfSupplyState ?? "—"} ·{" "}
                      {inv.taxKind === "inter" ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}
                    </div>
                  )}
                  <div className="flex justify-end mt-3">
                    <div className="w-72">
                      <BillingTotalsBreakdown
                        totals={billingTotals}
                        totalLabel="Total due"
                      />
                    </div>
                  </div>
                </div>

                {/* Shipping section. We split the UI two ways based on
                    where the invoice originated:
                      - Storefront / ecommerce (SO.source === "ecommerce"):
                        the order has already been handed off to the
                        courier via the mock ShiprocketAdapter at
                        pack-complete. There is no in-house Trip to
                        assign - the operator just sees the AWB and
                        carrier. Hiding the Assign-to-trip button
                        prevents accidental double-shipments.
                      - Back-office / B2B: route through Trips as before
                        (TripPicker drawer, dispatch table, mark-loaded
                        / mark-delivered actions). */}
                {inv.salesOrder?.source === "ecommerce" || inv.packingSlip?.awb ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-caption text-ink-muted uppercase font-semibold flex items-center gap-1.5">
                        <PackageCheck size={12} /> Courier dispatch
                      </div>
                      <Button
                        size="sm"
                        icon={<Truck size={14} />}
                        onClick={() => setShowCourierPicker(true)}
                        disabled={busy === "courier"}
                      >
                        {busy === "courier"
                          ? "Assigning…"
                          : inv.packingSlip?.awb
                            ? "Re-assign courier"
                            : "Assign to courier"}
                      </Button>
                    </div>
                    {!inv.packingSlip?.awb ? (
                      <div className="border border-dashed border-border rounded-md p-4 text-center text-body-sm text-ink-muted">
                        No courier assigned yet. Click <strong>Assign to courier</strong> to
                        hand this order off to Shiprocket / Blue Dart / Delhivery / DTDC.
                      </div>
                    ) : (
                      <div className="border border-border rounded-md overflow-hidden">
                        <div className="grid grid-cols-12 grid-header-cell text-caption">
                          <div className="col-span-3">Status</div>
                          <div className="col-span-3">Carrier</div>
                          <div className="col-span-3">AWB</div>
                          <div className="col-span-3 text-right">Action</div>
                        </div>
                        <div className="grid grid-cols-12 grid-cell items-center !py-3 text-body-sm">
                          <div className="col-span-3">
                            {inv.packingSlip.deliveredAt ? (
                              <Chip size="sm" tone="success" className="capitalize">
                                Delivered
                              </Chip>
                            ) : inv.packingSlip.dispatchedAt ? (
                              <Chip size="sm" tone="primary" className="capitalize">
                                In transit
                              </Chip>
                            ) : (
                              <Chip size="sm" tone="neutral" className="capitalize">
                                Awaiting handoff
                              </Chip>
                            )}
                            {inv.packingSlip.dispatchedAt && (
                              <div className="text-caption text-ink-muted mt-1">
                                Picked up {dt(inv.packingSlip.dispatchedAt)}
                              </div>
                            )}
                            {inv.packingSlip.deliveredAt && (
                              <div className="text-caption text-success mt-1">
                                {dt(inv.packingSlip.deliveredAt)}
                              </div>
                            )}
                          </div>
                          <div className="col-span-3">
                            <div className="font-semibold">
                              {inv.packingSlip.carrier ?? "—"}
                            </div>
                            <div className="text-caption text-ink-muted">
                              Ecommerce courier
                            </div>
                          </div>
                          <div className="col-span-3">
                            {inv.packingSlip.trackingUrl ? (
                              <a
                                href={inv.packingSlip.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-caption font-semibold text-primary hover:underline inline-flex items-center gap-1"
                              >
                                {inv.packingSlip.awb}
                                <ExternalLink size={11} />
                              </a>
                            ) : (
                              <div className="font-mono text-caption font-semibold">
                                {inv.packingSlip.awb}
                              </div>
                            )}
                          </div>
                          <div className="col-span-3 text-right">
                            {inv.packingSlip.deliveredAt ? (
                              <span className="text-success text-caption">
                                <CheckCircle2
                                  size={12}
                                  className="inline -mt-0.5 mr-1"
                                />
                                {dt(inv.packingSlip.deliveredAt)}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={onConfirmCourierDelivery}
                                disabled={busy === "delivery"}
                              >
                                {busy === "delivery"
                                  ? "Confirming…"
                                  : "Confirm delivery"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-caption text-ink-muted uppercase font-semibold flex items-center gap-1.5">
                      <Truck size={12} /> Trip assignments
                    </div>
                    <Button
                      size="sm"
                      icon={<CalendarClock size={14} />}
                      onClick={() => setShowTripPicker(true)}
                      disabled={inv.status === "draft" || busy === "assign"}
                    >
                      {busy === "assign" ? "Assigning…" : "Assign to trip"}
                    </Button>
                  </div>
                  {inv.dispatches.length === 0 ? (
                    <div className="border border-dashed border-border rounded-md p-4 text-center text-body-sm text-ink-muted">
                      Not on any trip yet. Click <strong>Assign to trip</strong>{" "}
                      to drop this invoice on a scheduled run.
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden">
                      <div className="grid grid-cols-12 grid-header-cell text-caption">
                        <div className="col-span-3">Drop</div>
                        <div className="col-span-3">Trip</div>
                        <div className="col-span-2">Vehicle / Driver</div>
                        <div className="col-span-2">Destination</div>
                        <div className="col-span-2 text-right">Action</div>
                      </div>
                      {inv.dispatches.map((d) => {
                        const vehicle = d.trip?.vehicle ?? d.vehicle ?? "—";
                        const driver = d.trip?.driver ?? d.driver ?? "—";
                        return (
                          <div
                            key={d.id}
                            className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm"
                          >
                            <div className="col-span-3 flex items-center gap-2">
                              <span className="font-mono text-caption font-semibold text-primary">
                                {d.dispatchNo}
                              </span>
                              <Chip size="sm" tone={dispatchTone(d.status)} className="capitalize">
                                {d.status}
                              </Chip>
                            </div>
                            <div className="col-span-3">
                              {d.trip ? (
                                <>
                                  <div className="font-mono text-caption font-semibold">
                                    {d.trip.tripNo}
                                  </div>
                                  <div className="text-caption text-ink-muted">
                                    {dt(d.trip.scheduledDate)}
                                    {d.trip.route ? ` · ${d.trip.route}` : ""}
                                  </div>
                                </>
                              ) : (
                                <span className="text-caption text-ink-muted">
                                  Direct dispatch
                                </span>
                              )}
                            </div>
                            <div className="col-span-2">
                              <div className="font-mono text-caption">{vehicle}</div>
                              <div className="text-caption text-ink-muted">{driver}</div>
                            </div>
                            <div className="col-span-2 text-body-sm">
                              {d.destination ?? "—"}
                              <div className="text-caption text-ink-muted tnum">
                                {d.weightKg > 0 ? `${d.weightKg} kg` : ""}
                              </div>
                            </div>
                            <div className="col-span-2 text-right">
                              {d.status === "delivered" ? (
                                <span className="text-success text-caption">
                                  ✓ {d.signedAt ? dt(d.signedAt) : "delivered"}
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onConfirmDispatch(d.id)}
                                  disabled={busy === d.id}
                                >
                                  {busy === d.id ? "Working…" : "Confirm delivery"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}

                {inv.notes && (
                  <div>
                    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                      Notes
                    </div>
                    <div className="text-body-sm whitespace-pre-line">{inv.notes}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-border p-3 flex items-center gap-2 justify-end bg-canvas">
              <Button
                variant="ghost"
                size="sm"
                icon={<Receipt size={14} />}
                onClick={() => window.open(`${window.location.origin}/share/invoice/${inv.shareToken ?? ""}?print=1`)}
                disabled={!inv.shareToken}
              >
                Print
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                icon={<CalendarClock size={14} />}
                onClick={() => setShowTripPicker(true)}
                disabled={inv.status === "draft" || busy === "assign"}
              >
                Assign to trip
              </Button>
            </div>
          </>
        ) : null}

        {showTripPicker && inv && (
          <TripPicker
            onClose={() => setShowTripPicker(false)}
            onPick={(trip) => void onAssignToTrip(trip.id, trip.tripNo)}
          />
        )}
        {showCourierPicker && inv && (
          <CourierPicker
            initialCourier={inv.packingSlip?.carrier ?? null}
            initialAwb={inv.packingSlip?.awb ?? null}
            reassign={!!inv.packingSlip?.awb}
            onClose={() => setShowCourierPicker(false)}
            onAssigned={(a) => void onAssignCourier(a)}
          />
        )}
      </div>
    </div>
  );
};
