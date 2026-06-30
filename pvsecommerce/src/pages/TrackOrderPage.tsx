import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, type CustomerOrderRow } from "@/lib/api";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { usePlatform } from "@/state/PlatformContext";
import { OrderTimeline } from "@/components/OrderTimeline";
import { OrderItemsList } from "@/components/OrderItemsList";
import { inr, dateLong } from "@/lib/format";

type Step = "form" | "otp" | "result";

export const TrackOrderPage = () => {
  const auth = useAuth();
  const toast = useToast();
  const { isPhone } = usePlatform();
  const [step, setStep] = useState<Step>("form");
  const [soNo, setSoNo] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [resendSec, setResendSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<CustomerOrderRow | null>(null);

  useEffect(() => {
    if (resendSec <= 0) return;
    const t = window.setTimeout(() => setResendSec((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendSec]);

  const sendOtp = async () => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (!soNo.trim() || !/^[6-9][0-9]{9}$/.test(digits)) {
      toast.show("Enter order number and a valid mobile.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.sendOtp(digits, "track");
      setPhone(digits);
      setStep("otp");
      setCode("");
      setResendSec(res.resendInSec ?? 60);
      setDevOtp(res.devOtp ?? null);
      toast.show(res.devOtp ? `Dev OTP: ${res.devOtp}` : "OTP sent.", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not send OTP.", "error");
    } finally {
      setBusy(false);
    }
  };

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) {
      toast.show("Enter the 6-digit OTP.", "error");
      return;
    }
    setBusy(true);
    try {
      const row = await api.lookupOrder({ soNo: soNo.trim(), phone, code });
      setOrder(row);
      setStep("result");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not find order.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "2.5rem 5%", background: "var(--neutral-light)", minHeight: "70vh" }}>
      <div className="card-soft" style={{ maxWidth: 640, margin: "0 auto", padding: isPhone ? "1.25rem" : "2rem" }}>
        <h1 className="serif-title" style={{ fontSize: "1.8rem", color: "var(--forest-green-dark)", marginBottom: "0.35rem" }}>
          Track your order
        </h1>
        <p className="muted" style={{ marginBottom: "1.5rem" }}>
          Enter your sales order number and mobile to view live status.
        </p>

        {step === "form" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div className="float-field">
              <input placeholder=" " value={soNo} onChange={(e) => setSoNo(e.target.value)} />
              <label>Sales order # (e.g. SO-2026-2001)</label>
            </div>
            <div className="float-field">
              <input type="tel" placeholder=" " value={phone} onChange={(e) => setPhone(e.target.value)} />
              <label>Mobile number used at checkout</label>
            </div>
            <button type="button" className="btn btn-green" disabled={busy} onClick={() => void sendOtp()}>
              {busy ? "Sending…" : "Send OTP"}
            </button>
          </div>
        )}

        {step === "otp" && (
          <form onSubmit={lookup} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {devOtp && (
              <div style={{ padding: "0.65rem", background: "var(--forest-green-soft)", borderRadius: "var(--radius-sm)", fontSize: "0.85rem" }}>
                Dev OTP: <strong>{devOtp}</strong>
              </div>
            )}
            <div className="float-field">
              <input
                placeholder=" "
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
              />
              <label>6-digit OTP</label>
            </div>
            <button type="submit" className="btn btn-green" disabled={busy}>
              {busy ? "Looking up…" : "View order status"}
            </button>
            <button type="button" className="text-link" disabled={resendSec > 0 || busy} onClick={() => void sendOtp()}>
              {resendSec > 0 ? `Resend in ${resendSec}s` : "Resend OTP"}
            </button>
          </form>
        )}

        {step === "result" && order && (
          <div>
            <div style={{ marginBottom: "1rem" }}>
              <strong>{order.soNo}</strong>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Placed {dateLong(order.createdAt)} · {inr(order.total)}
              </div>
              {order.packingSlip?.trackingUrl && (
                <a href={order.packingSlip.trackingUrl} target="_blank" rel="noreferrer" className="text-link" style={{ display: "inline-block", marginTop: "0.5rem" }}>
                  Track shipment →
                </a>
              )}
            </div>
            <h2 style={{ fontSize: "1rem", marginBottom: "0.65rem" }}>Order items</h2>
            <OrderItemsList items={order.items} total={order.total} />
            {!auth.isAuthed && (
              <p style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
                <Link to="/login" className="text-link">Sign in</Link> to see all your orders.
              </p>
            )}
            <div style={{ marginTop: "1.5rem" }}>
              <OrderTimeline compact packingSlip={order.packingSlip} invoiceStatus={order.invoiceStatus} status={order.status} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
