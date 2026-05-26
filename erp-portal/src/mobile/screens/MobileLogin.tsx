import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../../lib/api";
import {
  setDeviceWarehouse,
  useDeviceWarehouse,
} from "../useDeviceWarehouse";
import { useBrand } from "../../hooks/useBrand";

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city?: string;
}

// Two-step login:
//   1. Username + 6-digit PIN via /v1/auth/pin (existing endpoint).
//   2. Pick the warehouse the device will own. Persisted per device,
//      not per session - swapping users on the same handheld doesn't
//      change which warehouse it serves until they explicitly switch.
//
// Username falls back to a clearly-recognisable list. Workers can also
// type their username manually if they're not in the dropdown.

export const MobileLogin = () => {
  const nav = useNavigate();
  const wh = useDeviceWarehouse();
  const { brandName, logoUrl } = useBrand();
  const monogram = (brandName?.trim()?.[0] ?? "N").toUpperCase();
  const [step, setStep] = useState<"who" | "pin" | "warehouse">(
    auth.token() ? (wh ? "warehouse" : "warehouse") : "who"
  );
  const [users, setUsers] = useState<{ username: string; name: string }[]>([]);
  const [username, setUsername] = useState<string>(
    auth.user()?.username ?? ""
  );
  const [manual, setManual] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  // Pull the public list of warehouse-role usernames so workers don't
  // have to memorise theirs. Falls back to manual entry on failure.
  useEffect(() => {
    if (step !== "who") return;
    let cancelled = false;
    fetch(`${import.meta.env.VITE_API_URL}/v1/auth/pin/users`)
      .then(async (r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setUsers(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [step]);

  // After login, fetch warehouses once the user lands on the picker.
  useEffect(() => {
    if (step !== "warehouse") return;
    let cancelled = false;
    api
      .warehouses()
      .then((rows) => {
        if (!cancelled) setWarehouses(rows as unknown as WarehouseRow[]);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load warehouses; check connection.");
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  const onPickUser = (uname: string) => {
    setUsername(uname);
    setError(null);
    setStep("pin");
  };

  const onSubmitPin = async () => {
    if (pin.length !== 6) {
      setError("PIN must be 6 digits.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.pinLogin(username, pin);
      auth.set(result.token, result.user);
      if (wh) {
        nav("/m/tasks", { replace: true });
      } else {
        setStep("warehouse");
      }
    } catch (err) {
      setError((err as Error).message ?? "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const onPickWarehouse = (w: WarehouseRow) => {
    setDeviceWarehouse({ id: w.id, code: w.code, name: w.name });
    nav("/m/tasks", { replace: true });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#003087] text-white">
      <div className="flex-1 px-6 py-10">
        <div className="mb-8 flex flex-col items-center gap-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={brandName}
              className="h-14 w-14 rounded-2xl bg-white/15 object-contain p-2"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-2xl font-bold">
              {monogram}
            </div>
          )}
          <h1 className="text-2xl font-semibold">{brandName} Warehouse</h1>
          <p className="text-sm text-white/70">
            {step === "who" && "Sign in to start picking and packing."}
            {step === "pin" && `Enter your 6-digit PIN, ${username}.`}
            {step === "warehouse" && "Choose this device's warehouse."}
          </p>
        </div>

        {step === "who" && (
          <div className="space-y-3">
            {!manual && users.length > 0 && (
              <ul className="space-y-2">
                {users.map((u) => (
                  <li key={u.username}>
                    <button
                      type="button"
                      onClick={() => onPickUser(u.username)}
                      className="flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-left hover:bg-white/15"
                    >
                      <div>
                        <div className="text-base font-medium">{u.name}</div>
                        <div className="text-xs text-white/60">{u.username}</div>
                      </div>
                      <span className="text-white/60">→</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-4">
              {manual ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (username.trim()) onPickUser(username.trim());
                  }}
                  className="space-y-3"
                >
                  <input
                    autoFocus
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-base placeholder:text-white/40 focus:border-white/60 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-white px-4 py-3 text-base font-semibold text-[#003087]"
                  >
                    Continue
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setManual(true)}
                  className="w-full rounded-xl border border-white/30 bg-transparent px-4 py-3 text-sm font-medium text-white/80"
                >
                  Use another username
                </button>
              )}
            </div>
          </div>
        )}

        {step === "pin" && (
          <div className="space-y-6">
            <div className="flex items-center justify-center gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className={[
                    "h-3 w-3 rounded-full border border-white/40",
                    i < pin.length ? "bg-white" : "bg-transparent",
                  ].join(" ")}
                />
              ))}
            </div>
            <PinPad
              onDigit={(d) => {
                setError(null);
                setPin((p) => (p.length < 6 ? p + d : p));
              }}
              onBack={() => setPin((p) => p.slice(0, -1))}
              onClear={() => setPin("")}
              onSubmit={onSubmitPin}
              disabled={busy}
              valid={pin.length === 6}
            />
            <button
              type="button"
              onClick={() => setStep("who")}
              className="block w-full text-center text-xs text-white/70"
            >
              Sign in as a different user
            </button>
          </div>
        )}

        {step === "warehouse" && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {warehouses.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => onPickWarehouse(w)}
                    className="flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-left hover:bg-white/15"
                  >
                    <div>
                      <div className="text-base font-medium">{w.name}</div>
                      <div className="text-xs text-white/60">
                        {w.code}
                        {w.city ? ` • ${w.city}` : ""}
                      </div>
                    </div>
                    <span className="text-white/60">→</span>
                  </button>
                </li>
              ))}
              {warehouses.length === 0 && (
                <li className="rounded-xl bg-white/10 px-4 py-6 text-center text-sm text-white/70">
                  Loading warehouses…
                </li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-red-500/20 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
      </div>

      <footer className="px-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-2 text-center text-[11px] text-white/40">
        {brandName} Mobile · v1.0
      </footer>
    </div>
  );
};

// =====================================================================
// PinPad
// =====================================================================
// Stays inside this file because the only screen that uses it is
// MobileLogin. Each key is a 56x56 hit target (well past the 44px
// minimum) with no hover state - this is built for thumbs.

const KEYS: (string | "back" | "clear")[] = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "clear", "0", "back",
];

const PinPad = ({
  onDigit,
  onBack,
  onClear,
  onSubmit,
  disabled,
  valid,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  onClear: () => void;
  onSubmit: () => void;
  disabled: boolean;
  valid: boolean;
}) => {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => {
          if (k === "back") {
            return (
              <button
                key="back"
                type="button"
                onClick={onBack}
                disabled={disabled}
                className="h-16 rounded-2xl bg-white/10 text-lg font-semibold text-white/90 active:bg-white/20 disabled:opacity-50"
              >
                ⌫
              </button>
            );
          }
          if (k === "clear") {
            return (
              <button
                key="clear"
                type="button"
                onClick={onClear}
                disabled={disabled}
                className="h-16 rounded-2xl bg-white/10 text-sm font-semibold text-white/70 active:bg-white/20 disabled:opacity-50"
              >
                Clear
              </button>
            );
          }
          return (
            <button
              key={k}
              type="button"
              onClick={() => onDigit(k)}
              disabled={disabled}
              className="h-16 rounded-2xl bg-white text-2xl font-semibold text-[#003087] active:bg-white/90 disabled:opacity-50"
            >
              {k}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !valid}
        className="h-14 w-full rounded-2xl bg-emerald-400 text-base font-bold text-emerald-950 active:bg-emerald-300 disabled:bg-emerald-400/30 disabled:text-emerald-950/50"
      >
        {disabled ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
};
