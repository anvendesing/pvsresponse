import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, type CustomerAddress } from "@/lib/api";
import {
  extractIndianPincode,
  INDIA_DELIVERY_NOTE,
  isValidIndianPincode,
  PINCODE_PLACE_HINT,
  pincodeFieldUpdate,
  validateIndianPincode,
} from "@/lib/pincodeLookup";
import { useAuth } from "@/state/AuthContext";
import { useToast } from "@/state/ToastContext";

const LEGACY_KEY = "pv_addresses_v1";

const FRESH = {
  id: "",
  label: "Home",
  name: "",
  addressLine: "",
  city: "",
  district: "",
  state: "",
  pincode: "",
  phone: "",
};

export const AccountAddresses = () => {
  const auth = useAuth();
  const toast = useToast();
  const [list, setList] = useState<CustomerAddress[]>([]);
  const [draft, setDraft] = useState({ ...FRESH });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lastAutofillPinRef = useRef("");

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.listAddresses();
      setList(rows);
      auth.setAddresses(rows);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not load addresses.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!auth.isAuthed) return;
    void load();
  }, [auth.isAuthed]);

  useEffect(() => {
    if (!auth.isAuthed || list.length > 0) return;
    try {
      const raw = window.localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      const legacy = JSON.parse(raw) as unknown;
      if (!Array.isArray(legacy)) return;
      void (async () => {
        for (const a of legacy) {
          if (!a || typeof a !== "object") continue;
          try {
            const row = a as {
              label?: string;
              name?: string;
              line?: string;
              city?: string;
              state?: string;
              pincode?: string;
              phone?: string;
            };
            await api.createAddress({
              label: row.label ?? "Home",
              name: row.name ?? "",
              phone: row.phone ?? "",
              addressLine: row.line ?? "",
              city: row.city ?? "",
              state: row.state ?? "",
              pincode: row.pincode ?? "",
            });
          } catch {
            /* best effort */
          }
        }
        window.localStorage.removeItem(LEGACY_KEY);
        await load();
      })();
    } catch {
      /* noop */
    }
  }, [auth.isAuthed, list.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pinErr = validateIndianPincode(draft.pincode);
    if (pinErr) {
      toast.show(pinErr, "error");
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await api.updateAddress(draft.id, {
          label: draft.label,
          name: draft.name,
          phone: draft.phone,
          addressLine: draft.addressLine,
          city: draft.city,
          state: draft.state,
          pincode: draft.pincode,
        });
      } else {
        await api.createAddress({
          label: draft.label,
          name: draft.name,
          phone: draft.phone,
          addressLine: draft.addressLine,
          city: draft.city,
          state: draft.state,
          pincode: draft.pincode,
        });
      }
      setDraft({ ...FRESH });
      await load();
      toast.show("Address saved.", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not save address.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api.deleteAddress(id);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not delete.", "error");
    } finally {
      setBusy(false);
    }
  };

  const onPincodeChange = (raw: string) => {
    setDraft((prev) => {
      const { next, lastAutofillPin } = pincodeFieldUpdate(prev, raw, lastAutofillPinRef.current);
      lastAutofillPinRef.current = lastAutofillPin;
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <p className="muted" style={{ fontSize: "0.88rem", margin: 0 }}>
        {INDIA_DELIVERY_NOTE}
      </p>
      <div className="card-soft">
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Saved addresses</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No addresses saved yet. Add one below to speed up future checkouts.</p>
        ) : (
          <div className="addr-cards-grid">
            {list.map((a) => (
              <div
                key={a.id}
                style={{
                  border: "1px solid rgba(34,37,31,0.08)",
                  borderRadius: "var(--radius-md)",
                  padding: "1rem",
                }}
              >
                <strong>{a.label ?? "Address"}</strong>
                {a.isDefault && (
                  <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "var(--forest-green)" }}>Default</span>
                )}
                {!isValidIndianPincode(a.pincode) && (
                  <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "var(--color-error)" }}>
                    Invalid pincode
                  </span>
                )}
                <div style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>{a.name}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>{a.addressLine}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
                  {a.city}, {a.state} {a.pincode}
                  {a.distanceKm != null && (
                    <span> · ~{Math.round(a.distanceKm)} km from dispatch</span>
                  )}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>{a.phone}</div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                  <button type="button" onClick={() => {
                    lastAutofillPinRef.current = extractIndianPincode(a.pincode);
                    setDraft({ ...FRESH, ...a, label: a.label ?? "Home", state: a.state ?? "" });
                  }} className="text-link">
                    Edit
                  </button>
                  <button type="button" onClick={() => void remove(a.id)} style={{ color: "var(--color-error)", fontSize: "0.85rem" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="card-soft" onSubmit={(e) => void submit(e)} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>{draft.id ? "Edit address" : "Add a new address"}</h2>
        <div className="form-grid">
          <Input label="Label" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
          <Input label="Full name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
        </div>
        <Input label="Address line" value={draft.addressLine} onChange={(v) => setDraft({ ...draft, addressLine: v })} required />
        <div className="form-grid-3">
          <Input label="Pincode" value={draft.pincode} onChange={onPincodeChange} required inputMode="numeric" maxLength={6} pattern="[1-9][0-9]{5}" />
          <Input label="City" value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} required />
          <Input label="State" value={draft.state} onChange={(v) => setDraft({ ...draft, state: v })} required />
        </div>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "-0.35rem" }}>
          {PINCODE_PLACE_HINT}
        </p>
        <Input label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} required />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          {draft.id && (
            <button type="button" onClick={() => setDraft({ ...FRESH })} className="btn btn-outline">
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-green" disabled={busy}>
            {draft.id ? "Save changes" : "Add address"}
          </button>
        </div>
      </form>
    </div>
  );
};

const Input = ({
  label,
  value,
  onChange,
  required,
  inputMode,
  maxLength,
  pattern,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "numeric" | "text";
  maxLength?: number;
  pattern?: string;
}) => (
  <div className="float-field">
    <input
      type="text"
      placeholder=" "
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      inputMode={inputMode}
      maxLength={maxLength}
      pattern={pattern}
    />
    <label>
      {label}
      {required && " *"}
    </label>
  </div>
);
