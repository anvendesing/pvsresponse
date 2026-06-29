import { findByPincode } from "@twin.techies/india-pincode";

export type PincodePlace = {
  city: string;
  district: string;
  state: string;
};

/** Strip to digits and cap at 6 — suitable for controlled pincode inputs. */
export const normalizePincodeInput = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, 6);

/**
 * Offline lookup of city/town, district, and state from a 6-digit Indian pincode.
 * Uses bundled India Post data — no network calls.
 */
export const lookupIndianPincode = (raw: string): PincodePlace | null => {
  const pin = normalizePincodeInput(raw);
  if (!/^[1-9]\d{5}$/.test(pin)) return null;

  const hit = findByPincode(pin);
  if (!hit) return null;

  const district = hit.district?.trim() || hit.offices[0]?.district?.trim() || "";
  const city = hit.offices[0]?.city?.trim() || district;
  const state = hit.state?.trim();
  if (!city || !state) return null;

  return { city, district: district || city, state };
};

/**
 * Apply a pincode field change. Autofill city/district/state only when the 6-digit
 * pin changes — manual edits are kept until the pincode changes.
 */
export const pincodeFieldUpdate = <
  T extends PincodePlace & { pincode: string },
>(
  prev: T,
  raw: string,
  lastAutofillPin: string
): { next: T; lastAutofillPin: string } => {
  const pin = normalizePincodeInput(raw);
  const next = { ...prev, pincode: pin };

  if (pin.length === 6 && pin !== lastAutofillPin) {
    const place = lookupIndianPincode(pin);
    if (place) {
      next.city = place.city;
      next.district = place.district;
      next.state = place.state;
      return { next, lastAutofillPin: pin };
    }
  }

  if (pin.length < 6) {
    return { next, lastAutofillPin: "" };
  }

  return { next, lastAutofillPin };
};

export const PINCODE_PLACE_HINT =
  "City, district, and state are suggested from pincode — edit any field if needed.";
