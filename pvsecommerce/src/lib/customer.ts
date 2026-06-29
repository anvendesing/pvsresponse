/** Match backend placeholderCustomerName / isPlaceholderCustomerName. */
export function placeholderCustomerName(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `Customer · ${digits}`;
}

export function isPlaceholderCustomerName(name: string, phone?: string | null): boolean {
  const n = name.trim();
  if (!n || n === "Customer") return true;
  if (phone) {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (n === placeholderCustomerName(digits)) return true;
    if (n === placeholderCustomerName(phone)) return true;
    if (n === digits) return true;
  }
  return false;
}

export function displayCustomerName(name: string, phone?: string | null): string {
  return isPlaceholderCustomerName(name, phone) ? "" : name;
}
