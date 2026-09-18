import { useMemo } from "react";
import { useFxRatesMap, useTickerFinancialsMap } from "../../../../market-data/hooks";
import { buildPortfolioFinancialsMap } from "../../../../market-data/portfolio-financials";
import { useAppSelector } from "../../../../state/app/context";
import type { TickerRecord } from "../../../../types/ticker";
import { selectEffectiveExchangeRates } from "../../../../utils/exchange-rate-map";
import { getPortfolioPositionValue } from "../../kelly-sizer/portfolio";
import { calculatePortfolioSummaryTotals } from "../../portfolio-list/metrics";
import { buildTrackedCurrencies } from "../../portfolio-list/pane/data";
import type { SymbolExposure } from "./model";

const NO_INSTRUMENT_OPTIONS = {};

function holdsOptions(ticker: TickerRecord): boolean {
  if (ticker.metadata.assetCategory === "OPT") return true;
  if (ticker.metadata.broker_contracts?.some((contract) => contract.secType === "OPT")) return true;
  return ticker.metadata.positions.some((position) => (position.multiplier ?? 1) !== 1);
}

export interface BookExposure {
  bySymbol: Map<string, SymbolExposure>;
  /** Gross market value of every position, base currency. */
  bookValue: number;
  baseCurrency: string;
  heldTickers: TickerRecord[];
}

/**
 * Market value of every held symbol across all portfolios, in the base
 * currency, the same way the portfolio pane totals them. Theses match
 * positions by symbol, so this is the only portfolio data they need.
 */
export function useBookExposure(): BookExposure {
  const tickersBySymbol = useAppSelector((state) => state.tickers);
  const cachedFinancials = useAppSelector((state) => state.financials);
  const cachedExchangeRates = useAppSelector((state) => state.exchangeRates);
  const baseCurrency = useAppSelector((state) => state.config.baseCurrency);
  const heldTickers = useMemo(
    () => [...tickersBySymbol.values()].filter((ticker) => ticker.metadata.positions.some((position) => position.shares !== 0)),
    [tickersBySymbol],
  );
  const liveFinancials = useTickerFinancialsMap(heldTickers, NO_INSTRUMENT_OPTIONS);
  const financials = useMemo(
    () => buildPortfolioFinancialsMap(heldTickers, cachedFinancials, liveFinancials, NO_INSTRUMENT_OPTIONS),
    [cachedFinancials, heldTickers, liveFinancials],
  );
  const trackedCurrencies = useMemo(
    () => buildTrackedCurrencies(heldTickers, financials, null, baseCurrency),
    [baseCurrency, financials, heldTickers],
  );
  const fetchedRates = useFxRatesMap(trackedCurrencies);
  const exchangeRates = selectEffectiveExchangeRates(fetchedRates, cachedExchangeRates);
  return useMemo(() => {
    const totals = calculatePortfolioSummaryTotals(heldTickers, financials, baseCurrency, exchangeRates, true, null);
    const bySymbol = new Map<string, SymbolExposure>();
    for (const ticker of heldTickers) {
      const symbol = ticker.metadata.ticker.toUpperCase();
      const value = getPortfolioPositionValue({
        ticker,
        financials: financials.get(ticker.metadata.ticker) ?? null,
        portfolioId: null,
        baseCurrency,
        exchangeRates,
      });
      const options = holdsOptions(ticker);
      const spot = financials.get(ticker.metadata.ticker)?.quote?.price;
      const optionNotional = options && spot
        ? ticker.metadata.positions.reduce((total, position) => total + Math.abs(position.shares) * (position.multiplier ?? 1) * spot, 0)
        : 0;
      bySymbol.set(symbol, { symbol, value, optionNotional, hasOptions: options });
    }
    return { bySymbol, bookValue: totals.totalMktValue, baseCurrency, heldTickers };
  }, [baseCurrency, exchangeRates, financials, heldTickers]);
}
