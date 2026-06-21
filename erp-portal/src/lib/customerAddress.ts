export type CustomerAddressFields = {
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
};

/** Multi-line ship-to block for print layouts and address slips. */
export function formatCustomerAddress(c: CustomerAddressFields | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.addressLine?.trim()) parts.push(c.addressLine.trim());
  const cityLine = [c.city, c.state, c.pincode].filter(Boolean).join(", ");
  if (cityLine) parts.push(cityLine);
  return parts.join("\n");
}

/** One-line summary for table subtitles (city · pincode). */
export function formatCustomerSummary(c: CustomerAddressFields | null | undefined): string {
  if (!c) return "";
  const pin = c.pincode?.trim();
  const city = c.city?.trim();
  if (city && pin) return `${city} · ${pin}`;
  if (pin) return pin;
  if (city) return city;
  return c.addressLine?.trim() ?? "";
}

export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

export function validatePincode(value: string): string | null {
  const v = value.trim();
  if (!v) return "Pincode is required";
  if (!PINCODE_PATTERN.test(v)) return "Enter a valid 6-digit pincode";
  return null;
}
