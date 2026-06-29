// Browser-compatible wrapper for @twin.techies/india-pincode.
// The original package uses readFileSync at init time which breaks in
// Rollup browser builds. This shim imports the JSON via a virtual
// module (see vite.config.ts "inline-pincodes" plugin) so the data
// gets inlined at build time without any Node.js fs calls.

// @ts-ignore — virtual module resolved by vite.config.ts inline-pincodes plugin
import rawData from "virtual:pincodes-json";

type PincodeEntry = {
  pincode: string;
  state: string;
  district?: string;
  offices?: Array<{ city?: string; district?: string }>;
};

type PincodesJson = {
  version: number;
  pincodes: PincodeEntry[];
};

const byPin = new Map<string, PincodeEntry>();

function init() {
  if (byPin.size > 0) return;
  const json = rawData as PincodesJson | undefined;
  if (!json) return;
  const records: PincodeEntry[] = Array.isArray(json)
    ? json
    : Array.isArray(json.pincodes)
      ? json.pincodes
      : [];
  for (const r of records) {
    if (r.pincode) byPin.set(r.pincode, r);
  }
}

export function findByPincode(pin: string): PincodeEntry | null {
  init();
  return byPin.get(pin) ?? null;
}
