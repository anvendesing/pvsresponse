import { db } from "../db.js";

/**
 * NovaERP Sync Engine — server side
 *
 * Protocol:
 *
 *   pull(deviceId, since?, cursor?, limit?)
 *      -> { changes, tombstones, serverTime, nextCursor }
 *
 *   push(deviceId, mutations[])
 *      -> { applied, conflicts, serverTime, cursor }
 *
 * Conflict policy (per entity):
 *   - Default: server-wins. Client sends `baseVersion`; if server version is
 *     greater, the push is recorded as a conflict and the server value remains.
 *   - Append-only entities (StockLedger, AuditLog, ChangeLog, Attendance) are
 *     never conflicted; any client insert is appended.
 */

export const APPEND_ONLY: ReadonlySet<string> = new Set([
  "StockLedger",
  "AuditLog",
  "Attendance",
]);

export const SYNCABLE_ENTITIES = [
  "Product",
  "Bin",
  "Warehouse",
  "Vendor",
  "Customer",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "Grn",
  "Bom",
  "BomItem",
  "ProductionOrder",
  "WorkOrder",
  "Worker",
  "Attendance",
  "Invoice",
  "InvoiceItem",
  "DispatchOrder",
  "Approval",
  "StockLedger",
  "PutawayRule",
  "TransferOrder",
  "TransferOrderItem",
] as const;

export type SyncableEntity = (typeof SYNCABLE_ENTITIES)[number];

export interface ClientMutation {
  entity: SyncableEntity;
  entityId: string;
  op: "insert" | "update" | "delete";
  baseVersion?: number; // last known version (for update conflict detection)
  payload: Record<string, unknown>;
  clientTime: string; // ISO
}

export interface PullChange {
  entity: string;
  entityId: string;
  op: "insert" | "update" | "delete";
  version: number;
  payload: Record<string, unknown>;
  serverTime: string;
}

export interface PullResponse {
  serverTime: string;
  nextCursor: number;
  changes: PullChange[];
  tombstones: { entity: string; entityId: string; serverTime: string }[];
}

export interface PushResult {
  applied: { entity: string; entityId: string; version: number }[];
  conflicts: {
    entity: string;
    entityId: string;
    reason: string;
    serverPayload: Record<string, unknown>;
  }[];
  serverTime: string;
  cursor: number;
}

export const pull = async (
  deviceId: string,
  since?: Date,
  cursor = 0,
  limit = 500
): Promise<PullResponse> => {
  const where = since ? { serverTime: { gt: since } } : { id: { gt: "" } };
  const rawChanges = await db.changeLog.findMany({
    where: {
      ...where,
      origin: { not: deviceId }, // don't echo back the device's own writes
    },
    orderBy: [{ serverTime: "asc" }, { id: "asc" }],
    take: limit,
    skip: cursor,
  });
  const tombstones = await db.tombstone.findMany({
    where: since ? { serverTime: { gt: since } } : {},
    orderBy: { serverTime: "asc" },
    take: limit,
  });

  await db.syncState.upsert({
    where: { deviceId },
    update: { lastPulledAt: new Date(), cursor: cursor + rawChanges.length },
    create: { deviceId, lastPulledAt: new Date(), cursor: rawChanges.length },
  });

  return {
    serverTime: new Date().toISOString(),
    nextCursor: cursor + rawChanges.length,
    changes: rawChanges.map((c) => ({
      entity: c.entity,
      entityId: c.entityId,
      op: c.op as PullChange["op"],
      version: c.version,
      payload: JSON.parse(c.payload),
      serverTime: c.serverTime.toISOString(),
    })),
    tombstones: tombstones.map((t) => ({
      entity: t.entity,
      entityId: t.entityId,
      serverTime: t.serverTime.toISOString(),
    })),
  };
};

const dbModelFor = (entity: SyncableEntity) => {
  const map: Record<string, keyof typeof db> = {
    Product: "product",
    Bin: "bin",
    Warehouse: "warehouse",
    Vendor: "vendor",
    Customer: "customer",
    PurchaseOrder: "purchaseOrder",
    PurchaseOrderItem: "purchaseOrderItem",
    Grn: "grn",
    Bom: "bom",
    BomItem: "bomItem",
    ProductionOrder: "productionOrder",
    WorkOrder: "workOrder",
    Worker: "worker",
    Attendance: "attendance",
    Invoice: "invoice",
    InvoiceItem: "invoiceItem",
    DispatchOrder: "dispatchOrder",
    Approval: "approval",
    StockLedger: "stockLedger",
    PutawayRule: "putawayRule",
    TransferOrder: "transferOrder",
    TransferOrderItem: "transferOrderItem",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any)[map[entity]] as any;
};

const lastVersion = async (entity: string, entityId: string) => {
  const last = await db.changeLog.findFirst({
    where: { entity, entityId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return last?.version ?? 0;
};

export const push = async (
  deviceId: string,
  mutations: ClientMutation[]
): Promise<PushResult> => {
  const applied: PushResult["applied"] = [];
  const conflicts: PushResult["conflicts"] = [];

  for (const m of mutations) {
    const model = dbModelFor(m.entity);
    if (!model) continue;

    if (APPEND_ONLY.has(m.entity)) {
      // Always append, never conflict.
      const created = await model.create({ data: m.payload });
      const version = (await lastVersion(m.entity, created.id)) + 1;
      await db.changeLog.create({
        data: {
          entity: m.entity,
          entityId: created.id,
          op: "insert",
          version,
          payload: JSON.stringify(created),
          origin: deviceId,
        },
      });
      applied.push({ entity: m.entity, entityId: created.id, version });
      continue;
    }

    const currentVersion = await lastVersion(m.entity, m.entityId);

    if (m.op === "insert") {
      const exists = await model.findUnique({ where: { id: m.entityId } });
      if (exists) {
        const last = await db.changeLog.findFirst({
          where: { entity: m.entity, entityId: m.entityId },
          orderBy: { version: "desc" },
        });
        conflicts.push({
          entity: m.entity,
          entityId: m.entityId,
          reason: "already-exists",
          serverPayload: last ? JSON.parse(last.payload) : exists,
        });
        await db.syncConflict.create({
          data: {
            deviceId,
            entity: m.entity,
            entityId: m.entityId,
            reason: "already-exists",
            clientPayload: JSON.stringify(m.payload),
            serverPayload: JSON.stringify(exists),
          },
        });
        continue;
      }
      const created = await model.create({ data: m.payload });
      const version = currentVersion + 1;
      await db.changeLog.create({
        data: {
          entity: m.entity,
          entityId: created.id,
          op: "insert",
          version,
          payload: JSON.stringify(created),
          origin: deviceId,
        },
      });
      applied.push({ entity: m.entity, entityId: created.id, version });
    } else if (m.op === "update") {
      if (m.baseVersion !== undefined && currentVersion > m.baseVersion) {
        const last = await db.changeLog.findFirst({
          where: { entity: m.entity, entityId: m.entityId },
          orderBy: { version: "desc" },
        });
        conflicts.push({
          entity: m.entity,
          entityId: m.entityId,
          reason: "stale-base-version",
          serverPayload: last ? JSON.parse(last.payload) : {},
        });
        await db.syncConflict.create({
          data: {
            deviceId,
            entity: m.entity,
            entityId: m.entityId,
            reason: "stale-base-version",
            clientPayload: JSON.stringify(m.payload),
            serverPayload: last?.payload ?? "{}",
          },
        });
        continue;
      }
      const updated = await model.update({ where: { id: m.entityId }, data: m.payload });
      const version = currentVersion + 1;
      await db.changeLog.create({
        data: {
          entity: m.entity,
          entityId: m.entityId,
          op: "update",
          version,
          payload: JSON.stringify(updated),
          origin: deviceId,
        },
      });
      applied.push({ entity: m.entity, entityId: m.entityId, version });
    } else if (m.op === "delete") {
      try {
        await model.delete({ where: { id: m.entityId } });
      } catch {
        // already gone — idempotent
      }
      const version = currentVersion + 1;
      await db.changeLog.create({
        data: {
          entity: m.entity,
          entityId: m.entityId,
          op: "delete",
          version,
          payload: JSON.stringify(m.payload),
          origin: deviceId,
        },
      });
      await db.tombstone.upsert({
        where: { entity_entityId: { entity: m.entity, entityId: m.entityId } as never },
        update: { serverTime: new Date() },
        create: { entity: m.entity, entityId: m.entityId },
      });
      applied.push({ entity: m.entity, entityId: m.entityId, version });
    }
  }

  await db.syncState.upsert({
    where: { deviceId },
    update: { lastPushedAt: new Date() },
    create: { deviceId, lastPushedAt: new Date() },
  });

  const cursor = await db.changeLog.count();
  return { applied, conflicts, serverTime: new Date().toISOString(), cursor };
};
