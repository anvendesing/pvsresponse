// Default ContainerType catalogue. Lazy-seeded on the first GET of
// /v1/settings/container-types so a fresh deployment never returns an
// empty picker. Admins can deactivate or add more from the Settings
// page; existing PackingContainer rows keep their containerTypeId so
// historical labels stay accurate.

import type { PrismaClient } from "@prisma/client";

export const CONTAINER_KINDS = ["box", "bag", "carton", "sack", "other"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

type SeedRow = {
  code: string;
  name: string;
  kind: ContainerKind;
  tareKg: number;
  maxKg?: number;
  sortOrder: number;
};

export const DEFAULT_CONTAINER_TYPES: SeedRow[] = [
  { code: "BOX-S", name: "Small Box (5 kg)", kind: "box", tareKg: 0.25, maxKg: 5, sortOrder: 10 },
  { code: "BOX-M", name: "Medium Box (15 kg)", kind: "box", tareKg: 0.5, maxKg: 15, sortOrder: 20 },
  { code: "BOX-L", name: "Large Box (25 kg)", kind: "box", tareKg: 0.8, maxKg: 25, sortOrder: 30 },
  { code: "CARTON", name: "5-Bottle Carton", kind: "carton", tareKg: 0.6, maxKg: 30, sortOrder: 40 },
  { code: "BAG-S", name: "Small Poly Bag", kind: "bag", tareKg: 0.05, maxKg: 3, sortOrder: 50 },
  { code: "BAG-L", name: "Large Jute Bag", kind: "bag", tareKg: 0.2, maxKg: 20, sortOrder: 60 },
  { code: "SACK-25", name: "25 kg Sack", kind: "sack", tareKg: 0.3, maxKg: 25, sortOrder: 70 },
  { code: "SACK-50", name: "50 kg Sack", kind: "sack", tareKg: 0.5, maxKg: 50, sortOrder: 80 },
];

export const ensureDefaultContainerTypes = async (
  db: Pick<PrismaClient, "containerType">
): Promise<void> => {
  const count = await db.containerType.count();
  if (count > 0) return;
  await db.containerType.createMany({
    data: DEFAULT_CONTAINER_TYPES.map((c) => ({
      code: c.code,
      name: c.name,
      kind: c.kind,
      tareKg: c.tareKg,
      maxKg: c.maxKg ?? null,
      sortOrder: c.sortOrder,
      active: true,
    })),
  });
};
