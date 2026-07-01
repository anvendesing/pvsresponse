import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";
import { usePlatform } from "@/state/PlatformContext";

export const LoginPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const { isApp } = usePlatform();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "/account";

  const toast = useToast();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [resendSec, setResendSec] = useState(0);
  const [devHint, setDevHint] = useState<string | null>(null);

  useEffect(() => {
    if (auth.isAuthed) navigate(redirect, { replace: true });
  }, [auth.isAuthed, navigate, redirect]);

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
      const res = await auth.requestOtp(digits, "login");
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
  }, [auth, phone, toast]);

  const verify = useCallback(async () => {
    if (!/^[0-9]{6}$/.test(code)) {
      toast.show("Enter the 6-digit OTP.", "error");
      return;
    }
    setBusy(true);
    try {
      await auth.verifyOtp(phone, code, undefined, "login");
      navigate(redirect, { replace: true });
    } catch (e) {
      toast.show(
        e instanceof ApiError ? e.message : (e as Error).message ?? "Verification failed.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }, [auth, code, navigate, phone, redirect, toast]);

  if (auth.isAuthed) return null;

  return (
    <div
      style={{
        minHeight: isApp ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(160deg, var(--forest-green-dark) 0%, #2d5016 55%, var(--forest-green) 100%)",
        padding: "env(safe-area-inset-top, 0) 0 env(safe-area-inset-bottom, 0)",
      }}
    >
      {/* Brand header */}
      <div style={{ flex: "0 0 auto", padding: "3rem 2rem 2rem", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
          <img
            src="/brand/logo.png"
            alt="Prakruthivanam"
            style={{ height: 72, objectFit: "contain" }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
        <h1 style={{ fontSize: "1.5rem", color: "#fff", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
          Prakruthivanam
        </h1>
        <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
          100% organic · farm fresh
        </p>
      </div>

      {/* Login card */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          padding: "0 1.25rem 2rem",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "1.25rem",
            padding: "1.75rem 1.5rem",
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            maxWidth: 440,
            width: "100%",
            margin: "0 auto",
          }}
        >
          {step === "phone" ? (
            <>
              <h2 style={{ fontSize: "1.3rem", color: "var(--forest-green-dark)", marginBottom: "0.3rem" }}>
                Sign in
              </h2>
              <p className="muted" style={{ fontSize: "0.88rem", marginBottom: "1.4rem" }}>
                Enter your mobile number to receive a one-time code.
              </p>

              <div className="float-field" style={{ marginBottom: "1rem" }}>
                <input
                  type="tel"
                  placeholder=" "
                  value={phone}
                  autoFocus
                  inputMode="tel"
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void sendOtp()}
                />
                <label>Mobile number *</label>
              </div>

              <button
                type="button"
                className="btn btn-green btn-block"
                style={{ height: 48, fontSize: "1rem" }}
                disabled={busy}
                onClick={() => void sendOtp()}
              >
                {busy ? "Sending…" : "Send OTP"}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: "1.3rem", color: "var(--forest-green-dark)", marginBottom: "0.3rem" }}>
                Enter OTP
              </h2>
              <p className="muted" style={{ fontSize: "0.88rem", marginBottom: "1.4rem" }}>
                Code sent to <strong>{phone}</strong>
              </p>

              {devHint && (
                <div
                  style={{
                    padding: "0.6rem 0.85rem",
                    background: "var(--forest-green-soft)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.85rem",
                    marginBottom: "1rem",
                  }}
                >
                  Dev OTP: <strong>{devHint}</strong>
                </div>
              )}

              <div className="float-field" style={{ marginBottom: "1rem" }}>
                <input
                  type="text"
                  placeholder=" "
                  value={code}
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && void verify()}
                />
                <label>6-digit OTP *</label>
              </div>

              <button
                type="button"
                className="btn btn-green btn-block"
                style={{ height: 48, fontSize: "1rem" }}
                disabled={busy}
                onClick={() => void verify()}
              >
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "0.85rem" }}>
                <button type="button" className="text-link" onClick={() => setStep("phone")}>
                  ← Change number
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
            </>
          )}
        </div>

        {!isApp && (
          <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>
            New here?{" "}
            <Link to="/" style={{ color: "#fff", textDecoration: "underline" }}>
              Browse the store
            </Link>
            {" "}— an account is created at checkout.
          </p>
        )}
      </div>
    </div>
  );
};
