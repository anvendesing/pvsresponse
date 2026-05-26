// Addresses tab. Stored locally as a simple list - no backend
// model yet because the order endpoint accepts the address inline
// at checkout. Customers can save 1+ addresses for convenience.

import { useEffect, useState, type FormEvent } from "react";

interface Address {
  id: string;
  label: string;
  name: string;
  line: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

const STORAGE_KEY = "pv_addresses_v1";

const FRESH: Address = {
  id: "",
  label: "Home",
  name: "",
  line: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
};

export const AccountAddresses = () => {
  const [list, setList] = useState<Address[]>([]);
  const [draft, setDraft] = useState<Address>({ ...FRESH });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setList(JSON.parse(raw) as Address[]);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* noop */
    }
  }, [list]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = draft.id || `addr_${Date.now()}`;
    setList((prev) => {
      const idx = prev.findIndex((a) => a.id === id);
      const next = { ...draft, id };
      if (idx >= 0) {
        const out = [...prev];
        out[idx] = next;
        return out;
      }
      return [...prev, next];
    });
    setDraft({ ...FRESH });
  };

  const remove = (id: string) => setList((prev) => prev.filter((a) => a.id !== id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div className="card-soft">
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Saved addresses</h2>
        {list.length === 0 ? (
          <p className="muted">No addresses saved yet. Add one below to speed up future checkouts.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {list.map((a) => (
              <div
                key={a.id}
                style={{
                  border: "1px solid rgba(34,37,31,0.08)",
                  borderRadius: "var(--radius-md)",
                  padding: "1rem",
                }}
              >
                <strong>{a.label}</strong>
                <div style={{ fontSize: "0.85rem", marginTop: "0.4rem" }}>
                  {a.name}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
                  {a.line}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
                  {a.city}, {a.state} {a.pincode}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--neutral-gray)" }}>
                  {a.phone}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                  <button
                    type="button"
                    onClick={() => setDraft(a)}
                    className="text-link"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    style={{ color: "var(--color-error)", fontSize: "0.85rem" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="card-soft" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>{draft.id ? "Edit address" : "Add a new address"}</h2>
        <div className="form-grid">
          <Input label="Label" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
          <Input label="Full name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
        </div>
        <Input label="Address line" value={draft.line} onChange={(v) => setDraft({ ...draft, line: v })} required />
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <Input label="Pincode" value={draft.pincode} onChange={(v) => setDraft({ ...draft, pincode: v })} required />
          <Input label="City" value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} required />
          <Input label="State" value={draft.state} onChange={(v) => setDraft({ ...draft, state: v })} required />
        </div>
        <Input label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} required />

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          {draft.id && (
            <button type="button" onClick={() => setDraft({ ...FRESH })} className="btn btn-outline">
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-green">
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) => (
  <div className="float-field">
    <input
      type="text"
      placeholder=" "
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    />
    <label>
      {label}
      {required && " *"}
    </label>
  </div>
);
