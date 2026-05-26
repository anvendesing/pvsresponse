// Multi-step checkout: shipping -> payment -> review/place. The
// payment step is purely cosmetic (we always submit through the
// /storefront-mock/order endpoint which doesn't actually charge a
// card). On success the customer lands on the order success page.
//
// We pre-fill the shipping form from the dummy auth context if the
// customer is "logged in", and persist any free-form notes the
// customer typed on the cart page so we don't drop them.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api, type PlaceOrderResult } from "@/lib/api";
import { useCart, lineKeyFor } from "@/state/CartContext";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { inr } from "@/lib/format";
import { CheckIcon } from "@/assets/icons";

const SHIPPING_THRESHOLD = 3000;

interface ShippingForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  pincode: string;
  city: string;
  state: string;
  delivery: "standard" | "express";
}

const FRESH: ShippingForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  pincode: "",
  city: "",
  state: "",
  delivery: "standard",
};

type PayMethod = "card" | "upi" | "net" | "cod";

export const CheckoutPage = () => {
  const cart = useCart();
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [shipping, setShipping] = useState<ShippingForm>(() => ({
    ...FRESH,
    name: auth.user?.name ?? "",
    email: auth.user?.email ?? "",
    phone: auth.user?.phone ?? "",
  }));
  const [payment, setPayment] = useState<PayMethod>("card");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [notes] = useState<string>(() => {
    try {
      return window.localStorage.getItem("pv_cart_notes") ?? "";
    } catch {
      return "";
    }
  });

  // Customers should not land on /checkout with an empty cart; bounce
  // them back to the cart page in that case (unless we just placed
  // the order, which clears the cart).
  useEffect(() => {
    if (cart.lines.length === 0) {
      navigate("/cart", { replace: true });
    }
  }, [cart.lines.length, navigate]);

  const subTotal = cart.subTotal;
  const tax = Math.round(subTotal * 0.18);
  const shippingFee = useMemo(() => {
    if (shipping.delivery === "express") return 150;
    return subTotal >= SHIPPING_THRESHOLD ? 0 : 99;
  }, [shipping.delivery, subTotal]);
  const total = subTotal + tax + shippingFee;

  const setShip = <K extends keyof ShippingForm>(k: K, v: ShippingForm[K]) =>
    setShipping((prev) => ({ ...prev, [k]: v }));

  const submitShipping = (e: FormEvent) => {
    e.preventDefault();
    setStep(2);
  };

  const submitPayment = () => {
    setStep(3);
  };

  const placeOrder = async () => {
    setErrMsg(null);
    setBusy(true);
    try {
      const result: PlaceOrderResult = await api.placeOrder({
        name: shipping.name,
        email: shipping.email,
        phone: shipping.phone,
        city: shipping.city,
        notes:
          [
            notes.trim(),
            `Address: ${shipping.address}, ${shipping.city}, ${shipping.state} ${shipping.pincode}`,
            `Delivery: ${shipping.delivery}`,
            `Payment: ${labelForPayment(payment)}`,
          ]
            .filter(Boolean)
            .join(" | "),
        items: cart.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
        })),
      });
      try {
        window.localStorage.setItem(
          `pv_order_${result.salesOrder.soNo}`,
          JSON.stringify(result)
        );
        window.localStorage.removeItem("pv_cart_notes");
      } catch {
        /* noop */
      }
      cart.clear();
      toast.show("Order placed successfully!", "success");
      navigate(`/order/${result.salesOrder.soNo}`, {
        replace: true,
        state: { result },
      });
    } catch (e) {
      setErrMsg(
        e instanceof ApiError
          ? e.message
          : (e as Error).message ?? "Could not place order."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "2.5rem 5%", background: "var(--neutral-light)", minHeight: "70vh" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1
          className="serif-title"
          style={{
            fontSize: "2rem",
            color: "var(--forest-green-dark)",
            marginBottom: "0.4rem",
          }}
        >
          Checkout
        </h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          Just three quick steps to delivery.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 380px",
            gap: "2rem",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <StepCard
              num={1}
              title="Shipping & Delivery"
              status={step > 1 ? "done" : step === 1 ? "active" : "pending"}
              onEdit={step > 1 ? () => setStep(1) : undefined}
            >
              {step === 1 ? (
                <form onSubmit={submitShipping} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  <div className="form-grid">
                    <FieldText
                      label="Full name"
                      required
                      value={shipping.name}
                      onChange={(v) => setShip("name", v)}
                    />
                    <FieldText
                      label="Phone"
                      required
                      pattern="[0-9]{10}"
                      value={shipping.phone}
                      onChange={(v) => setShip("phone", v)}
                    />
                  </div>
                  <FieldText
                    label="Email"
                    type="email"
                    required
                    value={shipping.email}
                    onChange={(v) => setShip("email", v)}
                  />
                  <FieldText
                    label="Address line"
                    required
                    value={shipping.address}
                    onChange={(v) => setShip("address", v)}
                  />
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <FieldText
                      label="Pincode"
                      required
                      pattern="[0-9]{6}"
                      value={shipping.pincode}
                      onChange={(v) => setShip("pincode", v)}
                    />
                    <FieldText
                      label="City"
                      required
                      value={shipping.city}
                      onChange={(v) => setShip("city", v)}
                    />
                    <FieldText
                      label="State"
                      required
                      value={shipping.state}
                      onChange={(v) => setShip("state", v)}
                    />
                  </div>

                  <div style={{ marginTop: "0.5rem" }}>
                    <strong style={{ fontSize: "0.85rem" }}>Delivery method</strong>
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem", gridTemplateColumns: "1fr 1fr" }}>
                      <DeliveryCard
                        active={shipping.delivery === "standard"}
                        title="Standard (3-5 days)"
                        sub={subTotal >= SHIPPING_THRESHOLD ? "FREE" : inr(99)}
                        onClick={() => setShip("delivery", "standard")}
                      />
                      <DeliveryCard
                        active={shipping.delivery === "express"}
                        title="Express (1-2 days)"
                        sub={inr(150)}
                        onClick={() => setShip("delivery", "express")}
                      />
                    </div>
                  </div>

                  <button type="submit" className="btn btn-green" style={{ alignSelf: "flex-end", marginTop: "0.5rem" }}>
                    Continue to Payment
                  </button>
                </form>
              ) : (
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  {shipping.name} · {shipping.address}, {shipping.city}, {shipping.state} {shipping.pincode}
                </p>
              )}
            </StepCard>

            <StepCard
              num={2}
              title="Payment Method"
              status={step > 2 ? "done" : step === 2 ? "active" : "pending"}
              onEdit={step > 2 ? () => setStep(2) : undefined}
            >
              {step >= 2 && (
                <>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                    <PayPill active={payment === "card"} onClick={() => setPayment("card")}>
                      Card
                    </PayPill>
                    <PayPill active={payment === "upi"} onClick={() => setPayment("upi")}>
                      UPI
                    </PayPill>
                    <PayPill active={payment === "net"} onClick={() => setPayment("net")}>
                      Net Banking
                    </PayPill>
                    <PayPill active={payment === "cod"} onClick={() => setPayment("cod")}>
                      COD
                    </PayPill>
                  </div>
                  {step === 2 && (
                    <>
                      <div className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
                        This is a demo storefront - no card is actually charged. We'll mark the order paid and route it through the warehouse pipeline.
                      </div>
                      <button type="button" className="btn btn-green" onClick={submitPayment}>
                        Continue to Review
                      </button>
                    </>
                  )}
                  {step === 3 && (
                    <p className="muted" style={{ fontSize: "0.85rem" }}>
                      Pay via <strong>{labelForPayment(payment)}</strong>.
                    </p>
                  )}
                </>
              )}
            </StepCard>

            <StepCard
              num={3}
              title="Review & Place Order"
              status={step === 3 ? "active" : "pending"}
            >
              {step === 3 && (
                <>
                  {errMsg && (
                    <div
                      style={{
                        padding: "0.75rem 1rem",
                        background: "#fef2f2",
                        color: "var(--color-error)",
                        borderRadius: "var(--radius-sm)",
                        marginBottom: "1rem",
                        fontSize: "0.88rem",
                      }}
                    >
                      {errMsg}
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                      maxHeight: 240,
                      overflowY: "auto",
                      paddingRight: "0.5rem",
                    }}
                  >
                    {cart.lines.map((l) => (
                      <div
                        key={lineKeyFor(l)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.85rem",
                          padding: "0.45rem 0",
                          borderBottom: "1px solid rgba(34,37,31,0.06)",
                        }}
                      >
                        <span>
                          {l.productName}{" "}
                          <span className="muted">× {l.qty}</span>
                        </span>
                        <strong className="tnum">{inr(l.qty * l.rate)}</strong>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-green btn-block"
                    style={{ marginTop: "1.25rem" }}
                    onClick={placeOrder}
                    disabled={busy}
                  >
                    {busy ? "Placing order…" : `Place order · ${inr(total)}`}
                  </button>
                </>
              )}
            </StepCard>
          </div>

          <aside className="card-soft" style={{ alignSelf: "start", position: "sticky", top: "1.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Order summary</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {cart.lines.map((l) => (
                <div
                  key={lineKeyFor(l)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.85rem",
                  }}
                >
                  <span style={{ color: "var(--neutral-gray)" }}>
                    {l.productName} × {l.qty}
                  </span>
                  <span className="tnum">{inr(l.qty * l.rate)}</span>
                </div>
              ))}
            </div>
            <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)" }} />
            <Row label="Subtotal" value={inr(subTotal)} />
            <Row
              label="Shipping"
              value={shippingFee === 0 ? "FREE" : inr(shippingFee)}
            />
            <Row label="GST (18%)" value={inr(tax)} />
            <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)", margin: "0.4rem 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 700 }}>
              <span>Payable</span>
              <span style={{ color: "var(--forest-green)" }} className="tnum">
                {inr(total)}
              </span>
            </div>
            <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--neutral-gray)", textAlign: "center" }}>
              Test storefront. No actual payment is processed.
            </p>
            <Link
              to="/cart"
              style={{
                display: "block",
                textAlign: "center",
                fontSize: "0.85rem",
                color: "var(--forest-green)",
                marginTop: "0.6rem",
              }}
            >
              ← Edit cart
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
};

// =====================================================================
// Sub-components.
// =====================================================================

const StepCard = ({
  num,
  title,
  status,
  onEdit,
  children,
}: {
  num: number;
  title: string;
  status: "active" | "done" | "pending";
  onEdit?: () => void;
  children: React.ReactNode;
}) => (
  <div
    className="card-soft"
    style={{
      borderLeft: `4px solid ${
        status === "active"
          ? "var(--primary-gold)"
          : status === "done"
          ? "var(--forest-green)"
          : "rgba(34,37,31,0.08)"
      }`,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
      <strong style={{ fontSize: "1rem" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: "var(--radius-full)",
            background:
              status === "done"
                ? "var(--forest-green)"
                : status === "active"
                ? "var(--primary-gold)"
                : "rgba(34,37,31,0.1)",
            color: status === "done" ? "var(--neutral-white)" : "var(--neutral-dark)",
            fontSize: "0.78rem",
            marginRight: "0.6rem",
          }}
        >
          {status === "done" ? <CheckIcon /> : num}
        </span>
        {title}
      </strong>
      {onEdit && (
        <button type="button" onClick={onEdit} className="text-link">
          edit
        </button>
      )}
    </div>
    {status !== "pending" && children}
    {status === "pending" && (
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Complete the previous step first.
      </p>
    )}
  </div>
);

const FieldText = ({
  label,
  value,
  onChange,
  required,
  type = "text",
  pattern,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  pattern?: string;
}) => (
  <div className="float-field">
    <input
      type={type}
      placeholder=" "
      required={required}
      pattern={pattern}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    <label>
      {label}
      {required && " *"}
    </label>
  </div>
);

const DeliveryCard = ({
  active,
  title,
  sub,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      textAlign: "left",
      padding: "0.85rem 1rem",
      border: `2px solid ${active ? "var(--forest-green)" : "rgba(34,37,31,0.1)"}`,
      borderRadius: "var(--radius-sm)",
      background: active ? "var(--forest-green-soft)" : "var(--neutral-white)",
      display: "flex",
      flexDirection: "column",
      gap: "0.3rem",
    }}
  >
    <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
    <span
      style={{
        fontSize: "0.85rem",
        color: active ? "var(--forest-green)" : "var(--neutral-gray)",
        fontWeight: 600,
      }}
    >
      {sub}
    </span>
  </button>
);

const PayPill = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: "0.5rem 1rem",
      borderRadius: "var(--radius-full)",
      border: `2px solid ${active ? "var(--forest-green)" : "rgba(34,37,31,0.1)"}`,
      background: active ? "var(--forest-green-soft)" : "var(--neutral-white)",
      color: active ? "var(--forest-green)" : "var(--neutral-dark)",
      fontWeight: 600,
      fontSize: "0.85rem",
    }}
  >
    {children}
  </button>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      fontSize: "0.88rem",
      padding: "0.25rem 0",
      color: "var(--neutral-gray)",
    }}
  >
    <span>{label}</span>
    <span className="tnum">{value}</span>
  </div>
);

const labelForPayment = (m: PayMethod): string => {
  switch (m) {
    case "card":
      return "Credit / Debit Card";
    case "upi":
      return "UPI";
    case "net":
      return "Net Banking";
    case "cod":
      return "Cash on Delivery";
  }
};
