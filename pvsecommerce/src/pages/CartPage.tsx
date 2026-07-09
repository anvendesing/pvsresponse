// Standalone cart page (the slide-in drawer is great for "just

// added" but the dedicated page gives breathing room for editing

// quantities and adding order notes before checkout).



import { Link, useNavigate } from "react-router-dom";

import { useEffect, useState } from "react";

import { useCart, lineKeyFor } from "@/state/CartContext";

import { useCatalog } from "@/state/CatalogContext";

import { lineBarcode } from "@/lib/scanCode";

import { useToast } from "@/state/ToastContext";

import { usePlatform } from "@/state/PlatformContext";

import { inr, cartLineDescription } from "@/lib/format";

import { TrashIcon } from "@/assets/icons";

import { CartLineImage } from "@/components/CartLineImage";



const SHIPPING_THRESHOLD = 3000;



export const CartPage = () => {

  const cart = useCart();

  const { products } = useCatalog();

  const toast = useToast();

  const navigate = useNavigate();

  const { isPhone } = usePlatform();



  const [notes, setNotes] = useState("");



  useEffect(() => {
    cart.syncStock(products);
  }, [products, cart.syncStock]);



  const subTotal = cart.subTotal;

  const qualifiesFreeShipping = subTotal >= SHIPPING_THRESHOLD;

  const amountToFreeShipping = Math.max(0, SHIPPING_THRESHOLD - subTotal);



  const goCheckout = () => {

    if (cart.lines.length === 0) {

      toast.show("Your cart is empty.", "error");

      return;

    }

    const oos = cart.lines.filter((l) => l.available <= 0);

    if (oos.length > 0) {

      toast.show("Remove sold-out items before checkout.", "error");

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

    <div className="cart-page-wrap">

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



        <div className={cart.lines.length === 0 ? undefined : "cart-checkout-grid"}>

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

                    const soldOut = l.available <= 0;

                    return (

                      <div key={key} className="cart-line-grid">

                        <CartLineImage line={l} className="cart-line-art" />

                        <div style={{ minWidth: 0 }}>

                          <div style={{ fontWeight: 600 }}>{cartLineDescription(l)}</div>

                          <div style={{ fontSize: "0.78rem", color: "var(--neutral-gray)" }}>

                            {[lineBarcode(l), `${inr(l.rate)} per pack`].filter(Boolean).join(" · ")}

                          </div>

                          {soldOut && (

                            <p style={{ fontSize: "0.78rem", color: "var(--color-error)", marginTop: "0.35rem" }}>

                              Sold out — remove or choose another variant.

                            </p>

                          )}

                          {!soldOut && l.qty >= l.available && l.available < 99 && (

                            <p style={{ fontSize: "0.78rem", color: "var(--color-warning, #b45309)", marginTop: "0.35rem" }}>

                              Limited stock — max {l.available} per order.

                            </p>

                          )}

                          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem", flexWrap: "wrap" }}>

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

                        <strong style={{ color: "var(--forest-green)", whiteSpace: "nowrap" }} className="tnum">

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

              <Row label="Shipping" value="Calculated at checkout" muted />

              <Row label="GST" value="Calculated at checkout" muted />

              <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)", margin: "0.75rem 0" }} />

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem" }}>

                <strong>Subtotal</strong>

                <strong style={{ color: "var(--forest-green)" }} className="tnum">

                  {inr(subTotal)}

                </strong>

              </div>

              <p style={{ fontSize: "0.78rem", color: "var(--neutral-gray)", marginTop: "0.65rem", lineHeight: 1.45 }}>

                Shipping and GST are calculated at checkout once your delivery pincode is entered.

              </p>

              {!qualifiesFreeShipping && subTotal > 0 && (

                <p style={{ fontSize: "0.78rem", color: "var(--forest-green)", marginTop: "0.45rem" }}>

                  Add {inr(amountToFreeShipping)} more — free shipping may apply on orders above ₹3,000 (confirm at checkout).

                </p>

              )}

              {qualifiesFreeShipping && subTotal > 0 && (

                <p style={{ fontSize: "0.78rem", color: "var(--forest-green)", marginTop: "0.45rem" }}>

                  You may qualify for free shipping — final fee confirmed at checkout.

                </p>

              )}



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



      {isPhone && cart.lines.length > 0 && (

        <div className="sticky-bottom-cta">

          <div style={{ flex: 1 }}>

            <div style={{ fontSize: "0.75rem", color: "var(--neutral-gray)" }}>

              {cart.count} item{cart.count !== 1 ? "s" : ""}

            </div>

            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--forest-green)" }}>

              {inr(subTotal)}

            </div>

            <div style={{ fontSize: "0.68rem", color: "var(--neutral-gray)" }}>

              + shipping &amp; tax at checkout

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



const Row = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (

  <div

    style={{

      display: "flex",

      justifyContent: "space-between",

      fontSize: "0.92rem",

      padding: "0.3rem 0",

      gap: "1rem",

    }}

  >

    <span className="muted">{label}</span>

    <span

      className={muted ? undefined : "tnum"}

      style={{

        textAlign: "right",

        color: muted ? "var(--neutral-gray)" : undefined,

        fontStyle: muted ? "italic" : undefined,

        fontSize: muted ? "0.85rem" : undefined,

      }}

    >

      {value}

    </span>

  </div>

);


