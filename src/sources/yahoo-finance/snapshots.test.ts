import { expect, test } from "bun:test";
import { buildYahooStatements, computeYahooReturn, latestYahooMetric, parseYahooTimeseries } from "./financials";
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

test("Yahoo latest metrics use the reported calendar period, retaining zero and final equal-period source precedence", async () => {
  const points = [
    { asOfDate: "2025-12-31", currencyCode: "USD", reportedValue: { raw: 20 } },
    { asOfDate: "2023-12-31", currencyCode: "USD", reportedValue: { raw: 100 } },
    { asOfDate: "2025-12-31", currencyCode: "USD", reportedValue: { raw: 0 } },
    { asOfDate: "2024-12-31", currencyCode: "USD", reportedValue: { raw: 200 } },
  ];
  const raw = [{ meta: { type: ["annualTotalRevenue"] }, annualTotalRevenue: points }];
  const financials = await loadYahooTickerFinancials("PERIOD", {
    providerId: "yahoo", fetchAssetProfile: async () => undefined,
    fetchChart: async () => ({ meta: { currency: "USD", regularMarketPrice: 10 }, history: [{ date: new Date("2026-09-11"), close: 10 }] }),
    fetchExtendedHoursData: async () => ({}), fetchQuoteSupplement: async () => ({}), fetchTimeseries: async () => raw,
  });
  expect(financials.fundamentals?.revenue).toBe(0);
  expect(financials.annualStatements.at(-1)).toMatchObject({ date: "2025-12-31", totalRevenue: 0 });
  expect(points.map(point => point.asOfDate)).toEqual(["2025-12-31", "2023-12-31", "2025-12-31", "2024-12-31"]);
  const invalid = parseYahooTimeseries([{ meta: { type: ["annualTotalRevenue"] }, annualTotalRevenue: [
    { asOfDate: "TTM", reportedValue: { raw: 200 } }, { asOfDate: "2026-02-29", reportedValue: { raw: 300 } },
  ] }]);
  expect(latestYahooMetric(invalid, "annualTotalRevenue")).toBeUndefined();
  expect(latestYahooMetric(invalid, "annualNetIncome")).toBeUndefined();
});


test("Yahoo dated missing latest metrics preserve the period without borrowing old values or coercing zero", async () => {
  for (const missing of [null, undefined, NaN, Infinity, "0"]) {
    const point = (asOfDate: string, raw: unknown) => ({ asOfDate, currencyCode: "USD", reportedValue: { raw } });
    const raw = [
      { meta: { type: ["annualTotalRevenue"] }, annualTotalRevenue: [point("2025-12-31", 123), point("2025-12-31", missing), point("2024-12-31", 200)] },
      { meta: { type: ["annualDilutedEPS"] }, annualDilutedEPS: [point("2024-12-31", 2), point("2025-12-31", missing)] },
      { meta: { type: ["quarterlyTotalRevenue"] }, quarterlyTotalRevenue: [point("2026-06-30", 0), point("2026-03-31", 50)] },
      { meta: { type: ["annualNetIncome"] }, annualNetIncome: [point("2026-02-29", 10), point("TTM", 20)] },
    ];
    const financials = await loadYahooTickerFinancials("PERIOD", {
      providerId: "yahoo", fetchAssetProfile: async () => undefined,
      fetchChart: async () => ({ meta: { currency: "USD", regularMarketPrice: 10 }, history: [{ date: new Date("2026-09-11"), close: 10 }] }),
      fetchExtendedHoursData: async () => ({}), fetchQuoteSupplement: async () => ({}), fetchTimeseries: async () => raw,
    });
    expect(financials.fundamentals?.revenue).toBeUndefined();
    expect(financials.fundamentals?.eps).toBeUndefined();
    expect(financials.fundamentals?.netIncome).toBeUndefined();
    expect(financials.annualStatements.map(row => row.date)).toEqual(["2024-12-31", "2025-12-31"]);
    expect(financials.annualStatements.at(-1)).toMatchObject({ date: "2025-12-31", currency: "USD" });
    expect(financials.annualStatements.at(-1)?.totalRevenue).toBeUndefined();
    expect(financials.annualStatements.at(-1)?.eps).toBeUndefined();
    expect(financials.quarterlyStatements.at(-1)?.totalRevenue).toBe(0);
    expect(JSON.parse(JSON.stringify(financials)).annualStatements.at(-1).totalRevenue).toBeUndefined();
  }
});
