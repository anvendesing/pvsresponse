import { z } from "zod";

/** Indian postal pincode — 6 digits, first digit 1–9. */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

export const pincodeSchema = z
  .string()
  .trim()
  .regex(PINCODE_RE, "Pincode must be a valid 6-digit Indian postal code");

/** Prisma select fragment for ship-to / document headers. */
export const customerShipToSelect = {
  id: true,
  code: true,
  name: true,
  gst: true,
  contact: true,
  addressLine: true,
  city: true,
  state: true,
  pincode: true,
} as const;

export type CustomerShipTo = {
  name: string;
  gst?: string | null;
  contact?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

/** Multi-line block for address slips, packing slips, and public docs. */
export function formatCustomerAddress(c: CustomerShipTo | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.addressLine?.trim()) parts.push(c.addressLine.trim());
  const cityLine = [c.city, c.state, c.pincode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  return parts.join("\n");
}

/** Single-line destination for dispatch orders and transport lists. */
export function formatCustomerDestination(c: CustomerShipTo | null | undefined): string {
  if (!c) return "";
  const oneLine = formatCustomerAddress(c).replace(/\n/g, ", ");
  if (oneLine) return oneLine;
  return c.name;
}

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh",
];

/**
 * Migrate legacy imports that stuffed the full postal address into `city`.
 * Keeps the original blob in addressLine and tries to extract pincode / state / town.
 */
export function parseLegacyCustomerCity(city: string | null | undefined): {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
} {
  const raw = city?.trim();
  if (!raw) {
    return { addressLine: null, city: null, state: null, pincode: null };
  }

  const pinMatches = [...raw.matchAll(/\b([1-9][0-9]{5})\b/g)];
  const pincode = pinMatches.length ? pinMatches[pinMatches.length - 1][1] : null;

  let state: string | null = null;
  for (const s of INDIAN_STATES) {
    if (raw.includes(s)) {
      state = s;
      break;
    }
  }

  const segments = raw
    .split(/[,·]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let shortCity: string | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    let seg = segments[i].replace(/\b[1-9][0-9]{5}\b/g, "").trim();
    seg = seg.replace(/\bPH\s*:?\s*[\d+\s.-]+/gi, "").trim();
    if (!seg) continue;
    if (state && seg.toLowerCase() === state.toLowerCase()) continue;
    if (/^\d+$/.test(seg)) continue;
    if (seg.length > 48) continue;
    shortCity = seg;
    break;
  }

  return {
    addressLine: raw,
    city: shortCity,
    state,
    pincode,
  };
}

export const customerAddressBody = {
  addressLine: z.string().trim().min(3, "Address line is required"),
  city: z.string().trim().min(2, "City / town is required"),
  district: z.string().trim().min(2, "District is required").optional(),
  state: z.string().trim().nullable().optional(),
  pincode: pincodeSchema,
};

export const customerAddressPatch = {
  addressLine: z.string().trim().min(3, "Address line is required").optional(),
  city: z.string().trim().min(2, "City / town is required").optional(),
  district: z.string().trim().min(2, "District is required").optional().nullable(),
  state: z.string().trim().nullable().optional(),
  pincode: pincodeSchema.optional(),
};
