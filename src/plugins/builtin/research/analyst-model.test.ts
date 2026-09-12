import { expect, test } from "bun:test";
import type { AnalystResearchData } from "../../../types/financials";
import { analystTargetCurrency, formatAnalystPrice, formatRecommendationMix, latestRecommendation, recommendationMix, recommendationTotal, targetUpside } from "./analyst-model";
const data: AnalystResearchData = { symbol: "FIX", recommendations: [], ratings: [], earningsEstimates: [], revenueEstimates: [] };
const complete = { period: "current month", strongBuy: 2, buy: 3, hold: 4, sell: 0, strongSell: 0 };

test("unknown and explicit minor units format without a currency or scale guess", () => {
  expect(formatAnalystPrice(0, undefined)).toBe("0.00 (ccy?)");
  expect(formatAnalystPrice(125, "GBp")).toBe("£1.25");
  expect(formatAnalystPrice(1.25, "GBP")).toBe("£1.25");
  expect(formatAnalystPrice(Infinity, "USD")).toBe("-");
  expect(analystTargetCurrency({ ...data, currency: " GBP ", priceTarget: { currency: " " } })).toBe("GBP");
  expect(analystTargetCurrency({ ...data, currency: "USD", priceTarget: { currency: " EUR " } })).toBe("EUR");
  expect(targetUpside({ average: 0, current: 2 })).toBe(-1);
});

test("consensus total requires every finite nonnegative integer bucket", () => {
  expect(recommendationTotal(data)).toBeNull();
  expect(recommendationTotal({ ...data, recommendations: [complete] })).toBe(9);
  for (const strongSell of [undefined, -1, NaN, Infinity, 0.5]) {
    const incomplete = { ...data, recommendations: [{ ...complete, strongSell }] };
    expect(recommendationTotal(incomplete)).toBeNull();
    expect(recommendationMix(incomplete)?.strongSell).toBeNull();
    expect(formatRecommendationMix(incomplete)).toBe("SB 2  B 3  H 4  S -");
  }
  expect(recommendationTotal({ ...data, recommendations: [{ ...complete, strongBuy: 0, buy: 0, hold: 0 }] })).toBe(0);
});

test("explicit current month is selected without inventing an observation date", () => {
  for (const period of ["current month", "current_month", "0m"]) {
    const current = { ...complete, period };
    expect(latestRecommendation({ ...data, recommendations: [{ ...complete, period: "previous month" }, current] })).toBe(current);
  }
  const historical = { ...complete, period: "previous month" };
  expect(latestRecommendation({ ...data, recommendations: [historical] })).toBe(historical);
});
