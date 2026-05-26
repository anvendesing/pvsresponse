// Order success page. Pulls the just-placed order from
// react-router's location state when arriving from checkout, falling
// back to localStorage if the customer reloads or shares the link.
// The tracking timeline reads off the regular order lifecycle, but
// since we don't actually progress the order on this page we mock
// the first two steps as completed/active.

import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { PlaceOrderResult } from "@/lib/api";
import { CheckIcon } from "@/assets/icons";
import { inr } from "@/lib/format";

interface LocState {
  result?: PlaceOrderResult;
}

export const OrderSuccessPage = () => {
  const { soNo = "" } = useParams<{ soNo: string }>();
  const loc = useLocation();
  const incoming = (loc.state as LocState | null)?.result ?? null;
  const [order, setOrder] = useState<PlaceOrderResult | null>(incoming);

  useEffect(() => {
    if (order) return;
    try {
      const raw = window.localStorage.getItem(`pv_order_${soNo}`);
      if (raw) setOrder(JSON.parse(raw) as PlaceOrderResult);
    } catch {
      /* noop */
    }
  }, [order, soNo]);

  return (
    <div style={{ padding: "3rem 5%", background: "var(--neutral-light)", minHeight: "70vh" }}>
      <div
        className="card-soft"
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "2.5rem",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: "var(--radius-full)",
            background: "var(--forest-green-soft)",
            color: "var(--forest-green)",
            marginBottom: "1.25rem",
          }}
        >
          <span style={{ fontSize: "1.6rem" }}>
            <CheckIcon />
          </span>
        </div>
        <h1
          className="serif-title"
          style={{ fontSize: "2.2rem", color: "var(--forest-green-dark)", marginBottom: "0.6rem" }}
        >
          Thank you, {order?.customer.name?.split(" ")[0] ?? "friend"}!
        </h1>
        <p style={{ color: "var(--neutral-gray)", marginBottom: "1.75rem" }}>
          Your order <strong>{order?.salesOrder.soNo ?? soNo}</strong> has been placed and is now being prepared by our farm team. A confirmation has been sent to your email.
        </p>

        {order && (
          <div
            style={{
              padding: "1.25rem 1.5rem",
              background: "var(--neutral-cream)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.9rem",
              display: "grid",
              gap: "0.5rem",
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <DocRow label="Sales order" value={order.salesOrder.soNo} />
            <DocRow label="Invoice" value={order.invoice.invoiceNo} />
            <DocRow label="Status" value={`${order.salesOrder.status} · ${order.invoice.status}`} />
            <DocRow label="Total paid" value={inr(order.invoice.amount)} />
            {"pickListNo" in order.pickList && (
              <DocRow label="Pick list" value={order.pickList.pickListNo} />
            )}
          </div>
        )}

        <h2 style={{ marginTop: "2.25rem", marginBottom: "0.4rem" }}>Tracking</h2>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          You'll receive an email and SMS as your order moves through each
          stage.
        </p>
        <ol className="tracking-timeline">
          <Step done label="Order Confirmed" sub="We received your order." />
          <Step active label="Packing" sub="Warehouse picking your items now." />
          <Step label="Dispatched" sub="Awaiting pickup by courier partner." />
          <Step label="Out for Delivery" sub="Courier on the last mile." />
          <Step label="Delivered" sub="Enjoy your harvest!" />
        </ol>

        <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link to="/" className="btn btn-green">
            Continue shopping
          </Link>
          <Link to="/account/orders" className="btn btn-outline">
            View all orders
          </Link>
        </div>
      </div>
    </div>
  );
};

const DocRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div
      style={{
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--neutral-gray)",
      }}
    >
      {label}
    </div>
    <div className="tnum" style={{ fontWeight: 600 }}>
      {value}
    </div>
  </div>
);

const Step = ({
  done,
  active,
  label,
  sub,
}: {
  done?: boolean;
  active?: boolean;
  label: string;
  sub: string;
}) => (
  <li className={`tracking-step ${done ? "completed" : ""} ${active ? "active" : ""}`}>
    <span className="dot" />
    <div>
      <strong>{label}</strong>
      <span>{sub}</span>
    </div>
  </li>
);
