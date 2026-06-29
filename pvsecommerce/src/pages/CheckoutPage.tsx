// Checkout: Verify (OTP) -> Shipping -> Payment (PayU / Razorpay).

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { OtpModal } from "@/components/OtpModal";
import {
  ApiError,
  api,
  type CustomerAddress,
  type PlaceOrderResult,
  type ShippingQuoteResult,
  type StorefrontPaymentGateway,
} from "@/lib/api";
import { loadRazorpayCheckout, openRazorpayCheckout } from "@/lib/razorpay";
import { submitPayuCheckout } from "@/lib/payu";
import { useCart, lineKeyFor } from "@/state/CartContext";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { inr, cartLineSummary } from "@/lib/format";
import { isPlaceholderCustomerName } from "@/lib/customer";
import {
  extractIndianPincode,
  INDIA_DELIVERY_NOTE,
  isValidIndianPincode,
  PINCODE_PLACE_HINT,
  pincodeFieldUpdate,
  validateIndianPincode,
} from "@/lib/pincodeLookup";
import { CheckIcon } from "@/assets/icons";
import { usePlatform } from "@/state/PlatformContext";

interface ShippingForm {
  name: string;
  email: string;
  phone: string;
  addressLine: string;
  pincode: string;
  city: string;
  district: string;
  state: string;
  delivery: "standard" | "express";
  addressId: string | null;
}

export const CheckoutPage = () => {
  const cart = useCart();
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isPhone } = usePlatform();
  const addresses = Array.isArray(auth.addresses) ? auth.addresses : [];
  const deliverableAddresses = addresses.filter((a) => isValidIndianPincode(a.pincode));
  const undeliverableAddresses = addresses.filter((a) => !isValidIndianPincode(a.pincode));

  const [step, setStep] = useState<1 | 2 | 3>(() => (auth.isAuthed ? 2 : 1));
  const [otpOpen, setOtpOpen] = useState(false);
  const [showNewAddress, setShowNewAddress] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shipping, setShipping] = useState<ShippingForm>(() => ({
    name: auth.customer?.name && !isPlaceholderCustomerName(auth.customer.name, auth.customer.phone)
      ? auth.customer.name
      : "",
    email: auth.customer?.email ?? "",
    phone: auth.customer?.phone ?? "",
    addressLine: "",
    pincode: "",
    city: "",
    district: "",
    state: "",
    delivery: "standard",
    addressId: null,
  }));
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [paymentGateways, setPaymentGateways] = useState<StorefrontPaymentGateway[]>([]);
  const [paymentGateway, setPaymentGateway] = useState<StorefrontPaymentGateway | "">("");
  const lastAutofillPinRef = useRef("");
  const [notes] = useState<string>(() => {
    try {
      return window.localStorage.getItem("pv_cart_notes") ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (cart.lines.length === 0) navigate("/cart", { replace: true });
  }, [cart.lines.length, navigate]);

  useEffect(() => {
    const payuStatus = searchParams.get("payu");
    if (payuStatus === "failed") {
      setErrMsg("PayU payment was cancelled or failed. You can try again.");
      setStep(3);
      setSearchParams({}, { replace: true });
    } else if (payuStatus === "error") {
      const code = searchParams.get("code");
      setErrMsg(code ? `Payment could not be confirmed (${code}). Contact support if charged.` : "Payment confirmation failed.");
      setStep(3);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (step !== 3) return;
    void api
      .activePaymentGateways()
      .then((res) => {
        const active = Array.isArray(res?.active) ? res.active : [];
        setPaymentGateways(active);
        setPaymentGateway((prev) => {
          if (prev && active.includes(prev)) return prev;
          return active[0] ?? "";
        });
      })
      .catch(() => {
        setPaymentGateways([]);
        setPaymentGateway("");
      });
  }, [step]);

  useEffect(() => {
    if (!auth.customer) return;
    setShipping((prev) => ({
      ...prev,
      name:
        prev.name ||
        (auth.customer!.name && !isPlaceholderCustomerName(auth.customer!.name, auth.customer!.phone)
          ? auth.customer!.name
          : ""),
      email: auth.customer!.email ?? prev.email,
      phone: auth.customer!.phone ?? prev.phone,
    }));
  }, [auth.customer]);

  useEffect(() => {
    const defaultAddr =
      deliverableAddresses.find((a) => a.isDefault) ?? deliverableAddresses[0];
    if (defaultAddr && !shipping.addressId && !showNewAddress) {
      applyAddress(defaultAddr);
    }
  }, [deliverableAddresses, shipping.addressId, showNewAddress]);

  const applyAddress = (a: CustomerAddress) => {
    lastAutofillPinRef.current = extractIndianPincode(a.pincode);
    setShipping((prev) => ({
      ...prev,
      addressId: a.id,
      name: a.name,
      phone: a.phone,
      addressLine: a.addressLine,
      city: a.city,
      state: a.state ?? "",
      pincode: a.pincode,
    }));
    setShowNewAddress(false);
  };

  const subTotal = cart.subTotal;
  const goodsTaxFallback = Math.round(subTotal * 0.18);
  const cartItemsKey = cart.lines.map((l) => `${l.productId}:${l.variantId}:${l.qty}`).join("|");

  useEffect(() => {
    const pin = shipping.pincode.replace(/\D/g, "").slice(0, 6);
    if (!/^[1-9]\d{5}$/.test(pin) || cart.lines.length === 0) {
      setShippingQuote(null);
      setQuoteError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setQuoteLoading(true);
      setQuoteError(null);
      void api
        .shippingQuote({
          pincode: pin,
          state: shipping.state.trim() || undefined,
          addressId: shipping.addressId ?? undefined,
          subTotal,
          items: cart.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
          })),
        })
        .then(setShippingQuote)
        .catch((err) => {
          setShippingQuote(null);
          setQuoteError(err instanceof ApiError ? err.message : "Could not load shipping rates.");
        })
        .finally(() => setQuoteLoading(false));
    }, 400);

    return () => window.clearTimeout(timer);
  }, [shipping.pincode, shipping.state, shipping.addressId, subTotal, cartItemsKey, cart.lines.length]);

  const quoteOptions = Array.isArray(shippingQuote?.options) ? shippingQuote.options : [];
  const standardOption = quoteOptions.find((o) => o.id === "standard");
  const expressOption = quoteOptions.find((o) => o.id === "express");
  const selectedOption = quoteOptions.find((o) => o.id === shipping.delivery);

  const subTotalDisplay = shippingQuote?.subTotal ?? subTotal;
  const taxKind = shippingQuote?.taxKind ?? "intra";
  const cgstTotal =
    shippingQuote?.cgstTotal ??
    (taxKind === "inter" ? 0 : Math.round((goodsTaxFallback / 2) * 100) / 100);
  const sgstTotal =
    shippingQuote?.sgstTotal ??
    (taxKind === "inter" ? 0 : goodsTaxFallback - Math.round((goodsTaxFallback / 2) * 100) / 100);
  const igstTotal = shippingQuote?.igstTotal ?? (taxKind === "inter" ? goodsTaxFallback : 0);
  const goodsTax = shippingQuote?.goodsTax ?? goodsTaxFallback;
  const transportTax = selectedOption?.transportTax ?? 0;
  const shippingFee = selectedOption?.fee ?? 0;
  const total = selectedOption?.payableTotal ?? subTotalDisplay + goodsTax + shippingFee + transportTax;

  const formatShippingSub = (fee: number | undefined, loading: boolean) => {
    if (loading) return "Calculating…";
    if (quoteError) return "Unavailable";
    if (fee === undefined) return "Enter pincode";
    return fee === 0 ? "FREE" : inr(fee);
  };

  const setShip = <K extends keyof ShippingForm>(k: K, v: ShippingForm[K]) =>
    setShipping((prev) => ({ ...prev, [k]: v, ...(k !== "addressId" && k !== "delivery" ? { addressId: null } : {}) }));

  const onPincodeChange = (raw: string) => {
    setShipping((prev) => {
      const { next, lastAutofillPin } = pincodeFieldUpdate(prev, raw, lastAutofillPinRef.current);
      lastAutofillPinRef.current = lastAutofillPin;
      return { ...next, addressId: null };
    });
  };

  const submitShipping = async (e: FormEvent) => {
    e.preventDefault();
    if (!shipping.name.trim() || !shipping.phone.trim() || !shipping.addressLine.trim()) {
      toast.show("Please complete shipping details.", "error");
      return;
    }
    const pinErr =
      showNewAddress || deliverableAddresses.length === 0
        ? validateIndianPincode(shipping.pincode)
        : null;
    if (pinErr) {
      toast.show(pinErr, "error");
      return;
    }
    if (quoteLoading) {
      toast.show("Calculating shipping rates…", "error");
      return;
    }
    if (quoteError || !shippingQuote) {
      toast.show(quoteError ?? "Shipping is not available for this pincode.", "error");
      return;
    }

    setShippingBusy(true);
    try {
      let addressId = shipping.addressId;

      if (
        auth.customer &&
        isPlaceholderCustomerName(auth.customer.name, auth.customer.phone) &&
        shipping.name.trim()
      ) {
        await api.updateProfile({ name: shipping.name.trim() });
      }

      const enteringNewAddress = showNewAddress || deliverableAddresses.length === 0;
      if (enteringNewAddress && saveAddress && !addressId) {
        const created = await api.createAddress({
          label: "Home",
          name: shipping.name.trim(),
          phone: shipping.phone.trim(),
          addressLine: shipping.addressLine.trim(),
          city: shipping.city.trim(),
          state: shipping.state.trim(),
          pincode: shipping.pincode.trim(),
          isDefault: deliverableAddresses.length === 0,
        });
        addressId = created.id;
      }

      setShipping((prev) => ({ ...prev, addressId }));
      await auth.refreshMe();
      setStep(3);
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : (err as Error).message ?? "Could not save shipping.",
        "error"
      );
    } finally {
      setShippingBusy(false);
    }
  };

  const placeOrder = async () => {
    setErrMsg(null);
    if (!paymentGateway) {
      setErrMsg("No payment gateway is configured. Please try again later.");
      return;
    }
    setBusy(true);
    try {
      const gatewayLabel = paymentGateway === "payu" ? "PayU" : "Razorpay";
      const orderNotes = [
        notes.trim(),
        `Delivery: ${shipping.delivery}`,
        `Payment: ${gatewayLabel}`,
      ]
        .filter(Boolean)
        .join(" | ");

      const orderInput = {
        name: shipping.name,
        email: shipping.email || undefined,
        phone: shipping.phone,
        addressLine: shipping.addressLine,
        city: shipping.city,
        state: shipping.state,
        pincode: shipping.pincode,
        addressId: shipping.addressId ?? undefined,
        notes: orderNotes,
        deliveryMethod: shipping.delivery,
        shippingFee,
        gateway: paymentGateway,
        items: cart.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
        })),
      };

      const init = await api.initCheckoutOrder(orderInput);

      if (init.gateway === "payu") {
        submitPayuCheckout(init.checkoutUrl, init.fields);
        return;
      }

      await loadRazorpayCheckout();

      openRazorpayCheckout({
        keyId: init.keyId,
        amount: init.amount,
        currency: init.currency,
        orderId: init.razorpayOrderId,
        name: "Prakruthivanam",
        description: `Order · ${inr(init.totals.total)}`,
        prefill: init.prefill,
        onDismiss: () => setBusy(false),
        onSuccess: async (rzpResponse) => {
          try {
            const result: PlaceOrderResult = await api.confirmRazorpayOrder({
              intentId: init.intentId,
              razorpay_payment_id: rzpResponse.razorpay_payment_id,
              razorpay_order_id: rzpResponse.razorpay_order_id,
              razorpay_signature: rzpResponse.razorpay_signature,
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
            toast.show("Payment successful — order placed!", "success");
            navigate(`/order/${result.salesOrder.soNo}`, {
              replace: true,
              state: { result },
            });
          } catch (e) {
            setErrMsg(
              e instanceof ApiError
                ? e.message
                : (e as Error).message ?? "Payment received but order confirmation failed."
            );
            setBusy(false);
          }
        },
      });
    } catch (e) {
      setErrMsg(
        e instanceof ApiError
          ? e.message
          : (e as Error).message ?? "Could not start payment."
      );
      setBusy(false);
    }
  };

  return (
    <>
      <OtpModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onSuccess={() => {
          setStep(2);
          void auth.refreshMe();
        }}
      />

      <div style={{ padding: "2.5rem 5%", background: "var(--neutral-light)", minHeight: "70vh" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <h1 className="serif-title" style={{ fontSize: "2rem", color: "var(--forest-green-dark)", marginBottom: "0.4rem" }}>
            Checkout
          </h1>
          <p className="muted" style={{ marginBottom: "1.5rem" }}>
            Verify your mobile, confirm delivery within India, then pay securely.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: "2rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <StepCard
                num={1}
                title="Verify mobile"
                status={step > 1 ? "done" : step === 1 ? "active" : "pending"}
                onEdit={step > 1 ? () => setStep(1) : undefined}
              >
                {step === 1 && (
                  <div>
                    {auth.isAuthed ? (
                      <p className="muted" style={{ fontSize: "0.9rem" }}>
                        Signed in as <strong>{auth.customer?.phone}</strong>
                      </p>
                    ) : (
                      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>
                        We'll send a one-time code to verify your number before checkout.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn btn-green"
                      onClick={() => (auth.isAuthed ? setStep(2) : setOtpOpen(true))}
                    >
                      {auth.isAuthed ? "Continue to shipping" : "Verify with OTP"}
                    </button>
                  </div>
                )}
                {step > 1 && (
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    Verified · {auth.customer?.phone ?? shipping.phone}
                  </p>
                )}
              </StepCard>

              <StepCard
                num={2}
                title="Shipping"
                status={step > 2 ? "done" : step === 2 ? "active" : "pending"}
                onEdit={step > 2 ? () => setStep(2) : undefined}
              >
                {step === 2 && (
                  <form onSubmit={submitShipping} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                    {deliverableAddresses.length > 0 && !showNewAddress && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {deliverableAddresses.map((a) => (
                          <label
                            key={a.id}
                            style={{
                              display: "flex",
                              gap: "0.65rem",
                              padding: "0.85rem",
                              border: `2px solid ${shipping.addressId === a.id ? "var(--forest-green)" : "rgba(34,37,31,0.1)"}`,
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="radio"
                              name="address"
                              checked={shipping.addressId === a.id}
                              onChange={() => applyAddress(a)}
                            />
                            <span style={{ fontSize: "0.85rem" }}>
                              <strong>{a.label ?? "Address"}</strong> · {a.name}
                              <br />
                              {a.addressLine}, {a.city}, {a.state} {a.pincode}
                            </span>
                          </label>
                        ))}
                        <button type="button" className="text-link" onClick={() => setShowNewAddress(true)}>
                          + Add new address
                        </button>
                      </div>
                    )}

                    {undeliverableAddresses.length > 0 && !showNewAddress && (
                      <div
                        style={{
                          padding: "0.75rem",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(180, 80, 0, 0.08)",
                          fontSize: "0.82rem",
                          color: "var(--neutral-gray)",
                        }}
                      >
                        <strong style={{ display: "block", marginBottom: "0.35rem" }}>
                          Addresses not available for delivery
                        </strong>
                        {INDIA_DELIVERY_NOTE} Update or replace these in{" "}
                        <Link to="/account/addresses" style={{ color: "var(--forest-green)" }}>
                          saved addresses
                        </Link>
                        .
                        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                          {undeliverableAddresses.map((a) => (
                            <li key={a.id}>
                              {a.label ?? "Address"} · {a.city}, {a.state} {a.pincode}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {(showNewAddress || deliverableAddresses.length === 0) && (
                      <>
                        <div className="form-grid">
                          <FieldText label="Full name" required value={shipping.name} onChange={(v) => setShip("name", v)} />
                          <FieldText label="Phone" required pattern="[0-9]{10}" value={shipping.phone} onChange={(v) => setShip("phone", v)} />
                        </div>
                        <FieldText label="Email (optional)" type="email" value={shipping.email} onChange={(v) => setShip("email", v)} />
                        <FieldText label="Address line" required value={shipping.addressLine} onChange={(v) => setShip("addressLine", v)} />
                        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                          <FieldText label="Pincode" required pattern="[1-9][0-9]{5}" inputMode="numeric" maxLength={6} value={shipping.pincode} onChange={onPincodeChange} />
                          <FieldText label="City" required value={shipping.city} onChange={(v) => setShip("city", v)} />
                          <FieldText label="State" required value={shipping.state} onChange={(v) => setShip("state", v)} />
                        </div>
                        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "-0.35rem" }}>
                          {PINCODE_PLACE_HINT}
                        </p>
                        {shippingQuote?.distanceKm != null ? (
                          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>
                            Approx. {Math.round(shippingQuote.distanceKm)} km from our dispatch location (
                            saved with this address).
                          </p>
                        ) : shipping.addressId ? null : (
                          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>
                            Distance is saved when you add this address to your profile.
                          </p>
                        )}
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.88rem" }}>
                          <input
                            type="checkbox"
                            checked={saveAddress}
                            onChange={(e) => setSaveAddress(e.target.checked)}
                          />
                          Save this address for next time
                        </label>
                      </>
                    )}

                    <div style={{ marginTop: "0.5rem" }}>
                      <strong style={{ fontSize: "0.85rem" }}>Delivery method</strong>
                      {quoteError && (
                        <p style={{ fontSize: "0.82rem", color: "var(--color-error)", marginTop: "0.35rem" }}>
                          {quoteError}
                        </p>
                      )}
                      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem", gridTemplateColumns: "1fr 1fr" }}>
                        <DeliveryCard
                          active={shipping.delivery === "standard"}
                          title={standardOption?.label ?? "Standard (3-5 days)"}
                          sub={formatShippingSub(standardOption?.fee, quoteLoading)}
                          disabled={quoteLoading || !!quoteError || !standardOption}
                          onClick={() => setShip("delivery", "standard")}
                        />
                        <DeliveryCard
                          active={shipping.delivery === "express"}
                          title={expressOption?.label ?? "Express (1-2 days)"}
                          sub={formatShippingSub(expressOption?.fee, quoteLoading)}
                          disabled={quoteLoading || !!quoteError || !expressOption}
                          onClick={() => setShip("delivery", "express")}
                        />
                      </div>
                    </div>

                    <button type="submit" className="btn btn-green" style={{ alignSelf: "flex-end", marginTop: "0.5rem" }} disabled={shippingBusy || quoteLoading || !!quoteError || !shippingQuote}>
                      {shippingBusy ? "Saving…" : "Continue to payment"}
                    </button>
                  </form>
                )}
                {step > 2 && (
                  <p className="muted" style={{ fontSize: "0.85rem" }}>
                    {shipping.name} · {shipping.addressLine}, {shipping.city}, {shipping.state} {shipping.pincode}
                  </p>
                )}
              </StepCard>

              <StepCard num={3} title="Payment" status={step === 3 ? "active" : "pending"}>
                {step === 3 && (
                  <>
                    {errMsg && (
                      <div style={{ padding: "0.75rem 1rem", background: "#fef2f2", color: "var(--color-error)", borderRadius: "var(--radius-sm)", marginBottom: "1rem", fontSize: "0.88rem" }}>
                        {errMsg}
                      </div>
                    )}
                    <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
                      Your order is created only after payment succeeds.
                      {shippingQuote?.source === "shiprocket" && (
                        <span> Shipping rates from Shiprocket.</span>
                      )}
                    </p>
                    {paymentGateways.length > 1 && (
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                        {paymentGateways.map((g) => (
                          <button
                            key={g}
                            type="button"
                            className={`btn ${paymentGateway === g ? "btn-green" : ""}`}
                            style={{ fontSize: "0.85rem" }}
                            onClick={() => setPaymentGateway(g)}
                          >
                            {g === "payu" ? "PayU" : "Razorpay"}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn btn-green btn-block"
                      onClick={placeOrder}
                      disabled={busy || quoteLoading || !!quoteError || !shippingQuote || !paymentGateway}
                    >
                      {busy
                        ? "Opening payment…"
                        : `Pay ${inr(total)} with ${paymentGateway === "payu" ? "PayU" : paymentGateway === "razorpay" ? "Razorpay" : "…"}`}
                    </button>
                  </>
                )}
              </StepCard>
            </div>

            <aside className="card-soft" style={{ alignSelf: "start", position: "sticky", top: "1.5rem" }}>
              <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Order summary</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                {cart.lines.map((l) => (
                  <div key={lineKeyFor(l)} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                    <span style={{ color: "var(--neutral-gray)" }}>{cartLineSummary(l)}</span>
                    <span className="tnum">{inr(l.qty * l.rate)}</span>
                  </div>
                ))}
              </div>
              <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)" }} />
              <Row label="Subtotal (excl. GST)" value={inr(subTotalDisplay)} />
              <Row label="Shipping" value={shippingFee === 0 ? "FREE" : inr(shippingFee)} />
              {taxKind === "inter" ? (
                <Row label="IGST (goods)" value={inr(igstTotal)} />
              ) : (
                <>
                  <Row label="CGST (goods)" value={inr(cgstTotal)} />
                  <Row label="SGST (goods)" value={inr(sgstTotal)} />
                </>
              )}
              {transportTax > 0 && (
                <Row
                  label={taxKind === "inter" ? "IGST (shipping)" : "GST (shipping)"}
                  value={inr(transportTax)}
                />
              )}
              <hr style={{ border: "none", borderTop: "1px solid rgba(34,37,31,0.08)", margin: "0.4rem 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 700 }}>
                <span>Payable</span>
                <span style={{ color: "var(--forest-green)" }} className="tnum">{inr(total)}</span>
              </div>
              <Link to="/cart" style={{ display: "block", textAlign: "center", fontSize: "0.85rem", color: "var(--forest-green)", marginTop: "0.6rem" }}>
                ← Edit cart
              </Link>
            </aside>
          </div>
        </div>
      </div>

      {/* Sticky bottom pay CTA on phone (only on payment step) */}
      {isPhone && step === 3 && paymentGateway && shippingQuote && !quoteError && (
        <div className="sticky-bottom-cta">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.72rem", color: "var(--neutral-gray)" }}>Total payable</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--forest-green)" }}>{inr(total)}</div>
          </div>
          <button
            type="button"
            className="btn btn-green"
            style={{ flex: "none", padding: "0.75rem 1.5rem" }}
            disabled={busy || quoteLoading}
            onClick={placeOrder}
          >
            {busy ? "Opening…" : `Pay with ${paymentGateway === "payu" ? "PayU" : "Razorpay"}`}
          </button>
        </div>
      )}
    </>
  );
};

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
        status === "active" ? "var(--primary-gold)" : status === "done" ? "var(--forest-green)" : "rgba(34,37,31,0.08)"
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
            background: status === "done" ? "var(--forest-green)" : status === "active" ? "var(--primary-gold)" : "rgba(34,37,31,0.1)",
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
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  pattern?: string;
  inputMode?: "numeric" | "text";
  maxLength?: number;
}) => (
  <div className="float-field">
    <input
      type={type}
      placeholder=" "
      required={required}
      pattern={pattern}
      inputMode={inputMode}
      maxLength={maxLength}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    <label>{label}{required && " *"}</label>
  </div>
);

const DeliveryCard = ({
  active,
  title,
  sub,
  onClick,
  disabled,
}: {
  active: boolean;
  title: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      textAlign: "left",
      padding: "0.85rem 1rem",
      border: `2px solid ${active ? "var(--forest-green)" : "rgba(34,37,31,0.1)"}`,
      borderRadius: "var(--radius-sm)",
      background: active ? "var(--forest-green-soft)" : "var(--neutral-white)",
      display: "flex",
      flexDirection: "column",
      gap: "0.3rem",
      opacity: disabled ? 0.65 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
    }}
  >
    <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
    <span style={{ fontSize: "0.85rem", color: active ? "var(--forest-green)" : "var(--neutral-gray)", fontWeight: 600 }}>{sub}</span>
  </button>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", padding: "0.25rem 0", color: "var(--neutral-gray)" }}>
    <span>{label}</span>
    <span className="tnum">{value}</span>
  </div>
);
