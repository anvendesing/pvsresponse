// Canonical scan-code format for a packing container.
//
//   C.<packingSlipNo>.<2-digit-seq>
//
// Examples:
//   C.PS-2026-8001.01
//   C.PS-2026-8042.07
//
// We use the same `C.` prefix the scanner UI uses for "container"
// because the existing bin format is `B.<…>` — the prefix lets the
// generic scan dispatcher route a code without disambiguating against
// product barcodes.

export const CONTAINER_CODE_PREFIX = "C.";

export const containerCode = (packingSlipNo: string, seq: number): string =>
  `${CONTAINER_CODE_PREFIX}${packingSlipNo}.${seq.toString().padStart(2, "0")}`;

export interface ParsedContainerCode {
  packingSlipNo: string;
  seq: number;
}

export const parseContainerCode = (raw: string): ParsedContainerCode | null => {
  const t = raw.trim().toUpperCase();
  if (!t.startsWith(CONTAINER_CODE_PREFIX)) return null;
  // packingSlipNo can have dashes, so split from the right: the seq
  // is always the last `.NN` token; everything between the prefix and
  // the last `.` is the slip no.
  const lastDot = t.lastIndexOf(".");
  if (lastDot <= CONTAINER_CODE_PREFIX.length) return null;
  const seqStr = t.slice(lastDot + 1);
  if (!/^\d{1,3}$/.test(seqStr)) return null;
  const slipNo = t.slice(CONTAINER_CODE_PREFIX.length, lastDot);
  if (!slipNo) return null;
  return { packingSlipNo: slipNo, seq: parseInt(seqStr, 10) };
};
