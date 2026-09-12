import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender, settleFrame } from "../../../renderers/opentui/test-utils";
import { AppContext, createInitialState } from "../../../state/app/context";
import { createDefaultConfig } from "../../../types/config";
import { createTestTicker } from "../../../test-support/pane";
import { buildTickerReport, ticker as runTickerCommand } from "../../../cli/commands/ticker";
import { createTestDataProvider } from "../../../test-support/data-provider";
import type { MarketContext } from "../../../cli/types";
import type { TickerFinancials } from "../../../types/financials";
import { buildTickerAiContext } from "../ai/ticker-context";
import { OverviewTab } from "./overview-tab";

const config = createDefaultConfig("/tmp/gloom-fund-coverage-test-unused");
const savedTicker = createTestTicker("NEWF", "New fund", { assetCategory: "ETF", exchange: "ARCA", currency: "USD" });
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
});

for (const covered of [false, true]) {
  test(`${covered ? "covered zero" : "incomplete cached"} fund returns agree across overview, text, JSON and AI context`, async () => {
    const financials: TickerFinancials = {
      annualStatements: [], quarterlyStatements: [],
      priceHistory: [
        { date: new Date(covered ? "2023-09-08" : "2026-08-06"), close: 100 },
        { date: new Date("2026-09-10"), close: covered ? 100 : 105 },
      ],
      // Legacy cached since-inception percentages must not override the dated inputs.
      fundamentals: { return1Y: .05, return3Y: .05, dividendYield: 0 },
      quote: { symbol: "NEWF", currency: "USD", instrumentType: "ETF", price: covered ? 100 : 105, change: 0, changePercent: 0, lastUpdated: Date.parse("2026-09-10") },
    };
    const state = createInitialState(config);
    await act(async () => {
      setup = await testRender(
        <AppContext value={{ state, dispatch: () => {} }}>
          <OverviewTab ticker={savedTicker} financials={financials} width={120} />
        </AppContext>,
        { width: 120, height: 20 },
      );
    });
    await settleFrame(setup!, 10);
    const frame = setup!.captureCharFrame();
    expect(frame).toMatch(covered ? /1Y\s+0.00%/ : /1Y\s+-/);
    expect(frame).toMatch(covered ? /3Y\s+0.00%/ : /3Y\s+-/);
    expect(frame).toMatch(/Div Yield\s+0.00%/);
    const report = await buildTickerReport({ symbol: "NEWF", tickerFile: savedTicker, financials, config, toBase: async value => value });
    expect(report.includes("1Y Return")).toBe(covered);
    expect(report.includes("3Y Return")).toBe(covered);
    let captured: any;
    let closed = 0;
    await runTickerCommand("NEWF", {
      initMarketData: async () => ({
        config, dataDir: "/tmp/gloom-fund-coverage-test-unused",
        store: { loadTicker: async () => savedTicker },
        persistence: { close: () => { closed++; } },
        dataProvider: { ...createTestDataProvider({ getTickerFinancials: async () => financials }), getNews: async () => [] },
      }) as unknown as MarketContext,
      printResult: result => { captured = result.data; },
    });
    expect(closed).toBe(1);
    expect(captured.fundamentals.return1Y).toBe(covered ? 0 : undefined);
    expect(captured.fundamentals.return3Y).toBe(covered ? 0 : undefined);
    const context = buildTickerAiContext(savedTicker, financials, "USD");
    expect(context.includes("1Y Return: 0 (fraction)")).toBe(covered);
    expect(context).not.toContain("1Y Return: 0.05");
    expect(financials.fundamentals?.return1Y).toBe(.05);
  });
}
