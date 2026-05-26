// Order history table for the logged-in customer. Pulls
// /storefront-mock/orders?email=<x> and renders each order as a row
// with a derived status label. Clicking a row jumps to the success
// page which can serve as an order detail view.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, type CustomerOrderRow } from "@/lib/api";
import { useAuth } from "@/state/AuthContext";
import { dateLong, inr } from "@/lib/format";

const labelFor = (o: CustomerOrderRow): { text: string; color: string } => {
  if (o.status === "cancelled") return { text: "Cancelled", color: "var(--color-error)" };
  if (o.packingSlip?.deliveredAt)
    return { text: "Delivered", color: "var(--forest-green)" };
  if (o.packingSlip?.dispatchedAt)
    return { text: "Dispatched", color: "var(--primary-gold-dark)" };
  if (o.packingSlip?.status === "packed")
    return { text: "Packed", color: "var(--primary-gold-dark)" };
  if (o.invoiceStatus === "paid")
    return { text: "Confirmed", color: "var(--forest-green)" };
  return { text: o.status, color: "var(--neutral-gray)" };
};

export const AccountOrders = () => {
  const auth = useAuth();
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.user?.email) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .ordersByEmail(auth.user.email)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof ApiError
            ? e.message
            : (e as Error).message ?? "Could not load orders."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.email]);

  return (
    <div className="card-soft">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.2rem" }}>My Orders</h2>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {orders.length} {orders.length === 1 ? "order" : "orders"}
        </span>
      </div>

      {error && (
        <div style={{ color: "var(--color-error)", background: "#fef2f2", padding: "0.75rem", borderRadius: "var(--radius-sm)", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <p className="muted" style={{ marginBottom: "0.85rem" }}>
            You haven't placed any orders yet.
          </p>
          <Link to="/" className="btn btn-green">
            Browse the store
          </Link>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--neutral-gray)", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.08em" }}>
                <th style={{ padding: "0.75rem 0.5rem" }}>Order</th>
                <th style={{ padding: "0.75rem 0.5rem" }}>Placed</th>
                <th style={{ padding: "0.75rem 0.5rem" }}>Items</th>
                <th style={{ padding: "0.75rem 0.5rem" }}>Total</th>
                <th style={{ padding: "0.75rem 0.5rem" }}>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const { text, color } = labelFor(o);
                return (
                  <tr
                    key={o.id}
                    style={{ borderTop: "1px solid rgba(34,37,31,0.06)" }}
                  >
                    <td style={{ padding: "0.85rem 0.5rem", fontWeight: 600 }}>
                      {o.soNo}
                      {o.invoiceNo && (
                        <div style={{ fontSize: "0.75rem", color: "var(--neutral-gray)", fontWeight: 400 }}>
                          {o.invoiceNo}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.85rem 0.5rem", color: "var(--neutral-gray)" }}>
                      {dateLong(o.createdAt)}
                    </td>
                    <td style={{ padding: "0.85rem 0.5rem", color: "var(--neutral-gray)" }}>
                      {o.itemCount}
                    </td>
                    <td style={{ padding: "0.85rem 0.5rem", fontWeight: 700 }} className="tnum">
                      {inr(o.total)}
                    </td>
                    <td style={{ padding: "0.85rem 0.5rem" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.25rem 0.6rem",
                          borderRadius: "var(--radius-full)",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color,
                          background: `${color}15`,
                        }}
                      >
                        {text}
                      </span>
                    </td>
                    <td style={{ padding: "0.85rem 0.5rem", textAlign: "right" }}>
                      <Link
                        to={`/order/${o.soNo}`}
                        style={{ color: "var(--forest-green)", fontSize: "0.85rem", fontWeight: 600 }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
