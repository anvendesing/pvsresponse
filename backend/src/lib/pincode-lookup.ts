import { findByPincode } from "@twin.techies/india-pincode";
import { computeAddressDistanceFields } from "./address-distance.js";

export type PincodePlace = {
  pincode: string;
  city: string;
  district: string;
  state: string;
  distanceKm: number | null;
  dispatchPincode: string | null;
};

const normalizePin = (raw: string): string | null => {
  const pin = raw.replace(/\D/g, "").slice(0, 6);
  return /^[1-9]\d{5}$/.test(pin) ? pin : null;
};

/** Offline city, district, state and dispatch distance for a delivery pincode. */
export async function lookupPincodePlace(raw: string): Promise<PincodePlace | null> {
  const pin = normalizePin(raw);
  if (!pin) return null;

  const hit = findByPincode(pin);
  if (!hit) return null;

  const district = hit.district?.trim() || hit.offices[0]?.district?.trim() || "";
  const city = hit.offices[0]?.city?.trim() || district;
  const state = hit.state?.trim();
  if (!city || !state) return null;

  const distance = await computeAddressDistanceFields(pin);
  return {
    pincode: pin,
    city,
    district: district || city,
    state,
    distanceKm: distance.distanceKm,
    dispatchPincode: distance.dispatchPincode,
  };
}
