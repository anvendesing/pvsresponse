import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  Building,
  Check,
  ChevronRight,
  Cog,
  Database,
  Factory,
  Gauge,
  Globe,
  Key,
  Loader2,
  MapPin,
  MessageSquare,
  Palette,
  Plus,
  Power,
  RotateCcw,
  Save,
  ScanLine,
  Shield,
  Smartphone,
  Tags,
  Trash2,
  Users,
  Warehouse as WarehouseIcon,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { Toolbar } from "@/components/common/Toolbar";
import {
  api,
  type CompanyProfile,
  type CompanyProfileUpdate,
  type PutawayRuleRow,
  type StockRuleRow,
  type WarehouseRow,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBrand } from "@/hooks/useBrand";
import { UserManager } from "@/components/settings/UserManager";
import { CategoryManager } from "@/components/settings/CategoryManager";

type SettingsSection = { id: string; label: string; icon: typeof Building };

const SECTION_GROUPS: { heading: string; sections: SettingsSection[] }[] = [
  {
    heading: "General",
    sections: [{ id: "company", label: "Company", icon: Building }],
  },
  {
    heading: "Warehouse & production",
    sections: [
      { id: "warehouses", label: "Warehouses", icon: WarehouseIcon },
      { id: "putaway", label: "Putaway rules", icon: ArrowRightLeft },
      { id: "stockrules", label: "Stock rules", icon: Gauge },
      { id: "production", label: "Production lines", icon: Factory },
    ],
  },
  {
    heading: "Catalog & access",
    sections: [
      { id: "categories", label: "Categories", icon: Tags },
      { id: "users", label: "Users & Roles", icon: Users },
      { id: "security", label: "Security", icon: Shield },
    ],
  },
  {
    heading: "Integrations",
    sections: [
      { id: "scanner", label: "Scanner", icon: ScanLine },
      { id: "sms", label: "SMS (SMSIdea)", icon: MessageSquare },
      { id: "payment", label: "Payment (CCAvenue)", icon: Key },
      { id: "sync", label: "Sync & Offline", icon: Wifi },
      { id: "backup", label: "Backup", icon: Database },
    ],
  },
  {
    heading: "Preferences",
    sections: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "mobile", label: "Mobile Apps", icon: Smartphone },
      { id: "lang", label: "Language", icon: Globe },
    ],
  },
];

const SECTIONS = SECTION_GROUPS.flatMap((g) => g.sections);

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));

const sectionFromQuery = (raw: string | null) =>
  raw && SECTION_IDS.has(raw) ? raw : null;

export const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [active, setActive] = useState(
    () => sectionFromQuery(searchParams.get("section")) ?? "company"
  );

  // Deep link: /settings?section=putaway
  useEffect(() => {
    const fromUrl = sectionFromQuery(searchParams.get("section"));
    if (fromUrl && fromUrl !== active) setActive(fromUrl);
  }, [searchParams]);

  const selectSection = (id: string) => {
    setActive(id);
    const next = new URLSearchParams(searchParams);
    if (id === "company") next.delete("section");
    else next.set("section", id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="h-full flex flex-col">
      <Toolbar left={<h2 className="text-h3 font-bold">Settings</h2>} />
      <div className="flex-1 grid grid-cols-12 min-h-0 bg-canvas">
        <aside className="col-span-3 bg-surface border-r border-border overflow-y-auto p-2 min-h-0">
          {SECTION_GROUPS.map((group) => (
            <div key={group.heading} className="mb-2">
              <div className="px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-ink-muted">
                {group.heading}
              </div>
              {group.sections.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectSection(s.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 h-9 rounded-md text-body-sm font-medium transition-colors",
                      active === s.id
                        ? "bg-primary text-white"
                        : "text-ink hover:bg-canvas hover:text-primary"
                    )}
                  >
                    <Icon size={16} />
                    <span className="flex-1 text-left">{s.label}</span>
                    <ChevronRight size={14} className={active === s.id ? "" : "text-ink-muted"} />
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="col-span-9 overflow-y-auto p-4 space-y-4">
          {active === "company" && <CompanyForm />}
          {active === "warehouses" && <WarehouseManager />}
          {active === "production" && <ProductionMaster />}
          {active === "putaway" && <PutawayRulesManager />}
          {active === "stockrules" && <StockRulesManager />}

          {active === "categories" && <CategoryManager />}

          {active === "users" && <UserManager />}

          {active === "security" && (
            <Card title="Security & Sessions">
              <div className="space-y-2">
                <Toggle label="Enforce 2FA for admins" on />
                <Toggle label="Allow biometric login (mobile)" on />
                <Toggle label="Auto-lock idle counters after 3 minutes" on />
                <Toggle label="Force logout on shift end" />
                <Toggle label="Session telemetry & device tracking" on />
              </div>
            </Card>
          )}

          {active === "scanner" && (
            <Card title="Barcode Scanner">
              <div className="space-y-2">
                <Toggle label="Trigger on Enter" on />
                <Toggle label="Auto-add to cart on scan" on />
                <Toggle label="Beep on duplicate" />
                <Toggle label="Vibrate on mobile" on />
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Input label="Min code length" defaultValue="6" />
                  <Input label="Throttle (ms)" defaultValue="40" />
                </div>
              </div>
            </Card>
          )}

          {active === "sms" && (
            <Card title="SMS — SMSIdea Integration" actions={<Chip tone="success">Connected</Chip>}>
              <div className="grid grid-cols-2 gap-3">
                <Input label="API key" type="password" defaultValue="************K23" />
                <Input label="Sender ID" defaultValue="NOVAMF" />
                <Input label="DLT Template ID" defaultValue="1107171234567890123" />
                <Input label="Default route" defaultValue="Transactional" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  "Invoice Generated",
                  "Dispatch Updates",
                  "OTP Verification",
                  "Worker Alerts",
                  "PO Approved",
                ].map((t) => (
                  <Toggle key={t} label={t} on />
                ))}
              </div>
            </Card>
          )}

          {active === "payment" && (
            <Card title="Payment — CCAvenue" actions={<Chip tone="success">Live</Chip>}>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Merchant ID" defaultValue="91234876" />
                <Input label="Access code" type="password" defaultValue="*************" />
                <Input label="Working key" type="password" defaultValue="*************" />
                <Input label="Settlement bank" defaultValue="HDFC Bank · Current" />
              </div>
            </Card>
          )}

          {active === "sync" && (
            <Card title="Sync & Offline">
              <div className="space-y-2">
                <Toggle label="Background delta sync (every 30s)" on />
                <Toggle label="Critical operations work offline (POS, transfer, MO)" on />
                <Toggle label="Conflict auto-resolve (server wins)" />
                <Toggle label="Compress payloads" on />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Local DB size" value="124 MB" />
                <Stat label="Last full sync" value="3 min ago" />
                <Stat label="Sync queue" value="3 items" />
              </div>
            </Card>
          )}

          {active === "backup" && (
            <Card title="Backups">
              <div className="space-y-2">
                <Toggle label="Hourly snapshots" on />
                <Toggle label="Daily off-site (S3)" on />
                <Toggle label="Encrypted at rest (AES-256)" on />
              </div>
            </Card>
          )}

          {active === "notifications" && (
            <Card title="Notifications">
              <div className="space-y-2">
                <Toggle label="Stock low alerts" on />
                <Toggle label="QC failure alerts" on />
                <Toggle label="Production delay alerts" on />
                <Toggle label="Approval requests" on />
                <Toggle label="Shift handover summary" />
              </div>
            </Card>
          )}

          {active === "appearance" && (
            <div className="space-y-4">
              <BrandNameForm />
              <Card title="Appearance">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {["Light", "Industrial Dark", "High Contrast"].map((t, i) => (
                    <button
                      key={t}
                      className={cn(
                        "border rounded-md p-3 text-left",
                        i === 0 ? "border-primary bg-primary-50" : "border-border hover:border-primary"
                      )}
                    >
                      <div className="font-semibold text-body-sm">{t}</div>
                      <div className="text-caption text-ink-muted mt-0.5">
                        {i === 0 ? "Default · Trust Blue Pay" : i === 1 ? "Optimized for night shift" : "WCAG AAA"}
                      </div>
                    </button>
                  ))}
                </div>
                <Toggle label="Larger touch targets (kiosk mode)" />
                <Toggle label="Reduce motion" />
              </Card>
            </div>
          )}

          {active === "mobile" && (
            <Card title="Mobile Apps">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Android version" value="1.0.4 · 2.1k installs" />
                <Stat label="iOS version" value="—" />
                <Stat label="Auto-update" value="Enabled" />
                <Stat label="Min SDK" value="Android 9 / iOS 14" />
              </div>
            </Card>
          )}

          {active === "lang" && (
            <Card title="Language & Locale">
              <div className="grid grid-cols-2 gap-3">
                <Input label="System language" defaultValue="English (India)" />
                <Input label="Currency" defaultValue="INR (₹)" />
                <Input label="Date format" defaultValue="dd MMM yyyy" />
                <Input label="Time zone" defaultValue="Asia/Kolkata (UTC+5:30)" />
              </div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
};

const Toggle = ({ label, on }: { label: string; on?: boolean }) => {
  const [v, setV] = useState(!!on);
  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-md border border-border bg-white">
      <span className="text-body-sm font-medium text-ink">{label}</span>
      <button
        onClick={() => setV((x) => !x)}
        className={cn(
          "h-6 w-10 rounded-full p-0.5 transition-colors",
          v ? "bg-primary" : "bg-border"
        )}
      >
        <div
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-e1 transition-transform",
            v && "translate-x-4"
          )}
        />
      </button>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-canvas border border-border rounded-md p-3">
    <div className="text-caption text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
    <div className="text-body font-bold text-ink mt-1">{value}</div>
  </div>
);

// =====================================================================
// Company Profile - controlled form with dirty tracking + sticky save bar.
// Loads the singleton from /v1/settings/company on mount; persists with PUT.
// =====================================================================

// Fields the user can edit. Wider type vs. CompanyProfile so that pre-load
// and reset states ("") don't crash the controlled inputs.
type FormState = Pick<
  CompanyProfile,
  | "legalName"
  | "tradeName"
  | "gstin"
  | "pan"
  | "cin"
  | "industry"
  | "addressLine"
  | "city"
  | "state"
  | "pincode"
  | "country"
  | "phone"
  | "email"
  | "website"
  | "invoicePrefix"
  | "quotePrefix"
  | "currency"
  | "fiscalYearStart"
  | "termsDefault"
  | "bankName"
  | "bankAccountNo"
  | "bankIfsc"
  | "bankBranch"
  | "upi"
> & { defaultTaxRate: number };

const blankForm: FormState = {
  legalName: "",
  tradeName: "",
  gstin: "",
  pan: "",
  cin: "",
  industry: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
  phone: "",
  email: "",
  website: "",
  invoicePrefix: "INV",
  quotePrefix: "Q",
  currency: "INR",
  fiscalYearStart: "04-01",
  defaultTaxRate: 18,
  termsDefault: "",
  bankName: "",
  bankAccountNo: "",
  bankIfsc: "",
  bankBranch: "",
  upi: "",
};

// Convert nullable server fields to strings (so controlled inputs are happy)
// and back. Empty strings are sent as null so the server doesn't store "".
const toForm = (p: CompanyProfile): FormState => ({
  legalName: p.legalName ?? "",
  tradeName: p.tradeName ?? "",
  gstin: p.gstin ?? "",
  pan: p.pan ?? "",
  cin: p.cin ?? "",
  industry: p.industry ?? "",
  addressLine: p.addressLine ?? "",
  city: p.city ?? "",
  state: p.state ?? "",
  pincode: p.pincode ?? "",
  country: p.country ?? "India",
  phone: p.phone ?? "",
  email: p.email ?? "",
  website: p.website ?? "",
  invoicePrefix: p.invoicePrefix ?? "INV",
  quotePrefix: p.quotePrefix ?? "Q",
  currency: p.currency ?? "INR",
  fiscalYearStart: p.fiscalYearStart ?? "04-01",
  defaultTaxRate: p.defaultTaxRate ?? 18,
  termsDefault: p.termsDefault ?? "",
  bankName: p.bankName ?? "",
  bankAccountNo: p.bankAccountNo ?? "",
  bankIfsc: p.bankIfsc ?? "",
  bankBranch: p.bankBranch ?? "",
  upi: p.upi ?? "",
});

const toPayload = (s: FormState): CompanyProfileUpdate => {
  const trim = (v: string) => v.trim();
  const nz = (v: string) => (trim(v) ? trim(v) : null);
  return {
    legalName: trim(s.legalName),
    tradeName: nz(s.tradeName ?? ""),
    gstin: nz(s.gstin ?? ""),
    pan: nz(s.pan ?? ""),
    cin: nz(s.cin ?? ""),
    industry: nz(s.industry ?? ""),
    addressLine: nz(s.addressLine ?? ""),
    city: nz(s.city ?? ""),
    state: nz(s.state ?? ""),
    pincode: nz(s.pincode ?? ""),
    country: trim(s.country) || "India",
    phone: nz(s.phone ?? ""),
    email: nz(s.email ?? ""),
    website: nz(s.website ?? ""),
    invoicePrefix: trim(s.invoicePrefix) || "INV",
    quotePrefix: trim(s.quotePrefix) || "Q",
    currency: trim(s.currency) || "INR",
    fiscalYearStart: trim(s.fiscalYearStart) || "04-01",
    defaultTaxRate: Number.isFinite(s.defaultTaxRate) ? s.defaultTaxRate : 18,
    termsDefault: nz(s.termsDefault ?? ""),
    bankName: nz(s.bankName ?? ""),
    bankAccountNo: nz(s.bankAccountNo ?? ""),
    bankIfsc: nz(s.bankIfsc ?? ""),
    bankBranch: nz(s.bankBranch ?? ""),
    upi: nz(s.upi ?? ""),
  };
};

// Stringify both sides for a cheap deep-equality check across primitives.
const isDirty = (a: FormState, b: FormState) =>
  JSON.stringify(a) !== JSON.stringify(b);

type SaveBanner =
  | { kind: "ok"; msg: string }
  | { kind: "err"; msg: string }
  | null;

const CompanyForm = () => {
  const { refresh: refreshBrand } = useBrand();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<SaveBanner>(null);

  // `pristine` is the snapshot loaded from the server; `form` is the live
  // editing state. `isDirty(pristine, form)` drives the save bar.
  const [pristine, setPristine] = useState<FormState>(blankForm);
  const [form, setForm] = useState<FormState>(blankForm);
  const bannerTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await api.getCompanyProfile();
        if (cancelled) return;
        const f = toForm(p);
        setPristine(f);
        setForm(f);
      } catch (e) {
        const err = e as { message?: string };
        setLoadError(err.message ?? "Failed to load company profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-dismiss the success banner after a few seconds; keep error banners
  // sticky so the user has time to read them.
  useEffect(() => {
    if (bannerTimer.current) {
      window.clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
    if (banner?.kind === "ok") {
      bannerTimer.current = window.setTimeout(() => setBanner(null), 3500);
    }
    return () => {
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    };
  }, [banner]);

  const dirty = useMemo(() => isDirty(pristine, form), [pristine, form]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    if (banner?.kind === "ok") setBanner(null);
  };

  const handleSave = async () => {
    if (!form.legalName.trim()) {
      setBanner({ kind: "err", msg: "Legal name is required." });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const updated = await api.updateCompanyProfile(toPayload(form));
      const f = toForm(updated);
      setPristine(f);
      setForm(f);
      // The brand chrome (topbar, login monogram, command palette,
      // mobile login) reads tradeName/legalName via /public/company.
      // Trigger a re-fetch so the rename shows up everywhere without
      // forcing the user to reload the page.
      void refreshBrand();
      setBanner({ kind: "ok", msg: "Company profile saved." });
    } catch (e) {
      const err = e as { message?: string; status?: number };
      setBanner({
        kind: "err",
        msg:
          err.status === 403
            ? "You need admin or supervisor role to change company settings."
            : err.message ?? "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm(pristine);
    setBanner(null);
  };

  if (loading) {
    return (
      <Card title="Company Profile" subtitle="Plant identity and registration">
        <div className="flex items-center gap-2 text-ink-muted text-body-sm py-6">
          <Loader2 size={16} className="animate-spin" />
          Loading company profile…
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card title="Company Profile" subtitle="Plant identity and registration">
        <div className="flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-md p-3 text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-body-sm">Could not load profile</div>
            <div className="text-caption">{loadError}</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 pb-24 relative">
      {/* Identity */}
      <Card title="Company Profile" subtitle="Identity that appears on invoices and quotes">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Legal name *"
            value={form.legalName}
            onChange={(e) => update("legalName", e.target.value)}
            placeholder="ACME Manufacturing Pvt Ltd"
          />
          <Input
            label="Trade name"
            value={form.tradeName ?? ""}
            onChange={(e) => update("tradeName", e.target.value)}
            placeholder="ACME Works"
          />
          <Input
            label="Industry"
            value={form.industry ?? ""}
            onChange={(e) => update("industry", e.target.value)}
            placeholder="Industrial Machinery"
          />
          <Input
            label="Website"
            value={form.website ?? ""}
            onChange={(e) => update("website", e.target.value)}
            placeholder="https://..."
          />
        </div>
      </Card>

      {/* Statutory */}
      <Card title="Statutory & Tax" subtitle="Registration numbers used on tax invoices">
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="GSTIN"
            value={form.gstin ?? ""}
            onChange={(e) => update("gstin", e.target.value.toUpperCase())}
            placeholder="27ABCDE1234F1Z5"
            className="font-mono"
          />
          <Input
            label="PAN"
            value={form.pan ?? ""}
            onChange={(e) => update("pan", e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            className="font-mono"
          />
          <Input
            label="CIN"
            value={form.cin ?? ""}
            onChange={(e) => update("cin", e.target.value.toUpperCase())}
            placeholder="U12345MH2024PTC123456"
            className="font-mono"
          />
          <Input
            label="Default tax rate (%)"
            type="number"
            value={String(form.defaultTaxRate)}
            onChange={(e) =>
              update("defaultTaxRate", Number(e.target.value) || 0)
            }
            helper="Falls back when a product has no GST set"
          />
          <Input
            label="Currency"
            value={form.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase())}
            placeholder="INR"
          />
          <Input
            label="Fiscal year start (MM-DD)"
            value={form.fiscalYearStart}
            onChange={(e) => update("fiscalYearStart", e.target.value)}
            placeholder="04-01"
            helper="India default: 1 April"
          />
        </div>
      </Card>

      {/* Address */}
      <Card title="Registered Address" subtitle="Used on tax invoices and shipping labels">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Input
              label="Street address"
              value={form.addressLine ?? ""}
              onChange={(e) => update("addressLine", e.target.value)}
              placeholder="Plot 14, Chakan MIDC Industrial Area"
            />
          </div>
          <Input
            label="City"
            value={form.city ?? ""}
            onChange={(e) => update("city", e.target.value)}
            placeholder="Pune"
          />
          <Input
            label="State"
            value={form.state ?? ""}
            onChange={(e) => update("state", e.target.value)}
            placeholder="Maharashtra"
          />
          <Input
            label="Pincode"
            value={form.pincode ?? ""}
            onChange={(e) => update("pincode", e.target.value)}
            placeholder="410501"
          />
          <Input
            label="Country"
            value={form.country}
            onChange={(e) => update("country", e.target.value)}
          />
        </div>
      </Card>

      {/* Contact */}
      <Card title="Contact" subtitle="Shown to customers on shareable quotes and invoices">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Phone"
            value={form.phone ?? ""}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="+91 98765 43210"
          />
          <Input
            label="Email"
            type="email"
            value={form.email ?? ""}
            onChange={(e) => update("email", e.target.value)}
            placeholder="hello@company.com"
          />
        </div>
      </Card>

      {/* Document numbering */}
      <Card title="Document Numbering" subtitle="Prefixes for auto-generated document numbers">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quote prefix"
            value={form.quotePrefix}
            onChange={(e) => update("quotePrefix", e.target.value.toUpperCase())}
            placeholder="Q"
            helper={`Quotes will look like ${form.quotePrefix || "Q"}-2026-1001`}
          />
          <Input
            label="Invoice prefix"
            value={form.invoicePrefix}
            onChange={(e) =>
              update("invoicePrefix", e.target.value.toUpperCase())
            }
            placeholder="INV"
            helper={`Invoices will look like ${form.invoicePrefix || "INV"}-2026-1001`}
          />
        </div>
      </Card>

      {/* Banking */}
      <Card title="Banking" subtitle="Printed on invoice footers; never shared on customer-facing quote links">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Bank name"
            value={form.bankName ?? ""}
            onChange={(e) => update("bankName", e.target.value)}
            placeholder="HDFC Bank"
          />
          <Input
            label="Branch"
            value={form.bankBranch ?? ""}
            onChange={(e) => update("bankBranch", e.target.value)}
            placeholder="Pune Main"
          />
          <Input
            label="Account number"
            value={form.bankAccountNo ?? ""}
            onChange={(e) => update("bankAccountNo", e.target.value)}
            placeholder="0123456789"
            className="font-mono"
          />
          <Input
            label="IFSC"
            value={form.bankIfsc ?? ""}
            onChange={(e) => update("bankIfsc", e.target.value.toUpperCase())}
            placeholder="HDFC0000123"
            className="font-mono"
          />
          <div className="col-span-2">
            <Input
              label="UPI ID"
              value={form.upi ?? ""}
              onChange={(e) => update("upi", e.target.value)}
              placeholder="company@hdfcbank"
            />
          </div>
        </div>
      </Card>

      {/* Default terms */}
      <Card
        title="Default Terms & Conditions"
        subtitle="Auto-applied to new quotes and invoices"
      >
        <textarea
          className="w-full min-h-[120px] bg-white border border-border rounded-md px-3 py-2 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 resize-y"
          value={form.termsDefault ?? ""}
          onChange={(e) => update("termsDefault", e.target.value)}
          placeholder="1. Payment due within 30 days of invoice.&#10;2. Delivery within 7-10 working days.&#10;3. Goods once sold are not refundable."
        />
      </Card>

      {/* Sticky action bar */}
      <div
        className={cn(
          "sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 border-t bg-surface/95 backdrop-blur",
          "flex items-center gap-3 transition-shadow",
          dirty ? "shadow-[0_-4px_12px_rgba(15,23,42,0.06)] border-primary/30" : "border-border"
        )}
      >
        <div className="flex-1 min-w-0">
          {banner?.kind === "ok" && (
            <div className="flex items-center gap-1.5 text-success text-body-sm font-medium">
              <Check size={14} />
              {banner.msg}
            </div>
          )}
          {banner?.kind === "err" && (
            <div className="flex items-center gap-1.5 text-danger text-body-sm font-medium">
              <AlertTriangle size={14} />
              {banner.msg}
            </div>
          )}
          {!banner && dirty && (
            <span className="text-body-sm text-ink-muted">
              Unsaved changes
            </span>
          )}
          {!banner && !dirty && (
            <span className="text-body-sm text-ink-muted">All changes saved</span>
          )}
        </div>
        <Button
          size="md"
          variant="ghost"
          onClick={handleReset}
          disabled={!dirty || saving}
          className="gap-1.5"
        >
          <RotateCcw size={14} />
          Reset
        </Button>
        <Button
          size="md"
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="gap-1.5"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
};

// =====================================================================
// Brand Name - quick-edit form for the application brand string. The
// brand is whatever the user sees in the topbar / login chrome /
// command palette. It is stored on CompanyProfile.tradeName (with
// legalName as a fallback), so this form is just a lightweight
// front-end for that one field. Useful for tenants who don't want to
// open the full Company Profile screen just to rename "NovaERP" to
// their brand (e.g. "Prakruthivanam"). Save calls
// PUT /v1/settings/company { tradeName } and refreshes BrandContext.
// =====================================================================

const BrandNameForm = () => {
  const { brandName, refresh: refreshBrand } = useBrand();
  const [legalName, setLegalName] = useState<string>("");
  const [tradeName, setTradeName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<SaveBanner>(null);
  // Pristine snapshot drives the dirty check + the Reset action.
  const [pristine, setPristine] = useState<{ legal: string; trade: string }>({
    legal: "",
    trade: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const p = await api.getCompanyProfile();
        if (cancelled) return;
        const legal = p.legalName ?? "";
        const trade = p.tradeName ?? "";
        setLegalName(legal);
        setTradeName(trade);
        setPristine({ legal, trade });
      } catch (e) {
        const err = e as { message?: string };
        setBanner({
          kind: "err",
          msg: err.message ?? "Could not load brand name.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    legalName.trim() !== pristine.legal.trim() ||
    tradeName.trim() !== pristine.trade.trim();

  // What the chrome will say after save - mirrors the resolution in
  // useBrand(): tradeName -> legalName -> "NovaERP".
  const previewName =
    tradeName.trim() || legalName.trim() || "NovaERP";

  const onSave = async () => {
    if (!legalName.trim() && !tradeName.trim()) {
      setBanner({
        kind: "err",
        msg: "Enter either a brand name or a legal name.",
      });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const updated = await api.updateCompanyProfile({
        legalName: legalName.trim() || tradeName.trim(),
        tradeName: tradeName.trim() || null,
      });
      const legal = updated.legalName ?? "";
      const trade = updated.tradeName ?? "";
      setLegalName(legal);
      setTradeName(trade);
      setPristine({ legal, trade });
      void refreshBrand();
      setBanner({ kind: "ok", msg: `Brand updated to "${previewName}".` });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setBanner({
        kind: "err",
        msg:
          err.status === 403
            ? "Admin or supervisor role required to rename the application."
            : err.message ?? "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setLegalName(pristine.legal);
    setTradeName(pristine.trade);
    setBanner(null);
  };

  return (
    <Card
      title="Brand name"
      subtitle="The name shown in the topbar, login screen, command palette and mobile login"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-body-sm py-3">
          <Loader2 size={16} className="animate-spin" /> Loading brand…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Brand / display name"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              placeholder="Prakruthivanam"
              helper="Shown to operators in the chrome. Falls back to Legal name if empty."
            />
            <Input
              label="Legal name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Prakruthivanam Foods Pvt Ltd"
              helper="Printed on invoices, quotes and shared documents."
            />
          </div>

          <div className="mt-3 rounded-md border border-border bg-canvas p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-primary text-white grid place-items-center font-bold">
              {(previewName.trim()[0] ?? "N").toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Preview
              </div>
              <div className="text-body font-bold text-ink">{previewName}</div>
              <div className="text-caption text-ink-muted">
                Currently displayed:{" "}
                <span className="font-semibold text-ink">{brandName}</span>
              </div>
            </div>
          </div>

          {banner && (
            <div
              className={cn(
                "mt-3 rounded-md px-3 py-2 text-body-sm flex items-center gap-2",
                banner.kind === "ok"
                  ? "bg-success-soft border border-success text-success"
                  : "bg-danger-soft border border-danger text-danger"
              )}
            >
              {banner.kind === "ok" ? (
                <Check size={14} />
              ) : (
                <AlertTriangle size={14} />
              )}
              {banner.msg}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={14} />}
              onClick={onReset}
              disabled={!dirty || saving}
            >
              Reset
            </Button>
            <Button
              size="sm"
              icon={<Save size={14} />}
              onClick={onSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : "Save brand"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
};

// =====================================================================
// Warehouse Manager - master-data CRUD for Warehouse / Plant locations.
// Lists all warehouses (active + inactive), supports inline edit of name
// and city, soft-deactivate / re-activate, and create new ones.
// Backend hard-deletes only when no bins or stock-ledger entries exist;
// otherwise it falls back to soft-delete (active=false).
// =====================================================================

type RowEdits = { name: string; city: string };

const WarehouseManager = () => {
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<SaveBanner>(null);

  // Inline edit state per row id. Only present while a row is being edited.
  const [edits, setEdits] = useState<Record<string, RowEdits>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Add-new form state.
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ code: "", name: "", city: "" });
  const [creating, setCreating] = useState(false);

  const bannerTimer = useRef<number | null>(null);

  const reload = async () => {
    try {
      const list = await api.warehouses({ includeInactive: true });
      setRows(list);
    } catch (e) {
      const err = e as { message?: string };
      setLoadError(err.message ?? "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (bannerTimer.current) {
      window.clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
    if (banner?.kind === "ok") {
      bannerTimer.current = window.setTimeout(() => setBanner(null), 3500);
    }
    return () => {
      if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    };
  }, [banner]);

  const startEdit = (w: WarehouseRow) =>
    setEdits((m) => ({ ...m, [w.id]: { name: w.name, city: w.city } }));

  const cancelEdit = (id: string) =>
    setEdits((m) => {
      const { [id]: _omit, ...rest } = m;
      return rest;
    });

  const setEdit = (id: string, patch: Partial<RowEdits>) =>
    setEdits((m) => ({ ...m, [id]: { ...m[id], ...patch } }));

  const surfaceError = (e: unknown, fallback: string) => {
    const err = e as { message?: string; status?: number; details?: { code?: string } };
    if (err.status === 403) {
      setBanner({
        kind: "err",
        msg: "Admin or supervisor role required to change warehouses.",
      });
    } else if (err.status === 409 || err.details?.code === "duplicate_code") {
      setBanner({ kind: "err", msg: err.message ?? "Code already in use" });
    } else {
      setBanner({ kind: "err", msg: err.message ?? fallback });
    }
  };

  const saveRow = async (id: string) => {
    const e = edits[id];
    if (!e || !e.name.trim() || !e.city.trim()) {
      setBanner({ kind: "err", msg: "Name and city are required." });
      return;
    }
    setSavingId(id);
    setBanner(null);
    try {
      await api.updateWarehouse(id, {
        name: e.name.trim(),
        city: e.city.trim(),
      });
      cancelEdit(id);
      await reload();
      setBanner({ kind: "ok", msg: "Warehouse updated." });
    } catch (err) {
      surfaceError(err, "Failed to update warehouse");
    } finally {
      setSavingId(null);
    }
  };

  const toggleActive = async (w: WarehouseRow) => {
    setSavingId(w.id);
    setBanner(null);
    try {
      await api.updateWarehouse(w.id, { active: !w.active });
      await reload();
      setBanner({
        kind: "ok",
        msg: w.active
          ? `${w.code} deactivated.`
          : `${w.code} re-activated.`,
      });
    } catch (err) {
      surfaceError(err, "Failed to update status");
    } finally {
      setSavingId(null);
    }
  };

  const removeRow = async (w: WarehouseRow) => {
    const hasHistory = w.binCount > 0 || w.ledgerCount > 0;
    const confirmMsg = hasHistory
      ? `${w.code} has ${w.binCount} bin(s) and ${w.ledgerCount} stock entries. It will be deactivated rather than removed. Continue?`
      : `Remove ${w.code} (${w.name}) permanently?`;
    if (!window.confirm(confirmMsg)) return;
    setSavingId(w.id);
    setBanner(null);
    try {
      const res = await api.deleteWarehouse(w.id);
      await reload();
      setBanner({
        kind: "ok",
        msg: res.softDeleted
          ? res.message ?? `${w.code} deactivated (had stock history).`
          : `${w.code} removed.`,
      });
    } catch (err) {
      surfaceError(err, "Failed to delete warehouse");
    } finally {
      setSavingId(null);
    }
  };

  const submitNew = async () => {
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim();
    const city = draft.city.trim();
    if (!code || !name || !city) {
      setBanner({ kind: "err", msg: "Code, name and city are all required." });
      return;
    }
    if (code.length < 2) {
      setBanner({ kind: "err", msg: "Code must be at least 2 characters." });
      return;
    }
    setCreating(true);
    setBanner(null);
    try {
      await api.createWarehouse({ code, name, city });
      setDraft({ code: "", name: "", city: "" });
      setShowAdd(false);
      await reload();
      setBanner({ kind: "ok", msg: `${code} created.` });
    } catch (err) {
      surfaceError(err, "Failed to create warehouse");
    } finally {
      setCreating(false);
    }
  };

  const activeCount = useMemo(
    () => rows.filter((r) => r.active).length,
    [rows]
  );

  if (loading) {
    return (
      <Card title="Warehouses & Plants" subtitle="Storage and production locations">
        <div className="flex items-center gap-2 text-ink-muted text-body-sm py-6">
          <Loader2 size={16} className="animate-spin" />
          Loading warehouses…
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card title="Warehouses & Plants" subtitle="Storage and production locations">
        <div className="flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-md p-3 text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-body-sm">Could not load warehouses</div>
            <div className="text-caption">{loadError}</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card with summary + add-new control */}
      <Card
        title="Warehouses & Plants"
        subtitle={`${activeCount} active · ${rows.length - activeCount} deactivated · ${rows.length} total`}
        actions={
          showAdd ? null : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowAdd(true)}
              className="gap-1.5"
            >
              <Plus size={14} />
              Add warehouse
            </Button>
          )
        }
        noPadding
      >
        {showAdd && (
          <div className="border-b border-border bg-primary-50/40 p-4">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Input
                  label="Code *"
                  value={draft.code}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="WH-DEL"
                  className="font-mono"
                  helper="Short, unique, uppercase"
                />
              </div>
              <div className="col-span-5">
                <Input
                  label="Name *"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Delhi Distribution Centre"
                />
              </div>
              <div className="col-span-4">
                <Input
                  label="City *"
                  value={draft.city}
                  onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                  placeholder="Delhi"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  setDraft({ code: "", name: "", city: "" });
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={submitNew}
                disabled={creating}
                className="gap-1.5"
              >
                {creating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Create warehouse
              </Button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="p-8 text-center text-ink-muted text-body-sm">
            No warehouses yet. Click <strong>Add warehouse</strong> to register your first location.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((w) => {
              const editing = !!edits[w.id];
              const busy = savingId === w.id;
              return (
                <div
                  key={w.id}
                  className={cn(
                    "px-4 py-3 flex items-center gap-3",
                    !w.active && "bg-canvas/60"
                  )}
                >
                  <div
                    className={cn(
                      "h-9 w-9 rounded-md grid place-items-center shrink-0",
                      w.active
                        ? "bg-primary-50 text-primary"
                        : "bg-border/40 text-ink-muted"
                    )}
                  >
                    <Building size={16} />
                  </div>

                  {editing ? (
                    <div className="flex-1 grid grid-cols-12 gap-2">
                      <div className="col-span-3 self-center font-mono text-caption text-ink-muted">
                        {w.code}
                      </div>
                      <div className="col-span-5">
                        <Input
                          size="sm"
                          value={edits[w.id].name}
                          onChange={(e) =>
                            setEdit(w.id, { name: e.target.value })
                          }
                          placeholder="Name"
                        />
                      </div>
                      <div className="col-span-4">
                        <Input
                          size="sm"
                          value={edits[w.id].city}
                          onChange={(e) =>
                            setEdit(w.id, { city: e.target.value })
                          }
                          placeholder="City"
                          iconLeft={<MapPin size={12} />}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        <span className="truncate">{w.name}</span>
                        {!w.active && (
                          <Chip tone="neutral" size="sm">
                            Deactivated
                          </Chip>
                        )}
                      </div>
                      <div className="text-caption text-ink-muted flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="font-mono">{w.code}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={11} />
                          {w.city}
                        </span>
                        {(w.binCount > 0 || w.ledgerCount > 0) && (
                          <>
                            <span>·</span>
                            <span>
                              {w.binCount} bin{w.binCount === 1 ? "" : "s"} ·{" "}
                              {w.ledgerCount} stock entr{w.ledgerCount === 1 ? "y" : "ies"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    {editing ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelEdit(w.id)}
                          disabled={busy}
                          className="gap-1"
                        >
                          <X size={13} />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => saveRow(w.id)}
                          disabled={busy}
                          className="gap-1"
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Save size={13} />
                          )}
                          Save
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(w)}
                          disabled={busy}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(w)}
                          disabled={busy}
                          className="gap-1"
                          title={w.active ? "Deactivate" : "Re-activate"}
                        >
                          <Power size={13} />
                          {w.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRow(w)}
                          disabled={busy}
                          className="gap-1 text-danger hover:bg-danger/5"
                          title="Remove"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Status banner */}
      {banner && (
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md text-body-sm border",
            banner.kind === "ok"
              ? "bg-success/5 border-success/30 text-success"
              : "bg-danger/5 border-danger/30 text-danger"
          )}
        >
          {banner.kind === "ok" ? (
            <Check size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <span className="flex-1">{banner.msg}</span>
          <button
            onClick={() => setBanner(null)}
            className="text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Production master data: WorkCenters + Machines
// =====================================================================
//
// Two stacked cards. WorkCenters represent production lines / cells /
// stations. Machines belong to a work center and track operational
// status. The "station" / "machine" free-text fields on existing BOMs
// and work orders still work; pickers in those forms will be wired
// to these masters in a follow-up so historical rows aren't disturbed.

interface WorkCenterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  capacityPerHour: number | null;
  productionLineWarehouseId: string | null;
  productionLineWarehouse: { id: string; code: string; name: string } | null;
  active: boolean;
  machines: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    active: boolean;
  }>;
}

interface MachineRow {
  id: string;
  code: string;
  name: string;
  workCenterId: string;
  workCenter: { id: string; code: string; name: string };
  status: string;
  description: string | null;
  active: boolean;
}

const ProductionMaster = () => {
  const [workCenters, setWorkCenters] = useState<WorkCenterRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [wc, m, wh] = await Promise.all([
        api.workCenters(),
        api.machines(),
        api.warehouses({ includeInactive: false }),
      ]);
      setWorkCenters(wc as unknown as WorkCenterRow[]);
      setMachines(m as unknown as MachineRow[]);
      setWarehouses(wh);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);

  return (
    <>
      {error && (
        <div className="px-3 py-2 bg-danger-soft border border-danger text-danger text-body-sm rounded">
          {error}
        </div>
      )}
      <WorkCentersCard
        rows={workCenters}
        warehouses={warehouses}
        loading={loading}
        onChanged={reload}
      />
      <MachinesCard
        rows={machines}
        workCenters={workCenters}
        loading={loading}
        onChanged={reload}
      />
    </>
  );
};

// ----- WorkCenters --------------------------------------------------

const WorkCentersCard = ({
  rows,
  warehouses,
  loading,
  onChanged,
}: {
  rows: WorkCenterRow[];
  warehouses: WarehouseRow[];
  loading: boolean;
  onChanged: () => void | Promise<void>;
}) => {
  const [draft, setDraft] = useState<{
    code: string;
    name: string;
    capacity: string;
    description: string;
    autoCreateProdWarehouse: boolean;
  } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    code: string;
    name: string;
    capacity: string;
    description: string;
    productionLineWarehouseId: string;
    active: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = (r: WorkCenterRow) => {
    setEditId(r.id);
    setEditDraft({
      code: r.code,
      name: r.name,
      capacity: r.capacityPerHour ? String(r.capacityPerHour) : "",
      description: r.description ?? "",
      productionLineWarehouseId: r.productionLineWarehouseId ?? "",
      active: r.active,
    });
  };

  const submitNew = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.name.trim()) return;
    setBusy(true);
    try {
      await api.createWorkCenter({
        code: draft.code.trim(),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        capacityPerHour: draft.capacity ? Number(draft.capacity) : null,
        active: true,
        ...(draft.autoCreateProdWarehouse ? { autoCreateProductionWarehouse: true } : {}),
      });
      setDraft(null);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editId || !editDraft) return;
    setBusy(true);
    try {
      await api.updateWorkCenter(editId, {
        code: editDraft.code.trim(),
        name: editDraft.name.trim(),
        description: editDraft.description.trim() || null,
        capacityPerHour: editDraft.capacity ? Number(editDraft.capacity) : null,
        productionLineWarehouseId: editDraft.productionLineWarehouseId || null,
        active: editDraft.active,
      });
      setEditId(null);
      setEditDraft(null);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: WorkCenterRow) => {
    if (!confirm(`Delete work center "${r.code}"?`)) return;
    setBusy(true);
    try {
      const res = await api.deleteWorkCenter(r.id);
      if (res.softDeleted && res.message) alert(res.message);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Work centers (production lines)"
      subtitle="Stations, cells and lines where production happens"
      actions={
        !draft && (
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() =>
              setDraft({ code: "", name: "", capacity: "", description: "", autoCreateProdWarehouse: false })
            }
            disabled={busy}
          >
            Add work center
          </Button>
        )
      }
      noPadding
    >
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-canvas text-caption uppercase font-semibold text-ink-muted">
            <tr>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-right px-3 py-2">Capacity / hr</th>
              <th className="text-left px-3 py-2">Prod. warehouse</th>
              <th className="text-right px-3 py-2">Machines</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {draft && (
              <tr className="border-t border-border bg-primary-50/40">
                <td className="px-3 py-2">
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="WC-PACK-1"
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    size="sm"
                    placeholder="Packaging line 1"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    size="sm"
                    type="number"
                    min={0}
                    placeholder="100"
                    value={draft.capacity}
                    onChange={(e) =>
                      setDraft({ ...draft, capacity: e.target.value })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-1 cursor-pointer text-caption">
                    <input
                      type="checkbox"
                      checked={draft.autoCreateProdWarehouse}
                      onChange={(e) => setDraft({ ...draft, autoCreateProdWarehouse: e.target.checked })}
                    />
                    Auto-create
                  </label>
                </td>
                <td className="px-3 py-2 text-right text-ink-muted">—</td>
                <td className="px-3 py-2 text-center">
                  <Chip size="sm" tone="success">
                    new
                  </Chip>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      icon={<Save size={12} />}
                      onClick={submitNew}
                      disabled={busy}
                    >
                      Save
                    </Button>
                    <button
                      onClick={() => setDraft(null)}
                      className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && !draft && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  <Loader2 size={14} className="inline animate-spin mr-1" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && !draft && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  No work centers yet. Click <strong>Add work center</strong> to start.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isEditing = editId === r.id && editDraft;
              if (isEditing) {
                return (
                  <tr key={r.id} className="border-t border-border bg-primary-50/40">
                    <td className="px-3 py-2">
                      <Input
                        size="sm"
                        value={editDraft.code}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, code: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        size="sm"
                        value={editDraft.name}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, name: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        value={editDraft.capacity}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, capacity: e.target.value })
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="h-7 rounded border border-border bg-surface text-body-sm px-2 w-full"
                        value={editDraft.productionLineWarehouseId}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, productionLineWarehouseId: e.target.value })
                        }
                      >
                        <option value="">— none —</option>
                        {warehouses.map((wh) => (
                          <option key={wh.id} value={wh.id}>
                            {wh.code} ({wh.kind})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {r.machines.length}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editDraft.active}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, active: e.target.checked })
                          }
                        />
                        <span className="text-caption">Active</span>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          icon={<Save size={12} />}
                          onClick={submitEdit}
                          disabled={busy}
                        >
                          Save
                        </Button>
                        <button
                          onClick={() => {
                            setEditId(null);
                            setEditDraft(null);
                          }}
                          className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={r.id} className="border-t border-border hover:bg-canvas/50">
                  <td className="px-3 py-2 font-mono text-caption text-primary">
                    {r.code}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {r.name}
                    {r.description && (
                      <div className="text-caption text-ink-muted">
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tnum">
                    {r.capacityPerHour ? r.capacityPerHour : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.productionLineWarehouse ? (
                      <span className="font-mono text-caption text-primary">
                        {r.productionLineWarehouse.code}
                      </span>
                    ) : (
                      <span className="text-ink-muted text-caption">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tnum">{r.machines.length}</td>
                  <td className="px-3 py-2 text-center">
                    <Chip size="sm" tone={r.active ? "success" : "neutral"}>
                      {r.active ? "active" : "inactive"}
                    </Chip>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => startEdit(r)}
                        className="h-7 px-2 rounded text-primary hover:bg-primary-50 text-caption"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(r)}
                        className="h-7 w-7 grid place-items-center rounded text-danger hover:bg-danger-soft"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// ----- Machines -----------------------------------------------------

const MachinesCard = ({
  rows,
  workCenters,
  loading,
  onChanged,
}: {
  rows: MachineRow[];
  workCenters: WorkCenterRow[];
  loading: boolean;
  onChanged: () => void | Promise<void>;
}) => {
  const [draft, setDraft] = useState<{
    code: string;
    name: string;
    workCenterId: string;
    status: "running" | "idle" | "maintenance" | "broken";
    description: string;
  } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    code: string;
    name: string;
    workCenterId: string;
    status: "running" | "idle" | "maintenance" | "broken";
    description: string;
    active: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const submitNew = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.name.trim() || !draft.workCenterId) return;
    setBusy(true);
    try {
      await api.createMachine({
        code: draft.code.trim(),
        name: draft.name.trim(),
        workCenterId: draft.workCenterId,
        status: draft.status,
        description: draft.description.trim() || null,
        active: true,
      });
      setDraft(null);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: MachineRow) => {
    setEditId(r.id);
    setEditDraft({
      code: r.code,
      name: r.name,
      workCenterId: r.workCenterId,
      status: r.status as "running" | "idle" | "maintenance" | "broken",
      description: r.description ?? "",
      active: r.active,
    });
  };

  const submitEdit = async () => {
    if (!editId || !editDraft) return;
    setBusy(true);
    try {
      await api.updateMachine(editId, {
        code: editDraft.code.trim(),
        name: editDraft.name.trim(),
        workCenterId: editDraft.workCenterId,
        status: editDraft.status,
        description: editDraft.description.trim() || null,
        active: editDraft.active,
      });
      setEditId(null);
      setEditDraft(null);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MachineRow) => {
    if (!confirm(`Delete machine "${r.code}"?`)) return;
    setBusy(true);
    try {
      await api.deleteMachine(r.id);
      await onChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusTone = (s: string): "success" | "neutral" | "warning" | "danger" => {
    if (s === "running") return "success";
    if (s === "idle") return "neutral";
    if (s === "maintenance") return "warning";
    return "danger";
  };

  return (
    <Card
      title="Machines"
      subtitle="Specific assets that live on a work center"
      actions={
        !draft && (
          <Button
            size="sm"
            icon={<Cog size={14} />}
            onClick={() =>
              setDraft({
                code: "",
                name: "",
                workCenterId: workCenters[0]?.id ?? "",
                status: "idle",
                description: "",
              })
            }
            disabled={busy || workCenters.length === 0}
            title={
              workCenters.length === 0
                ? "Add a work center first"
                : "Add a machine"
            }
          >
            Add machine
          </Button>
        )
      }
      noPadding
    >
      {workCenters.length === 0 && !loading ? (
        <div className="px-4 py-6 text-center text-ink-muted text-body-sm">
          Add a work center first - every machine belongs to one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-canvas text-caption uppercase font-semibold text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Work center</th>
                <th className="text-center px-3 py-2">Status</th>
                <th className="text-center px-3 py-2">Active</th>
                <th className="text-right px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {draft && (
                <tr className="border-t border-border bg-primary-50/40">
                  <td className="px-3 py-2">
                    <Input
                      size="sm"
                      autoFocus
                      placeholder="PCH-SEAL-02"
                      value={draft.code}
                      onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      size="sm"
                      placeholder="Pouch sealer 2"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={draft.workCenterId}
                      onChange={(e) =>
                        setDraft({ ...draft, workCenterId: e.target.value })
                      }
                      className="h-8 w-full bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary"
                    >
                      {workCenters.map((wc) => (
                        <option key={wc.id} value={wc.id}>
                          {wc.code} · {wc.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          status: e.target.value as "running" | "idle" | "maintenance" | "broken",
                        })
                      }
                      className="h-8 w-full bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary"
                    >
                      <option value="idle">idle</option>
                      <option value="running">running</option>
                      <option value="maintenance">maintenance</option>
                      <option value="broken">broken</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center text-ink-muted">—</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        icon={<Save size={12} />}
                        onClick={submitNew}
                        disabled={busy}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setDraft(null)}
                        className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && !draft && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                    <Loader2 size={14} className="inline animate-spin mr-1" /> Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !draft && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                    No machines yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const isEditing = editId === r.id && editDraft;
                if (isEditing) {
                  return (
                    <tr key={r.id} className="border-t border-border bg-primary-50/40">
                      <td className="px-3 py-2">
                        <Input
                          size="sm"
                          value={editDraft.code}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, code: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          size="sm"
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, name: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editDraft.workCenterId}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, workCenterId: e.target.value })
                          }
                          className="h-8 w-full bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary"
                        >
                          {workCenters.map((wc) => (
                            <option key={wc.id} value={wc.id}>
                              {wc.code} · {wc.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={editDraft.status}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              status: e.target.value as "running" | "idle" | "maintenance" | "broken",
                            })
                          }
                          className="h-8 w-full bg-white border border-border rounded text-body-sm px-2 outline-none focus:border-primary"
                        >
                          <option value="idle">idle</option>
                          <option value="running">running</option>
                          <option value="maintenance">maintenance</option>
                          <option value="broken">broken</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={editDraft.active}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, active: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            icon={<Save size={12} />}
                            onClick={submitEdit}
                            disabled={busy}
                          >
                            Save
                          </Button>
                          <button
                            onClick={() => {
                              setEditId(null);
                              setEditDraft(null);
                            }}
                            className="h-7 w-7 grid place-items-center rounded text-ink-muted hover:bg-canvas"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-canvas/50">
                    <td className="px-3 py-2 font-mono text-caption text-primary">
                      {r.code}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-caption text-primary">
                        {r.workCenter.code}
                      </span>{" "}
                      <span className="text-ink-muted">· {r.workCenter.name}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Chip size="sm" tone={statusTone(r.status)}>
                        {r.status}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Chip size="sm" tone={r.active ? "success" : "neutral"}>
                        {r.active ? "yes" : "no"}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => startEdit(r)}
                          className="h-7 px-2 rounded text-primary hover:bg-primary-50 text-caption"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(r)}
                          className="h-7 w-7 grid place-items-center rounded text-danger hover:bg-danger-soft"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

// =====================================================================
// Putaway Rules
// =====================================================================

const binPath = (b: { zone: string; shelf: string; bin: string }) =>
  `${b.zone}/${b.shelf}/${b.bin}`;

export const PutawayRulesManager = () => {
  const [rules, setRules] = useState<PutawayRuleRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [variants, setVariants] = useState<Array<{ id: string; sku: string; label: string }>>([]);
  const [whBins, setWhBins] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    productId: "",
    variantId: "",
    toWarehouseId: "",
    toBinId: "",
    priority: "100",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, wh, p] = await Promise.all([
        api.putawayRules(),
        api.warehouses(),
        api.products(),
      ]);
      setRules(r);
      setWarehouses(wh);
      setProducts(
        (p as unknown as Array<{ id: string; sku: string; name: string }>).map((x) => ({
          id: x.id,
          sku: x.sku,
          name: x.name,
        }))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!draft.productId) {
      setVariants([]);
      return;
    }
    void api.variantsWithBoms(draft.productId).then((res) => {
      setVariants(
        res.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          label: v.label ?? v.sku,
        }))
      );
    }).catch(() => setVariants([]));
  }, [draft.productId]);

  useEffect(() => {
    if (!draft.toWarehouseId) {
      setWhBins([]);
      return;
    }
    void api.bins(draft.toWarehouseId).then((bins) => {
      setWhBins(
        bins.map((b) => ({
          id: b.id,
          label: `${binPath(b)}${(b.qty ?? 0) > 0 ? ` (${b.qty})` : " (empty)"}`,
        }))
      );
    }).catch(() => setWhBins([]));
  }, [draft.toWarehouseId]);

  const submitNew = async () => {
    if (!draft.productId || !draft.toWarehouseId) {
      alert("Product and destination warehouse are required.");
      return;
    }
    if (!draft.toBinId) {
      alert("Destination bin is required. Auto-pick empty bins is disabled.");
      return;
    }
    setBusy(true);
    try {
      await api.createPutawayRule({
        productId: draft.productId,
        variantId: draft.variantId || null,
        toWarehouseId: draft.toWarehouseId,
        toBinId: draft.toBinId,
        priority: Number(draft.priority) || 100,
        notes: draft.notes.trim() || null,
        active: true,
      });
      setShowAdd(false);
      setDraft({
        productId: "",
        variantId: "",
        toWarehouseId: "",
        toBinId: "",
        priority: "100",
        notes: "",
      });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (rule: PutawayRuleRow) => {
    setBusy(true);
    try {
      await api.updatePutawayRule(rule.id, { active: !rule.active });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: PutawayRuleRow) => {
    if (!confirm(`Delete putaway rule for ${rule.product.sku}?`)) return;
    setBusy(true);
    try {
      await api.deletePutawayRule(rule.id);
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Putaway rules"
      subtitle="Each variant must have a fixed destination bin. MO complete posts FG here (no auto-pick of empty bins)."
      actions={
        !showAdd ? (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowAdd(true)} disabled={busy}>
            Add rule
          </Button>
        ) : null
      }
      noPadding
    >
      {error && (
        <div className="px-4 py-2 text-danger text-body-sm">{error}</div>
      )}
      {showAdd && (
        <div className="px-4 py-3 bg-primary-50/30 border-b border-border space-y-3">
          <p className="text-body-sm font-medium text-ink">New putaway rule</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption text-ink-muted block mb-1">Product</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.productId}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    productId: e.target.value,
                    variantId: "",
                  })
                }
              >
                <option value="">— select product —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Variant (optional)</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.variantId}
                onChange={(e) => setDraft({ ...draft, variantId: e.target.value })}
                disabled={!draft.productId}
              >
                <option value="">— all variants —</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku} — {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Destination warehouse</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.toWarehouseId}
                onChange={(e) =>
                  setDraft({ ...draft, toWarehouseId: e.target.value, toBinId: "" })
                }
              >
                <option value="">— select warehouse —</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.code} — {wh.name} ({wh.kind})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Destination bin *</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.toBinId}
                onChange={(e) => setDraft({ ...draft, toBinId: e.target.value })}
                disabled={!draft.toWarehouseId}
              >
                <option value="">— select bin —</option>
                {whBins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Priority (lower = higher priority)</label>
              <Input
                size="sm"
                type="number"
                min={1}
                max={999}
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              />
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Notes</label>
              <Input
                size="sm"
                placeholder="Optional"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Save size={12} />} onClick={submitNew} disabled={busy}>
              Save rule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-canvas text-caption uppercase font-semibold text-ink-muted">
            <tr>
              <th className="text-left px-3 py-2">Product</th>
              <th className="text-left px-3 py-2">Variant</th>
              <th className="text-left px-3 py-2">Destination warehouse</th>
              <th className="text-left px-3 py-2">Bin</th>
              <th className="text-right px-3 py-2">Priority</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  <Loader2 size={14} className="inline animate-spin mr-1" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  No putaway rules yet. Add a rule to auto-route finished goods from production to storage.
                </td>
              </tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-canvas/50">
                <td className="px-3 py-2">
                  <span className="font-mono text-caption text-primary">{r.product.sku}</span>
                  <div className="text-caption text-ink-muted">{r.product.name}</div>
                </td>
                <td className="px-3 py-2 text-ink-muted">
                  {r.variant ? (
                    <span className="font-mono text-caption">{r.variant.sku}</span>
                  ) : (
                    <span className="text-caption">all variants</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-caption text-primary">{r.toWarehouse.code}</span>
                  <div className="text-caption text-ink-muted">{r.toWarehouse.name}</div>
                </td>
                <td className="px-3 py-2 text-caption font-mono">
                  {r.tobin ? binPath(r.tobin) : "—"}
                </td>
                <td className="px-3 py-2 text-right tnum">{r.priority}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleActive(r)} disabled={busy} title="Toggle active">
                    <Chip size="sm" tone={r.active ? "success" : "neutral"}>
                      {r.active ? "active" : "inactive"}
                    </Chip>
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => remove(r)}
                    className="h-7 w-7 grid place-items-center rounded text-danger hover:bg-danger-soft"
                    title="Delete rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// =====================================================================
// Stock Rules (min-qty → auto MO or transfer)
// =====================================================================

const StockRulesManager = () => {
  const [rules, setRules] = useState<StockRuleRow[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [variants, setVariants] = useState<Array<{ id: string; sku: string; label: string }>>([]);
  const [boms, setBoms] = useState<Array<{ id: string; label: string }>>([]);
  const [allBins, setAllBins] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    productId: "",
    variantId: "",
    monitorBinId: "",
    minQty: "20",
    triggerType: "mo" as "mo" | "transfer",
    bomId: "",
    sourceBinId: "",
    toBinId: "",
    tags: "",
    notes: "",
  });

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p, bins] = await Promise.all([
        api.stockRules(),
        api.products(),
        api.warehousesAndBins(),
      ]);
      setRules(r);
      setProducts(
        (p as unknown as Array<{ id: string; sku: string; name: string }>).map((x) => ({
          id: x.id,
          sku: x.sku,
          name: x.name,
        }))
      );
      setAllBins(
        bins.map((b) => ({
          id: b.id,
          label: `${b.warehouse ?? ""} · ${binPath(b)} (qty ${b.qty})`,
        }))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!draft.productId) {
      setVariants([]);
      setBoms([]);
      return;
    }
    void api.variantsWithBoms(draft.productId).then((res) => {
      setVariants(
        res.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          label: v.label ?? v.sku,
        }))
      );
    }).catch(() => setVariants([]));
    void api.boms({ productId: draft.productId, active: true }).then((rows) => {
      setBoms(
        (rows as Array<{ id: string; revision: string; outputQty: number }>).map((b) => ({
          id: b.id,
          label: `${b.revision} · batch ${b.outputQty}`,
        }))
      );
    }).catch(() => setBoms([]));
  }, [draft.productId]);

  const submitNew = async () => {
    if (!draft.productId || !draft.monitorBinId || !draft.minQty) {
      alert("Product, monitored bin, and min qty are required.");
      return;
    }
    if (draft.triggerType === "mo" && !draft.bomId) {
      alert("Select a BOM for auto-manufacture triggers.");
      return;
    }
    if (draft.triggerType === "transfer" && !draft.sourceBinId) {
      alert("Select a source bin for auto-transfer triggers.");
      return;
    }
    setBusy(true);
    try {
      await api.createStockRule({
        productId: draft.productId,
        variantId: draft.variantId || null,
        monitorBinId: draft.monitorBinId,
        minQty: Number(draft.minQty),
        triggerType: draft.triggerType,
        bomId: draft.triggerType === "mo" ? draft.bomId : null,
        sourceBinId: draft.triggerType === "transfer" ? draft.sourceBinId : null,
        toBinId: draft.toBinId || draft.monitorBinId,
        tags: draft.tags.trim() || null,
        notes: draft.notes.trim() || null,
        active: true,
      });
      setShowAdd(false);
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runCheckAll = async () => {
    setBusy(true);
    setCheckResult(null);
    try {
      const res = await api.checkAllStockRules();
      setCheckResult(
        `Checked ${res.checked} evaluations · ${res.triggered} document(s) created.`
      );
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (rule: StockRuleRow) => {
    setBusy(true);
    try {
      await api.updateStockRule(rule.id, { active: !rule.active });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: StockRuleRow) => {
    if (!confirm(`Delete stock rule for ${rule.product.sku}?`)) return;
    setBusy(true);
    try {
      await api.deleteStockRule(rule.id);
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Stock rules"
      subtitle="When a monitored bin falls below min qty, auto-create an MO (batch = BOM output) or a replenishment transfer (with team tags)."
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runCheckAll} disabled={busy}>
            Check all now
          </Button>
          {!showAdd && (
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowAdd(true)} disabled={busy}>
              Add rule
            </Button>
          )}
        </div>
      }
      noPadding
    >
      {checkResult && (
        <div className="px-4 py-2 bg-success-soft text-success text-body-sm border-b border-success/30">
          {checkResult}
        </div>
      )}
      {error && <div className="px-4 py-2 text-danger text-body-sm">{error}</div>}
      {showAdd && (
        <div className="px-4 py-3 bg-primary-50/30 border-b border-border space-y-3">
          <p className="text-body-sm font-medium text-ink">New stock rule</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-caption text-ink-muted block mb-1">Product</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.productId}
                onChange={(e) =>
                  setDraft({ ...draft, productId: e.target.value, variantId: "", bomId: "" })
                }
              >
                <option value="">— select —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Variant</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.variantId}
                onChange={(e) => setDraft({ ...draft, variantId: e.target.value })}
                disabled={!draft.productId}
              >
                <option value="">— any —</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-caption text-ink-muted block mb-1">Monitored bin (destination)</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.monitorBinId}
                onChange={(e) =>
                  setDraft({ ...draft, monitorBinId: e.target.value, toBinId: e.target.value })
                }
              >
                <option value="">— select bin —</option>
                {allBins.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Min qty</label>
              <Input
                size="sm"
                type="number"
                min={0}
                value={draft.minQty}
                onChange={(e) => setDraft({ ...draft, minQty: e.target.value })}
              />
            </div>
            <div>
              <label className="text-caption text-ink-muted block mb-1">Trigger</label>
              <select
                className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                value={draft.triggerType}
                onChange={(e) =>
                  setDraft({ ...draft, triggerType: e.target.value as "mo" | "transfer" })
                }
              >
                <option value="mo">Auto manufacturing order</option>
                <option value="transfer">Auto transfer order</option>
              </select>
            </div>
            {draft.triggerType === "mo" ? (
              <div className="col-span-2">
                <label className="text-caption text-ink-muted block mb-1">BOM (batch size = output qty)</label>
                <select
                  className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                  value={draft.bomId}
                  onChange={(e) => setDraft({ ...draft, bomId: e.target.value })}
                >
                  <option value="">— select BOM —</option>
                  {boms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="col-span-2">
                <label className="text-caption text-ink-muted block mb-1">Source bin</label>
                <select
                  className="h-8 w-full rounded border border-border bg-surface text-body-sm px-2"
                  value={draft.sourceBinId}
                  onChange={(e) => setDraft({ ...draft, sourceBinId: e.target.value })}
                >
                  <option value="">— select source —</option>
                  {allBins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="text-caption text-ink-muted block mb-1">Team tags (comma-separated)</label>
              <Input
                size="sm"
                placeholder="e.g. cold-storage, night-shift"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Save size={12} />} onClick={submitNew} disabled={busy}>
              Save rule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-canvas text-caption uppercase font-semibold text-ink-muted">
            <tr>
              <th className="text-left px-3 py-2">Product</th>
              <th className="text-left px-3 py-2">Monitor bin</th>
              <th className="text-right px-3 py-2">Min</th>
              <th className="text-left px-3 py-2">Trigger</th>
              <th className="text-left px-3 py-2">Action / tags</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2 w-12" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  <Loader2 size={14} className="inline animate-spin mr-1" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-ink-muted">
                  No stock rules yet.
                </td>
              </tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-canvas/50">
                <td className="px-3 py-2">
                  <span className="font-mono text-caption text-primary">{r.product.sku}</span>
                  {r.variant && (
                    <div className="text-caption text-ink-muted">{r.variant.sku}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-caption">
                  {r.monitorBin.warehouse.code} · {binPath(r.monitorBin)}
                  <div className="text-ink-muted tnum">now {r.monitorBin.qty}</div>
                </td>
                <td className="px-3 py-2 text-right tnum font-semibold">{r.minQty}</td>
                <td className="px-3 py-2">
                  <Chip size="sm" tone={r.triggerType === "mo" ? "primary" : "warning"}>
                    {r.triggerType === "mo" ? "MO" : "Transfer"}
                  </Chip>
                </td>
                <td className="px-3 py-2 text-caption text-ink-muted">
                  {r.triggerType === "mo" && r.bom
                    ? `BOM ${r.bom.revision} · batch ${r.bom.outputQty}`
                    : r.sourceBin
                      ? `from ${r.sourceBin.warehouse.code}/${binPath(r.sourceBin)}`
                      : "—"}
                  {r.tags && <div className="mt-0.5 text-primary">{r.tags}</div>}
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggleActive(r)} disabled={busy}>
                    <Chip size="sm" tone={r.active ? "success" : "neutral"}>
                      {r.active ? "active" : "off"}
                    </Chip>
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => remove(r)}
                    className="h-7 w-7 grid place-items-center rounded text-danger hover:bg-danger-soft"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
