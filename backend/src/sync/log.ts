import type { Prisma, PrismaClient } from "@prisma/client";
import { db as defaultDb } from "../db.js";

type AnyTx = PrismaClient | Prisma.TransactionClient;

/**
 * Record a mutation to the change log so other devices can pull it on next sync.
 * Used by all write endpoints. Versioning is monotonic per (entity, entityId).
 */
export async function recordChange(
  entity: string,
  entityId: string,
  op: "insert" | "update" | "delete",
  payload: unknown,
  userId: string | null,
  tx?: AnyTx
) {
  const client = (tx ?? defaultDb) as PrismaClient;
  const last = await client.changeLog.findFirst({
    where: { entity, entityId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  await client.changeLog.create({
    data: {
      entity,
      entityId,
      op,
      version,
      payload: JSON.stringify(payload),
      origin: userId ?? "server",
    },
  });
  if (op === "delete") {
    await client.tombstone.upsert({
      where: { entity_entityId: { entity, entityId } as never },
      update: { serverTime: new Date() },
      create: { entity, entityId },
    });
  }
}
