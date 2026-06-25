import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../../lib/api";
import { useBrand } from "../../hooks/useBrand";
import {
  setDeviceFacility,
  useDeviceFacility,
  type DeviceFacility,
} from "../useDeviceFacility";
import type { ProductionFacility } from "../../data/types";

// Two-step login (mirrors mobile/screens/MobileLogin):
//   1. Username + 6-digit PIN via /v1/auth/pin
//   2. Pick the production room (ProductionFacility) this device serves.
//      Persisted per-device; workers can switch from Profile.

type Step = "who" | "pin" | "room";

export const MfgLogin = () => {
  const nav = useNavigate();
  const facility = useDeviceFacility();
  const { brandName, logoUrl } = useBrand();
  const monogram = (brandName?.trim()?.[0] ?? "N").toUpperCase();

  const [step, setStep] = useState<Step>(
    auth.token() ? "room" : "who"
  );
  const [users, setUsers] = useState<{ username: string; name: string }[]>([]);
  const [username, setUsername] = useState<string>(
    auth.user()?.username ?? ""
  );
  const [manual, setManual] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<ProductionFacility[]>([]);

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

  useEffect(() => {
    if (step !== "room") return;
    let cancelled = false;
    api
      .productionFacilities({ active: true })
      .then((rows) => {
        if (!cancelled) setRooms(rows);
      })
      .catch(() => {
        if (!cancelled)
          setError("Could not load production rooms; check connection.");
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
      if (facility) nav("/mfg/room", { replace: true });
      else setStep("room");
    } catch (err) {
      setError((err as Error).message ?? "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const onPickRoom = (r: ProductionFacility) => {
    const payload: DeviceFacility = {
      id: r.id,
      code: r.code,
      name: r.name,
      productionLineWarehouseId: r.productionLineWarehouseId ?? null,
      productionLineWarehouseCode:
        r.productionLineWarehouse?.code ?? null,
      productionLineWarehouseName:
        r.productionLineWarehouse?.name ?? null,
    };
    setDeviceFacility(payload);
    nav("/mfg/room", { replace: true });
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
          <h1 className="text-2xl font-semibold">{brandName} Production</h1>
          <p className="text-sm text-white/70 text-center">
            {step === "who" && "Sign in to your production room."}
            {step === "pin" && `Enter your 6-digit PIN, ${username}.`}
            {step === "room" && "Choose this device's production room."}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-500/20 border border-red-300/40 px-4 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

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
              onClick={() => {
                setPin("");
                setStep("who");
              }}
              className="block w-full text-center text-xs text-white/70"
            >
              Sign in as a different user
            </button>
          </div>
        )}

        {step === "room" && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {rooms.length === 0 ? (
                <li className="rounded-xl bg-white/10 px-4 py-6 text-center text-sm text-white/70">
                  No active production rooms found. Ask a supervisor to set one up
                  under Settings → Production Facilities.
                </li>
              ) : (
                rooms.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onPickRoom(r)}
                      className="flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-left hover:bg-white/15"
                    >
                      <div className="min-w-0">
                        <div className="text-base font-medium truncate">
                          {r.name}
                        </div>
                        <div className="text-xs text-white/60 truncate">
                          {r.code}
                          {r.productionLineWarehouse?.code
                            ? ` · line WH: ${r.productionLineWarehouse.code}`
                            : ""}
                        </div>
                      </div>
                      <span className="text-white/60">→</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              onClick={() => {
                auth.clear();
                setStep("who");
                setPin("");
                setUsername("");
              }}
              className="block w-full pt-4 text-center text-xs text-white/70"
            >
              Sign in as a different user
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Inline PIN pad (copied & trimmed from MobileLogin) ---------------

interface PinPadProps {
  onDigit: (digit: string) => void;
  onBack: () => void;
  onClear: () => void;
  onSubmit: () => void;
  disabled: boolean;
  valid: boolean;
}

const PinPad = ({
  onDigit,
  onBack,
  onClear,
  onSubmit,
  disabled,
  valid,
}: PinPadProps) => {
  const keys: Array<{ label: string; onClick: () => void; variant?: "action" }> = [
    { label: "1", onClick: () => onDigit("1") },
    { label: "2", onClick: () => onDigit("2") },
    { label: "3", onClick: () => onDigit("3") },
    { label: "4", onClick: () => onDigit("4") },
    { label: "5", onClick: () => onDigit("5") },
    { label: "6", onClick: () => onDigit("6") },
    { label: "7", onClick: () => onDigit("7") },
    { label: "8", onClick: () => onDigit("8") },
    { label: "9", onClick: () => onDigit("9") },
    { label: "Clear", onClick: onClear, variant: "action" },
    { label: "0", onClick: () => onDigit("0") },
    { label: "⌫", onClick: onBack, variant: "action" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.onClick}
            disabled={disabled}
            className={[
              "h-14 rounded-2xl text-lg font-semibold transition-colors",
              k.variant === "action"
                ? "bg-white/10 text-white/80 text-sm"
                : "bg-white/15 text-white hover:bg-white/25",
            ].join(" ")}
          >
            {k.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !valid}
        className={[
          "w-full rounded-2xl px-4 py-3 text-base font-semibold transition-colors",
          valid
            ? "bg-white text-[#003087]"
            : "bg-white/20 text-white/50 cursor-not-allowed",
        ].join(" ")}
      >
        {disabled ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
};
