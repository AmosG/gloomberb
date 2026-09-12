import { expect, test } from "bun:test";
import { createTestDataProvider } from "../test-support/data-provider";
import { createDefaultConfig } from "../types/config";
import type { FinancialStatement, TickerFinancials } from "../types/financials";
import { loadChartPaneModel } from "../plugins/builtin/chart-composer/headless";
import { extractFundamentalSeries } from "./fundamentals";
import type { ChartSpec, SecuritySeriesSource } from "./types";

const source = (period: SecuritySeriesSource["period"] = "annual", metric = "trailingPE"): SecuritySeriesSource => ({
  kind: "security", instrument: { symbol: "TEST", exchange: "NYSE" },
  fieldId: `valuation.${metric}`, period, timestampMode: "available-at",
});
const fixture = (): TickerFinancials => ({
  financialCurrency: "USD",
  quote: { symbol: "TEST", currency: "USD", price: 60, lastUpdated: Date.parse("2026-09-11T20:00Z"), change: 0, changePercent: 0 },
  annualStatements: [
    { date: "2024-12-31", availableAt: "2025-03-01", currency: "USD", eps: 10 },
    { date: "2025-12-31", availableAt: "2026-03-01", currency: "USD", eps: -2 },
  ],
  quarterlyStatements: [],
  priceHistory: [
    { date: new Date("2025-03-01"), close: 50 },
    { date: new Date("2026-03-01"), close: 55 },
  ],
});

test("Current valuation chooses the latest available statement before evaluating its denominator", () => {
  for (const earnings of [-2, 0, undefined]) {
    const data = fixture(); data.annualStatements[1]!.eps = earnings;
    const original = JSON.stringify(data);
    expect(extractFundamentalSeries(data, source()).map(({ value, periodLabel }) => [value, periodLabel]))
      .toEqual([[5, "Year ended 2024-12-31"]]);
    expect(JSON.stringify(data)).toBe(original);
  }
  // An unpublished loss does not replace the earnings known at this quote time.
  const future = fixture(); future.annualStatements[1]!.fieldAvailability = { eps: "2026-10-01" };
  expect(extractFundamentalSeries(future, source()).at(-1)?.value).toBe(6);
  // A corrected positive latest observation resumes calculation on that period.
  future.annualStatements[1] = { ...future.annualStatements[1]!, eps: 3, fieldAvailability: { eps: "2026-03-01" } };
  expect(extractFundamentalSeries(future, source()).at(-1)?.value).toBe(20);
});

test("automatic valuation coverage does not substitute a profitable annual period for loss-making TTM inputs", () => {
  const data = fixture();
  data.annualStatements = [data.annualStatements[0]!];
  data.quarterlyStatements = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
    .map((date) => ({ date, currency: "USD", eps: -1 }));
  for (const period of ["auto", "ttm"] as const) {
    expect(extractFundamentalSeries(data, source(period))).toEqual([]);
  }
  // Missing TTM earnings coverage can still use the independently requested
  // automatic annual fallback; this is different from known unprofitable input.
  data.quarterlyStatements = data.quarterlyStatements.map(({ eps, ...row }) => row);
  expect(extractFundamentalSeries(data, source("auto")).at(-1)?.value).toBe(6);
  expect(extractFundamentalSeries(data, source("ttm"))).toEqual([]);
});

test("finite reported EPS takes precedence over aggregate income and shares, including zero", () => {
  for (const eps of [0, -0, -2, 2]) {
    const data = fixture();
    Object.assign(data.annualStatements[1]!, { eps, netIncome: 100, netIncomeCommonStockholders: eps * 10, dilutedShares: 10 });
    const original = structuredClone(data);
    const points = extractFundamentalSeries(data, source());
    expect(points.map(({ value }) => value)).toEqual(eps > 0 ? [5, 27.5, 30] : [5]);
    expect(data).toEqual(original);
  }
  // Only unavailable/nonfinite reported EPS keeps the existing derivation.
  for (const eps of [undefined, NaN, Infinity]) {
    const data = fixture();
    Object.assign(data.annualStatements[1]!, { eps, netIncome: 100, dilutedShares: 10 });
    expect(extractFundamentalSeries(data, source()).map(({ value }) => value)).toEqual([5, 5.5, 6]);
  }
});

test("zero TTM reported EPS is coverage, not permission to use aggregate income or annual EPS", () => {
  for (const earnings of [[0, 0, 0, 0], [1, -1, 2, -2]]) {
    const data = fixture();
    data.annualStatements = [data.annualStatements[0]!];
    data.quarterlyStatements = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
      .map((date, index) => ({ date, currency: "USD", eps: earnings[index], netIncome: 25, dilutedShares: 10 }));
    for (const period of ["auto", "ttm"] as const) {
      expect(extractFundamentalSeries(data, source(period))).toEqual([]);
    }
    data.quarterlyStatements = data.quarterlyStatements.map(({ eps, ...row }) => row);
    for (const period of ["auto", "ttm"] as const) {
      expect(extractFundamentalSeries(data, source(period)).at(-1)?.value).toBe(6);
    }
  }
});

test("reported zero EPS uses its own availability; absent EPS uses income and shares availability", () => {
  const data = fixture();
  const latest = data.annualStatements[1]!;
  Object.assign(latest, { eps: 0, netIncome: 200, dilutedShares: 10,
    fieldAvailability: { eps: "2026-03-01", netIncome: "2026-10-01", dilutedShares: "2026-10-01" } });
  // The known zero is effective even though alternative inputs are unpublished.
  expect(extractFundamentalSeries(data, source()).map(({ value }) => value)).toEqual([5]);
  latest.fieldAvailability = { eps: "2026-10-01", netIncome: "2026-03-01", dilutedShares: "2026-03-01" };
  // Before reported EPS is available, the older published period remains current.
  expect(extractFundamentalSeries(data, source()).map(({ value }) => value)).toEqual([5, 6]);
  latest.eps = undefined;
  expect(extractFundamentalSeries(data, source()).map(({ value }) => value)).toEqual([5, 2.75, 3]);
  latest.fieldAvailability.dilutedShares = "2026-10-01";
  expect(extractFundamentalSeries(data, source()).find(({ periodLabel }) => periodLabel === "Current")?.value).toBe(6);
});

test("other current monetary ratios cannot skip a latest zero denominator", () => {
  const cases: Array<[string, Partial<FinancialStatement>, keyof FinancialStatement]> = [
    ["priceSales", { totalRevenue: 100, dilutedShares: 10 }, "totalRevenue"],
    ["evSales", { totalRevenue: 100, dilutedShares: 10, totalDebt: 20, cashAndCashEquivalents: 5 }, "totalRevenue"],
    ["evEbitda", { ebitda: 100, dilutedShares: 10, totalDebt: 20, cashAndCashEquivalents: 5 }, "ebitda"],
    ["priceFcf", { freeCashFlow: 100, dilutedShares: 10 }, "freeCashFlow"],
  ];
  for (const [metric, fields, denominator] of cases) {
    const data = fixture();
    data.annualStatements = data.annualStatements.map((row, index) => ({ ...row, ...fields, ...(index ? { [denominator]: 0 } : {}) }));
    expect(extractFundamentalSeries(data, source("annual", metric)).some((point) => point.periodLabel === "Current")).toBe(false);
    data.quarterlyStatements = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]
      .map((date) => ({ date, currency: "USD", ...fields, [denominator]: 0 }));
    expect(extractFundamentalSeries(data, source("auto", metric))).toEqual([]);
  }
});

test("chart and headless export preserve historical P/E without a Current point sourced from older earnings", async () => {
  const data = fixture();
  const spec: ChartSpec = { version: 1, viewport: { range: "5Y", resolution: "1d" }, panels: [{ id: "main" }], studies: [],
    series: [{ id: "pe", source: source(), style: "line", transform: "raw", axis: "left", panelId: "main", interpolation: "none" }] };
  const context = { marketData: createTestDataProvider({ getTickerFinancials: async () => data,
    getQuote: async () => data.quote!, getPriceHistoryForResolution: async () => data.priceHistory }),
    apiClient: {} as any, config: createDefaultConfig("/tmp/valuation-denominator-test"), signal: new AbortController().signal };
  const model = await loadChartPaneModel(spec, context);
  expect(model.series[0]?.points.map((point) => point.value)).toEqual([5]);
  expect(model.snapshot.financials[0]?.[1].annualStatements.at(-1)?.eps).toBe(-2);
  data.annualStatements[1]!.eps = 3;
  const recovered = await loadChartPaneModel(spec, context);
  expect(recovered.series[0]?.points.at(-1)?.value).toBe(20);
});
