import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { OtpModal } from "@/components/OtpModal";
import { useAuth } from "@/state/AuthContext";

export const LoginPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "/account";
  const [otpOpen, setOtpOpen] = useState(false);

  if (auth.isAuthed) {
    navigate(redirect, { replace: true });
    return null;
  }

  return (
    <div
      style={{
        background: "var(--neutral-light)",
        minHeight: "70vh",
        padding: "3rem 1rem",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <OtpModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onSuccess={() => navigate(redirect, { replace: true })}
      />

      <div className="card-soft" style={{ width: "100%", maxWidth: 460, padding: "2rem" }}>
        <h1 className="serif-title" style={{ fontSize: "1.8rem", color: "var(--forest-green-dark)", marginBottom: "0.4rem" }}>
          Welcome back
        </h1>
        <p className="muted" style={{ marginBottom: "1.25rem", fontSize: "0.9rem" }}>
          Sign in with your mobile number to track orders and manage addresses.
        </p>

        <button
          type="button"
          className="btn btn-green btn-block"
          style={{ height: 48 }}
          onClick={() => setOtpOpen(true)}
        >
          Continue with OTP
        </button>

        <p style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
          New here?{" "}
          <Link to="/" className="text-link">
            Browse the store
          </Link>{" "}
          — an account is created automatically at checkout.
        </p>
      </div>
    </div>
  );
};
