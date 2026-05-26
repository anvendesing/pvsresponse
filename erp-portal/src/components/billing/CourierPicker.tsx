// Modal that lets the operator pick a courier for an ecommerce
// packing slip and (optionally) paste an AWB. The server fills in
// the courier-specific tracking URL template. Mirrors TripPicker
// for the in-house dispatch flow so operators have one mental model:
// "assign every order to the right channel from the invoice screen".

import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageCheck, Truck, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

interface Props {
  // Pre-fill if the slip already has a courier assigned (re-assign flow).
  initialCourier?: string | null;
  initialAwb?: string | null;
  onClose: () => void;
  // Called once the server responds with the updated slip. The caller
  // refreshes the parent invoice detail.
  onAssigned: (assignment: { courier: string; awb: string }) => void;
  // Action verb: "Assign" for first-time, "Re-assign" for change.
  reassign?: boolean;
}

export const CourierPicker = ({
  initialCourier,
  initialAwb,
  onClose,
  onAssigned,
  reassign = false,
}: Props) => {
  const [couriers, setCouriers] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The catalogue is keyed by code, but if the slip was assigned a
  // courier whose code doesn't match (e.g. the server stamped
  // "MockCourier" at pack-complete) we keep a freeform fallback so
  // the operator sees their original choice pre-selected.
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [awb, setAwb] = useState<string>(initialAwb ?? "");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.couriers();
        if (cancelled) return;
        setCouriers(list);
        // Pre-select the first known courier, or the existing one if
        // it matches a code in the catalogue.
        const match = initialCourier
          ? list.find(
              (c) =>
                c.code === initialCourier ||
                c.name.toLowerCase() === initialCourier.toLowerCase()
            )
          : null;
        setSelectedCode(match?.code ?? list[0]?.code ?? "");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialCourier]);

  const selected = useMemo(
    () => couriers.find((c) => c.code === selectedCode) ?? null,
    [couriers, selectedCode]
  );

  const submit = async () => {
    if (!selected) {
      setError("Pick a courier from the list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onAssigned({
        courier: selected.code,
        awb: awb.trim(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-body font-bold">
            <Truck size={16} className="text-primary" />
            {reassign ? "Re-assign courier" : "Assign to courier"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-body-sm text-ink-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading couriers…
            </div>
          ) : (
            <>
              <div>
                <label className="text-caption text-ink-muted uppercase font-semibold mb-1 block">
                  Courier
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {couriers.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setSelectedCode(c.code)}
                      className={cn(
                        "h-10 px-3 rounded-md border text-body-sm text-left transition-colors",
                        selectedCode === c.code
                          ? "border-primary bg-primary text-white font-semibold"
                          : "border-border bg-canvas hover:border-primary"
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-caption text-ink-muted uppercase font-semibold mb-1 block">
                  AWB / Tracking number
                </label>
                <Input
                  value={awb}
                  onChange={(e) => setAwb(e.target.value)}
                  placeholder="Leave blank for a mock AWB"
                  className="font-mono"
                />
                <div className="text-caption text-ink-muted mt-1">
                  If left blank the server mints a mock <strong>MOCK-AWB-…</strong>{" "}
                  string. The tracking URL is auto-built from the courier's
                  template.
                </div>
              </div>

              {selected && (
                <div className="rounded-md border border-border bg-canvas p-3 text-body-sm">
                  <div className="flex items-center gap-1.5 text-primary font-semibold">
                    <PackageCheck size={14} />
                    Will hand off to: {selected.name}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-md bg-danger-soft border border-danger px-3 py-2 text-body-sm text-danger">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border p-3 flex items-center justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || loading || !selected}>
            {busy ? "Assigning…" : reassign ? "Re-assign courier" : "Assign courier"}
          </Button>
        </div>
      </div>
    </div>
  );
};
