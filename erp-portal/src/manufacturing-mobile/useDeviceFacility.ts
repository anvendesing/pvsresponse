import { useEffect, useState } from "react";

// Persist the production room (ProductionFacility) this device is
// assigned to. Mirrors useDeviceWarehouse: a room belongs to a device,
// not to a session — swapping workers on the same shop-floor tablet
// keeps it pointing at the same room. Workers can change it from
// Profile → Switch room.

const KEY = "nova.mfg.facility";

export interface DeviceFacility {
  id: string;
  code: string;
  name: string;
  // Cached so the shell can show "Soap Room → CAOL-LINE" before the
  // detail screens fetch fresh data.
  productionLineWarehouseId?: string | null;
  productionLineWarehouseCode?: string | null;
  productionLineWarehouseName?: string | null;
}

const read = (): DeviceFacility | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeviceFacility) : null;
  } catch {
    return null;
  }
};

export const getDeviceFacility = (): DeviceFacility | null => read();

export const setDeviceFacility = (fac: DeviceFacility | null) => {
  if (fac) localStorage.setItem(KEY, JSON.stringify(fac));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("nova-mfg-facility-change"));
};

export const useDeviceFacility = () => {
  const [fac, setFac] = useState<DeviceFacility | null>(read);
  useEffect(() => {
    const onChange = () => setFac(read());
    window.addEventListener("nova-mfg-facility-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("nova-mfg-facility-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return fac;
};
