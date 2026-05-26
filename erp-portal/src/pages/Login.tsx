import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Lock, ScanLine, Shield, User } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, auth as authStore } from "@/lib/api";
import { useBrand } from "@/hooks/useBrand";

export const Login = () => {
  const navigate = useNavigate();
  const { brandName, logoUrl } = useBrand();
  const monogram = (brandName?.trim()?.[0] ?? "N").toUpperCase();
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("arjun.patel");
  const [password, setPassword] = useState("nova1234");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (!apiEnabled) {
        throw new Error("VITE_API_URL is not configured. Cannot reach the backend.");
      }
      const res = await api.login(username, password);
      authStore.set(res.token, res.user);
      navigate("/dashboard");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const tapPin = async (n: string) => {
    const next = (pin + n).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      setErr(null);
      setLoading(true);
      try {
        if (!apiEnabled) {
          throw new Error("VITE_API_URL is not configured. Cannot reach the backend.");
        }
        const res = await api.pinLogin(username, next);
        authStore.set(res.token, res.user);
        navigate("/dashboard");
      } catch (e) {
        setErr((e as Error).message);
        setPin("");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-canvas">
      {/* Left: brand panel */}
      <div className="hidden lg:flex w-[45%] bg-primary text-white p-12 flex-col justify-between relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 30%, #009CDE 0px, transparent 200px), radial-gradient(circle at 80% 70%, #F5BA2E 0px, transparent 240px)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-12">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brandName}
                className="h-11 w-11 rounded-md object-contain bg-white"
              />
            ) : (
              <div className="h-11 w-11 rounded-md bg-white text-primary grid place-items-center font-extrabold text-2xl">
                {monogram}
              </div>
            )}
            <div>
              <div className="text-h3 font-bold">{brandName}</div>
              <div className="text-caption opacity-80 uppercase tracking-widest">
                High-Performance Manufacturing
              </div>
            </div>
          </div>
          <h1 className="text-display leading-[1.1] font-bold mb-4">
            Built for the
            <br />
            shop floor.
          </h1>
          <p className="text-body opacity-85 max-w-[420px] leading-relaxed">
            Keyboard-first, scanner-first ERP for warehouse, manufacturing, procurement, and
            billing. Operates online or offline at industrial speed.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-3">
          {[
            { label: "Avg. scan", value: "<50ms" },
            { label: "Screen switch", value: "<200ms" },
            { label: "Offline ready", value: "100%" },
          ].map((s) => (
            <div key={s.label} className="bg-white/10 border border-white/20 rounded-lg p-3">
              <div className="text-caption opacity-80 uppercase tracking-wide">{s.label}</div>
              <div className="text-h3 font-bold mt-1 tnum">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brandName}
                className="h-9 w-9 rounded-md object-contain bg-white border border-border"
              />
            ) : (
              <div className="h-9 w-9 rounded-md bg-primary text-white grid place-items-center font-bold">
                {monogram}
              </div>
            )}
            <div className="text-h3 font-bold">{brandName}</div>
          </div>
          <h2 className="text-h1 font-bold mb-2">Sign in</h2>
          <p className="text-body text-ink-muted mb-3">
            Enter your credentials to start your shift.
          </p>
          <div
            className={`mb-6 inline-flex items-center gap-2 px-3 h-7 rounded-full text-caption font-semibold ${
              apiEnabled
                ? "bg-success-soft text-success"
                : "bg-danger-soft text-danger"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                apiEnabled ? "bg-success animate-pulse" : "bg-danger"
              }`}
            />
            {apiEnabled ? "Connected to backend API" : "Backend unreachable"}
          </div>
          {err && (
            <div className="mb-4 px-3 py-2 rounded-md bg-danger-soft text-danger text-caption font-semibold">
              {err}
            </div>
          )}

          <div className="inline-flex p-1 bg-canvas rounded-md border border-border mb-6">
            <button
              onClick={() => setMode("password")}
              className={`px-4 h-8 rounded text-body-sm font-semibold transition-colors ${
                mode === "password" ? "bg-white text-primary shadow-e1" : "text-ink-muted"
              }`}
            >
              Password
            </button>
            <button
              onClick={() => setMode("pin")}
              className={`px-4 h-8 rounded text-body-sm font-semibold transition-colors ${
                mode === "pin" ? "bg-white text-primary shadow-e1" : "text-ink-muted"
              }`}
            >
              PIN (Operator)
            </button>
          </div>

          {mode === "password" ? (
            <form onSubmit={submit} className="space-y-4">
              <Input
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                iconLeft={<User size={16} />}
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                iconLeft={<Lock size={16} />}
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-body-sm text-ink-muted">
                  <input type="checkbox" defaultChecked className="accent-primary" />
                  Keep me signed in
                </label>
                <a className="text-body-sm font-semibold text-primary hover:underline" href="#">
                  Forgot?
                </a>
              </div>
              <Button type="submit" size="lg" className="w-full" loading={loading}>
                Sign in to {brandName}
              </Button>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button variant="outline" type="button" icon={<ScanLine size={16} />}>
                  Scan badge
                </Button>
                <Button variant="outline" type="button" icon={<Fingerprint size={16} />}>
                  Biometric
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <div className="flex items-center justify-center gap-2 mb-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-12 w-10 rounded-md border-2 grid place-items-center text-h2 tnum font-bold ${
                      pin.length > i
                        ? "border-primary bg-primary-50 text-primary"
                        : "border-border bg-white text-ink-muted"
                    }`}
                  >
                    {pin.length > i ? "•" : ""}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                  <button
                    key={n}
                    onClick={() => tapPin(n)}
                    className="h-14 rounded-md bg-white border border-border text-h2 font-bold tnum hover:border-primary hover:text-primary transition-colors"
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPin("")}
                  className="h-14 rounded-md bg-canvas border border-border text-body-sm font-semibold text-ink-muted hover:text-danger"
                >
                  Clear
                </button>
                <button
                  onClick={() => tapPin("0")}
                  className="h-14 rounded-md bg-white border border-border text-h2 font-bold tnum hover:border-primary hover:text-primary"
                >
                  0
                </button>
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="h-14 rounded-md bg-canvas border border-border text-body-sm font-semibold text-ink-muted hover:text-primary"
                >
                  ⌫
                </button>
              </div>
              {loading && (
                <div className="mt-4 text-center text-body-sm text-primary font-semibold">
                  Verifying PIN…
                </div>
              )}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-border flex items-center justify-between text-caption text-ink-muted">
            <div className="flex items-center gap-2">
              <Shield size={12} />
              <span>End-to-end encrypted · v1.0.0</span>
            </div>
            <div>WH-MAIN · Pune Plant</div>
          </div>
        </div>
      </div>
    </div>
  );
};
