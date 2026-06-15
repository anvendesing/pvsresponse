// Helpers that keep PackingContainer.estWeightKg and PackingSlip's
// cached weight totals in sync with the underlying item rows.
//
// All container-mutation endpoints (add/remove/qty-change/seal/unseal,
// container-type change) call `recomputeContainer` after the write and
// `recomputePackingSlipWeight` after the container is touched. The
// rollups are O(slip-items + containers) and SQLite-friendly — no
// triggers, just the same Prisma client.

import type { PrismaClient } from "@prisma/client";
import { unitWeightKg } from "./variant-weight.js";

type Db = Pick<
  PrismaClient,
  "packingContainer" | "packingContainerItem" | "packingSlip" | "packingSlipItem" | "containerType"
>;

const padLabelSeq = (seq: number) => seq.toString().padStart(2, "0");

/** Two-decimal helper — matches the precision the UI prints. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const padLabel = padLabelSeq;

/**
 * Re-derive PackingContainer.estWeightKg from its items + tare. Called
 * after any insert / update / delete on PackingContainerItem and after
 * a container-type change. Returns the new weight so callers can use it
 * in their response without a second read.
 */
export const recomputeContainer = async (
  db: Db,
  containerId: string
): Promise<number> => {
  const c = await db.packingContainer.findUnique({
    where: { id: containerId },
    include: {
      containerType: true,
      items: {
        include: {
          packingSlipItem: {
            include: {
              product: { select: { weightKg: true } },
              variant: { select: { weightKg: true, size: true } },
            },
          },
        },
      },
    },
  });
  if (!c) return 0;
  const contents = c.items.reduce((sum, ci) => {
    const w = unitWeightKg(ci.packingSlipItem.variant, ci.packingSlipItem.product);
    return sum + ci.qty * w;
  }, 0);
  const tare = c.tareKgOverride ?? c.containerType?.tareKg ?? 0;
  const est = round2(contents + tare);
  await db.packingContainer.update({
    where: { id: containerId },
    data: { estWeightKg: est },
  });
  return est;
};

/**
 * Re-derive the cached PackingSlip totals from its sealed-and-open
 * containers. Used to keep DispatchOrder.weightKg rollups O(1) and to
 * surface the running total in the desktop pack header chip.
 *
 * Rules:
 *   - totalEstWeightKg   = sum of every container's estWeightKg
 *                          (open + sealed) — packers need to see the
 *                          running total as they fill containers.
 *   - totalActualWeightKg = sum of containers' actualWeightKg, or null
 *                          if no container has an actual reading yet
 *                          (the dispatch flow falls back to est in that
 *                          case).
 */
export const recomputePackingSlipWeight = async (
  db: Db,
  packingSlipId: string
): Promise<{ est: number; actual: number | null }> => {
  const containers = await db.packingContainer.findMany({
    where: { packingSlipId },
    select: { estWeightKg: true, actualWeightKg: true },
  });
  const est = round2(containers.reduce((s, c) => s + c.estWeightKg, 0));
  const anyActual = containers.some((c) => c.actualWeightKg != null);
  const actual = anyActual
    ? round2(
        containers.reduce(
          (s, c) => s + (c.actualWeightKg ?? c.estWeightKg),
          0
        )
      )
    : null;
  await db.packingSlip.update({
    where: { id: packingSlipId },
    data: { totalEstWeightKg: est, totalActualWeightKg: actual },
  });
  return { est, actual };
};

/**
 * Close gaps in container `seq` for a slip after a delete. Pads the
 * resulting label as well so existing printed labels stay consistent
 * with the in-app sequence (01, 02, 03 ...).
 */
export const renumberContainers = async (
  db: Db,
  packingSlipId: string
): Promise<void> => {
  const containers = await db.packingContainer.findMany({
    where: { packingSlipId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, label: true },
  });
  // Two-phase update because (packingSlipId, seq) is unique — bump
  // everyone into a temporary high range first, then settle into
  // contiguous values. Avoids transient collisions on SQLite.
  let i = 0;
  for (const c of containers) {
    i += 1;
    await db.packingContainer.update({
      where: { id: c.id },
      data: { seq: 10000 + i },
    });
  }
  i = 0;
  for (const c of containers) {
    i += 1;
    await db.packingContainer.update({
      where: { id: c.id },
      data: { seq: i, label: padLabel(i) },
    });
  }
};

/** Allocate the next available seq in a slip (1-based). */
export const nextContainerSeq = async (
  db: Pick<PrismaClient, "packingContainer">,
  packingSlipId: string
): Promise<{ seq: number; label: string }> => {
  const last = await db.packingContainer.findFirst({
    where: { packingSlipId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  return { seq, label: padLabel(seq) };
};

/**
 * Auto-bundle path used by /auto-pack and the legacy single-bundle
 * UI. When the slip has zero containers, drop everything into one new
 * sealed container (seq 01) of the first active ContainerType. Used
 * so the multi-container flag never blocks a one-click confirm flow —
 * packers who want precision can still split / reseal afterwards
 * (containers are editable up until /pack runs).
 *
 * No-op when the slip already has any container.
 */
export const ensureAutoBundleContainer = async (
  db: Db,
  packingSlipId: string,
  sealedById: string | null
): Promise<void> => {
  const existing = await db.packingContainer.count({ where: { packingSlipId } });
  if (existing > 0) return;
  const type = await db.containerType.findFirst({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const seq = 1;
  const items = await db.packingSlipItem.findMany({
    where: { packingSlipId, qtyPacked: { gt: 0 } },
    select: { id: true, qtyPacked: true },
  });
  if (items.length === 0) return;
  const container = await db.packingContainer.create({
    data: {
      packingSlipId,
      seq,
      label: padLabel(seq),
      containerTypeId: type?.id ?? null,
      status: "sealed",
      sealedAt: new Date(),
      sealedById,
      items: {
        create: items.map((i) => ({
          packingSlipItemId: i.id,
          qty: i.qtyPacked,
        })),
      },
    },
  });
  await recomputeContainer(db, container.id);
};

/**
 * For a slip whose packMultiContainerEnabled flag is on, every
 * PackingSlipItem.qtyPacked must be allocated across one or more
 * sealed containers and the per-line allocation sum must equal
 * qtyPacked (within 1e-6). Returns the list of offending lines so the
 * caller can surface a 409 with line-level detail.
 */
export const validateContainerAllocations = async (
  db: Db,
  packingSlipId: string
): Promise<
  Array<{ packingSlipItemId: string; qtyPacked: number; allocated: number; reason: string }>
> => {
  const slip = await db.packingSlip.findUnique({
    where: { id: packingSlipId },
    include: {
      items: { select: { id: true, qtyPacked: true } },
      containers: {
        include: { items: { select: { packingSlipItemId: true, qty: true } } },
      },
    },
  });
  if (!slip) return [];

  const issues: Array<{
    packingSlipItemId: string;
    qtyPacked: number;
    allocated: number;
    reason: string;
  }> = [];

  // A container that is still open at pack-complete blocks the whole
  // slip — the packer hasn't confirmed it's ready to ship.
  for (const c of slip.containers) {
    if (c.status !== "sealed") {
      issues.push({
        packingSlipItemId: "",
        qtyPacked: 0,
        allocated: 0,
        reason: `Container ${c.label} is still open. Seal it before packing.`,
      });
    }
  }

  const allocByLine = new Map<string, number>();
  for (const c of slip.containers) {
    for (const it of c.items) {
      allocByLine.set(
        it.packingSlipItemId,
        (allocByLine.get(it.packingSlipItemId) ?? 0) + it.qty
      );
    }
  }
  for (const line of slip.items) {
    if (line.qtyPacked <= 0) continue;
    const allocated = allocByLine.get(line.id) ?? 0;
    if (Math.abs(allocated - line.qtyPacked) > 1e-6) {
      issues.push({
        packingSlipItemId: line.id,
        qtyPacked: line.qtyPacked,
        allocated,
        reason:
          allocated < line.qtyPacked
            ? `Allocate the remaining ${(line.qtyPacked - allocated).toFixed(2)} units to a container.`
            : `Allocation exceeds qty packed by ${(allocated - line.qtyPacked).toFixed(2)}.`,
      });
    }
  }
  return issues;
};

/**
 * Container payload shape included in fullPackInclude so the desktop /
 * mobile UIs receive containers, their items, and the related slip-line
 * references in one round-trip.
 */
export const packContainerInclude = {
  containerType: true,
  items: {
    include: {
      packingSlipItem: {
        select: {
          id: true,
          productId: true,
          variantId: true,
          qtyPacked: true,
          qtyPicked: true,
          product: { select: { id: true, sku: true, name: true, barcode: true } },
          variant: { select: { id: true, sku: true, size: true, barcode: true } },
        },
      },
    },
  },
} as const;
