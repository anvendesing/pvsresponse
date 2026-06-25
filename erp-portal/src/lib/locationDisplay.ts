/** Mirror of backend formatLocationPath — hide internal placeholder levels. */

const IMPLICIT_SHELF = "00";
const IMPLICIT_BIN = "00";
const WH_LEVEL = "_";
const WH_LEGACY = "WH";

export function formatLocationPath(
  path: { zone: string; shelf: string; bin: string },
  warehouseName?: string | null
): string {
  const { zone, shelf, bin } = path;

  if (zone === WH_LEVEL || zone === WH_LEGACY) {
    return warehouseName?.trim() || "Warehouse";
  }

  const parts: string[] = [zone];
  if (shelf !== IMPLICIT_SHELF) parts.push(shelf);
  if (bin !== IMPLICIT_BIN) parts.push(bin);
  return parts.join(" / ");
}
