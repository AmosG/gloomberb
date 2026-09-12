import { expect, test } from "bun:test";
import { buildYahooStatements, computeYahooReturn } from "./financials";
import { loadYahooTickerFinancials } from "./snapshots";

test("Yahoo preserves report currency and calculates operating margin from operating income", async () => {
  const metrics = { annualTotalRevenue: 1000, annualOperatingIncome: 200, annualEBITDA: 300, annualNetIncome: 150 };
  const financials = await loadYahooTickerFinancials("TSM", {
    providerId: "yahoo",
    fetchAssetProfile: async () => undefined,
    fetchChart: async () => ({ meta: { currency: "USD", regularMarketPrice: 200 }, history: [{ date: new Date("2025-12-31"), close: 200 }] }),
    fetchExtendedHoursData: async () => ({}),
    fetchQuoteSupplement: async () => ({}),
    fetchTimeseries: async () => Object.entries(metrics).map(([key, value]) => ({
      meta: { type: [key] },
      [key]: [{ asOfDate: "2025-12-31", currencyCode: "TWD", reportedValue: { raw: value } }],
    })),
  });
  expect(financials.quote?.currency).toBe("USD");
  expect(financials.financialCurrency).toBe("TWD");
  expect(financials.annualStatements[0]?.currency).toBe("TWD");
  expect(financials.fundamentals).toMatchObject({ financialCurrency: "TWD", revenue: 1000, operatingMargin: 0.2 });
});


test("Yahoo never overwrites statement currency while adding another metric", () => {
  expect(buildYahooStatements({
    annualTotalRevenue: [{ asOfDate: "2025-12-31", value: 3000, currency: "TWD" }],
    annualNetIncome: [{ asOfDate: "2025-12-31", value: 50, currency: "USD" }],
  }, "annual")).toEqual([{ date: "2025-12-31", totalRevenue: 3000, currency: "TWD" }]);
});

test("Yahoo snapshot does not label a young fund's since-inception change as full-year performance", async () => {
  const financials = await loadYahooTickerFinancials("NEWF", {
    providerId: "yahoo",
    fetchAssetProfile: async () => undefined,
    fetchChart: async () => ({
      meta: { currency: "USD", instrumentType: "ETF", regularMarketPrice: 105, regularMarketTime: Date.parse("2026-09-10") / 1000 },
      history: [{ date: new Date("2026-08-06"), close: 100 }, { date: new Date("2026-09-10"), close: 105 }],
    }),
    fetchExtendedHoursData: async () => ({}),
    fetchQuoteSupplement: async () => ({}),
    fetchTimeseries: async () => [],
  });
  expect(financials.fundamentals?.return1Y).toBeUndefined();
  expect(financials.fundamentals?.return3Y).toBeUndefined();
  expect(financials.priceHistory.map(point => point.close)).toEqual([100, 105]);
});

test("Yahoo calendar horizons preserve zero and use the covered year boundary across leap years", () => {
  const history = [
    { date: new Date("2023-03-01"), close: 100 },
    { date: new Date("2023-03-02"), close: 110 },
    { date: new Date("2024-03-01"), close: 100 },
  ];
  expect(computeYahooReturn(history, 1)).toBe(0);
  expect(computeYahooReturn(history, 3)).toBeUndefined();
  expect(computeYahooReturn([...history].reverse(), 1)).toBe(0);
});
