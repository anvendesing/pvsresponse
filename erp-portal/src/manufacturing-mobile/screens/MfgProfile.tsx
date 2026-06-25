import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, auth } from "../../lib/api";
import {
  setDeviceFacility,
  useDeviceFacility,
  type DeviceFacility,
} from "../useDeviceFacility";
import type { ProductionFacility } from "../../data/types";

export const MfgProfile = () => {
  const nav = useNavigate();
  const facility = useDeviceFacility();
  const user = auth.user();
  const [rooms, setRooms] = useState<ProductionFacility[]>([]);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!picker) return;
    let cancelled = false;
    api
      .productionFacilities({ active: true })
      .then((rows) => {
        if (!cancelled) setRooms(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError((e as Error).message ?? "Could not load rooms.");
      });
    return () => {
      cancelled = true;
    };
  }, [picker]);

  const onPick = (r: ProductionFacility) => {
    const payload: DeviceFacility = {
      id: r.id,
      code: r.code,
      name: r.name,
      productionLineWarehouseId: r.productionLineWarehouseId ?? null,
      productionLineWarehouseCode: r.productionLineWarehouse?.code ?? null,
      productionLineWarehouseName: r.productionLineWarehouse?.name ?? null,
    };
    setDeviceFacility(payload);
    setPicker(false);
  };

  const onLogout = () => {
    auth.clear();
    nav("/mfg/login", { replace: true });
  };

  const onForgetRoom = () => {
    if (!confirm("Forget this room? You'll have to pick it again.")) return;
    setDeviceFacility(null);
    nav("/mfg/login", { replace: true });
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <section className="rounded-xl bg-white border border-slate-200 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Signed in as
        </div>
        <div className="text-base font-semibold text-slate-800 mt-0.5">
          {user?.name ?? "Worker"}
        </div>
        <div className="text-xs text-slate-500 font-mono mt-0.5">
          {user?.username}
        </div>
      </section>

      <section className="rounded-xl bg-white border border-slate-200 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Production room
        </div>
        <div className="text-base font-semibold text-slate-800 mt-0.5">
          {facility?.name ?? "Not set"}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {facility?.code}
          {facility?.productionLineWarehouseCode
            ? ` · line WH: ${facility.productionLineWarehouseCode}`
            : ""}
        </div>
        <div className="flex flex-col gap-2 mt-3">
          <button
            onClick={() => setPicker((v) => !v)}
            className="rounded-xl border border-[#003087] text-[#003087] px-4 py-2 text-sm font-semibold"
          >
            {picker ? "Cancel" : "Switch room"}
          </button>
          {facility && (
            <button
              onClick={onForgetRoom}
              className="rounded-xl border border-slate-300 text-slate-600 px-4 py-2 text-xs font-medium"
            >
              Forget this room
            </button>
          )}
        </div>

        {picker && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 mb-2">
                {error}
              </div>
            )}
            <ul className="space-y-2">
              {rooms.length === 0 ? (
                <li className="text-xs text-slate-500 text-center py-2">
                  Loading rooms…
                </li>
              ) : (
                rooms.map((r) => {
                  const selected = r.id === facility?.id;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => onPick(r)}
                        className={`w-full text-left rounded-lg border px-3 py-2 ${
                          selected
                            ? "border-[#003087] bg-blue-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="text-sm font-medium text-slate-800">
                          {r.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {r.code}
                          {r.productionLineWarehouse?.code
                            ? ` · ${r.productionLineWarehouse.code}`
                            : ""}
                        </div>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white border border-slate-200 px-4 py-4">
        <button
          onClick={onLogout}
          className="w-full rounded-xl bg-red-600 text-white px-4 py-3 text-sm font-semibold"
        >
          Sign out
        </button>
      </section>

      <div className="text-center text-[10px] text-slate-400 pt-2">
        Manufacturing PWA · v1
      </div>
    </div>
  );
};
