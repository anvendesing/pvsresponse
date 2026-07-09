import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type CustomerOrderRow, type StoredOrderResult } from "@/lib/api";
import { promotePayuPendingOrder } from "@/lib/checkoutSnapshot";
import { track } from "@/lib/activity";
import { OrderTimeline } from "@/components/OrderTimeline";
import { OrderItemsList } from "@/components/OrderItemsList";
import { useAuth } from "@/state/AuthContext";
import { useCart } from "@/state/CartContext";
import { useToast } from "@/state/ToastContext";
import { CheckIcon } from "@/assets/icons";
import { inr } from "@/lib/format";

export const OrderSuccessPage = () => {
  const { soNo = "" } = useParams<{ soNo: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const cart = useCart();
  const toast = useToast();
  const [order, setOrder] = useState<StoredOrderResult | null>(() => {
    try {
      const raw = window.localStorage.getItem(`pv_order_${soNo}`);
      return raw ? (JSON.parse(raw) as StoredOrderResult) : null;
    } catch {
      return null;
    }
  });
  const [liveRow, setLiveRow] = useState<CustomerOrderRow | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    if (searchParams.get("paid") !== "1") return;
    cart.clear();
    try {
      window.localStorage.removeItem("pv_cart_notes");
    } catch {
      /* noop */
    }
    const promoted = promotePayuPendingOrder(soNo);
    if (promoted) setOrder(promoted);
    track("place_order", { meta: { soNo } });
    toast.show("Payment successful — order placed!", "success");
    setSearchParams({}, { replace: true });
  }, [cart, searchParams, setSearchParams, soNo, toast]);

  useEffect(() => {
    if (!soNo || !auth.isAuthed) {
      setLoadingItems(false);
      return;
    }
    let cancelled = false;
    setLoadingItems(true);
    void api
      .myOrder(soNo)
      .then((row) => {
        if (!cancelled) setLiveRow(row);
      })
      .catch(() => {
        if (!cancelled) setLiveRow(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.isAuthed, soNo]);

  const packingSlip = liveRow?.packingSlip ?? null;
  const invoiceStatus = liveRow?.invoiceStatus ?? order?.invoice.status ?? null;
  const status = liveRow?.status ?? order?.salesOrder.status ?? "confirmed";
  const displaySoNo = liveRow?.soNo ?? order?.salesOrder.soNo ?? soNo;
  const displayTotal = liveRow?.total ?? order?.invoice.amount ?? null;
  const items = liveRow?.items ?? order?.itemsSnapshot ?? [];

  return (
    <div style={{ padding: "3rem 5%", background: "var(--neutral-light)", minHeight: "70vh" }}>
      <div className="card-soft" style={{ maxWidth: 760, margin: "0 auto", padding: "2.5rem" }}>
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
        <h1 className="serif-title" style={{ fontSize: "2.2rem", color: "var(--forest-green-dark)", marginBottom: "0.6rem" }}>
          Thank you, {order?.customer.name?.split(" ")[0] ?? auth.customer?.name?.split(" ")[0] ?? "friend"}!
        </h1>
        <p style={{ color: "var(--neutral-gray)", marginBottom: "1.75rem" }}>
          Your order <strong>{displaySoNo}</strong> has been placed and is now being prepared by our farm team.
        </p>

        {(order || liveRow) && (
          <div
            style={{
              padding: "1.25rem 1.5rem",
              background: "var(--neutral-cream)",
              borderRadius: "var(--radius-md)",
              fontSize: "0.9rem",
            }}
            className="form-grid-2"
          >
            <DocRow label="Sales order" value={displaySoNo} />
            <DocRow label="Invoice" value={liveRow?.invoiceNo ?? order?.invoice.invoiceNo ?? "—"} />
            <DocRow label="Status" value={`${status} · ${invoiceStatus ?? "paid"}`} />
            <DocRow label="Total paid" value={displayTotal != null ? inr(displayTotal) : "—"} />
          </div>
        )}

        <h2 style={{ marginTop: "2.25rem", marginBottom: "0.75rem" }}>Order items</h2>
        {loadingItems && auth.isAuthed ? (
          <p className="muted" style={{ fontSize: "0.9rem" }}>Loading items…</p>
        ) : items.length > 0 ? (
          <>
            <OrderItemsList items={items} total={displayTotal ?? undefined} />
            {!auth.isAuthed && (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
                <Link to="/login" className="text-link">Sign in</Link> with the same mobile number to save this order to your account history.
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: "0.9rem" }}>Line items are not available yet.</p>
        )}

        <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link to="/" className="btn btn-green">
            Continue shopping
          </Link>
          <Link to={auth.isAuthed ? "/account/orders" : "/track"} className="btn btn-outline">
            {auth.isAuthed ? "View all orders" : "Track this order"}
          </Link>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          {packingSlip?.trackingUrl && (
            <p style={{ marginBottom: "0.5rem", fontSize: "0.85rem", textAlign: "center" }}>
              <a href={packingSlip.trackingUrl} target="_blank" rel="noreferrer" className="text-link">
                Track shipment with courier →
              </a>
            </p>
          )}
          <OrderTimeline compact packingSlip={packingSlip} invoiceStatus={invoiceStatus} status={status} />
        </div>
      </div>
    </div>
  );
};

const DocRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--neutral-gray)" }}>
      {label}
    </div>
    <div className="tnum" style={{ fontWeight: 600 }}>
      {value}
    </div>
  </div>
);
