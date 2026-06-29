import { findByPincode } from "@/lib/pincode-browser-shim";

export type PincodePlace = {
  city: string;
  district: string;
  state: string;
};

/** 6-digit Indian postal code — first digit 1–9. */
export const INDIAN_PINCODE_RE = /^[1-9]\d{5}$/;

export const INDIA_DELIVERY_NOTE =
  "We deliver within India only. Enter a valid 6-digit Indian pincode.";

/** Digits-only, max 6. */
export const normalizePincodeInput = (raw: string): string =>
  raw.replace(/\D/g, "").slice(0, 6);

export const isValidIndianPincode = (raw: string): boolean =>
  INDIAN_PINCODE_RE.test(normalizePincodeInput(raw));

export const extractIndianPincode = (raw: string): string => {
  const pin = normalizePincodeInput(raw);
  return isValidIndianPincode(pin) ? pin : "";
};

export const validateIndianPincode = (raw: string): string | null => {
  const pin = normalizePincodeInput(raw);
  if (!pin) return "Pincode is required.";
  if (!INDIAN_PINCODE_RE.test(pin)) {
    return "Enter a valid 6-digit Indian pincode. We deliver within India only.";
  }
  return null;
};

const officesFrom = (hit: { offices?: unknown }): Array<{ city?: string; district?: string }> =>
  Array.isArray(hit.offices) ? hit.offices : [];

/** Offline city, district, and state from a 6-digit Indian pincode. */
export const lookupIndianPincode = (raw: string): PincodePlace | null => {
  const pin = extractIndianPincode(raw);
  if (!pin) return null;

  const hit = findByPincode(pin);
  if (!hit) return null;

  const offices = officesFrom(hit);
  const district = hit.district?.trim() || offices[0]?.district?.trim() || "";
  const city = offices[0]?.city?.trim() || district;
  const state = hit.state?.trim();
  if (!city || !state) return null;

  return { city, district: district || city, state };
};

/**
 * Pincode field change — digits only, autofill city/district/state for valid Indian pins.
 */
export const pincodeFieldUpdate = <
  T extends PincodePlace & { pincode: string },
>(
  prev: T,
  raw: string,
  lastAutofillPin: string
): { next: T; lastAutofillPin: string } => {
  const pincode = normalizePincodeInput(raw);
  const next = { ...prev, pincode };

  if (pincode.length === 6 && pincode !== lastAutofillPin) {
    const place = lookupIndianPincode(pincode);
    if (place) {
      next.city = place.city;
      next.district = place.district;
      next.state = place.state;
      return { next, lastAutofillPin: pincode };
    }
  }

  if (pincode.length < 6) {
    return { next, lastAutofillPin: "" };
  }

  return { next, lastAutofillPin };
};

export const PINCODE_PLACE_HINT =
  "City, district, and state are suggested from your 6-digit Indian pincode — edit any field if needed.";
