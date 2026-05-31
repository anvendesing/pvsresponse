// Public enquiry form. Captures product interest, dealership applications,
// farm-visit requests, or general questions and posts them to the CRM
// pipeline via POST /v1/storefront-mock/enquiries (no auth required).

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type EnquiryFormInput } from "@/lib/api";
import { useToast } from "@/state/ToastContext";

const TYPES: { id: EnquiryFormInput["type"]; label: string; hint: string }[] = [
  { id: "product",    label: "Product / bulk order", hint: "Buy in quantity or ask about a product" },
  { id: "dealership", label: "Dealership / distribution", hint: "Become a dealer or stockist" },
  { id: "farm_visit", label: "Farm visit", hint: "Request a visit to our farm" },
  { id: "other",      label: "Other", hint: "Any other enquiry" },
];

export const EnquiryPage = () => {
  const toast = useToast();
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<EnquiryFormInput["type"]>("product");
  const [contactName, setContactName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [subject, setSubject] = useState("");
  const [requirement, setRequirement] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !subject.trim()) {
      toast.show("Name and subject are required.", "error");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      toast.show("Give us a phone or email so we can reach you.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api.submitEnquiry({
        type,
        contactName: contactName.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        subject: subject.trim(),
        requirement: requirement.trim() || undefined,
      });
      setSubmitted(res.enquiryNo);
      toast.show("Enquiry submitted. We'll be in touch!", "success");
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : "Could not submit. Please try again.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ background: "var(--neutral-light)", minHeight: "70vh", padding: "3rem 1rem", display: "flex", justifyContent: "center" }}>
        <div className="card-soft" style={{ width: "100%", maxWidth: 520, padding: "2.5rem", textAlign: "center" }}>
          <h1 className="serif-title" style={{ fontSize: "1.8rem", color: "var(--forest-green-dark)", marginBottom: "0.6rem" }}>
            Thank you!
          </h1>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            Your enquiry <strong>{submitted}</strong> has been received. Our team will
            reach out to you shortly.
          </p>
          <Link to="/" className="btn btn-green">Back to store</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--neutral-light)", minHeight: "70vh", padding: "3rem 1rem", display: "flex", justifyContent: "center" }}>
      <div className="card-soft" style={{ width: "100%", maxWidth: 560, padding: "2rem" }}>
        <h1 className="serif-title" style={{ fontSize: "1.8rem", color: "var(--forest-green-dark)", marginBottom: "0.4rem" }}>
          Make an enquiry
        </h1>
        <p className="muted" style={{ marginBottom: "1.25rem", fontSize: "0.9rem" }}>
          Wholesale orders, dealership, farm visits, or anything else — tell us what
          you need and we'll get back to you.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              style={{
                textAlign: "left",
                padding: "0.7rem 0.85rem",
                borderRadius: "var(--radius-md)",
                border: `2px solid ${type === t.id ? "var(--forest-green)" : "var(--neutral-cream)"}`,
                background: type === t.id ? "var(--neutral-white)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: type === t.id ? "var(--forest-green)" : "var(--neutral-charcoal)" }}>
                {t.label}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--neutral-gray)" }}>{t.hint}</div>
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <Field label="Subject" required>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. 50 kg groundnut oil per month" required />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <Field label="Your name" required>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} required />
            </Field>
            <Field label="Company (optional)">
              <input value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="Phone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="City (optional)">
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <div className="float-field">
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              rows={4}
              placeholder=" "
              style={{ resize: "vertical" }}
            />
            <label>Details (optional)</label>
          </div>
          <button type="submit" className="btn btn-green btn-block" style={{ marginTop: "0.5rem", height: 48 }} disabled={busy}>
            {busy ? "Submitting…" : "Submit enquiry"}
          </button>
        </form>
      </div>
    </div>
  );
};

const Field = ({
  label, required, children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div className="float-field">
    {children}
    <label>{label}{required && " *"}</label>
  </div>
);
