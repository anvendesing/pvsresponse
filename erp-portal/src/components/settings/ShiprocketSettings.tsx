import { useEffect, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type ShiprocketConfigRow } from "@/lib/api";

interface FormState {
  email: string;
  password: string;
  pickupPincode: string;
  active: boolean;
}

const EMPTY: FormState = {
  email: "",
  password: "",
  pickupPincode: "",
  active: false,
};

export const ShiprocketSettings = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(apiEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [masked, setMasked] = useState<ShiprocketConfigRow | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const row = await api.shiprocketConfig();
      setMasked(row);
      setForm({
        email: row.email ?? "",
        password: "",
        pickupPincode: row.pickupPincode ?? "",
        active: row.active,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: {
        email: string | null;
        password?: string | null;
        pickupPincode: string | null;
        active: boolean;
      } = {
        email: form.email.trim() || null,
        pickupPincode: form.pickupPincode.trim() || null,
        active: form.active,
      };
      if (form.password.trim()) body.password = form.password.trim();

      const updated = await api.updateShiprocketConfig(body);
      setMasked(updated);
      setForm((f) => ({ ...f, password: "" }));
      setBanner("Shiprocket settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testAuth = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.testShiprocketConfig();
      setBanner("Shiprocket login test succeeded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {banner && (
        <div className="bg-success-soft border border-success text-success px-3 py-2 rounded-md text-body-sm flex justify-between">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="underline text-caption">
            dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="bg-danger-soft border border-danger text-danger px-3 py-2 rounded-md text-body-sm">
          {error}
        </div>
      )}

      <Card
        title="Shipping — Shiprocket"
        actions={
          <Chip tone={form.active ? "success" : "neutral"} size="sm">
            {form.active ? "Active" : "Inactive"}
          </Chip>
        }
      >
        <p className="text-body-sm text-ink-muted px-4 pb-3 border-b border-border">
          Live courier rates at checkout via Shiprocket serviceability API. Falls back to heuristic
          rates when inactive or auth fails. Env fallback:{" "}
          <code className="font-mono text-caption">SHIPROCKET_EMAIL</code>,{" "}
          <code className="font-mono text-caption">SHIPROCKET_PASSWORD</code>,{" "}
          <code className="font-mono text-caption">SHIPROCKET_PICKUP_PINCODE</code>.
        </p>

        {loading ? (
          <div className="p-8 grid place-items-center text-ink-muted">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Use Shiprocket for storefront shipping quotes
            </label>
            <Input
              label="API email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Shiprocket account email"
            />
            <Input
              label="API password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={
                masked?.password ? `Saved (${masked.password}) — leave blank to keep` : "Shiprocket password"
              }
            />
            <Input
              label="Pickup pincode"
              value={form.pickupPincode}
              onChange={(e) => setForm((f) => ({ ...f, pickupPincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
              placeholder="6-digit warehouse pincode"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="outline" icon={<Send size={14} />} onClick={() => void testAuth()} disabled={busy}>
                Test login
              </Button>
              <Button size="sm" icon={<Save size={14} />} onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save Shiprocket settings"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
