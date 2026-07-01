import { useEffect, useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, apiEnabled, type SmsProviderConfigRow } from "@/lib/api";

interface FormState {
  mode: "test" | "live";
  username: string;
  password: string;
  senderId: string;
  peid: string;
  templateId: string;
  templateText: string;
  orderTemplateId: string;
  orderTemplateText: string;
  active: boolean;
}

const DEFAULT_OTP =
  "Your secret One Time Password (OTP) for creating eCommerce account {#var#}. Please do not share this with anyone. PVANAM";
const DEFAULT_ORDER =
  "Thanks for shopping. Your reference ID is {#var#}. Please visit our site again soon from {#var#}. PRAKRUTHIVANAM";

const EMPTY: FormState = {
  mode: "test",
  username: "",
  password: "",
  senderId: "PVANAM",
  peid: "",
  templateId: "1207162444616325184",
  templateText: DEFAULT_OTP,
  orderTemplateId: "1207173202559344872",
  orderTemplateText: DEFAULT_ORDER,
  active: false,
};

export const SmsProviderSettings = () => {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(apiEnabled);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [masked, setMasked] = useState<SmsProviderConfigRow | null>(null);

  const load = async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const row = await api.smsProvider();
      setMasked(row);
      setForm({
        mode: row.mode === "live" ? "live" : "test",
        username: row.username ?? "",
        password: "",
        senderId: row.senderId ?? "PVANAM",
        peid: row.peid ?? "",
        templateId: row.templateId ?? EMPTY.templateId,
        templateText: row.templateText ?? DEFAULT_OTP,
        orderTemplateId: row.orderTemplateId ?? EMPTY.orderTemplateId,
        orderTemplateText: row.orderTemplateText ?? DEFAULT_ORDER,
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
      const body: Partial<{
        mode: "test" | "live";
        username: string | null;
        password: string | null;
        senderId: string | null;
        peid: string | null;
        templateId: string | null;
        templateText: string | null;
        orderTemplateId: string | null;
        orderTemplateText: string | null;
        active: boolean;
      }> = {
        mode: form.mode,
        username: form.username.trim() || null,
        senderId: form.senderId.trim() || null,
        peid: form.peid.trim() || null,
        templateId: form.templateId.trim() || null,
        templateText: form.templateText.trim() || null,
        orderTemplateId: form.orderTemplateId.trim() || null,
        orderTemplateText: form.orderTemplateText.trim() || null,
        active: form.active,
      };
      if (form.password.trim()) body.password = form.password.trim();
      const row = await api.updateSmsProvider(body);
      setMasked(row);
      setForm((f) => ({ ...f, password: "" }));
      setBanner("SMS settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testSms = async () => {
    if (!testPhone.trim()) {
      setError("Enter a phone number for the test SMS.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.testSmsProvider({ phone: testPhone.trim() });
      setBanner("Test OTP SMS sent (uses DLT OTP template).");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!apiEnabled) {
    return (
      <Card title="SMS — SMSIdea">
        <p className="text-sm text-gray-500">Connect to the backend API to configure SMS.</p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card title="SMS — SMSIdea">
        <Loader2 className="animate-spin" size={20} />
      </Card>
    );
  }

  return (
    <Card
      title="SMS — SMSIdea (DLT)"
      actions={
        <Chip tone={masked?.active ? "success" : "neutral"}>
          {masked?.active ? "Active" : "Inactive"}
        </Chip>
      }
    >
      {banner && <p className="text-sm text-green-700 mb-3">{banner}</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <p className="text-caption text-ink-muted mb-3">
        Templates from your DLT registration. OTP uses{" "}
        <strong>eCommerce OTP ORG Final</strong> (not password reset). Order SMS uses{" "}
        <strong>shopping information</strong> after payment.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Mode
          <select
            className="mt-1 w-full border rounded px-2 py-1.5"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as "test" | "live" })}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
        <Input
          label="Sender ID (DLT header)"
          value={form.senderId}
          onChange={(e) => setForm({ ...form, senderId: e.target.value })}
        />
        <Input
          label="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <Input
          label="Password / API key"
          type="password"
          value={form.password}
          placeholder={masked?.hasPassword ? "Leave blank to keep current" : ""}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Input
          label="DLT Principal Entity ID (PEID)"
          value={form.peid}
          onChange={(e) => setForm({ ...form, peid: e.target.value })}
          className="col-span-2"
        />
      </div>

      <div className="mt-4 rounded-md border border-border p-3 space-y-3">
        <p className="text-body-sm font-semibold text-ink">OTP login (eCommerce OTP ORG Final)</p>
        <Input
          label="DLT Template ID"
          value={form.templateId}
          onChange={(e) => setForm({ ...form, templateId: e.target.value })}
        />
        <label className="text-sm block">
          Template text (must match DLT exactly; {"{#var#}"} = OTP)
          <textarea
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm min-h-[72px]"
            value={form.templateText}
            onChange={(e) => setForm({ ...form, templateText: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 rounded-md border border-border p-3 space-y-3">
        <p className="text-body-sm font-semibold text-ink">Order confirmed (shopping information)</p>
        <Input
          label="DLT Template ID"
          value={form.orderTemplateId}
          onChange={(e) => setForm({ ...form, orderTemplateId: e.target.value })}
        />
        <label className="text-sm block">
          Template text ({"{#var#}"} = order ref, then storefront URL)
          <textarea
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm min-h-[72px]"
            value={form.orderTemplateText}
            onChange={(e) => setForm({ ...form, orderTemplateText: e.target.value })}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 mt-3 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
        />
        Active (required in production to send real SMS)
      </label>

      <div className="flex flex-wrap gap-2 mt-4 items-end">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Save
        </Button>
        <Input label="Test phone" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
        <Button variant="secondary" onClick={() => void testSms()} disabled={busy}>
          <Send size={16} /> Test OTP SMS
        </Button>
      </div>
    </Card>
  );
};
