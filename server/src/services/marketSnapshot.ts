/**
 * The paid dataset behind GET /api/services/market-snapshot.
 *
 * MVP: a small, static, clearly labeled snapshot (PHASES.md B4). It is not live market data,
 * and the response says so. The README states this too. The payment for it is real.
 */
export const MARKET_SNAPSHOT = {
  label: "Static demo snapshot for the Donna MVP. Not live market data; figures are illustrative.",
  asOf: "2026-11-01",
  source: "Donna demo dataset",
  items: [
    { name: "Tool A", category: "AI coding assistant", pricingModel: "per seat, monthly", listPriceUsd: 19 },
    { name: "Tool B", category: "AI coding assistant", pricingModel: "per seat, monthly", listPriceUsd: 10 },
    { name: "Tool C", category: "AI coding assistant", pricingModel: "usage based", listPriceUsd: null },
  ],
} as const;
