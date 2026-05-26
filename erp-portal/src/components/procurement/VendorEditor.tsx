// Vendor add / edit / soft-delete modal.
//
// Mirrors the customer editor pattern: a single dialog handles create
// and update flows, switching submit verb based on whether `vendor`
// is null. Soft-delete is offered when the vendor has POs (the
// backend returns softDeleted=true and we surface the message).

import { useEffect, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import type { Vendor } from "@/data/types";

interface Props {
  vendor: Vendor | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const VendorEditor = ({ vendor, onClose, onSaved }: Props) => {
  const isNew = vendor === null;
  const [name, setName] = useState(vendor?.name ?? "");
  const [code, setCode] = useState(vendor?.code ?? "");
  const [gst, setGst] = useState(vendor?.gst ?? "");
  const [contact, setContact] = useState(vendor?.contact ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [city, setCity] = useState(vendor?.city ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [paymentTerms, setPaymentTerms] = useState(vendor?.paymentTerms ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(vendor?.leadTimeDays ?? 7);
  const [rating, setRating] = useState(vendor?.rating ?? 0);
  const [active, setActive] = useState(vendor?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trap Esc for quick dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        gst: gst.trim() || undefined,
        contact: contact.trim() || undefined,
        email: email.trim() || null,
        city: city.trim() || undefined,
        address: address.trim() || null,
        paymentTerms: paymentTerms.trim() || null,
        leadTimeDays: Number(leadTimeDays) || 0,
        rating: Number(rating) || 0,
        active,
      };
      if (isNew) {
        await api.createVendor({
          ...payload,
          code: code.trim() || undefined,
        });
        onSaved("Vendor created.");
      } else {
        await api.updateVendor(vendor!.id, {
          ...payload,
          code: code.trim() || undefined,
        });
        onSaved("Vendor updated.");
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!vendor) return;
    if (
      !window.confirm(
        `Delete ${vendor.name}? Vendors with PO history are kept (marked inactive) for audit.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.deleteVendor(vendor.id);
      if (r.softDeleted) {
        onSaved(r.message ?? "Vendor marked inactive.");
      } else {
        onSaved("Vendor deleted.");
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="bg-surface w-[640px] max-w-[95vw] max-h-[90vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Building2 size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                {isNew ? "New vendor" : `Edit ${vendor.name}`}
              </div>
              <div className="text-body-sm">
                {isNew
                  ? "Add a supplier so you can issue POs and post GRNs against them."
                  : "Update vendor master data; PO history is preserved."}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 grid place-items-center rounded-md text-ink-muted hover:bg-canvas"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-8">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Vendor name *
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Steelworks Industries Pvt Ltd"
                autoFocus
              />
            </div>
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Code
              </div>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="auto-generated"
              />
            </div>
          </div>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                GSTIN
              </div>
              <Input
                value={gst}
                onChange={(e) => setGst(e.target.value)}
                placeholder="22AAAAA0000A1Z5"
              />
            </div>
            <div className="col-span-6">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                City
              </div>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Mumbai"
              />
            </div>
          </div>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-6">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Contact (phone)
              </div>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="+91 ..."
              />
            </div>
            <div className="col-span-6">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Email
              </div>
              <Input
                value={email ?? ""}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ar@vendor.com"
              />
            </div>
          </div>
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
              Address
            </div>
            <textarea
              value={address ?? ""}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              placeholder="Plot 14, Industrial Area, MIDC..."
              className="w-full bg-white border border-border rounded-md px-3 py-2 text-body outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Lead time (days)
              </div>
              <Input
                type="number"
                min={0}
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(Number(e.target.value) || 0)}
              />
            </div>
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Rating (0-5)
              </div>
              <Input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={rating}
                onChange={(e) => setRating(Number(e.target.value) || 0)}
              />
            </div>
            <div className="col-span-4">
              <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
                Payment terms
              </div>
              <Input
                value={paymentTerms ?? ""}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. Net 30"
              />
            </div>
          </div>
          {!isNew && (
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span className="text-body-sm">Active</span>
            </label>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex justify-between items-center gap-2 bg-canvas">
          <div>
            {!isNew && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={remove}
                disabled={busy}
                className="!text-danger hover:!bg-danger-soft"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              icon={isNew ? <CheckCircle2 size={14} /> : <Save size={14} />}
              onClick={submit}
              disabled={busy}
            >
              {busy ? "Saving…" : isNew ? "Create vendor" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
