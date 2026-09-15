import { describe, expect, test } from "bun:test";
import { createTestTicker } from "../../../test-support/pane";
import type { TickerFinancials } from "../../../types/financials";
import { buildTickerAiContext } from "./ticker-context";

const ticker = createTestTicker("CONTROL", "Controlled issuer", { currency: "USD", exchange: "NASDAQ" });
const financials = (patch: Partial<TickerFinancials>): TickerFinancials => ({
  annualStatements: [], quarterlyStatements: [], priceHistory: [], ...patch,
});

describe("ticker research context source boundaries", () => {
  test("keeps summary, statement, and listing units independent, including minor units and unknown currency", () => {
    const source = financials({
      fundamentals: { financialCurrency: "GBp", eps: 20, revenue: 100, source: "yahoo" },
      financialCurrency: "JPY",
      annualStatements: [{ date: "2025-12-31", currency: "GBP", totalRevenue: 300 }],
    });
    const context = buildTickerAiContext(ticker, source, "EUR");
    expect(context).toContain("EPS: 20 GBp");
    expect(context).toContain("Revenue: 100 GBp");
    expect(context).toContain("  Revenue: 300 GBP");
    expect(context).toContain("Listing currency: USD");
    source.fundamentals!.financialCurrency = undefined;
    expect(buildTickerAiContext(ticker, source, "EUR")).toContain("EPS: 20 (currency unavailable)");
    source.annualStatements = [{ date: "2024-12-31", currency: "GBP" }, { date: "2025-12-31", totalRevenue: 300 }];
    expect(buildTickerAiContext(ticker, source, "EUR")).toContain("  Revenue: 300 (currency unavailable)");
    source.annualStatements[0]!.currency = "JPY";
    expect(buildTickerAiContext(ticker, source, "EUR")).toContain("  Revenue: 300 JPY");
  });

  test("preserves zero, small and invalid observations without making zero-valued data disappear", () => {
    const context = buildTickerAiContext(ticker, financials({
      fundamentals: { financialCurrency: "JPY", eps: 0.00000123, netIncome: 0, freeCashFlow: 0, operatingMargin: 0.0000001, trailingPE: 0.04, forwardPE: -2, pegRatio: Number.NaN },
      annualStatements: [{ date: "2025-12-31", currency: "JPY", netIncome: 0, totalDebt: 0, totalEquity: Number.POSITIVE_INFINITY }],
    }), "USD");
    expect(context).toContain("EPS: 0.00000123 JPY");
    expect(context).toContain("Operating Margin: 1e-7 (fraction)");
    expect(context).toContain("P/E (TTM): 0.04");
    expect(context).toContain("Forward P/E: N/M (reported -2)");
    expect(context).toContain("Net Income: 0 JPY");
    expect(context).toContain("Free Cash Flow: 0 JPY");
    expect(context).toContain("Total Debt: 0 JPY");
    expect(context).toContain("PEG: unavailable");
    expect(context).toContain("Equity: unavailable");
    expect(context).not.toMatch(/NaN|Infinity/);
  });

  test("selects the latest valid period and distinguishes period identity, field availability and retrieval failure", () => {
    const context = buildTickerAiContext(ticker, financials({
      fundamentals: { source: "yahoo", fetchedAt: "2026-09-09T12:00:00Z", stale: true },
      annualStatements: [
        { date: "2025-12-31", currency: "JPY", totalRevenue: 200, availableAt: "2026-02-10", dateSource: "sec", dateEvidence: { accessionNumber: "controlled", filed: "2026-02-09", startDate: "2025-01-01" }, fieldAvailability: { totalRevenue: "2026-02-11" } },
        { date: "2024-12-31", totalRevenue: 100 },
        { date: "invalid", totalRevenue: 999 },
      ],
      statementHistory: { mode: "extended", source: "sec", status: "retryable-failure", fetchedAt: "2026-09-09T12:00:00Z", attemptedAt: "2026-09-10T12:00:00Z", reason: "Controlled history outage" },
    }), "EUR");
    expect(context).toContain("Latest Annual Statement (2025-12-31)");
    expect(context).toContain("Available: 2026-02-10");
    expect(context).toContain("Period identity filing: controlled, filed 2026-02-09");
    expect(context).toContain('Field availability: {"totalRevenue":"2026-02-11"}');
    expect(context).toContain("Fundamentals stale: true");
    expect(context).toContain("Statement history: sec retryable-failure");
    expect(context).toContain("Statement history attempted: 2026-09-10T12:00:00Z");
    expect(context).toContain("Controlled history outage");
    expect(context).not.toContain("Revenue: 100");
    expect(context).not.toContain("Revenue: 999");
  });

  test("retains native capitalization and quote basis without treating metadata as a current observation", () => {
    const source = financials({
      quote: { symbol: "CONTROL", currency: "USD", instrumentType: "BOND", priceBasis: "percent-of-par", stale: true, price: 98, change: -0.5, changePercent: -0.5076, lastUpdated: Date.now() - 30 * 86400000, providerId: "controlled" },
      fundamentals: { marketCap: 10_000_000, marketCapCurrency: "JPY", source: "yahoo", fetchedAt: "2026-09-09T12:00:00Z", stale: true },
    });
    let context = buildTickerAiContext(ticker, source, "EUR");
    expect(context).toContain("Quoted Price: 98% of par (nominal currency USD)");
    expect(context).toContain("Quote Change: -0.5 percentage points of par");
    expect(context).toContain("Quote source stale flag: true");
    expect(context).toContain("Market Cap: 10000000 JPY");
    expect(context).toContain("Market Cap valuation date: unavailable");
    source.quote = undefined;
    source.quoteMetadata = { symbol: "CONTROL", currency: "GBP", source: { providerId: "controlled", lastUpdated: Date.now(), stale: true } };
    context = buildTickerAiContext(ticker, source, "EUR");
    expect(context).toContain("Quoted Price: unavailable");
    expect(context).not.toContain("Quoted Price: 98");
    expect(context).toContain("Quote metadata stale: true");
    expect(context).not.toContain("Quote observed:");
  });
});
