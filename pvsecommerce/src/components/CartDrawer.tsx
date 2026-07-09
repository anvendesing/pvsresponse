// Slide-in cart sidebar. Always mounted in <Layout> so any "add to
// cart" interaction can pop it without a route change.

import { Link } from "react-router-dom";
import { CloseIcon, TrashIcon } from "@/assets/icons";
import { useCart, lineKeyFor } from "@/state/CartContext";
import { lineBarcode } from "@/lib/scanCode";
import { inr, cartLineDescription } from "@/lib/format";
import { CartLineImage } from "./CartLineImage";

const SHIPPING_THRESHOLD = 3000;

export const CartDrawer = () => {
  const cart = useCart();
  const remaining = Math.max(0, SHIPPING_THRESHOLD - cart.subTotal);
  const progress = Math.min(100, (cart.subTotal / SHIPPING_THRESHOLD) * 100);

  return (
    <>
      <div
        className={`cart-overlay ${cart.drawerOpen ? "open" : ""}`}
        onClick={cart.closeDrawer}
        aria-hidden={!cart.drawerOpen}
      />
      <aside
        className={`cart-drawer ${cart.drawerOpen ? "open" : ""}`}
        aria-hidden={!cart.drawerOpen}
        aria-label="Shopping cart"
      >
        <div className="cart-drawer-head">
          <strong style={{ fontSize: "1.1rem" }}>
            Your Cart{" "}
            <span style={{ color: "var(--neutral-gray)", fontWeight: 400 }}>
              ({cart.count} items)
            </span>
          </strong>
          <button
            type="button"
            onClick={cart.closeDrawer}
            className="util-btn"
            aria-label="Close cart"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="cart-drawer-body">
          {cart.lines.length === 0 ? (
            <div className="cart-empty">
              <p style={{ marginBottom: "0.85rem" }}>Your cart is empty.</p>
              <button
                type="button"
                className="btn btn-green"
                onClick={cart.closeDrawer}
              >
                Continue shopping
              </button>
            </div>
          ) : (
            <>
              {remaining > 0 ? (
                <div style={{ marginBottom: "1rem" }}>
                  <div
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--neutral-gray)",
                      marginBottom: "0.4rem",
                    }}
                  >
                    Add <strong style={{ color: "var(--forest-green)" }}>{inr(remaining)}</strong>{" "}
                    more for free shipping.
                  </div>
                  <div className="shipping-progress">
                    <div
                      className="shipping-progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: "var(--forest-green-soft)",
                    color: "var(--forest-green)",
                    fontSize: "0.85rem",
                    padding: "0.6rem 0.8rem",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: "1rem",
                    fontWeight: 600,
                  }}
                >
                  ✓ You qualify for free shipping
                </div>
              )}

              {cart.lines.map((l) => {
                const key = lineKeyFor(l);
                return (
                  <div className="cart-line" key={key}>
                    <div className="cart-line-art">
                      <CartLineImage line={l} />
                    </div>
                    <div className="cart-line-info">
                      <span className="cart-line-title">{cartLineDescription(l)}</span>
                      <span className="cart-line-meta">
                        {lineBarcode(l) ?? ""}
                      </span>
                      <span className="cart-line-price">{inr(l.qty * l.rate)}</span>
                      <span className="qty-pill green" style={{ marginTop: "0.35rem", height: "30px", fontSize: "0.8rem" }}>
                        <button type="button" onClick={() => cart.setQty(key, l.qty - 1)} aria-label="Decrease">
                          −
                        </button>
                        <span className="qty-val">{l.qty}</span>
                        <button
                          type="button"
                          onClick={() => cart.setQty(key, l.qty + 1)}
                          aria-label="Increase"
                          disabled={l.qty >= l.available}
                        >
                          +
                        </button>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => cart.remove(key)}
                      aria-label="Remove from cart"
                      style={{ color: "var(--neutral-gray)" }}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {cart.lines.length > 0 && (
          <div className="cart-drawer-foot">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
              <span>Subtotal</span>
              <strong className="tnum">{inr(cart.subTotal)}</strong>
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--neutral-gray)" }}>
              Taxes &amp; shipping are calculated at checkout.
            </p>
            <Link
              to="/cart"
              className="btn btn-outline btn-block"
              onClick={cart.closeDrawer}
            >
              View Cart
            </Link>
            <Link
              to="/checkout"
              className="btn btn-green btn-block"
              onClick={cart.closeDrawer}
            >
              Checkout
            </Link>
          </div>
        )}
      </aside>
    </>
  );
};
