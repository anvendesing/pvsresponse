/**
 * Fire-and-forget stock rule evaluation (manual, post-GRN, post-MO, interval).
 */

import { checkAllStockRules, type StockRuleTriggerResult } from "./stock-rules.js";

let running = false;

export type StockRulesRunSummary = {
  source: string;
  skipped?: boolean;
  checked: number;
  triggered: number;
  results: StockRuleTriggerResult[];
};

export const triggerStockRulesCheck = async (
  source: string,
  userId: string | null = null
): Promise<StockRulesRunSummary> => {
  if (running) {
    return { source, skipped: true, checked: 0, triggered: 0, results: [] };
  }
  running = true;
  try {
    const results = await checkAllStockRules(userId);
    const triggered = results.filter((r) => r.created).length;
    return { source, checked: results.length, triggered, results };
  } finally {
    running = false;
  }
};

/** Non-blocking; logs summary at info level. */
export const scheduleStockRulesCheck = (
  source: string,
  userId: string | null,
  log: { info: (o: unknown, msg?: string) => void }
) => {
  void triggerStockRulesCheck(source, userId)
    .then((summary) => {
      if (summary.skipped) return;
      if (summary.triggered > 0) {
        log.info(
          { source, triggered: summary.triggered, checked: summary.checked },
          "stock rules: documents created"
        );
      }
    })
    .catch((err) => {
      log.info({ err, source }, "stock rules: check failed");
    });
};

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const startStockRulesInterval = (
  log: { info: (o: unknown, msg?: string) => void }
) => {
  const raw = process.env.STOCK_RULES_CHECK_INTERVAL_MS;
  const ms = raw ? parseInt(raw, 10) : DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(ms) || ms <= 0) {
    log.info("stock rules: periodic check disabled (STOCK_RULES_CHECK_INTERVAL_MS ≤ 0)");
    return;
  }
  log.info({ intervalMs: ms }, "stock rules: periodic check enabled");
  setInterval(() => scheduleStockRulesCheck("interval", null, log), ms);
};
