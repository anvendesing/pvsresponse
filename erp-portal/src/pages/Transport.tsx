// Transport & Dispatch (trip-centric)
//
// The transport workspace is now organised around **Trips**, not
// individual dispatches. A Trip = one truck, one driver, one calendar
// date, multiple drops. The page shows a 4-day calendar strip at the
// top with trip counts per day. Selecting a trip reveals its roster
// (the invoices being delivered) plus actions: start, complete,
// cancel-with-rollover, and reschedule.
//
// Operators no longer type vehicle/driver/ETA per invoice - they
// either auto-schedule one trip per day for the next 4 days or
// create a single trip, and then drop invoices on it.

import { backdropDismissProps } from "@/hooks/useBackdropDismiss";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  ExternalLink,
  Navigation,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Input";
import { Kpi } from "@/components/common/Kpi";
import { Toolbar } from "@/components/common/Toolbar";
import { api, type TripRow, type TripStatus } from "@/lib/api";
import { dt, inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { InvoicePicker } from "@/components/billing/InvoicePicker";

const tripTone = (s: TripStatus) => {
  switch (s) {
    case "scheduled":
      return "neutral" as const;
    case "in_transit":
      return "primary" as const;
    case "completed":
      return "success" as const;
    case "cancelled":
      return "danger" as const;
  }
};

const isoDate = (offsetDays: number): string => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const fmtDay = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
};

const dayKey = (s: string) => s.slice(0, 10);

export const Transport = () => {
  const navigate = useNavigate();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<string>(isoDate(0));
  const [showNew, setShowNew] = useState(false);
  const [okBanner, setOkBanner] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TripRow | null>(null);
  const [showStatuses, setShowStatuses] = useState<Set<TripStatus>>(
    () => new Set<TripStatus>(["scheduled", "in_transit"])
  );

  const refresh = async () => {
    setLoading(true);
    try {
      // Window: a week back (to keep recently completed/cancelled trips
      // visible) through 7 days ahead.
      const fresh = await api.trips({ from: isoDate(-7), to: isoDate(7) });
      setTrips(fresh);
      setError(null);
      // Auto-select the first trip on the active day if none is chosen.
      if (!selectedTripId && fresh.length) {
        const onDay = fresh.find((t) => dayKey(t.scheduledDate) === activeDay);
        if (onDay) setSelectedTripId(onDay.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const scheduled = trips.filter((t) => t.status === "scheduled").length;
    const inTransit = trips.filter((t) => t.status === "in_transit").length;
    const drops = trips.reduce((s, t) => s + t.dispatches.length, 0);
    const todayTrips = trips.filter(
      (t) => dayKey(t.scheduledDate) === isoDate(0)
    ).length;
    return { scheduled, inTransit, drops, todayTrips };
  }, [trips]);

  // 4-day calendar strip: today + next 3 days. Each card shows trip
  // count and total drops scheduled for that date.
  const calendarDays = useMemo(() => {
    return Array.from({ length: 4 }, (_, i) => {
      const date = isoDate(i);
      const onDay = trips.filter((t) => dayKey(t.scheduledDate) === date);
      const drops = onDay.reduce((s, t) => s + t.dispatches.length, 0);
      return { date, trips: onDay, drops };
    });
  }, [trips]);

  // Trips visible in the left column: filtered by active day +
  // status toggles.
  const visibleTrips = useMemo(() => {
    return trips
      .filter((t) => dayKey(t.scheduledDate) === activeDay)
      .filter((t) => showStatuses.has(t.status))
      .sort((a, b) => a.tripNo.localeCompare(b.tripNo));
  }, [trips, activeDay, showStatuses]);

  const selectedTrip = useMemo(
    () => trips.find((t) => t.id === selectedTripId) ?? null,
    [trips, selectedTripId]
  );

  const onAutoSchedule = async () => {
    setBusy("auto");
    try {
      const res = await api.autoScheduleTrips({ days: 4 });
      await refresh();
      setOkBanner(
        res.created.length === 0
          ? "All 4 days already have a scheduled trip."
          : `Created ${res.created.length} trip${res.created.length === 1 ? "" : "s"} for the next 4 days.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onStart = async (id: string) => {
    setBusy(id);
    try {
      await api.startTrip(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onComplete = async (id: string) => {
    if (!confirm("Mark all drops on this trip as delivered?")) return;
    setBusy(id);
    try {
      await api.completeTrip(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async (reason: string) => {
    if (!cancelTarget) return;
    setBusy(cancelTarget.id);
    try {
      const res = await api.cancelTrip(cancelTarget.id, reason);
      setCancelTarget(null);
      await refresh();
      if (res.successor) {
        setOkBanner(
          `Trip ${cancelTarget.tripNo} cancelled. ${res.trip.dispatches.length} drop${res.trip.dispatches.length === 1 ? " was" : "s were"} rolled over to ${res.successor.tripNo} (${dt(res.successor.scheduledDate)}).`
        );
        setSelectedTripId(res.successor.id);
        setActiveDay(dayKey(res.successor.scheduledDate));
      } else {
        setOkBanner(
          `Trip ${cancelTarget.tripNo} cancelled. (No drops to roll over.)`
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onUnassignDrop = async (tripId: string, dispatchId: string) => {
    setBusy(dispatchId);
    try {
      await api.unassignDispatchFromTrip(tripId, dispatchId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // "+ Add drop" picks an issued invoice and creates a dispatch on
  // the currently selected trip in one shot.
  const [addDropOpen, setAddDropOpen] = useState(false);
  const onAddDrop = async (invoiceId: string) => {
    if (!selectedTrip) return;
    setBusy("addDrop");
    try {
      await api.createDispatch({ invoiceId, tripId: selectedTrip.id });
      setAddDropOpen(false);
      await refresh();
      setOkBanner(`Drop added to ${selectedTrip.tripNo}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <Toolbar
        left={
          <div>
            <div className="text-h3 font-bold">Transport & Dispatch</div>
            <div className="text-body-sm text-ink-muted">
              Plan daily trips, drop invoices on them. Cancellations
              auto-roll to the next day.
            </div>
          </div>
        }
      />

      {okBanner && (
        <div className="px-3 py-2 rounded-md bg-success-soft border border-success text-success text-body-sm flex items-center gap-2">
          <CheckCircle2 size={14} />
          <span className="flex-1">{okBanner}</span>
          <button
            className="underline text-caption"
            onClick={() => setOkBanner(null)}
          >
            dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="px-3 py-2 rounded-md bg-danger-soft border border-danger text-danger text-body-sm flex items-center gap-2">
          <AlertTriangle size={14} />
          <span className="flex-1">{error}</span>
          <button
            className="underline text-caption"
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <Kpi
          label="Trips today"
          value={String(stats.todayTrips)}
          accent="primary"
        />
        <Kpi
          label="In transit"
          value={String(stats.inTransit)}
          accent={stats.inTransit > 0 ? "primary" : "none"}
        />
        <Kpi label="Scheduled (next 4d)" value={String(stats.scheduled)} accent="none" />
        <Kpi label="Total drops" value={String(stats.drops)} accent="none" />
      </div>

      {/* 4-day calendar strip */}
      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Trip schedule
            </div>
            <div className="text-body-sm text-ink-muted">
              Pick a day to see its trips. Auto-create the next 4 days in
              one click.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw size={14} />}
              onClick={refresh}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<CalendarPlus size={14} />}
              onClick={onAutoSchedule}
              disabled={busy === "auto"}
            >
              Auto-schedule next 4 days
            </Button>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setShowNew(true)}
            >
              New trip
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 p-4">
          {calendarDays.map((d) => {
            const isActive = d.date === activeDay;
            const isToday = d.date === isoDate(0);
            const inTransit = d.trips.some((t) => t.status === "in_transit");
            return (
              <button
                key={d.date}
                onClick={() => {
                  setActiveDay(d.date);
                  // Snap selection to first trip of the day.
                  const first = d.trips[0];
                  if (first) setSelectedTripId(first.id);
                }}
                className={cn(
                  "border rounded-md p-3 text-left transition-colors",
                  isActive
                    ? "border-primary bg-primary-50"
                    : "border-border hover:border-primary/50 hover:bg-canvas"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-caption text-ink-muted uppercase font-semibold">
                    {fmtDay(d.date)}
                  </div>
                  {isToday && (
                    <Chip size="sm" tone="primary">
                      Today
                    </Chip>
                  )}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-h2 font-bold tnum">{d.trips.length}</span>
                  <span className="text-caption text-ink-muted">
                    trip{d.trips.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-caption text-ink-muted">
                  {d.drops} drop{d.drops === 1 ? "" : "s"} planned
                  {inTransit && (
                    <span className="ml-2 text-primary font-semibold">
                      · in-transit
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-3">
        {/* Trip list */}
        <Card className="col-span-5">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-caption text-ink-muted uppercase font-semibold">
                Trips on {fmtDay(activeDay)}
              </div>
              <div className="text-body-sm text-ink-muted">
                {visibleTrips.length} trip{visibleTrips.length === 1 ? "" : "s"} matching filters
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(["scheduled", "in_transit", "completed", "cancelled"] as TripStatus[]).map(
                (s) => {
                  const on = showStatuses.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => {
                        const next = new Set(showStatuses);
                        if (on) next.delete(s);
                        else next.add(s);
                        setShowStatuses(next);
                      }}
                      className={cn(
                        "px-2 py-1 text-caption rounded border capitalize transition-colors",
                        on
                          ? "bg-primary-50 border-primary text-primary font-semibold"
                          : "border-border text-ink-muted hover:bg-canvas"
                      )}
                    >
                      {s.replace(/_/g, " ")}
                    </button>
                  );
                }
              )}
            </div>
          </div>
          <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            {visibleTrips.length === 0 ? (
              <div className="px-4 py-6 text-center text-body-sm text-ink-muted">
                No trips for this day match the filters.
              </div>
            ) : (
              visibleTrips.map((t) => {
                const used = t.dispatches.reduce(
                  (s, d) => s + (d.weightKg ?? 0),
                  0
                );
                const pct = t.capacityKg
                  ? Math.min(100, Math.round((used / t.capacityKg) * 100))
                  : 0;
                const isSel = t.id === selectedTripId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTripId(t.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 transition-colors",
                      isSel ? "bg-primary-50" : "hover:bg-canvas"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-caption font-semibold text-primary">
                        {t.tripNo}
                      </span>
                      <Chip size="sm" tone={tripTone(t.status)} className="capitalize">
                        {t.status.replace(/_/g, " ")}
                      </Chip>
                    </div>
                    <div className="mt-1 text-body-sm font-semibold">
                      {t.vehicle}{" "}
                      <span className="text-ink-muted font-normal">· {t.driver}</span>
                    </div>
                    {t.route && (
                      <div className="text-caption text-ink-muted">{t.route}</div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-canvas rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            pct > 90
                              ? "bg-danger"
                              : pct > 70
                                ? "bg-warning"
                                : "bg-primary"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-caption text-ink-muted tnum w-20 text-right">
                        {Math.round(used)} / {t.capacityKg} kg
                      </span>
                      <span className="text-caption text-ink-muted">
                        {t.dispatches.length} drop
                        {t.dispatches.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Trip detail */}
        <div className="col-span-7">
          {selectedTrip ? (
            <TripDetail
              trip={selectedTrip}
              busy={busy}
              onStart={() => onStart(selectedTrip.id)}
              onComplete={() => onComplete(selectedTrip.id)}
              onCancelClick={() => setCancelTarget(selectedTrip)}
              onUnassignDrop={(d) => onUnassignDrop(selectedTrip.id, d)}
              onAddDropClick={() => setAddDropOpen(true)}
              onOpenInvoice={(invoiceId) =>
                navigate(`/billing?tab=invoices&open=${invoiceId}`)
              }
              onReschedule={async (date) => {
                setBusy(selectedTrip.id);
                try {
                  await api.updateTrip(selectedTrip.id, { scheduledDate: date });
                  await refresh();
                  setActiveDay(date);
                  setOkBanner(
                    `Trip ${selectedTrip.tripNo} rescheduled to ${fmtDay(date)}.`
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : (
            <Card>
              <div className="p-8 text-center text-ink-muted">
                Select a trip to see its roster.
              </div>
            </Card>
          )}
        </div>
      </div>

      {showNew && (
        <NewTripModal
          defaultDate={activeDay}
          onClose={() => setShowNew(false)}
          onCreated={async (t) => {
            setShowNew(false);
            setOkBanner(`Trip ${t.tripNo} created.`);
            await refresh();
            setSelectedTripId(t.id);
            setActiveDay(dayKey(t.scheduledDate));
          }}
        />
      )}

      {cancelTarget && (
        <CancelTripModal
          trip={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={onCancel}
          busy={busy === cancelTarget.id}
        />
      )}

      {addDropOpen && selectedTrip && (
        <InvoicePicker
          onClose={() => setAddDropOpen(false)}
          onPick={(inv) => void onAddDrop(inv.id)}
        />
      )}
    </div>
  );
};

// ===================================================================
// Trip detail panel (right column)
// ===================================================================
interface TripDetailProps {
  trip: TripRow;
  busy: string | null;
  onStart: () => void;
  onComplete: () => void;
  onCancelClick: () => void;
  onUnassignDrop: (dispatchId: string) => void;
  onAddDropClick: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onReschedule: (date: string) => void;
}

const TripDetail = ({
  trip,
  busy,
  onStart,
  onComplete,
  onCancelClick,
  onUnassignDrop,
  onAddDropClick,
  onOpenInvoice,
  onReschedule,
}: TripDetailProps) => {
  const navigate = useNavigate();
  const [editingDate, setEditingDate] = useState(false);
  const [newDate, setNewDate] = useState(dayKey(trip.scheduledDate));
  const used = trip.dispatches.reduce((s, d) => s + (d.weightKg ?? 0), 0);
  const totalAmount = trip.dispatches.reduce(
    (s, d) => s + (d.invoice.amount ?? 0),
    0
  );

  return (
    <Card>
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-h4 font-bold text-primary">
                {trip.tripNo}
              </span>
              <Chip size="sm" tone={tripTone(trip.status)} className="capitalize">
                {trip.status.replace(/_/g, " ")}
              </Chip>
              {trip.rolledOverFromId && (
                <Chip size="sm" tone="warning">
                  Rolled over
                </Chip>
              )}
            </div>
            <div className="text-body-sm text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
              <CalendarClock size={12} />
              {editingDate ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-40 inline-block">
                    <Input
                      type="date"
                      size="sm"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                    />
                  </span>
                  <Button
                    size="sm"
                    onClick={() => {
                      onReschedule(newDate);
                      setEditingDate(false);
                    }}
                    disabled={busy === trip.id}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingDate(false)}
                  >
                    Cancel
                  </Button>
                </span>
              ) : (
                <>
                  <span>{dt(trip.scheduledDate)}</span>
                  {trip.status === "scheduled" && (
                    <button
                      className="text-primary underline text-caption"
                      onClick={() => setEditingDate(true)}
                    >
                      reschedule
                    </button>
                  )}
                </>
              )}
              <span className="text-ink-muted">·</span>
              <Truck size={12} /> <span>{trip.vehicle}</span>
              <span className="text-ink-muted">·</span>
              <span>{trip.driver}</span>
              {trip.route && (
                <>
                  <span className="text-ink-muted">·</span>
                  <Navigation size={12} /> <span>{trip.route}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {trip.status === "scheduled" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancelClick}
                  disabled={busy === trip.id}
                >
                  Cancel trip
                </Button>
                <Button
                  size="sm"
                  icon={<Truck size={14} />}
                  onClick={onStart}
                  disabled={busy === trip.id || trip.dispatches.length === 0}
                >
                  Start trip
                </Button>
              </>
            )}
            {trip.status === "in_transit" && (
              <Button
                size="sm"
                icon={<Check size={14} />}
                onClick={onComplete}
                disabled={busy === trip.id}
              >
                Mark all delivered
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/reports/containers?trip=${trip.id}`)}
              title="View per-container manifest for this trip"
            >
              Manifest
            </Button>
          </div>
        </div>

        {/* Capacity / value summary */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="border border-border rounded-md p-2.5">
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Drops
            </div>
            <div className="text-h3 font-bold tnum">{trip.dispatches.length}</div>
          </div>
          <div className="border border-border rounded-md p-2.5">
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Load
            </div>
            <div className="text-h3 font-bold tnum">
              {Math.round(used)}{" "}
              <span className="text-caption text-ink-muted font-normal">
                / {trip.capacityKg} kg
              </span>
            </div>
          </div>
          <div className="border border-border rounded-md p-2.5">
            <div className="text-caption text-ink-muted uppercase font-semibold">
              Invoice value
            </div>
            <div className="text-h3 font-bold tnum">{inr(totalAmount)}</div>
          </div>
        </div>
      </div>

      {trip.notes && (
        <div className="px-4 py-2 bg-canvas border-b border-border text-body-sm whitespace-pre-line">
          {trip.notes}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-caption text-ink-muted uppercase font-semibold">
            Roster
          </div>
          {trip.status === "scheduled" && (
            <Button
              size="sm"
              variant="outline"
              icon={<Plus size={14} />}
              onClick={onAddDropClick}
              disabled={busy === "addDrop"}
            >
              Add drop
            </Button>
          )}
        </div>
        {trip.dispatches.length === 0 ? (
          <div className="border border-dashed border-border rounded-md p-6 text-center">
            <div className="text-body-sm text-ink-muted mb-2">
              No invoices on this trip yet.
            </div>
            <div className="text-caption text-ink-muted">
              Click <strong>+ Add drop</strong> above, or open an invoice
              from <strong>Billing &gt; Invoices</strong> and use{" "}
              <strong>Assign to trip</strong>.
            </div>
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <div className="grid grid-cols-12 grid-header-cell text-caption">
              <div className="col-span-3">Drop</div>
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Destination</div>
              <div className="col-span-2 text-right">Weight</div>
              <div className="col-span-2 text-right">Action</div>
            </div>
            {trip.dispatches.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-12 grid-cell items-center !py-2 text-body-sm"
              >
                <div className="col-span-3">
                  <div className="font-mono text-caption font-semibold text-primary">
                    {d.dispatchNo}
                  </div>
                  <button
                    className="text-caption text-ink-muted hover:underline"
                    onClick={() => onOpenInvoice(d.invoice.id)}
                  >
                    inv {d.invoice.invoiceNo}{" "}
                    <ExternalLink size={10} className="inline" />
                  </button>
                </div>
                <div className="col-span-3">
                  <div className="font-semibold truncate">
                    {d.invoice.customer.name}
                  </div>
                  <div className="text-caption text-ink-muted tnum">
                    {inr(d.invoice.amount)}
                  </div>
                </div>
                <div className="col-span-2 text-body-sm">
                  {d.destination ?? d.invoice.customer.city ?? "—"}
                </div>
                <div className="col-span-2 text-right tnum">
                  {d.weightKg > 0 ? `${d.weightKg} kg` : "—"}
                </div>
                <div className="col-span-2 text-right">
                  {trip.status === "scheduled" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={12} />}
                      onClick={() => onUnassignDrop(d.id)}
                      disabled={busy === d.id}
                    >
                      Remove
                    </Button>
                  ) : (
                    <Chip size="sm" tone="neutral" className="capitalize">
                      {d.status}
                    </Chip>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

// ===================================================================
// New Trip modal
// ===================================================================
const NewTripModal = ({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: string;
  onClose: () => void;
  onCreated: (t: TripRow) => void;
}) => {
  const [date, setDate] = useState(defaultDate);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [route, setRoute] = useState("");
  const [capacity, setCapacity] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!vehicle.trim() || !driver.trim() || !date) {
      setError("Date, vehicle and driver are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTrip({
        scheduledDate: date,
        vehicle: vehicle.trim(),
        driver: driver.trim(),
        route: route.trim() || null,
        capacityKg: capacity,
      });
      onCreated(t);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-full max-w-md rounded-lg elevation-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-caption text-ink-muted uppercase font-semibold">
              New trip
            </div>
            <div className="text-body-sm">
              Schedule a vehicle for a day. Add invoice drops afterwards.
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
        <div className="p-4 grid grid-cols-2 gap-3">
          <Field label="Scheduled date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Capacity (kg)">
            <Input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Vehicle">
            <Input
              placeholder="KA-01-AB-1234"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Driver">
            <Input
              placeholder="Driver name"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Route (optional)">
              <Input
                placeholder="e.g. Bangalore South"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create trip"}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ===================================================================
// Cancel Trip modal - explains the rollover and asks for a reason.
// ===================================================================
const CancelTripModal = ({
  trip,
  onClose,
  onConfirm,
  busy,
}: {
  trip: TripRow;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  busy: boolean;
}) => {
  const [reason, setReason] = useState("");
  const dropCount = trip.dispatches.length;
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center"
      {...backdropDismissProps(onClose)}
    >
      <div
        className="bg-surface w-full max-w-md rounded-lg elevation-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-danger">
            <AlertTriangle size={16} />
            <div className="font-bold">Cancel trip {trip.tripNo}?</div>
          </div>
        </div>
        <div className="p-4 space-y-3 text-body-sm">
          {dropCount > 0 ? (
            <div className="border border-warning bg-warning-soft rounded-md p-3 text-body-sm">
              {dropCount} invoice{dropCount === 1 ? "" : "s"} will be auto-rolled
              over to a new trip on the next day with the same vehicle and
              driver. You can re-arrange afterwards.
            </div>
          ) : (
            <div className="text-ink-muted">
              No drops on this trip - it will simply be marked cancelled.
            </div>
          )}
          <Field label="Reason (optional)">
            <Input
              placeholder="e.g. Vehicle breakdown"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
        <div className="border-t border-border px-4 py-3 flex justify-end gap-2 bg-canvas">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Keep trip
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => onConfirm(reason)}
            disabled={busy}
          >
            {busy ? "Cancelling…" : "Cancel & roll over"}
          </Button>
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
