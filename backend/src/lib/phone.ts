/** Normalize Indian mobile numbers to 10-digit local form. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return null;
}

export function formatPhoneDisplay(phone: string): string {
  const n = normalizePhone(phone);
  return n ?? phone.trim();
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}
