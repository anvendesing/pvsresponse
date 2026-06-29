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
  templateId: string;
  templateText: string;
  active: boolean;
}

const EMPTY: FormState = {
  mode: "test",
  username: "",
  password: "",
  senderId: "",
  templateId: "",
  templateText: "Your PVS verification code is {otp}. Valid for 10 minutes.",
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
        senderId: row.senderId ?? "",
        templateId: row.templateId ?? "",
        templateText: row.templateText ?? EMPTY.templateText,
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
        templateId: string | null;
        templateText: string | null;
        active: boolean;
      }> = {
        mode: form.mode,
        username: form.username.trim() || null,
        senderId: form.senderId.trim() || null,
        templateId: form.templateId.trim() || null,
        templateText: form.templateText.trim() || null,
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
      setBanner("Test SMS sent.");
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
      title="SMS — SMSIdea Integration"
      actions={
        <Chip tone={masked?.active ? "success" : "neutral"}>
          {masked?.active ? "Active" : "Inactive"}
        </Chip>
      }
    >
      {banner && <p className="text-sm text-green-700 mb-3">{banner}</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

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
          label="Sender ID"
          value={form.senderId}
          onChange={(e) => setForm({ ...form, senderId: e.target.value })}
        />
        <Input
          label="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          placeholder={masked?.hasPassword ? "Leave blank to keep current" : ""}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Input
          label="DLT Template ID"
          value={form.templateId}
          onChange={(e) => setForm({ ...form, templateId: e.target.value })}
        />
      </div>

      <div className="mt-3">
        <label className="text-sm block mb-1">OTP message template</label>
        <textarea
          className="w-full border rounded px-2 py-1.5 text-sm min-h-[80px]"
          value={form.templateText}
          onChange={(e) => setForm({ ...form, templateText: e.target.value })}
        />
        <p className="text-xs text-gray-500 mt-1">Use {"{otp}"} for the verification code.</p>
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
          <Send size={16} /> Test SMS
        </Button>
      </div>
    </Card>
  );
};
