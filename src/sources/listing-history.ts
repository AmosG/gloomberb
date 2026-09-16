import type { PricePoint, TickerFinancials } from "../types/financials";
import { canonicalExchange, parsePublicTickerKey } from "../utils/exchanges";
import { getPricePointTimestamp } from "../utils/price-history";
import { HistoryCoverageError } from "./history-coverage";

const CIRCLE_IPO_MONTH = Date.parse("2025-06-01");
const CIRCLE_FIRST_SESSION_END = Date.parse("2025-06-06");

/** The June 4 offer was $31; NYSE trading began June 5. Captured Cloud
 * daily history inserts that offer as OHLC, and its inception week/month
 * carries the same $31 open/low. Its first-session intraday feed also
 * inserts the offer before the opening auction (13:40 UTC in 5m data),
 * though independent daily trading OHLC is 69/103.75/64/83.23.
 * This is an exact attested source defect,
 * not a general zero-volume or pre-inception-bar heuristic.
 * https://www.circle.com/pressroom/circle-announces-pricing-of-upsized-initial-public-offering
 */
export function hasCircleOfferingPriceHistory(
  points: readonly PricePoint[],
  target: { symbol: string; exchange?: string },
  sourceKey: string,
): boolean {
  if (sourceKey !== "provider:gloomberb-cloud") return false;
  const parsed = parsePublicTickerKey(target.symbol);
  const exchange = canonicalExchange(parsed.exchange || target.exchange);
  // The unqualified Cloud CRCL endpoint is the same US default listing. An
  // explicit other venue remains a distinct target, even with similar values.
  if (parsed.symbol !== "CRCL" || (exchange && exchange !== "NYSE")) return false;
  return points.some((point) => {
    const time = getPricePointTimestamp(point);
    return time >= CIRCLE_IPO_MONTH && time < CIRCLE_FIRST_SESSION_END
      && point.open === 31 && point.low === 31;
  });
}

export function assertTradingPriceHistory(
  points: PricePoint[], target: { symbol: string; exchange?: string }, sourceKey: string,
): PricePoint[] {
  if (hasCircleOfferingPriceHistory(points, target, sourceKey)) {
    // Reject the entire requested source window. Dropping the bad bar alone
    // could silently move a comparison baseline or claim a complete month.
    throw new HistoryCoverageError({ message: "CRCL NYSE history includes the June 4, 2025 IPO offer price as market history. Trading began June 5; the affected source window is unavailable." });
  }
  return points;
}

export function sanitizeListingFinancialHistory(
  value: TickerFinancials, target: { symbol: string; exchange?: string }, sourceKey: string,
): TickerFinancials {
  return hasCircleOfferingPriceHistory(value.priceHistory, target, sourceKey)
    ? { ...value, priceHistory: [] } : value;
}
