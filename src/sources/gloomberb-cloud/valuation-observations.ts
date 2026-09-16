import type { TickerFinancials } from "../../types/financials";
import { canonicalExchange, parsePublicTickerKey } from "../../utils/exchanges";
import { redactUnavailableFundamentals } from "../../utils/fundamentals";

/** Retire the exact mapped SAP observation still served by older Cloud
 * deployments/caches. Raw share/period validation belongs to the backend;
 * this narrower guard cannot classify a different source observation.
 * See docs/data-quality/sap-us-valuation.md. */
export function retractKnownCloudValuation(
  financials: TickerFinancials,
  target?: { symbol: string; exchange?: string },
): TickerFinancials {
  const value = redactUnavailableFundamentals(financials.fundamentals);
  if (!value || (value.source && !["twelvedata", "cache"].includes(value.source)) ||
    value.sharesOutstanding !== 1_154_204_232) return financials;
  const quote = financials.quote ?? financials.quoteMetadata;
  const identity = parsePublicTickerKey(quote?.symbol ?? target?.symbol ?? "");
  const venue = canonicalExchange(quote?.listingExchangeName ||
    financials.quote?.exchangeName || identity.exchange || target?.exchange);
  if (identity.symbol !== "SAP" || (venue && venue !== "NYSE") ||
    (quote?.currency ?? value.marketCapCurrency) !== "USD") return financials;
  const unavailable = new Set(value.unavailableFields ?? []);
  if (value.enterpriseValue === 4_095_338_359_014) unavailable.add("enterpriseValue");
  if (value.enterpriseToRevenue === 92.879) unavailable.add("enterpriseToRevenue");
  if (unavailable.size === (value.unavailableFields?.length ?? 0)) return financials;
  return { ...financials, fundamentals: redactUnavailableFundamentals({
    ...value, unavailableFields: [...unavailable],
  }) };
}
