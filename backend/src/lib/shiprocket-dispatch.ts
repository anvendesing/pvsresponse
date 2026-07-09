import { db } from "../db.js";
import { getShiprocketToken } from "./shiprocket.js";
import { getShiprocketCredentials, getShiprocketPickupPincode, getShiprocketPickupLocation } from "./shiprocket-config.js";
import { fetchShiprocketRates } from "./shiprocket.js";
import { logSystemError, logSystemInfo, logSystemWarn } from "./system-log.js";

const API_BASE = "https://apiv2.shiprocket.in/v1/external";
const TRACKING_URL = "https://app.shiprocket.in/courier-tracking/{AWB}";

export type ShiprocketDispatchResult =
  | {
      ok: true;
      awb: string;
      carrier: string;
      trackingUrl: string;
      shiprocketOrderId: string;
      shiprocketShipmentId: string;
      courierCompanyId: number | null;
    }
  | {
      ok: false;
      reason: "not_configured" | "missing_address" | "no_packed_lines" | "api_error";
      message: string;
    };

type ParsedShippingMeta = {
  deliveryMethod: string;
  courierName: string;
  weightKg: number;
  pickupPincode: string;
  deliveryPincode: string;
};

const parseShippingMeta = (notes: string | null | undefined): ParsedShippingMeta | null => {
  if (!notes) return null;
  const m = notes.match(
    /Shipping:\s*(\w+)\s*·\s*([^·]+)\s*·\s*([\d.]+)\s*kg\s*·\s*(\d{6})→(\d{6})/
  );
  if (!m) return null;
  return {
    deliveryMethod: m[1],
    courierName: m[2].trim(),
    weightKg: parseFloat(m[3]),
    pickupPincode: m[4],
    deliveryPincode: m[5],
  };
};

const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Customer", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

const normalizePhone = (raw: string | null | undefined): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return "9999999999";
};

// Resolved at dispatch time so it always reflects the latest saved setting.
const resolvePickupLocationName = async (): Promise<string> =>
  getShiprocketPickupLocation();

async function shiprocketFetch<T>(
  path: string,
  init: RequestInit
): Promise<{ ok: true; json: T } | { ok: false; message: string; status: number }> {
  const token = await getShiprocketToken();
  if (!token) {
    return { ok: false, message: "Shiprocket authentication failed.", status: 502 };
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    message?: string;
    status_code?: number;
  };
  if (!res.ok) {
    return {
      ok: false,
      message: json.message ?? `Shiprocket HTTP ${res.status}`,
      status: res.status,
    };
  }
  return { ok: true, json };
}

type CreateOrderResponse = {
  order_id?: number;
  shipment_id?: number;
  message?: string;
};

type AssignAwbResponse = {
  awb_assign_status?: number;
  response?: {
    data?: {
      awb_code?: string;
      courier_name?: string;
      courier_company_id?: number;
    };
  };
  awb_code?: string;
  courier_name?: string;
  message?: string;
};

async function resolveCourierCompanyId(
  meta: ParsedShippingMeta | null,
  weightKg: number
): Promise<number | null> {
  if (!meta?.deliveryPincode || !meta.pickupPincode) return null;
  const { rows } = await fetchShiprocketRates({
    pickupPincode: meta.pickupPincode,
    deliveryPincode: meta.deliveryPincode,
    weightKg,
  });
  if (rows.length === 0) return null;
  const target = meta.courierName.toLowerCase();
  const match =
    rows.find((r) => r.courierName.toLowerCase() === target) ??
    rows.find((r) => r.courierName.toLowerCase().includes(target)) ??
    rows.find((r) => target.includes(r.courierName.toLowerCase()));
  if (match?.courierCompanyId) return match.courierCompanyId;
  const preferSurface = meta.deliveryMethod === "standard";
  const modePick = preferSurface
    ? rows.find((r) => r.mode === "Surface") ?? rows[0]
    : rows.find((r) => r.mode === "Air") ?? rows[0];
  return modePick?.courierCompanyId ?? null;
}

export async function assignShiprocketAwbOnly(
  shipmentId: string,
  opts?: { courierCompanyId?: number | null; reassign?: boolean }
): Promise<
  | {
      ok: true;
      awb: string;
      carrier: string;
      trackingUrl: string;
      courierCompanyId: number | null;
    }
  | { ok: false; message: string }
> {
  const assignBody: Record<string, unknown> = { shipment_id: Number(shipmentId) };
  if (opts?.courierCompanyId) assignBody.courier_id = opts.courierCompanyId;
  if (opts?.reassign) assignBody.status = "reassign";

  const assigned = await shiprocketFetch<AssignAwbResponse>("/courier/assign/awb", {
    method: "POST",
    body: JSON.stringify(assignBody),
  });

  if (!assigned.ok) {
    return { ok: false, message: assigned.message };
  }

  const awbData = assigned.json.response?.data;
  const awb =
    awbData?.awb_code?.trim() ||
    assigned.json.awb_code?.trim() ||
    "";
  const carrier =
    awbData?.courier_name?.trim() ||
    assigned.json.courier_name?.trim() ||
    "Shiprocket";

  if (!awb) {
    return { ok: false, message: assigned.json.message ?? "Shiprocket did not return an AWB." };
  }

  return {
    ok: true,
    awb,
    carrier,
    trackingUrl: TRACKING_URL.replace("{AWB}", encodeURIComponent(awb)),
    courierCompanyId: awbData?.courier_company_id ?? opts?.courierCompanyId ?? null,
  };
}

export async function dispatchPackingSlipViaShiprocket(
  packingSlipId: string,
  opts?: { courierCompanyId?: number | null; reassign?: boolean }
): Promise<ShiprocketDispatchResult> {
  const creds = await getShiprocketCredentials();
  if (!creds) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Shiprocket is not configured. Add credentials under Settings → Shiprocket.",
    };
  }

  // Idempotency: if the packing slip already has a Shiprocket shipment ID but
  // no AWB (create succeeded, assign failed previously), skip create and only
  // assign the AWB. This prevents duplicate Shiprocket orders on retry.
  const existing = await db.packingSlip.findUnique({
    where: { id: packingSlipId },
    select: { shiprocketShipmentId: true, shiprocketOrderId: true, awb: true },
  });
  if (existing?.shiprocketShipmentId && !existing.awb) {
    await logSystemInfo("shiprocket", "dispatch", "Reusing existing Shiprocket shipment (assign-only retry)", {
      packingSlipId,
      shiprocketShipmentId: existing.shiprocketShipmentId,
    });
    const assigned = await assignShiprocketAwbOnly(existing.shiprocketShipmentId, opts);
    if (!assigned.ok) {
      await logSystemError("shiprocket", "assign_awb", assigned.message, {
        packingSlipId,
        shiprocketShipmentId: existing.shiprocketShipmentId,
      });
      return { ok: false, reason: "api_error", message: assigned.message };
    }
    return {
      ok: true,
      awb: assigned.awb,
      carrier: assigned.carrier,
      trackingUrl: assigned.trackingUrl,
      shiprocketOrderId: existing.shiprocketOrderId ?? "",
      shiprocketShipmentId: existing.shiprocketShipmentId,
      courierCompanyId: assigned.courierCompanyId,
    };
  }
  if (existing?.awb) {
    if (!opts?.reassign) {
      // Fully dispatched already — block accidental duplicate orders.
      await logSystemInfo("shiprocket", "dispatch", "AWB already assigned; skipping re-create", {
        packingSlipId,
        awb: existing.awb,
      });
      return {
        ok: false,
        reason: "api_error",
        message: `AWB ${existing.awb} already assigned to this packing slip. Use 'Assign Courier' to reassign.`,
      };
    }
    // reassign=true: operator is deliberately changing courier.  Clear the
    // stale AWB / carrier / Shiprocket IDs so a fresh order can be created.
    await logSystemInfo("shiprocket", "dispatch", "Reassign requested — clearing stale AWB before re-dispatch", {
      packingSlipId,
      previousAwb: existing.awb,
    });
    await db.packingSlip.update({
      where: { id: packingSlipId },
      data: {
        awb: null,
        carrier: null,
        trackingUrl: null,
        shiprocketOrderId: null,
        shiprocketShipmentId: null,
      },
    });
  }

  const slip = await db.packingSlip.findUnique({
    where: { id: packingSlipId },
    include: {
      items: {
        where: { qtyPacked: { gt: 0 } },
        include: {
          product: { select: { name: true, sku: true, hsn: true } },
          variant: { select: { sku: true, hsn: true } },
        },
      },
      salesOrder: {
        select: {
          id: true,
          soNo: true,
          notes: true,
          totalWeightKg: true,
          transportCharge: true,
          subTotal: true,
          total: true,
          orderDate: true,
          customer: {
            select: {
              id: true,
              name: true,
              contact: true,
              addressLine: true,
              city: true,
              state: true,
              pincode: true,
            },
          },
        },
      },
      invoice: { select: { invoiceNo: true, amount: true } },
    },
  });

  if (!slip?.salesOrder) {
    return { ok: false, reason: "api_error", message: "Packing slip or sales order not found." };
  }

  const packedLines = slip.items.filter((it) => it.qtyPacked > 0);
  if (packedLines.length === 0) {
    return { ok: false, reason: "no_packed_lines", message: "Nothing packed on this slip." };
  }

  const customer = slip.salesOrder.customer;
  const defaultAddr = await db.customerAddress.findFirst({
    where: { customerId: customer.id, isDefault: true },
    orderBy: { updatedAt: "desc" },
  });
  const shipLine =
    defaultAddr?.addressLine ?? customer.addressLine ?? "";
  const shipCity = defaultAddr?.city ?? customer.city ?? "";
  const shipState = defaultAddr?.state ?? customer.state ?? "";
  const shipPincode = (defaultAddr?.pincode ?? customer.pincode ?? "")
    .replace(/\D/g, "")
    .slice(0, 6);
  const shipPhone = normalizePhone(defaultAddr?.phone ?? customer.contact);
  const shipName = defaultAddr?.name ?? customer.name;

  if (!shipLine || !shipCity || !shipPincode || shipPincode.length !== 6) {
    return {
      ok: false,
      reason: "missing_address",
      message:
        "Customer ship-to address is incomplete. Add a default address with line, city, and pincode.",
    };
  }

  const meta = parseShippingMeta(slip.salesOrder.notes);
  const weightKg = Math.max(
    slip.totalEstWeightKg || slip.salesOrder.totalWeightKg || meta?.weightKg || 0.5,
    0.5
  );

  const orderItems = packedLines.map((line) => ({
    name: line.product.name.slice(0, 200),
    sku: (line.variant?.sku ?? line.product.sku).slice(0, 100),
    units: Math.round(line.qtyPacked),
    selling_price: line.rate,
    discount: 0,
    tax: 0,
    hsn: parseInt(String(line.variant?.hsn ?? line.product.hsn ?? "0").replace(/\D/g, ""), 10) || undefined,
  }));

  const subTotal = packedLines.reduce((s, l) => s + l.qtyPacked * l.rate, 0);
  const { first, last } = splitName(shipName);
  const orderId = (slip.invoice?.invoiceNo ?? slip.salesOrder.soNo).slice(0, 50);
  const orderDate = (slip.salesOrder.orderDate ?? new Date())
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

  const pickupLocation = await resolvePickupLocationName();

  const createBody = {
    order_id: orderId,
    order_date: orderDate,
    pickup_location: pickupLocation,
    billing_customer_name: first,
    billing_last_name: last,
    billing_address: shipLine.slice(0, 200),
    billing_address_2: "",
    billing_city: shipCity.slice(0, 100),
    billing_pincode: shipPincode,
    billing_state: shipState.slice(0, 100),
    billing_country: "India",
    billing_email: process.env.SHIPROCKET_BILLING_EMAIL?.trim() || "orders@example.com",
    billing_phone: shipPhone,
    shipping_is_billing: true,
    order_items: orderItems,
    payment_method: "Prepaid",
    sub_total: Math.round(subTotal * 100) / 100,
    length: 20,
    breadth: 15,
    height: 10,
    weight: weightKg,
    shipping_charges: slip.salesOrder.transportCharge ?? 0,
  };

  const created = await shiprocketFetch<CreateOrderResponse>("/orders/create/adhoc", {
    method: "POST",
    body: JSON.stringify(createBody),
  });

  if (!created.ok) {
    await logSystemError("shiprocket", "create_order", created.message, {
      packingSlipId,
      orderId,
    });
    return { ok: false, reason: "api_error", message: created.message };
  }

  const shipmentId = created.json.shipment_id;
  const srOrderId = created.json.order_id;
  if (!shipmentId) {
    const msg = created.json.message ?? "Shiprocket did not return a shipment_id.";
    await logSystemError("shiprocket", "create_order", msg, { packingSlipId, orderId });
    return { ok: false, reason: "api_error", message: msg };
  }

  // Persist Shiprocket order/shipment IDs immediately after create so that
  // any retry (from a crash or UI re-click) can skip re-create and only
  // assign the AWB. Without this, a failed assign leaves an orphan order.
  await db.packingSlip
    .update({
      where: { id: packingSlipId },
      data: {
        shiprocketOrderId: String(srOrderId ?? ""),
        shiprocketShipmentId: String(shipmentId),
      },
    })
    .catch((err: unknown) => {
      // Non-fatal — log and continue to assign; IDs will be returned for the
      // caller to persist (ecommerceCourierPatch / assign-courier route).
      void logSystemWarn("shiprocket", "dispatch", "Could not persist shipment IDs mid-dispatch", {
        packingSlipId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const courierCompanyId =
    opts?.courierCompanyId ??
    (await resolveCourierCompanyId(meta, weightKg));

  const assigned = await assignShiprocketAwbOnly(String(shipmentId), {
    courierCompanyId,
    reassign: opts?.reassign,
  });

  if (!assigned.ok) {
    await logSystemError("shiprocket", "assign_awb", assigned.message, {
      packingSlipId,
      shipmentId,
    });
    return { ok: false, reason: "api_error", message: assigned.message };
  }

  const { awb, carrier: assignedCarrier, trackingUrl } = assigned;
  const carrier = assignedCarrier === "Shiprocket" && meta?.courierName
    ? meta.courierName
    : assignedCarrier;

  await logSystemInfo("shiprocket", "dispatch", "Order created and AWB assigned", {
    packingSlipId,
    orderId,
    shiprocketOrderId: srOrderId,
    shiprocketShipmentId: shipmentId,
    awb,
    carrier,
  });

  return {
    ok: true,
    awb,
    carrier,
    trackingUrl,
    shiprocketOrderId: String(srOrderId ?? ""),
    shiprocketShipmentId: String(shipmentId),
    courierCompanyId: assigned.courierCompanyId,
  };
}

/** Stamp mock AWB when Shiprocket is not configured (local dev / smoke tests). */
export const mockCourierPatch = (): {
  awb: string;
  carrier: string;
  trackingUrl: string;
  dispatchedAt: Date;
} => {
  const awb = `MOCK-AWB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  return {
    awb,
    carrier: "MockCourier",
    trackingUrl: TRACKING_URL.replace("{AWB}", encodeURIComponent(awb)),
    dispatchedAt: new Date(),
  };
};

export async function ecommerceCourierPatch(
  packingSlipId: string
): Promise<{
  awb?: string;
  carrier?: string;
  trackingUrl?: string;
  dispatchedAt?: Date;
  shiprocketOrderId?: string;
  shiprocketShipmentId?: string;
  shiprocketError?: string;
}> {
  const creds = await getShiprocketCredentials();
  if (!creds) {
    const mock = mockCourierPatch();
    return mock;
  }

  const result = await dispatchPackingSlipViaShiprocket(packingSlipId);
  if (result.ok) {
    return {
      awb: result.awb,
      carrier: result.carrier,
      trackingUrl: result.trackingUrl,
      dispatchedAt: new Date(),
      shiprocketOrderId: result.shiprocketOrderId,
      shiprocketShipmentId: result.shiprocketShipmentId,
    };
  }

  await logSystemWarn("shiprocket", "dispatch", result.message, {
    packingSlipId,
    reason: result.reason,
  });

  return { shiprocketError: result.message };
}
