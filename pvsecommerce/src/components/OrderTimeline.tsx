import type { CustomerOrderRow } from "@/lib/api";

export const OrderTimeline = ({
  packingSlip,
  invoiceStatus,
  status,
  compact = false,
}: {
  packingSlip: CustomerOrderRow["packingSlip"];
  invoiceStatus: string | null;
  status: string;
  /** Single-row stepper — labels only, no subtext. */
  compact?: boolean;
}) => {
  const confirmed = invoiceStatus === "paid" || status === "confirmed";
  const packed = packingSlip?.status === "packed" || Boolean(packingSlip?.awb);
  const dispatched = Boolean(packingSlip?.dispatchedAt);
  const delivered = Boolean(packingSlip?.deliveredAt);

  const steps = [
    {
      key: "confirmed",
      label: compact ? "Confirmed" : "Order Confirmed",
      sub: "We received your order.",
      done: confirmed,
      active: confirmed && !packed,
    },
    {
      key: "packed",
      label: "Packed",
      sub: packingSlip?.packingSlipNo
        ? `Pick list ${packingSlip.packingSlipNo}`
        : "Warehouse preparing your items.",
      done: packed,
      active: packed && !dispatched,
    },
    {
      key: "dispatched",
      label: "Dispatched",
      sub: packingSlip?.carrier
        ? `${packingSlip.carrier}${packingSlip.awb ? ` · AWB ${packingSlip.awb}` : ""}`
        : "Handed to courier.",
      done: dispatched,
      active: dispatched && !delivered,
    },
    {
      key: "delivered",
      label: "Delivered",
      sub: "Enjoy your harvest!",
      done: delivered,
      active: delivered,
    },
  ];

  return (
    <ol className={`tracking-timeline${compact ? " tracking-timeline--compact" : ""}`}>
      {steps.map((s, idx) => (
        <li
          key={s.key}
          className={`tracking-step ${s.done ? "completed" : ""} ${s.active ? "active" : ""}${idx < steps.length - 1 ? " has-connector" : ""}`}
        >
          <span className="dot" aria-hidden />
          <div className="tracking-step-text">
            <strong>{s.label}</strong>
            {!compact && <span>{s.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
};
