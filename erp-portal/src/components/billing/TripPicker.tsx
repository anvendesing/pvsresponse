// Modal that lets the operator pick a scheduled Trip to assign an
// invoice to. Lists trips for the next ~4 days, shows current load
// vs capacity per trip, and offers a "Create new trip" shortcut for
// when none of the listed trips fit.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Plus, Truck, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { api, type TripRow } from "@/lib/api";
import { cn } from "@/lib/cn";

interface Props {
  onClose: () => void;
  // Called when the operator picks an existing trip OR creates a new one.
  // The caller is then expected to mutate the dispatch / create one with
  // tripId = trip.id.
  onPick: (trip: TripRow) => void;
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
};

const isoDate = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export const TripPicker = ({ onClose, onPick }: Props) => {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline "create new trip" form state.
  const [showNew, setShowNew] = useState(false);
  const [newDate, setNewDate] = useState(isoDate(0));
  const [newVehicle, setNewVehicle] = useState("");
  const [newDriver, setNewDriver] = useState("");
  const [newRoute, setNewRoute] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      // Load this week's trips (today + 6 days). The user can extend
      // by clicking auto-schedule.
      const fresh = await api.trips({
        from: isoDate(0),
        to: isoDate(6),
        status: "scheduled",
      });
      setTrips(fresh);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, TripRow[]>();
    for (const t of trips) {
      const key = t.scheduledDate.slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map, ([date, ts]) => ({ date, trips: ts }));
  }, [trips]);

  const onAutoSchedule = async () => {
    setBusy(true);
    try {
      await api.autoScheduleTrips({ days: 4 });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async () => {
    if (!newVehicle.trim() || !newDriver.trim() || !newDate) {
      setError("Date, vehicle and driver are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.createTrip({
        scheduledDate: newDate,
        vehicle: newVehicle.trim(),
        driver: newDriver.trim(),
        route: newRoute.trim() || null,
      });
      onPick(created);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-ink/40 grid place-items-center" {...backdropDismissProps(onClose)}>
      <div
        className="bg-surface w-full max-w-2xl max-h-[85vh] rounded-lg elevation-3 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 grid place-items-center bg-primary-50 text-primary rounded-md">
              <Truck size={16} />
            </div>
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Assign to a trip
              </div>
              <div className="text-body-sm">
                Pick a scheduled trip or create a new one.
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
          <div className="px-4 py-2 bg-danger-soft border-b border-danger text-danger text-body-sm">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {loading ? (
              <div className="text-center text-ink-muted py-6">Loading trips…</div>
            ) : grouped.length === 0 ? (
              <div className="border border-dashed border-border rounded-md p-6 text-center">
                <div className="text-body font-semibold mb-1">
                  No scheduled trips for the next week
                </div>
                <div className="text-body-sm text-ink-muted mb-4">
                  Auto-create one trip per day for the next 4 days, or add a
                  single trip below.
                </div>
                <Button
                  size="sm"
                  icon={<CalendarPlus size={14} />}
                  onClick={onAutoSchedule}
                  disabled={busy}
                >
                  Auto-schedule next 4 days
                </Button>
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.date}>
                  <div className="text-caption text-ink-muted uppercase font-semibold mb-1.5">
                    {fmtDate(g.date)}
                  </div>
                  <div className="space-y-2">
                    {g.trips.map((t) => {
                      const used = t.dispatches.reduce(
                        (s, d) => s + (d.weightKg ?? 0),
                        0
                      );
                      const pct =
                        t.capacityKg > 0
                          ? Math.min(100, Math.round((used / t.capacityKg) * 100))
                          : 0;
                      return (
                        <button
                          key={t.id}
                          onClick={() => onPick(t)}
                          className="w-full text-left border border-border rounded-md p-3 hover:border-primary hover:bg-primary-50/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-caption font-semibold text-primary">
                                  {t.tripNo}
                                </span>
                                <Chip size="sm" tone="primary" className="capitalize">
                                  {t.status.replace(/_/g, " ")}
                                </Chip>
                                {t.route && (
                                  <span className="text-body-sm text-ink-muted truncate">
                                    {t.route}
                                  </span>
                                )}
                              </div>
                              <div className="text-body-sm font-semibold mt-0.5">
                                {t.vehicle}{" "}
                                <span className="text-ink-muted font-normal">
                                  · {t.driver}
                                </span>
                              </div>
                              <div className="text-caption text-ink-muted mt-0.5">
                                {t.dispatches.length} drop
                                {t.dispatches.length === 1 ? "" : "s"}
                              </div>
                            </div>
                            <div className="w-32 shrink-0">
                              <div className="text-caption text-ink-muted text-right tnum">
                                {Math.round(used)} / {t.capacityKg} kg
                              </div>
                              <div className="h-1.5 mt-1 bg-canvas rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full transition-all",
                                    pct > 90
                                      ? "bg-danger"
                                      : pct > 70
                                        ? "bg-warning"
                                        : "bg-primary"
                                  )}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-border bg-canvas">
          {!showNew ? (
            <div className="p-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={<CalendarPlus size={14} />}
                onClick={onAutoSchedule}
                disabled={busy}
              >
                Auto-schedule next 4 days
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setShowNew(true)}
              >
                Create new trip
              </Button>
            </div>
          ) : (
            <div className="p-3 grid grid-cols-2 gap-2">
              <Field label="Date">
                <Input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </Field>
              <Field label="Route (optional)">
                <Input
                  placeholder="e.g. South Bangalore"
                  value={newRoute}
                  onChange={(e) => setNewRoute(e.target.value)}
                />
              </Field>
              <Field label="Vehicle">
                <Input
                  placeholder="KA-01-AB-1234"
                  value={newVehicle}
                  onChange={(e) => setNewVehicle(e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Driver">
                <Input
                  placeholder="Driver name"
                  value={newDriver}
                  onChange={(e) => setNewDriver(e.target.value)}
                />
              </Field>
              <div className="col-span-2 flex justify-end gap-2 mt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowNew(false)}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button size="sm" onClick={onCreate} disabled={busy}>
                  {busy ? "Creating…" : "Create & assign"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="text-caption text-ink-muted uppercase font-semibold mb-1">
      {label}
    </div>
    {children}
  </div>
);
