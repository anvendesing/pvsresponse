// Offline pincode → lat/lng and distance (km) for Indian postal codes.
// Uses bundled data via pincode-distance — no third-party API calls.
// Note: @twin.techies/india-pincode (city/state autofill) does not ship coordinates.

import { createRequire } from "node:module";

type PincodeDistanceEngine = {
  getlatLng(pincode: string): { lat?: number; lng?: number } | null;
  getDistance(from: string, to: string): number;
};

// pincode-distance is CJS; tsx ESM interop on its src/ entry breaks `new`.
const require = createRequire(import.meta.url);
const mod = require("pincode-distance") as
  | { default?: new () => PincodeDistanceEngine }
  | (new () => PincodeDistanceEngine);
const PincodeDistance =
  typeof mod === "function" ? mod : mod.default!;
const engine = new PincodeDistance();

export type PincodeCoords = {
  lat: number;
  lng: number;
};

/** Resolve approximate centre coordinates for a 6-digit Indian pincode. */
export function pincodeCoordinates(raw: string): PincodeCoords | null {
  const pin = raw.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  try {
    const hit = engine.getlatLng(pin) as { lat?: number; lng?: number } | null;
    if (!hit || typeof hit.lat !== "number" || typeof hit.lng !== "number") return null;
    return { lat: hit.lat, lng: hit.lng };
  } catch {
    return null;
  }
}

/** Great-circle road-ish distance in km between two pincodes (Haversine on pin centroids). */
export function pincodeDistanceKm(fromRaw: string, toRaw: string): number | null {
  const from = fromRaw.replace(/\D/g, "").slice(0, 6);
  const to = toRaw.replace(/\D/g, "").slice(0, 6);
  if (!/^[1-9]\d{5}$/.test(from) || !/^[1-9]\d{5}$/.test(to)) return null;
  try {
    const km = engine.getDistance(from, to);
    if (typeof km !== "number" || !Number.isFinite(km) || km < 0) return null;
    return Math.round(km * 10) / 10;
  } catch {
    return null;
  }
}
