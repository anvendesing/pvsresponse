// Tiny CSV serializer used by /reports/* endpoints when called with
// `?format=csv`. Intentionally dependency-free — Excel/Google Sheets
// both accept RFC-4180 style quoting and CRLF line endings.

const escapeCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === "object") {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  // Quote when the cell contains a separator, quote, or line break.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export const toCsv = (
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): string => {
  const out: string[] = [];
  out.push(headers.map(escapeCell).join(","));
  for (const r of rows) {
    out.push(r.map(escapeCell).join(","));
  }
  // Trailing CRLF keeps Excel happy when the file is opened directly.
  return out.join("\r\n") + "\r\n";
};

/**
 * Convenience: build a `Content-Disposition` attachment header value
 * with a safe filename (alpha-num, dash, underscore, dot only).
 */
export const csvAttachment = (filename: string): string => {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `attachment; filename="${safe}"`;
};
