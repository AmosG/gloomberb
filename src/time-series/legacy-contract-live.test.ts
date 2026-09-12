import { expect, test } from "bun:test";
import { createTestDataProvider } from "../test-support/data-provider";
import type { ChartSpec } from "./types";
import { chartQuoteOverrideKeyForSource, chartQuoteOverrideKeyForTarget, getLiveChartQuoteTargets, subscribeToLiveChartQuotes } from "./live-quotes";

test("live chart targets and quote overrides preserve same-local-symbol option definitions", async () => {
  const source = (strike: number) => ({ kind: "security" as const, fieldId: "price", instrument: { symbol: "ACME", exchange: "NASDAQ", brokerId: "fixture", brokerInstanceId: "feed", instrument: { brokerId: "fixture", brokerInstanceId: "feed", symbol: "ACME", localSymbol: "LEGACY", secType: "OPT", currency: "USD", right: "C" as const, strike, lastTradeDateOrContractMonth: "20261016", multiplier: "100" } } });
  const a = source(100); const b = source(110);
  const spec = { series: [{ id: "a", source: a }, { id: "b", source: b }], studies: [] } as unknown as ChartSpec;
  const targets = getLiveChartQuoteTargets(spec); expect(targets).toHaveLength(2);
  let emit: any; let received: ReadonlyMap<string, any> | undefined;
  const provider = createTestDataProvider({ subscribeQuotes: (_targets, onQuote) => { emit = onQuote; return () => {}; } });
  const dispose = subscribeToLiveChartQuotes({ spec, dataProvider: provider, refreshIntervalMs: 0, onRefresh: overrides => { received = overrides; } });
  try {
    emit(targets[0], { symbol: "ACME", currency: "USD", price: 10, lastUpdated: Date.now() });
    emit(targets[1], { symbol: "ACME", currency: "USD", price: 20, lastUpdated: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(received?.size).toBe(2);
    expect(received?.get(chartQuoteOverrideKeyForSource(a))?.price).toBe(10);
    expect(received?.get(chartQuoteOverrideKeyForSource(b))?.price).toBe(20);
    expect(chartQuoteOverrideKeyForTarget(targets[0]!)).toBe(chartQuoteOverrideKeyForSource(a));
  } finally { dispose(); }
});
