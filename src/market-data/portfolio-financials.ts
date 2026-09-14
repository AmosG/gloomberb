import type { TickerFinancials } from "../types/financials";
import type { TickerRecord } from "../types/ticker";
import { instrumentFromTicker, type TickerInstrumentOptions } from "./request-types";

export function buildPortfolioFinancialsMap(
  portfolioTickers: TickerRecord[],
  cachedFinancials: Map<string, TickerFinancials>,
  marketFinancials: Map<string, TickerFinancials>,
  options: TickerInstrumentOptions = {},
): Map<string, TickerFinancials> {
  const result = new Map<string, TickerFinancials>();
  for (const ticker of portfolioTickers) {
    const symbol = ticker.metadata.ticker;
    const cached = cachedFinancials.get(symbol);
    const instrument = instrumentFromTicker(ticker, symbol, options);
    if (cached) {
      // The symbol-only app cache cannot establish a broker price's contract.
      const ambiguousPrice = options.portfolioId && (!instrument || instrument.brokerId || ticker.metadata.broker_contracts?.length);
      result.set(symbol, ambiguousPrice
        ? { ...cached, quote: undefined, priceHistory: [] }
        : cached);
    }
    const scoped = marketFinancials.get(symbol);
    if (scoped) result.set(symbol, instrument ? scoped : { ...scoped, quote: undefined, priceHistory: [] });
  }
  return result;
}
