import { useEffect, useState } from "react";
import { ChevronDown, Loader2, MapPin, RefreshCw, Save, Send } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type ShiprocketConfigRow, type ShiprocketPickupLocationRow } from "@/lib/api";

interface FormState {
  email: string;
  password: string;
  pickupPincode: string;
  pickupLocation: string;
  active: boolean;
}

const EMPTY: FormState = {
  email: "",
  password: "",
  pickupPincode: "",
  pickupLocation: "",
  active: false,
};

export const ShiprocketSettings = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(apiEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [masked, setMasked] = useState<ShiprocketConfigRow | null>(null);
  const [locations, setLocations] = useState<ShiprocketPickupLocationRow[] | null>(null);
  const [fetchingLocations, setFetchingLocations] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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
        pickupLocation: row.pickupLocation ?? "",
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
        pickupLocation: string | null;
        active: boolean;
      } = {
        email: form.email.trim() || null,
        pickupPincode: form.pickupPincode.trim() || null,
        pickupLocation: form.pickupLocation.trim() || null,
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

  const fetchLocations = async () => {
    setFetchingLocations(true);
    setLocationError(null);
    try {
      const list = await api.shiprocketPickupLocations();
      setLocations(list);
      if (list.length === 1 && !form.pickupLocation) {
        setForm((f) => ({ ...f, pickupLocation: list[0].name }));
      }
    } catch (e) {
      setLocationError((e as Error).message);
    } finally {
      setFetchingLocations(false);
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
          Live courier rates at checkout and automatic AWB assignment when ecommerce orders are
          packed. Env fallback:{" "}
          <code className="font-mono text-caption">SHIPROCKET_EMAIL</code>,{" "}
          <code className="font-mono text-caption">SHIPROCKET_PASSWORD</code>,{" "}
          <code className="font-mono text-caption">SHIPROCKET_PICKUP_PINCODE</code>,{" "}
          <code className="font-mono text-caption">SHIPROCKET_PICKUP_LOCATION</code>.
        </p>

        {loading ? (
          <div className="p-8 grid place-items-center text-ink-muted">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Use Shiprocket for storefront shipping quotes &amp; dispatch
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
                masked?.hasPassword ? `Saved (${masked.password ?? "****"}) — leave blank to keep` : "Shiprocket password"
              }
            />

            <Input
              label="Pickup pincode"
              value={form.pickupPincode}
              onChange={(e) => setForm((f) => ({ ...f, pickupPincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
              placeholder="6-digit warehouse pincode"
            />

            {/* Pickup location — fetched from Shiprocket */}
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1 flex items-center gap-1">
                <MapPin size={12} /> Pickup location
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-1">
                  {locations && locations.length > 0 ? (
                    <div className="relative">
                      <select
                        className="h-9 w-full appearance-none rounded-md border border-border bg-white px-3 pr-8 text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        value={form.pickupLocation}
                        onChange={(e) => setForm((f) => ({ ...f, pickupLocation: e.target.value }))}
                      >
                        <option value="">— select a location —</option>
                        {locations.map((l) => {
                          // Shiprocket status: 1 = Active, 0 = Inactive, 2 = Pending
                          const s = Number(l.status);
                          const isActive  = s === 1;
                          const isPending = s === 2;
                          const label = isActive ? "" : isPending ? " (pending)" : " (inactive)";
                          return (
                            <option key={l.name} value={l.name} disabled={!isActive && !isPending}>
                              {l.name}{label} · {l.address}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-2.5 text-ink-muted" />
                    </div>
                  ) : (
                    <Input
                      value={form.pickupLocation}
                      onChange={(e) => setForm((f) => ({ ...f, pickupLocation: e.target.value }))}
                      placeholder="e.g. Warehouse 1 — click Fetch to see options"
                    />
                  )}
                  {locationError && (
                    <p className="text-caption text-danger mt-1">{locationError}</p>
                  )}
                  <p className="text-caption text-ink-muted mt-1">
                    Must match the pickup location name exactly as registered in your Shiprocket panel.
                    {form.pickupLocation && (
                      <> Currently: <strong className="text-ink">{form.pickupLocation}</strong>.</>
                    )}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  icon={fetchingLocations ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  onClick={() => void fetchLocations()}
                  disabled={fetchingLocations || !form.email}
                  title="Fetch pickup locations from your Shiprocket account"
                >
                  Fetch
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button size="sm" variant="outline" icon={<Send size={14} />} onClick={() => void testAuth()} disabled={busy}>
                Test login
              </Button>
              <Button size="sm" icon={<Save size={14} />} onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
