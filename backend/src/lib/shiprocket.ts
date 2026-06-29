import { db } from "../db.js";
import { logSystemError, logSystemInfo, logSystemWarn } from "./system-log.js";
import {
  getShiprocketCredentials,
  getShiprocketPickupPincode,
} from "./shiprocket-config.js";

const API_BASE = "https://apiv2.shiprocket.in/v1/external";

type ShiprocketCourier = {
  courier_company_id?: number;
  courier_name?: string;
  rate?: number | string;
  freight_charge?: number | string;
  estimated_delivery_days?: string | number;
  etd?: string;
  mode?: string | number;
};

export type ShiprocketRateRow = {
  courierCompanyId: number | null;
  courierName: string;
  rate: number;
  etaDays: number | null;
  mode: "Surface" | "Air" | "Unknown";
};

let cachedToken: { token: string; expiresAt: number } | null = null;

const parseRate = (v: number | string | undefined): number => {
  if (v === undefined || v === null) return NaN;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const parseEtaDays = (raw: string | number | undefined): number | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  const m = String(raw).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

const normalizeMode = (mode: unknown): "Surface" | "Air" | "Unknown" => {
  if (mode === 0 || mode === "0") return "Surface";
  if (mode === 1 || mode === "1") return "Air";
  const m = String(mode ?? "").toLowerCase();
  if (m.includes("air")) return "Air";
  if (m.includes("surface") || m.includes("road")) return "Surface";
  return "Unknown";
};

export async function getPickupPincode(): Promise<string> {
  const fromConfig = await getShiprocketPickupPincode();
  if (fromConfig) return fromConfig;
  const profile = await db.companyProfile.findFirst({ select: { pincode: true } });
  const fromProfile = profile?.pincode?.replace(/\D/g, "").slice(0, 6);
  if (fromProfile && fromProfile.length === 6) return fromProfile;
  return "517132";
}

export async function getShiprocketToken(): Promise<string | null> {
  const creds = await getShiprocketCredentials();
  if (!creds) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const json = (await res.json()) as { token?: string; message?: string };
  if (!res.ok || !json.token) {
    console.warn("[Shiprocket] auth failed:", json.message ?? res.status);
    await logSystemError("shiprocket", "auth", json.message ?? `HTTP ${res.status}`);
    return null;
  }
  cachedToken = { token: json.token, expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000 };
  await logSystemInfo("shiprocket", "auth", "Shiprocket token refreshed");
  return json.token;
}

async function fetchServiceability(params: {
  pickupPincode: string;
  deliveryPincode: string;
  weightKg: number;
  cod: 0 | 1;
  mode?: "Surface" | "Air";
}): Promise<ShiprocketRateRow[]> {
  const token = await getShiprocketToken();
  if (!token) return [];

  const query = new URLSearchParams({
    pickup_postcode: params.pickupPincode,
    delivery_postcode: params.deliveryPincode,
    weight: String(Math.max(params.weightKg, 0.5)),
    cod: String(params.cod),
  });
  if (params.mode) query.set("mode", params.mode);

  const res = await fetch(`${API_BASE}/courier/serviceability/?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    message?: string;
    data?: { available_courier_companies?: ShiprocketCourier[] };
    available_courier_companies?: ShiprocketCourier[];
  };

  if (!res.ok) {
    console.warn("[Shiprocket] serviceability failed:", json.message ?? res.status);
    await logSystemWarn("shiprocket", "serviceability", json.message ?? `HTTP ${res.status}`, {
      pickup: params.pickupPincode,
      delivery: params.deliveryPincode,
      weightKg: params.weightKg,
      mode: params.mode ?? null,
    });
    return [];
  }

  const list =
    json.data?.available_courier_companies ?? json.available_courier_companies ?? [];

  return list
    .map((c) => {
      const rate = parseRate(c.rate ?? c.freight_charge);
      if (!Number.isFinite(rate)) return null;
      return {
        courierCompanyId: c.courier_company_id ?? null,
        courierName: c.courier_name ?? "Courier",
        rate,
        etaDays: parseEtaDays(c.estimated_delivery_days ?? c.etd),
        mode: normalizeMode(c.mode),
      };
    })
    .filter((r): r is ShiprocketRateRow => r !== null);
}

export async function fetchShiprocketRates(params: {
  pickupPincode: string;
  deliveryPincode: string;
  weightKg: number;
}): Promise<{ rows: ShiprocketRateRow[]; source: "shiprocket" | "fallback" }> {
  const [surfaceRows, airRows] = await Promise.all([
    fetchServiceability({ ...params, cod: 0, mode: "Surface" }),
    fetchServiceability({ ...params, cod: 0, mode: "Air" }),
  ]);

  let rows = [...surfaceRows, ...airRows];
  if (rows.length === 0) {
    rows = await fetchServiceability({ ...params, cod: 0 });
  }

  if (rows.length > 0) {
    await logSystemInfo("shiprocket", "serviceability", "Rates fetched", {
      pickup: params.pickupPincode,
      delivery: params.deliveryPincode,
      weightKg: params.weightKg,
      couriers: rows.length,
    });
    return { rows, source: "shiprocket" };
  }

  await logSystemWarn("shiprocket", "serviceability", "No couriers — using fallback rates", {
    pickup: params.pickupPincode,
    delivery: params.deliveryPincode,
    weightKg: params.weightKg,
  });

  const w = Math.max(params.weightKg, 0.5);
  const base = Math.max(49, Math.round(w * 45));
  return {
    source: "fallback",
    rows: [
      {
        courierCompanyId: null,
        courierName: "Standard delivery",
        rate: base,
        etaDays: 5,
        mode: "Surface",
      },
      {
        courierCompanyId: null,
        courierName: "Express delivery",
        rate: Math.max(99, Math.round(base * 1.55)),
        etaDays: 2,
        mode: "Air",
      },
    ],
  };
}
