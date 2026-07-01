import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { normalizePhone } from "./phone.js";
import { defaultPriceListIdForCustomerCode } from "./customer-defaults.js";
import { extractBearerToken, verifyStorefrontToken } from "./storefront-jwt.js";

export type StorefrontUser = {
  customerId: string;
  accountId: string;
  phone: string;
};

declare module "fastify" {
  interface FastifyRequest {
    storefrontUser?: StorefrontUser;
  }
}

export async function requireStorefrontAuth(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<StorefrontUser | null> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    void reply.code(401).send({
      error: { code: "unauthorized", message: "Bearer token required." },
    });
    return null;
  }
  const payload = verifyStorefrontToken(token);
  if (!payload) {
    void reply.code(401).send({
      error: { code: "unauthorized", message: "Invalid or expired token." },
    });
    return null;
  }
  const account = await db.customerAccount.findUnique({
    where: { id: payload.sub },
    select: { id: true, customerId: true, phone: true },
  });
  if (!account || account.phone !== payload.phone) {
    void reply.code(401).send({
      error: { code: "unauthorized", message: "Account not found." },
    });
    return null;
  }
  const user: StorefrontUser = {
    customerId: account.customerId,
    accountId: account.id,
    phone: account.phone!,
  };
  req.storefrontUser = user;
  return user;
}

export async function optionalStorefrontAuth(req: FastifyRequest): Promise<StorefrontUser | null> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return null;
  const payload = verifyStorefrontToken(token);
  if (!payload) return null;
  const account = await db.customerAccount.findUnique({
    where: { id: payload.sub },
    select: { id: true, customerId: true, phone: true },
  });
  if (!account || account.phone !== payload.phone) return null;
  const user: StorefrontUser = {
    customerId: account.customerId,
    accountId: account.id,
    phone: account.phone!,
  };
  req.storefrontUser = user;
  return user;
}

export function mapAddress(a: {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  addressLine: string;
  city: string;
  district?: string | null;
  state: string | null;
  pincode: string;
  distanceKm?: number | null;
  dispatchPincode?: string | null;
  isDefault: boolean;
}) {
  return {
    id: a.id,
    label: a.label,
    name: a.name,
    phone: a.phone,
    addressLine: a.addressLine,
    city: a.city,
    district: a.district ?? null,
    state: a.state,
    pincode: a.pincode,
    distanceKm: a.distanceKm ?? null,
    dispatchPincode: a.dispatchPincode ?? null,
    isDefault: a.isDefault,
  };
}

const customerOrderInclude = {
  invoices: {
    select: { invoiceNo: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  packingSlips: {
    select: {
      packingSlipNo: true,
      status: true,
      awb: true,
      carrier: true,
      trackingUrl: true,
      dispatchedAt: true,
      deliveredAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
  items: {
    select: {
      productId: true,
      variantId: true,
      qtyOrdered: true,
      rate: true,
      amount: true,
      product: { select: { name: true, sku: true, barcode: true } },
      variant: { select: { size: true, sku: true, barcode: true } },
    },
    orderBy: { id: "asc" as const },
  },
};

type CustomerOrderRecord = Awaited<
  ReturnType<
    typeof db.salesOrder.findMany<{ include: typeof customerOrderInclude }>
  >
>[number];

export function mapCustomerOrderRow(o: CustomerOrderRecord) {
  return {
    id: o.id,
    soNo: o.soNo,
    status: o.status,
    total: o.total,
    createdAt: o.createdAt,
    invoiceNo: o.invoices[0]?.invoiceNo ?? null,
    invoiceStatus: o.invoices[0]?.status ?? null,
    packingSlip: o.packingSlips[0]
      ? {
          packingSlipNo: o.packingSlips[0].packingSlipNo,
          status: o.packingSlips[0].status,
          awb: o.packingSlips[0].awb,
          carrier: o.packingSlips[0].carrier,
          trackingUrl: o.packingSlips[0].trackingUrl,
          dispatchedAt: o.packingSlips[0].dispatchedAt,
          deliveredAt: o.packingSlips[0].deliveredAt,
        }
      : null,
    itemCount: o.items.length,
    items: o.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      variantId: i.variantId,
      variantSize: i.variant?.size ?? null,
      barcode: i.variant?.barcode?.trim() || i.product.barcode?.trim() || null,
      qty: i.qtyOrdered,
      rate: i.rate,
      amount: i.amount,
    })),
  };
}

export async function serializeCustomerOrders(customerId: string, take = 50) {
  const orders = await db.salesOrder.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take,
    include: customerOrderInclude,
  });

  return orders.map(mapCustomerOrderRow);
}

export async function getCustomerOrderBySoNo(customerId: string, soNo: string) {
  const order = await db.salesOrder.findFirst({
    where: { customerId, soNo: soNo.trim() },
    include: customerOrderInclude,
  });
  return order ? mapCustomerOrderRow(order) : null;
}

const nextCustomerCode = async (): Promise<string> => {
  const rows = await db.customer.findMany({
    where: { code: { startsWith: "CUST-" } },
    select: { code: true },
  });
  const tail = rows
    .map((r) => parseInt(r.code.replace("CUST-", ""), 10))
    .filter((n) => Number.isFinite(n));
  let n = tail.length > 0 ? Math.max(...tail) : 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    n += 1;
    const code = `CUST-${n.toString().padStart(4, "0")}`;
    const taken = await db.customer.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error("could_not_allocate_customer_code");
};

/** ERP display label until the customer sets a real name at checkout. */
export function placeholderCustomerName(phone: string): string {
  const normalized = normalizePhone(phone) ?? phone.trim();
  return `Customer · ${normalized}`;
}

export function isPlaceholderCustomerName(name: string, phone?: string | null): boolean {
  const n = name.trim();
  if (!n || n === "Customer") return true;
  if (phone) {
    const p = normalizePhone(phone) ?? phone.trim();
    if (n === placeholderCustomerName(p)) return true;
    if (n === p) return true;
  }
  return false;
}

/** Mirror the default delivery address onto legacy Customer ship-to fields (ERP list view). */
export async function mirrorDefaultAddressToCustomer(
  customerId: string,
  address: {
    addressLine: string;
    city: string;
    district?: string | null;
    state: string | null;
    pincode: string;
    distanceKm?: number | null;
    dispatchPincode?: string | null;
  },
  tx: Pick<typeof db, "customer"> = db
) {
  await tx.customer.update({
    where: { id: customerId },
    data: {
      addressLine: address.addressLine,
      city: address.city,
      district: address.district ?? null,
      state: address.state,
      pincode: address.pincode,
      distanceKm: address.distanceKm ?? null,
      dispatchPincode: address.dispatchPincode ?? null,
    },
  });
}

export async function findOrCreateCustomerByPhone(phone: string, name?: string) {
  const normalized = normalizePhone(phone) ?? phone.trim();
  let account = await db.customerAccount.findUnique({
    where: { phone: normalized },
    include: { customer: true },
  });

  if (account) {
    account = await db.customerAccount.update({
      where: { id: account.id },
      data: { phoneVerifiedAt: new Date() },
      include: { customer: true },
    });
    const trimmedName = name?.trim();
    if (
      trimmedName &&
      isPlaceholderCustomerName(account.customer.name, normalized)
    ) {
      await db.customer.update({
        where: { id: account.customerId },
        data: { name: trimmedName, contact: normalized },
      });
      account.customer.name = trimmedName;
    }
    return account;
  }

  const existingCustomer = await db.customer.findFirst({
    where: { contact: normalized },
    include: { account: true },
  });

  if (existingCustomer?.account) {
    account = await db.customerAccount.update({
      where: { id: existingCustomer.account.id },
      data: { phone: normalized, phoneVerifiedAt: new Date() },
      include: { customer: true },
    });
    return account;
  }

  const code = await nextCustomerCode();
  const trimmedName = name?.trim();
  const displayName =
    trimmedName && !isPlaceholderCustomerName(trimmedName, normalized)
      ? trimmedName
      : placeholderCustomerName(normalized);
  const priceListId = await defaultPriceListIdForCustomerCode(code);

  const customer = existingCustomer
    ? await db.customer.update({
        where: { id: existingCustomer.id },
        data: { contact: normalized, name: displayName },
      })
    : await db.customer.create({
        data: {
          code,
          name: displayName,
          contact: normalized,
          priceListId,
        },
      });

  account = await db.customerAccount.create({
    data: {
      customerId: customer.id,
      phone: normalized,
      phoneVerifiedAt: new Date(),
    },
    include: { customer: true },
  });

  return account;
}
