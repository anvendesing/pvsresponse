import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";

export type OtpPurpose = "login" | "track";

interface OtpModalProps {
  open: boolean;
  purpose?: OtpPurpose;
  initialPhone?: string;
  title?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const OtpModal = ({
  open,
  purpose = "login",
  initialPhone = "",
  title = "Verify your mobile",
  onClose,
  onSuccess,
}: OtpModalProps) => {
  const auth = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [resendSec, setResendSec] = useState(0);
  const [devHint, setDevHint] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhone(initialPhone);
      setCode("");
      setStep("phone");
      setDevHint(null);
      setResendSec(0);
    }
  }, [open, initialPhone]);

  useEffect(() => {
    if (resendSec <= 0) return;
    const t = window.setTimeout(() => setResendSec((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendSec]);

  const sendOtp = useCallback(async () => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (!/^[6-9][0-9]{9}$/.test(digits)) {
      toast.show("Enter a valid 10-digit mobile number.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await auth.requestOtp(digits, purpose);
      setPhone(digits);
      setStep("code");
      setCode("");
      setResendSec(res.resendInSec ?? 60);
      if (res.devOtp) {
        setDevHint(res.devOtp);
        toast.show(`Dev OTP: ${res.devOtp}`, "success");
      } else {
        toast.show("OTP sent to your mobile.", "success");
      }
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : (e as Error).message ?? "Could not send OTP.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }, [auth, phone, purpose, toast]);

  const verify = useCallback(async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast.show("Enter the 6-digit OTP.", "error");
      return;
    }
    setBusy(true);
    try {
      if (purpose === "login") {
        await auth.verifyOtp(phone, code, undefined, purpose);
      }
      onSuccess();
      onClose();
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : (e as Error).message ?? "Verification failed.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }, [auth, code, onClose, onSuccess, phone, purpose, toast]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(13,27,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        className="card-soft"
        style={{ width: "100%", maxWidth: 420, padding: "1.75rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.35rem" }}>{title}</h2>
        <p className="muted" style={{ fontSize: "0.88rem", marginBottom: "1.25rem" }}>
          {step === "phone"
            ? "We'll send a one-time code to verify your number."
            : `Enter the code sent to ${phone}.`}
        </p>

        {step === "phone" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div className="float-field">
              <input
                type="tel"
                placeholder=" "
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                pattern="[6-9][0-9]{9}"
              />
              <label>Mobile number *</label>
            </div>
            <button type="button" className="btn btn-green btn-block" disabled={busy} onClick={() => void sendOtp()}>
              {busy ? "Sending…" : "Send OTP"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {devHint && (
              <div
                style={{
                  padding: "0.65rem 0.85rem",
                  background: "var(--forest-green-soft)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.85rem",
                }}
              >
                Dev mode OTP: <strong>{devHint}</strong>
              </div>
            )}
            <div className="float-field">
              <input
                type="text"
                placeholder=" "
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
              />
              <label>6-digit OTP *</label>
            </div>
            <button type="button" className="btn btn-green btn-block" disabled={busy} onClick={() => void verify()}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <button type="button" className="text-link" onClick={() => setStep("phone")}>
                Change number
              </button>
              <button
                type="button"
                className="text-link"
                disabled={resendSec > 0 || busy}
                onClick={() => void sendOtp()}
              >
                {resendSec > 0 ? `Resend in ${resendSec}s` : "Resend OTP"}
              </button>
            </div>
          </div>
        )}

        <button type="button" onClick={onClose} className="btn btn-outline btn-block" style={{ marginTop: "1rem" }}>
          Cancel
        </button>
      </div>
    </div>
  );
};
