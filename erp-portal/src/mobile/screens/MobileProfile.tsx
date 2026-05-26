import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, auth } from "../../lib/api";
import {
  setDeviceWarehouse,
  useDeviceWarehouse,
} from "../useDeviceWarehouse";

// =====================================================================
// /m/profile
// =====================================================================
// Shows the worker's identity, today's punch state, the device's
// chosen warehouse, and three actions: Punch in/out, Switch warehouse,
// Sign out.

interface WorkerRow {
  id: string;
  empNo: string;
  name: string;
  station: string;
  shift: string;
  status: string;
  unitsToday: number;
  targetToday: number;
  hoursToday: number;
  attendance?: { inAt?: string | null; outAt?: string | null }[];
}

export const MobileProfile = () => {
  const nav = useNavigate();
  const wh = useDeviceWarehouse();
  const user = auth.user();
  const [worker, setWorker] = useState<WorkerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError(null);
    try {
      const w = (await api.meWorker()) as unknown as WorkerRow;
      setWorker(w);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(
          "Your login isn't linked to a floor Worker record yet. Ask a supervisor to wire it up before punching in."
        );
      } else {
        setError((err as Error).message);
      }
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const punch = async (direction: "in" | "out" | "break") => {
    setBusy(true);
    setError(null);
    try {
      await api.punchSelf(direction);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onSwitchWh = () => {
    setDeviceWarehouse(null);
    nav("/m/login", { replace: true });
  };

  const onSignOut = () => {
    auth.clear();
    setDeviceWarehouse(null);
    nav("/m/login", { replace: true });
  };

  const status = worker?.status ?? "out";
  const inToday = !!worker?.attendance?.[0]?.inAt;

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#003087] text-lg font-bold text-white">
            {(user?.name ?? "?").slice(0, 1)}
          </div>
          <div>
            <div className="text-base font-semibold">{user?.name}</div>
            <div className="text-xs text-slate-500">{user?.username} · {user?.role}</div>
          </div>
        </div>
        {worker && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Station" value={worker.station} />
            <Stat label="Shift" value={worker.shift} />
            <Stat
              label="Status"
              value={status}
              tone={status === "in" ? "ok" : status === "break" ? "warn" : "muted"}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {worker && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Today
          </h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Hours" value={worker.hoursToday.toFixed(1)} />
            <Stat label="Units" value={String(worker.unitsToday)} />
            <Stat label="Target" value={String(worker.targetToday)} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={busy || status === "in"}
              onClick={() => punch("in")}
              className="rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              Punch in
            </button>
            <button
              type="button"
              disabled={busy || status !== "in"}
              onClick={() => punch("break")}
              className="rounded-xl bg-amber-500 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              Break
            </button>
            <button
              type="button"
              disabled={busy || status === "out"}
              onClick={() => punch("out")}
              className="rounded-xl bg-slate-700 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              Punch out
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {inToday ? "Punched in today." : "Not punched in today yet."}
          </div>
        </div>
      )}

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Device warehouse
        </h3>
        {wh ? (
          <>
            <div className="text-base font-semibold">{wh.name}</div>
            <div className="text-xs text-slate-500">{wh.code}</div>
          </>
        ) : (
          <div className="text-sm text-slate-500">No warehouse selected.</div>
        )}
        <button
          type="button"
          onClick={onSwitchWh}
          className="mt-3 w-full rounded-xl border border-[#003087] bg-white py-2.5 text-sm font-semibold text-[#003087]"
        >
          Switch warehouse
        </button>
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="w-full rounded-xl border border-red-300 bg-white py-3 text-sm font-semibold text-red-700"
      >
        Sign out
      </button>
    </div>
  );
};

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "ok" | "warn" | "muted";
}) => {
  const tones: Record<string, string> = {
    ok: "text-emerald-700",
    warn: "text-amber-700",
    muted: "text-slate-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={["text-sm font-bold tabular-nums", tones[tone ?? "muted"]].join(" ")}>
        {value}
      </div>
    </div>
  );
};
