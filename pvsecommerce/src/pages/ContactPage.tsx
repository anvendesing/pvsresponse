// Public Contact Us page — farm details + message form posting to the CRM
// enquiry pipeline via POST /v1/storefront-mock/enquiries (no auth required).

import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type EnquiryFormInput } from "@/lib/api";
import { useToast } from "@/state/ToastContext";

const PHONES = [
  { display: "+91 91005 05585", tel: "+919100505585" },
  { display: "+91 94929 03765", tel: "+919492903765" },
  { display: "+91 94408 55241", tel: "+919440855241" },
] as const;

const EMAILS = [
  { address: "prakruthivanam@gmail.com" },
  { address: "hello@prakruthivanam.in" },
] as const;

export const ContactPage = () => {
  const toast = useToast();
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [duplicateMsg, setDuplicateMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDuplicateMsg(null);

    if (!contactName.trim() || !message.trim()) {
      toast.show("Name and message are required.", "error");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      toast.show("Give us a phone or email so we can reach you.", "error");
      return;
    }

    setBusy(true);
    try {
      const payload: EnquiryFormInput = {
        type: "other",
        source: "contact_page",
        contactName: contactName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        subject: "Contact form message",
        requirement: message.trim(),
      };
      const res = await api.submitEnquiry(payload);
      setSubmitted(res.enquiryNo);
      toast.show("Message sent. We'll be in touch!", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const details = err.details as { code?: string; enquiryNo?: string } | undefined;
        if (details?.code === "duplicate_open_enquiry") {
          setDuplicateMsg(err.message);
          toast.show(err.message, "error");
          return;
        }
      }
      toast.show(
        err instanceof ApiError ? err.message : "Could not send your message. Please try again.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="contact-page">
        <div className="card-soft contact-page__success">
          <h1 className="serif-title contact-page__title">Thank you!</h1>
          <p className="muted">
            Thanks — your message is with us (<strong>{submitted}</strong>). We'll reply within a
            business day.
          </p>
          <Link to="/" className="btn btn-green">
            Back to store
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="contact-page">
      <div className="contact-page__header">
        <h1 className="serif-title contact-page__title">Contact Us</h1>
        <p className="muted contact-page__subtitle">
          Reach our farm team for orders, visits, partnerships, or any question about Prakruthivanam.
        </p>
      </div>

      <div className="contact-page__grid">
        <aside className="card-soft contact-page__info">
          <section className="contact-page__block">
            <h2 className="contact-page__label">Our farm</h2>
            <p className="contact-page__text">
              Chinna Tippa Samudram, Kothavaripalle,
              <br />
              Andhra Pradesh Madanapalle-517319
            </p>
          </section>

          <section className="contact-page__block">
            <h2 className="contact-page__label">Phone</h2>
            <ul className="contact-page__list">
              {PHONES.map((p) => (
                <li key={p.tel}>
                  <a href={`tel:${p.tel}`} className="contact-page__link">
                    {p.display}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="contact-page__block">
            <h2 className="contact-page__label">Email</h2>
            <ul className="contact-page__list">
              {EMAILS.map((e) => (
                <li key={e.address}>
                  <a href={`mailto:${e.address}`} className="contact-page__link">
                    {e.address}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="contact-page__block">
            <h2 className="contact-page__label">Hours</h2>
            <p className="contact-page__text">Mon–Sun 9:30am – 5:30pm</p>
          </section>
        </aside>

        <div className="card-soft contact-page__form-card">
          <h2 className="serif-title contact-page__form-title">Connect with us</h2>
          <p className="muted contact-page__form-hint">
            Send a message and we'll add it to our enquiry queue. For bulk orders or dealership,
            you can also use our{" "}
            <Link to="/enquiry" className="contact-page__inline-link">
              enquiry form
            </Link>
            .
          </p>

          {duplicateMsg && (
            <div className="contact-page__duplicate" role="alert">
              {duplicateMsg}
            </div>
          )}

          <form onSubmit={submit} className="contact-page__form">
            <Field label="Name" required>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </Field>
            <div className="float-field">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder=" "
                required
                style={{ resize: "vertical" }}
              />
              <label>Message *</label>
            </div>
            <button
              type="submit"
              className="btn btn-green btn-block contact-page__submit"
              disabled={busy}
            >
              {busy ? "Sending…" : "Submit"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) => (
  <div className="float-field">
    {children}
    <label>
      {label}
      {required && " *"}
    </label>
  </div>
);
