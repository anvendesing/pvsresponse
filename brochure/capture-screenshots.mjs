/**
 * Capture ERP portal screenshots for NovaERP-Features.pdf
 * Run: node capture-screenshots.mjs  (from brochure/, with dev servers up)
 * Requires: npx playwright install chromium (first time)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "screenshots");
const BASE = process.env.ERP_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:4000/v1";

const USER = "admin";
const PASS = "nova1234";

fs.mkdirSync(OUT, { recursive: true });

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`API login failed: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function firstQuoteShareToken(token) {
  const res = await fetch(`${API}/quotes?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const q = Array.isArray(rows) ? rows.find((r) => r.shareToken) : null;
  return q?.shareToken ?? null;
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  console.log(`  ✓ ${name}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function main() {
  console.log("NovaERP brochure screenshot capture");
  console.log(`  ERP: ${BASE}`);
  console.log(`  API: ${API}`);

  let shareToken = null;
  try {
    const jwt = await apiLogin();
    shareToken = await firstQuoteShareToken(jwt);
    if (shareToken) console.log(`  Share token: ${shareToken.slice(0, 12)}…`);
  } catch (e) {
    console.warn(`  API helper skipped: ${e.message}`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await shot(page, "01-login.png");

  await login(page);

  const routes = [
    ["02-dashboard.png", "/dashboard"],
    ["03-products.png", "/products"],
    ["04-pricelists.png", "/price-lists"],
    ["05-quotes.png", "/quotes"],
    ["09-picking.png", "/picking"],
    ["10-packing.png", "/packing"],
    ["11-inventory.png", "/inventory"],
    ["12-billing.png", "/billing"],
    ["13-reports.png", "/reports"],
    ["14-manufacturing.png", "/manufacturing"],
    ["15-enquiries.png", "/enquiries"],
    ["16-transfers.png", "/transfers"],
    ["17-warehouse.png", "/warehouse"],
  ];

  for (const [file, route] of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await shot(page, file);
  }

  // Quote editor — open first row
  await page.goto(`${BASE}/quotes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const firstRow = page.locator("table tbody tr").first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForTimeout(2000);
    await shot(page, "06-quote-editor.png");
  }
  // Share menu — from list row (avoids drawer overlay blocking the editor Share btn)
  const listShare = page.locator("table tbody tr").first().getByRole("button", { name: /^share$/i });
  if (await listShare.count()) {
    await listShare.click({ force: true });
    await page.waitForTimeout(800);
    await shot(page, "07-share-menu.png");
  }

  // Manufacturing MO detail
  await page.goto(`${BASE}/manufacturing`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const moBtn = page.locator("aside button").first();
  if (await moBtn.count()) {
    await moBtn.click();
    await page.waitForTimeout(2000);
    await page.getByText(/inventory locations/i).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, "18-manufacturing-detail.png");
  } else {
    console.warn("  ⚠ 18-manufacturing-detail.png skipped (no MO in list)");
  }

  // Settings — putaway rules tab
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const putawayTab = page.getByRole("button", { name: /putaway rules/i });
  if (await putawayTab.count()) {
    await putawayTab.click();
    await page.waitForTimeout(1000);
    await shot(page, "19-settings-putaway.png");
    const stockTab = page.getByRole("button", { name: /stock rules/i });
    if (await stockTab.count()) {
      await stockTab.click();
      await page.waitForTimeout(1000);
      await shot(page, "20-settings-stock-rules.png");
    }
  }

  if (shareToken) {
    await page.goto(`${BASE}/share/quote/${shareToken}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await shot(page, "08-public-quote.png", { fullPage: true });
  }

  await browser.close();
  console.log(`\nDone — ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
