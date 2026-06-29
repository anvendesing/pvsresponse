// Standalone cart page (the slide-in drawer is great for "just
// added" but the dedicated page gives breathing room for editing
// quantities and adding order notes before checkout).

import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useCart, lineKeyFor } from "@/state/CartContext";
import { lineBarcode } from "@/lib/scanCode";
import { useToast } from "@/state/ToastContext";
import { usePlatform } from "@/state/PlatformContext";
import { inr, cartLineDescription } from "@/lib/format";
import { TrashIcon } from "@/assets/icons";
import { PackagingArt } from "@/components/PackagingArt";

const SHIPPING_THRESHOLD = 3000;

export const CartPage = () => {
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const { isPhone } = usePlatform();

  const [notes, setNotes] = useState("");
  const [promo, setPromo] = useState("");
  const [promoMsg, setPromoMsg] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  const subTotal = cart.subTotal;
  const shipping = subTotal >= SHIPPING_THRESHOLD || subTotal === 0 ? 0 : 99;
  const tax = Math.round(subTotal * 0.18);
  const total = subTotal + tax + shipping;

  const applyPromo = () => {
    const code = promo.trim().toUpperCase();
    if (!code) return;
    if (code === "ORGANIC10") {
      setPromoMsg({ text: "Promo applied at checkout.", ok: true });
    } else {
      setPromoMsg({ text: "Code not recognised.", ok: false });
    }
  };

  const goCheckout = () => {
    if (cart.lines.length === 0) {
      toast.show("Your cart is empty.", "error");
      return;
    }
    if (notes.trim()) {
      try {
        window.localStorage.setItem("pv_cart_notes", notes.trim());
      } catch {
        /* noop */
      }
    }
    navigate("/checkout");
  };

  return (
    <div style={{ padding: "2.5rem 5%", background: "var(--neutral-light)", minHeight: "60vh" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1
          className="serif-title"
          style={{
            fontSize: "2rem",
            color: "var(--forest-green-dark)",
            marginBottom: "1.5rem",
          }}
        >
          Your Cart
        </h1>

        <div
          style={{
            display: "grid",
            gap: "2rem",
            gridTemplateColumns: cart.lines.length === 0 ? "1fr" : "minmax(0, 1fr) 380px",
          }}
        >
          <div>
            {cart.lines.length === 0 ? (
              <div className="card-soft" style={{ textAlign: "center", padding: "3rem" }}>
                <p style={{ marginBottom: "1rem", color: "var(--neutral-gray)" }}>
                  Your cart is empty. Browse our farm-fresh range to get started.
                </p>
                <Link to="/" className="btn btn-green">
                  Continue shopping
                </Link>
              </div>
            ) : (
              <>
                <div className="card-soft" style={{ padding: 0 }}>
                  {cart.lines.map((l) => {
                    const key = lineKeyFor(l);
                    return (
                      <div
                        key={key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "80px 1fr auto",
                          gap: "1.25rem",
                          alignItems: "center",
                          padding: "1.1rem 1.5rem",
                          borderBottom: "1px solid rgba(34,37,31,0.06)",
                        }}
                      >
                        <div className="cart-line-art" style={{ width: 80, height: 80 }}>
                          <PackagingArt kind={l.packagingHint} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{cartLineDescription(l)}</div>
                          <div style={{ fontSize: "0.78rem", color: "var(--neutral-gray)" }}>
                            {[lineBarcode(l), `${inr(l.rate)} per pack`].filter(Boolean).join(" · ")}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem" }}>
                            <span className="qty-pill green" style={{ height: 32 }}>
                              <button type="button" onClick={() => cart.setQty(key, l.qty - 1)}>−</button>
                              <span className="qty-val">{l.qty}</span>
                              <button
                                type="button"
                                onClick={() => cart.setQty(key, l.qty + 1)}
                                disabled={l.qty >= l.available}
                              >
                                +
                              </button>
                            </span>
                            <button
                              type="button"
                              onClick={() => cart.remove(key)}
                              style={{
                                color: "var(--color-error)",
                                fontSize: "0.78rem",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.25rem",
                              }}
                            >
                              <TrashIcon /> Remove
                            </button>
                          </div>
                        </div>
                        <strong style={{ color: "var(--forest-green)" }} className="tnum">
                          {inr(l.qty * l.rate)}
                        </strong>
                      </div>
                    );
                  })}
                </div>

                <div className="card-soft" style={{ marginTop: "1.5rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.6rem" }}>
                    Order notes (optional)
                  </strong>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="E.g., Please pack cold-pressed oils tightly in craft paper box."
                    style={{
                      width: "100%",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(34,37,31,0.15)",
                      padding: "0.75rem 1rem",
                      fontFamily: "inherit",
                      fontSize: "0.9rem",
                      resize: "vertical",
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {cart.lines.length > 0 && (
            <aside className="card-soft" style={{ alignSelf: "start", position: "sticky", top: "1.5rem" }}>
              <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Summary</h2>
              <Row label="Subtotal" value={inr(subTotal)} />
              <Row label="Shipping" value={shipping === 0 ? "FREE" : inr(shipping)} />
              <Row label="GST (18%)" value={inr(tax)} />
              <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)", margin: "0.75rem 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem" }}>
                <strong>Total</strong>
                <strong style={{ color: "var(--forest-green)" }} className="tnum">
                  {inr(total)}
                </strong>
              </div>

              <div style={{ marginTop: "1.25rem" }}>
                <label style={{ fontSize: "0.78rem", color: "var(--neutral-gray)" }}>
                  Promo code
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                  <input
                    type="text"
                    value={promo}
                    onChange={(e) => setPromo(e.target.value)}
                    placeholder="ORGANIC10"
                    style={{
                      flex: 1,
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(34,37,31,0.15)",
                      fontSize: "0.9rem",
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                    onClick={applyPromo}
                  >
                    Apply
                  </button>
                </div>
                {promoMsg && (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: promoMsg.ok ? "var(--forest-green)" : "var(--color-error)",
                      marginTop: "0.4rem",
                    }}
                  >
                    {promoMsg.text}
                  </div>
                )}
              </div>

              {!isPhone && (
                <>
                  <button
                    type="button"
                    className="btn btn-green btn-block"
                    style={{ marginTop: "1.25rem" }}
                    onClick={goCheckout}
                  >
                    Proceed to Checkout
                  </button>
                  <Link
                    to="/"
                    style={{
                      display: "block",
                      textAlign: "center",
                      fontSize: "0.85rem",
                      color: "var(--neutral-gray)",
                      marginTop: "0.85rem",
                    }}
                  >
                    Continue shopping
                  </Link>
                </>
              )}
            </aside>
          )}
        </div>
      </div>

      {/* Sticky bottom CTA on phone */}
      {isPhone && cart.lines.length > 0 && (
        <div className="sticky-bottom-cta">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--neutral-gray)" }}>
              {cart.count} item{cart.count !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--forest-green)" }}>
              {inr(total)}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-green"
            style={{ flex: "none", padding: "0.75rem 1.5rem" }}
            onClick={goCheckout}
          >
            Checkout
          </button>
        </div>
      )}
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      fontSize: "0.92rem",
      padding: "0.3rem 0",
    }}
  >
    <span className="muted">{label}</span>
    <span className="tnum">{value}</span>
  </div>
);
