import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { testRender, settleFrame, takeSavedTextFile } from "../../../../renderers/opentui/test-utils";
import { createInitialState } from "../../../../state/app/context";
import { exportPaneTable } from "../../../../state/pane-table-export-registry";
import { createTestDataProvider } from "../../../../test-support/data-provider";
import { createTestPaneConfig, createTestTicker, TestPaneProvider } from "../../../../test-support/pane";
import { createTestPluginRuntime } from "../../../../test-support/plugin-runtime";
import { renderHeadlessPaneText } from "../../../../cli/pane-functions/headless";
import { historicalPricesHeadless } from "../headless";
import { HistoricalPricesPane } from "./historical-prices";

let setup: Awaited<ReturnType<typeof testRender>> | undefined;
afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
});

for (const [symbol, prior, close] of [
  ["NG=F", 3.124, 3.125],
  ["RB=F", 2.1233, 2.1234],
  ["6J=F", .006282, .0062825],
] as const) {
  test(`${symbol}: history without instrument metadata keeps OHLC precision in pane, CSV and report`, async () => {
    const points = [
      { date: new Date("2026-09-08"), close: prior },
      { date: new Date("2026-09-09"), open: prior, high: close, low: prior, close, volume: 0 },
      { date: new Date("2026-09-10"), close: NaN },
      { date: new Date("2026-09-11"), close: 0 },
    ];
    const provider = createTestDataProvider({ getPriceHistory: async () => points });
    const paneId = "history:precision";
    const config = createTestPaneConfig("/tmp/gloom-history-precision-unused", {
      instanceId: paneId, paneId: "historical-prices", binding: { kind: "fixed", symbol },
    });
    const state = createInitialState(config);
    state.tickers.set(symbol, createTestTicker(symbol));
    const runtime = createTestPluginRuntime({ getMarketData: () => provider });
    await act(async () => {
      setup = await testRender(
        <TestPaneProvider state={state} paneId={paneId} pluginId="ticker-research" runtime={runtime}>
          <HistoricalPricesPane paneId={paneId} paneType="historical-prices" focused width={120} height={14} />
        </TestPaneProvider>, { width: 120, height: 14 },
      );
    });
    await settleFrame(setup!, 8);
    expect(setup!.captureCharFrame()).toContain(String(close));
    expect(setup!.captureCharFrame()).toContain(String(prior));
    await exportPaneTable(paneId, "history.csv");
    const csv = takeSavedTextFile()!.text;
    expect(csv).toContain(String(close));
    expect(csv).toContain(String(prior));

    const args = { symbols: [symbol], argument: [symbol], rawArgument: symbol, options: { range: "ALL" } };
    const result = await historicalPricesHeadless.load(args, { marketData: provider, signal: new AbortController().signal });
    expect(result.rows[1]).toMatchObject({ open: prior, high: close, low: prior, close, volume: 0 });
    expect(result.rows[2].close).toBeNull();
    expect(result.rows[3].close).toBe(0);
    const text = renderHeadlessPaneText(historicalPricesHeadless, result, args, "Historical Prices");
    expect(text).toContain(String(close));
    expect(text).toContain(String(prior));
    expect(Number.isNaN(points[2]!.close)).toBe(true);
  });
}
