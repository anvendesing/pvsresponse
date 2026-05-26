// Dummy login. The OTP flow accepts ANY 6-digit code (we never
// actually send one); the password flow accepts ANY non-empty
// password. Both paths build the AuthUser from name + email + phone
// and stash it in the AuthContext.
//
// We capture name+email+phone here so the order-history endpoint
// has something to query against, mirroring the data we ask for at
// checkout. In a real storefront this would be replaced by OTP /
// magic-link sign-in tied to CustomerAccount.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";

type Tab = "otp" | "pass";

export const LoginPage = () => {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("otp");

  // Shared profile fields (we collect them in both flows so the
  // dashboard has something to display; in a real impl name would
  // come from CustomerAccount, not the login form).
  const [name, setName] = useState(auth.user?.name ?? "");
  const [email, setEmail] = useState(auth.user?.email ?? "");
  const [phone, setPhone] = useState(auth.user?.phone ?? "");

  // OTP-specific
  const [otpRequested, setOtpRequested] = useState(false);
  const [otp, setOtp] = useState("");

  // Password-specific
  const [password, setPassword] = useState("");

  const requestOtp = () => {
    if (!phone || !/^[6-9][0-9]{9}$/.test(phone)) {
      toast.show("Enter a valid 10-digit mobile number.", "error");
      return;
    }
    setOtpRequested(true);
    toast.show("OTP sent (dummy). Enter any 6 digits.", "success");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (tab === "otp") {
      if (!otpRequested) {
        requestOtp();
        return;
      }
      if (!/^[0-9]{6}$/.test(otp)) {
        toast.show("OTP must be 6 digits.", "error");
        return;
      }
    } else if (!password.trim()) {
      toast.show("Enter your password.", "error");
      return;
    }

    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.show("Please fill name, email, and phone.", "error");
      return;
    }
    auth.signIn({ name, email, phone });
    toast.show(`Welcome back, ${name.split(" ")[0]}!`, "success");
    navigate("/account");
  };

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
      <div className="card-soft" style={{ width: "100%", maxWidth: 460, padding: "2rem" }}>
        <h1
          className="serif-title"
          style={{
            fontSize: "1.8rem",
            color: "var(--forest-green-dark)",
            marginBottom: "0.4rem",
          }}
        >
          Welcome back
        </h1>
        <p className="muted" style={{ marginBottom: "1.25rem", fontSize: "0.9rem" }}>
          Sign in to track orders and save your wishlist. (This is a demo - no real
          credentials are required.)
        </p>

        <div
          style={{
            display: "flex",
            background: "var(--neutral-cream)",
            borderRadius: "var(--radius-full)",
            padding: "0.25rem",
            marginBottom: "1.25rem",
          }}
        >
          <TabButton active={tab === "otp"} onClick={() => setTab("otp")}>
            OTP Sign-In
          </TabButton>
          <TabButton active={tab === "pass"} onClick={() => setTab("pass")}>
            Password
          </TabButton>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <Field label="Full name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Mobile number" required>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              pattern="[6-9][0-9]{9}"
              required
            />
          </Field>

          {tab === "otp" ? (
            <>
              {otpRequested && (
                <Field label="OTP (any 6 digits)" required>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </Field>
              )}
              <button
                type="submit"
                className="btn btn-green btn-block"
                style={{ marginTop: "0.5rem", height: 48 }}
              >
                {otpRequested ? "Verify OTP" : "Request OTP"}
              </button>
            </>
          ) : (
            <>
              <Field label="Password" required>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <button
                type="submit"
                className="btn btn-green btn-block"
                style={{ marginTop: "0.5rem", height: 48 }}
              >
                Sign in
              </button>
            </>
          )}
        </form>

        <p style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
          New here?{" "}
          <Link to="/" className="text-link">
            Browse the store
          </Link>{" "}
          - account is created automatically when you place an order.
        </p>
      </div>
    </div>
  );
};

const TabButton = ({
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
      flex: 1,
      padding: "0.6rem 1rem",
      borderRadius: "var(--radius-full)",
      background: active ? "var(--neutral-white)" : "transparent",
      color: active ? "var(--forest-green)" : "var(--neutral-gray)",
      fontWeight: active ? 700 : 500,
      fontSize: "0.85rem",
      boxShadow: active ? "var(--shadow-sm)" : "none",
    }}
  >
    {children}
  </button>
);

const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="float-field">
    {children}
    <label>
      {label}
      {required && " *"}
    </label>
  </div>
);
