// Distance from company dispatch pincode → delivery pincode.
// Computed once when an address is saved, not on every shipping quote.

import { db } from "../db.js";
import { pincodeDistanceKm } from "./pincode-geo.js";
import { getPickupPincode } from "./shiprocket.js";

export type AddressDistanceFields = {
  distanceKm: number | null;
  dispatchPincode: string | null;
};

const normalizePin = (raw: string | null | undefined): string | null => {
  const pin = raw?.replace(/\D/g, "").slice(0, 6) ?? "";
  return /^[1-9]\d{5}$/.test(pin) ? pin : null;
};

/** Compute km from warehouse/dispatch pincode to a delivery pincode. */
export async function computeAddressDistanceFields(
  deliveryPincode: string | null | undefined
): Promise<AddressDistanceFields> {
  const pin = normalizePin(deliveryPincode);
  if (!pin) return { distanceKm: null, dispatchPincode: null };

  const dispatchPincode = await getPickupPincode();
  const distanceKm = pincodeDistanceKm(dispatchPincode, pin);
  return { distanceKm, dispatchPincode };
}

type StoredDistance = {
  pincode: string;
  distanceKm: number | null;
  dispatchPincode: string | null;
};

/** Use saved distance when still valid; recompute if dispatch pin or delivery pin changed. */
export async function resolveStoredAddressDistance(
  stored: StoredDistance
): Promise<AddressDistanceFields> {
  const pin = normalizePin(stored.pincode);
  if (!pin) return { distanceKm: null, dispatchPincode: null };

  const currentDispatch = await getPickupPincode();
  if (
    stored.distanceKm != null &&
    stored.dispatchPincode === currentDispatch &&
    normalizePin(stored.pincode) === pin
  ) {
    return { distanceKm: stored.distanceKm, dispatchPincode: stored.dispatchPincode };
  }

  return computeAddressDistanceFields(pin);
}

/** Load saved distance for a customer address (storefront checkout). */
export async function distanceKmForCustomerAddress(
  addressId: string,
  customerId: string,
  deliveryPincode: string
): Promise<number | null> {
  const addr = await db.customerAddress.findFirst({
    where: { id: addressId, customerId },
    select: { pincode: true, distanceKm: true, dispatchPincode: true },
  });
  if (!addr) return null;
  const pin = normalizePin(addr.pincode);
  if (!pin || pin !== normalizePin(deliveryPincode)) return null;

  const fresh = await resolveStoredAddressDistance(addr);
  if (
    fresh.distanceKm !== addr.distanceKm ||
    fresh.dispatchPincode !== addr.dispatchPincode
  ) {
    await db.customerAddress.update({
      where: { id: addressId },
      data: fresh,
    });
  }
  return fresh.distanceKm;
}

/** Load saved distance from legacy Customer ship-to when pin matches. */
export async function distanceKmForCustomerProfile(
  customerId: string,
  deliveryPincode: string
): Promise<number | null> {
  const c = await db.customer.findUnique({
    where: { id: customerId },
    select: { pincode: true, distanceKm: true, dispatchPincode: true },
  });
  if (!c?.pincode) return null;
  const pin = normalizePin(c.pincode);
  if (!pin || pin !== normalizePin(deliveryPincode)) return null;

  const fresh = await resolveStoredAddressDistance({
    pincode: c.pincode,
    distanceKm: c.distanceKm,
    dispatchPincode: c.dispatchPincode,
  });
  if (fresh.distanceKm !== c.distanceKm || fresh.dispatchPincode !== c.dispatchPincode) {
    await db.customer.update({
      where: { id: customerId },
      data: fresh,
    });
  }
  return fresh.distanceKm;
}
