// Overview tab: hero greeting + 3 stat cards + active-order callout
// (whichever order is most recent and not yet delivered).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/state/AuthContext";
import { useWishlist } from "@/state/WishlistContext";
import { ApiError, api, type CustomerOrderRow } from "@/lib/api";
import { dateLong, inr } from "@/lib/format";

export const AccountOverview = () => {
  const auth = useAuth();
  const wishlist = useWishlist();
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.isAuthed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .myOrders()
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
  }, [auth.isAuthed]);

  const activeOrder = orders.find(
    (o) => !o.packingSlip?.deliveredAt && o.status !== "cancelled"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div className="card-soft">
        <h2
          className="serif-title"
          style={{ fontSize: "1.6rem", color: "var(--forest-green-dark)", marginBottom: "0.4rem" }}
        >
          Namaste, {auth.customer?.name.split(" ")[0] ?? auth.user?.name.split(" ")[0]}!
        </h2>
        <p className="muted">
          Glad to have you back. Here's a quick look at your activity.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
        }}
      >
        <StatCard
          label="Total Orders"
          value={loading ? "…" : String(orders.length)}
          color="var(--forest-green)"
        />
        <StatCard
          label="Wishlist"
          value={String(wishlist.count)}
          color="var(--color-error)"
        />
        <StatCard
          label="Patron"
          value="★ ★ ★"
          color="var(--primary-gold-dark)"
        />
      </div>

      {error && (
        <div className="card-soft" style={{ color: "var(--color-error)", background: "#fef2f2" }}>
          {error}
        </div>
      )}

      {activeOrder && (
        <div
          className="card-soft"
          style={{
            background: "var(--forest-green-soft)",
            borderColor: "var(--forest-green)",
            borderStyle: "dashed",
          }}
        >
          <div style={{ fontSize: "0.78rem", color: "var(--forest-green)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
            Active order
          </div>
          <strong style={{ display: "block", fontSize: "1.05rem", marginTop: "0.4rem" }}>
            {activeOrder.soNo} · {inr(activeOrder.total)}
          </strong>
          <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
            Placed {dateLong(activeOrder.createdAt)} · Status{" "}
            <strong style={{ color: "var(--forest-green)" }}>
              {activeOrder.packingSlip
                ? activeOrder.packingSlip.deliveredAt
                  ? "Delivered"
                  : activeOrder.packingSlip.dispatchedAt
                  ? "Dispatched"
                  : activeOrder.packingSlip.status
                : activeOrder.status}
            </strong>
          </div>
          <Link
            to="/account/orders"
            className="btn btn-green"
            style={{ marginTop: "0.75rem", display: "inline-flex" }}
          >
            View all orders
          </Link>
        </div>
      )}
    </div>
  );
};

const StatCard = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) => (
  <div className="card-soft" style={{ textAlign: "center" }}>
    <div style={{ fontSize: "1.6rem", fontWeight: 700, color }}>{value}</div>
    <div style={{ fontSize: "0.78rem", color: "var(--neutral-gray)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
      {label}
    </div>
  </div>
);
