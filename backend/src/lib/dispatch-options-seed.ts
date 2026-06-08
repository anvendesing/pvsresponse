// Default dispatch / transport modes for Indian B2B distribution.
// Lazy-seeded on first GET when the table is empty. Admins can add,
// edit, or deactivate options from Settings → Dispatch options.

import type { PrismaClient } from "@prisma/client";

export const DISPATCH_CATEGORIES = [
  { code: "door_to_door", label: "Door-to-Door Delivery" },
  { code: "bulk_carrier", label: "Bulk Carriers (LTL / FTL)" },
  { code: "company_vehicle", label: "Company Vehicle" },
  { code: "rtc_cargo", label: "RTC / State Transport Cargo" },
  { code: "bus_cargo", label: "Private Bus Cargo" },
  { code: "railway", label: "Railway Parcel / Freight" },
  { code: "courier", label: "Courier & Express Parcel" },
  { code: "customer_pickup", label: "Customer Pick-up / Ex-works" },
] as const;

export type DispatchCategoryCode = (typeof DISPATCH_CATEGORIES)[number]["code"];

type SeedRow = {
  code: string;
  name: string;
  category: DispatchCategoryCode;
  description?: string;
  defaultCharge?: number;
  sortOrder: number;
};

/** Curated starter list — common operators in South / Central India. */
export const DEFAULT_DISPATCH_OPTIONS: SeedRow[] = [
  {
    code: "door_own_fleet",
    name: "Door Delivery — Own Fleet",
    category: "door_to_door",
    description: "Company vehicle delivers to customer premises (last mile).",
    sortOrder: 10,
  },
  {
    code: "door_third_party",
    name: "Door Delivery — Local Tempo",
    category: "door_to_door",
    description: "Hired local tempo / mini-truck to customer door.",
    sortOrder: 20,
  },
  {
    code: "navata",
    name: "Navata Road Transport",
    category: "bulk_carrier",
    description: "Navata — AP/Telangana focused LTL/FTL operator.",
    sortOrder: 100,
  },
  {
    code: "vrl",
    name: "VRL Logistics",
    category: "bulk_carrier",
    description: "VRL — pan-India surface transport.",
    sortOrder: 110,
  },
  {
    code: "janata",
    name: "Janata Transport",
    category: "bulk_carrier",
    description: "Janata — regional bulk carrier.",
    sortOrder: 120,
  },
  {
    code: "tci",
    name: "TCI Freight",
    category: "bulk_carrier",
    description: "Transport Corporation of India — national FTL/LTL.",
    sortOrder: 130,
  },
  {
    code: "gati",
    name: "Gati / Allcargo Gati",
    category: "bulk_carrier",
    description: "Express distribution and surface freight.",
    sortOrder: 140,
  },
  {
    code: "safexpress",
    name: "Safexpress",
    category: "bulk_carrier",
    description: "Supply-chain and surface logistics.",
    sortOrder: 150,
  },
  {
    code: "dtdc_cargo",
    name: "DTDC Cargo",
    category: "bulk_carrier",
    description: "DTDC surface / cargo consignment.",
    sortOrder: 160,
  },
  {
    code: "company_lorry",
    name: "Company Lorry / Truck",
    category: "company_vehicle",
    description: "Own registered goods vehicle (lorry / truck).",
    sortOrder: 200,
  },
  {
    code: "company_van",
    name: "Company Pick-up Van",
    category: "company_vehicle",
    description: "Own Tata Ace / Bolero / pick-up for regional drops.",
    sortOrder: 210,
  },
  {
    code: "company_2w",
    name: "Company Two-wheeler",
    category: "company_vehicle",
    description: "Own bike / scooter for small urgent drops.",
    sortOrder: 220,
  },
  {
    code: "apsrtc_cargo",
    name: "APSRTC Cargo",
    category: "rtc_cargo",
    description: "Andhra Pradesh state transport corporation parcel cargo.",
    sortOrder: 300,
  },
  {
    code: "ksrtc_parcel",
    name: "KSRTC Swift Parcel",
    category: "rtc_cargo",
    description: "Karnataka state transport parcel service.",
    sortOrder: 310,
  },
  {
    code: "tsrtc_cargo",
    name: "TSRTC Cargo",
    category: "rtc_cargo",
    description: "Telangana state transport corporation cargo.",
    sortOrder: 320,
  },
  {
    code: "bus_cargo",
    name: "Private Bus Cargo",
    category: "bus_cargo",
    description: "Cargo space on private bus / tempo-traveller routes.",
    sortOrder: 400,
  },
  {
    code: "railway_parcel",
    name: "Indian Railways — Parcel (PP)",
    category: "railway",
    description: "Railway parcel booking for medium/heavy consignments.",
    sortOrder: 500,
  },
  {
    code: "railway_freight",
    name: "Indian Railways — Freight (FR)",
    category: "railway",
    description: "Full wagon / rake freight for bulk loads.",
    sortOrder: 510,
  },
  {
    code: "delhivery",
    name: "Delhivery Surface",
    category: "courier",
    description: "Delhivery B2B surface / express.",
    sortOrder: 600,
  },
  {
    code: "bluedart",
    name: "BlueDart",
    category: "courier",
    description: "BlueDart express parcel.",
    sortOrder: 610,
  },
  {
    code: "dtdc_courier",
    name: "DTDC Courier",
    category: "courier",
    description: "DTDC express courier consignment.",
    sortOrder: 620,
  },
  {
    code: "customer_pickup",
    name: "Customer Pick-up (Ex-works)",
    category: "customer_pickup",
    description: "Customer collects from warehouse — no freight charged.",
    defaultCharge: 0,
    sortOrder: 700,
  },
  {
    code: "customer_arranged",
    name: "Customer-Arranged Transport",
    category: "customer_pickup",
    description: "Customer books their own carrier; freight at their cost.",
    defaultCharge: 0,
    sortOrder: 710,
  },
];

export const ensureDefaultDispatchOptions = async (
  db: Pick<PrismaClient, "dispatchOption">
): Promise<void> => {
  const count = await db.dispatchOption.count();
  if (count > 0) return;
  await db.dispatchOption.createMany({
    data: DEFAULT_DISPATCH_OPTIONS.map((o) => ({
      code: o.code,
      name: o.name,
      category: o.category,
      description: o.description ?? null,
      defaultCharge: o.defaultCharge ?? 0,
      sortOrder: o.sortOrder,
      active: true,
    })),
  });
};
