import { useEffect, useState } from "react";

// Persist the chosen warehouse on the device. The mobile app is "owned"
// by a warehouse - workers don't switch warehouses mid-shift, so we
// store the choice in localStorage and only show the picker on first
// run or when the user opens Profile -> Switch warehouse.

const KEY = "nova.mobile.warehouse";

export interface DeviceWarehouse {
  id: string;
  code: string;
  name: string;
}

const read = (): DeviceWarehouse | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DeviceWarehouse) : null;
  } catch {
    return null;
  }
};

export const getDeviceWarehouse = (): DeviceWarehouse | null => read();

export const setDeviceWarehouse = (wh: DeviceWarehouse | null) => {
  if (wh) localStorage.setItem(KEY, JSON.stringify(wh));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("nova-mobile-wh-change"));
};

export const useDeviceWarehouse = () => {
  const [wh, setWh] = useState<DeviceWarehouse | null>(read);
  useEffect(() => {
    const onChange = () => setWh(read());
    window.addEventListener("nova-mobile-wh-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("nova-mobile-wh-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return wh;
};
