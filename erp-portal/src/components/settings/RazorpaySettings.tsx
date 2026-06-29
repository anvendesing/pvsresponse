import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type PaymentGatewayConfigRow } from "@/lib/api";

interface FormState {
  mode: "test" | "live";
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  active: boolean;
}

const EMPTY: FormState = {
  mode: "test",
  keyId: "",
  keySecret: "",
  webhookSecret: "",
  active: false,
};

export const RazorpaySettings = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(apiEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [masked, setMasked] = useState<PaymentGatewayConfigRow | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const row = await api.paymentGateway("razorpay");
      setMasked(row);
      setForm({
        mode: row.mode === "live" ? "live" : "test",
        keyId: row.keyId ?? "",
        keySecret: "",
        webhookSecret: "",
        active: row.active,
      });
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 404) {
        setMasked(null);
        setForm(EMPTY);
      } else {
        setError((e as Error).message);
      }
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
        mode: "test" | "live";
        keyId: string | null;
        keySecret?: string | null;
        webhookSecret?: string | null;
        active: boolean;
      } = {
        mode: form.mode,
        keyId: form.keyId.trim() || null,
        active: form.active,
      };
      if (form.keySecret.trim()) body.keySecret = form.keySecret.trim();
      if (form.webhookSecret.trim()) body.webhookSecret = form.webhookSecret.trim();

      const updated = await api.updatePaymentGateway("razorpay", body);
      setMasked(updated);
      setForm((f) => ({ ...f, keySecret: "", webhookSecret: "" }));
      setBanner("Razorpay settings saved.");
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
        title="Payment — Razorpay"
        actions={
          <Chip tone={form.active ? "success" : "neutral"} size="sm">
            {form.active ? "Active" : "Inactive"}
          </Chip>
        }
      >
        <p className="text-body-sm text-ink-muted px-4 pb-3 border-b border-border">
          Powers storefront checkout (UPI, cards, net banking). Use test keys until UAT is complete.
          Webhook URL: <code className="font-mono text-caption">POST /v1/webhooks/razorpay</code>
        </p>

        {loading ? (
          <div className="p-8 grid place-items-center text-ink-muted">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-caption text-ink-muted uppercase font-semibold mb-1">Mode</div>
                <select
                  className="h-9 w-full bg-surface border border-border rounded-md px-2 text-body-sm"
                  value={form.mode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mode: e.target.value as "test" | "live" }))
                  }
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </div>
              <label className="flex items-end gap-2 text-body-sm pb-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Enable Razorpay on storefront
              </label>
            </div>
            <Input
              label="Key ID"
              value={form.keyId}
              onChange={(e) => setForm((f) => ({ ...f, keyId: e.target.value }))}
              placeholder="rzp_test_…"
            />
            <Input
              label="Key secret"
              type="password"
              value={form.keySecret}
              onChange={(e) => setForm((f) => ({ ...f, keySecret: e.target.value }))}
              placeholder={
                masked?.keySecret ? `Saved (${masked.keySecret}) — leave blank to keep` : "Enter key secret"
              }
            />
            <Input
              label="Webhook secret"
              type="password"
              value={form.webhookSecret}
              onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
              placeholder={
                masked?.webhookSecret
                  ? `Saved (${masked.webhookSecret}) — leave blank to keep`
                  : "From Razorpay dashboard"
              }
            />
            <div className="flex justify-end pt-2">
              <Button size="sm" icon={<Save size={14} />} onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save Razorpay settings"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
