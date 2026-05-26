// Shared idempotency key generator. Backend dedupes on this so the
// mobile UI can retry a failed POST safely.

export const newClientOpId = (): string => {
  const c = (globalThis.crypto as Crypto | undefined);
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
