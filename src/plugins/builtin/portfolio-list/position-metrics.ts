import type { TickerRecord } from "../../../types/ticker";

export interface PortfolioPositionMetrics {
  positionCurrency: string;
  positionCount: number;
  hasShorts: boolean;
  totalShares: number;
  totalCost: number;
  /** Every nonzero lot has a finite source cost, independently of FX conversion. */
  hasCostBasis: boolean;
  /** Signed cost basis, for net market value minus cost P&L. */
  signedCost: number;
  totalCostUnits: number;
  totalPriceUnits: number;
  grossPriceUnits: number;
  multiplierHint: number;
  brokerMktValue: number;
  brokerNetMktValue: number;
  hasBrokerMktValue: boolean;
  brokerPnl: number;
  hasBrokerPnl: boolean;
  brokerMarkPrice: number | undefined;
  pnlLots: { signedCost: number; priceUnits: number; brokerPnl: number | null }[];
}

function normalizePositionMultiplier(multiplier: number | undefined): number {
  return typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

export function signedPositionDirection(position: { shares: number; side?: "long" | "short" }): 1 | -1 {
  if (position.side === "short") return -1;
  if (position.side === "long") return 1;
  return position.shares < 0 ? -1 : 1;
}

export function resolvePositionCostMultiplier(position: TickerRecord["metadata"]["positions"][number]): number {
  const priceMultiplier = normalizePositionMultiplier(position.multiplier);
  if (priceMultiplier === 1) return 1;
  if (position.marketValue == null || position.unrealizedPnl == null
    || typeof position.avgCost !== "number" || !Number.isFinite(position.avgCost)) return priceMultiplier;

  const costWithoutMultiplier = Math.abs(position.shares) * position.avgCost;
  const costWithMultiplier = costWithoutMultiplier * priceMultiplier;
  const direction = signedPositionDirection(position);
  const marketValue = Math.abs(position.marketValue);
  const withoutMultiplierError = Math.abs(direction * (marketValue - costWithoutMultiplier) - position.unrealizedPnl);
  const withMultiplierError = Math.abs(direction * (marketValue - costWithMultiplier) - position.unrealizedPnl);
  // Some broker derivative feeds report avgCost already scaled to the contract.
  return withoutMultiplierError < withMultiplierError ? 1 : priceMultiplier;
}

export function getPortfolioPositionMetrics(
  ticker: TickerRecord,
  activeTab: string | undefined,
  fallbackCurrency: string,
  valuation?: { currency: string; convert: (value: number, currency: string) => number },
): PortfolioPositionMetrics {
  const positions = ticker.metadata.positions.filter((position) =>
    (!activeTab || position.portfolio === activeTab) && position.shares !== 0,
  );
  const currencies = new Set(positions.map((position) => position.currency || fallbackCurrency));
  const positionCurrency = valuation?.currency ?? (currencies.size > 1 ? "Mixed" : [...currencies][0] || fallbackCurrency);
  const convert = (value: number, position: typeof positions[number]) => valuation
    ? valuation.convert(value, position.currency || fallbackCurrency)
    : currencies.size > 1 ? Number.NaN : value;
  const metrics: PortfolioPositionMetrics = {
    positionCurrency, positionCount: positions.length, hasShorts: false,
    totalShares: 0, totalCost: 0, hasCostBasis: positions.length > 0, signedCost: 0, totalCostUnits: 0,
    totalPriceUnits: 0, grossPriceUnits: 0, multiplierHint: 1,
    brokerMktValue: 0, brokerNetMktValue: 0, hasBrokerMktValue: positions.length > 0,
    brokerPnl: 0, hasBrokerPnl: positions.length > 0,
    brokerMarkPrice: positions.length === 1 ? positions[0]?.markPrice : undefined,
    pnlLots: [],
  };
  for (const position of positions) {
    const direction = signedPositionDirection(position);
    const magnitude = Math.abs(position.shares);
    const priceMultiplier = normalizePositionMultiplier(position.multiplier);
    const costMultiplier = resolvePositionCostMultiplier(position);
    const hasCost = typeof position.avgCost === "number" && Number.isFinite(position.avgCost);
    const cost = hasCost ? magnitude * position.avgCost! * costMultiplier : Number.NaN;
    metrics.hasCostBasis &&= hasCost;
    metrics.hasShorts ||= direction < 0;
    metrics.multiplierHint = Math.max(metrics.multiplierHint, priceMultiplier, costMultiplier);
    metrics.totalShares += magnitude * direction;
    metrics.totalCost += convert(cost, position);
    metrics.signedCost += direction * convert(cost, position);
    metrics.totalCostUnits += magnitude * costMultiplier;
    metrics.totalPriceUnits += magnitude * priceMultiplier * direction;
    metrics.grossPriceUnits += magnitude * priceMultiplier;

    // Normalize each lot before summing: broker values may be signed, and a
    // complete snapshot for one account cannot stand in for another missing lot.
    const marketValue = Number.isFinite(position.marketValue) ? Math.abs(position.marketValue!)
      : Number.isFinite(position.markPrice) ? magnitude * priceMultiplier * position.markPrice!
      : Number.isFinite(position.unrealizedPnl) && Number.isFinite(cost) ? cost + direction * position.unrealizedPnl!
      : null;
    const pnl = Number.isFinite(position.unrealizedPnl) ? position.unrealizedPnl!
      : marketValue != null && Number.isFinite(cost) ? direction * (marketValue - cost) : null;
    if (marketValue == null || !Number.isFinite(marketValue)) metrics.hasBrokerMktValue = false;
    else {
      metrics.brokerMktValue += convert(marketValue, position);
      metrics.brokerNetMktValue += direction * convert(marketValue, position);
    }
    if (pnl == null || !Number.isFinite(pnl)) metrics.hasBrokerPnl = false;
    else metrics.brokerPnl += convert(pnl, position);
    metrics.pnlLots.push({
      signedCost: direction * convert(cost, position),
      priceUnits: magnitude * priceMultiplier * direction,
      brokerPnl: pnl != null && Number.isFinite(pnl) ? convert(pnl, position) : null,
    });
  }
  return metrics;
}

export function resolveBrokerFallbackMarketValue(metrics: PortfolioPositionMetrics): number | null {
  return metrics.hasBrokerMktValue && Number.isFinite(metrics.brokerMktValue) ? metrics.brokerMktValue : null;
}

export function resolveBrokerFallbackPnl(metrics: PortfolioPositionMetrics, _brokerMarketValue?: number | null): number | null {
  return metrics.hasBrokerPnl && Number.isFinite(metrics.brokerPnl) ? metrics.brokerPnl : null;
}

export interface PortfolioPositionPnl {
  value: number | null;
  basis: "quote-and-cost" | "broker-snapshot" | "mixed" | "unavailable";
}

export function portfolioPnlLabel(bases: Iterable<PortfolioPositionPnl["basis"]>): string {
  const sources = new Set(bases);
  if (sources.has("mixed") || (sources.has("broker-snapshot") && sources.has("quote-and-cost"))) return "Mixed P&L";
  return sources.has("broker-snapshot") ? "Broker P&L" : "P&L";
}

/** A current quote cannot establish missing acquisition cost or refresh a broker P&L snapshot. */
export function resolvePortfolioPositionPnl(
  metrics: PortfolioPositionMetrics,
  currentUnitPrice?: number | null,
): PortfolioPositionPnl {
  if (metrics.pnlLots.length === 0) return { value: null, basis: "unavailable" };
  let total = 0;
  const bases = new Set<"quote-and-cost" | "broker-snapshot">();
  for (const lot of metrics.pnlLots) {
    const currentPnl = typeof currentUnitPrice === "number" && Number.isFinite(currentUnitPrice)
      ? currentUnitPrice * lot.priceUnits - lot.signedCost : Number.NaN;
    if (Number.isFinite(currentPnl)) {
      total += currentPnl;
      bases.add("quote-and-cost");
    } else if (lot.brokerPnl !== null && Number.isFinite(lot.brokerPnl)) {
      total += lot.brokerPnl;
      bases.add("broker-snapshot");
    } else return { value: null, basis: "unavailable" };
  }
  return Number.isFinite(total)
    ? { value: total, basis: bases.size > 1 ? "mixed" : [...bases][0]! }
    : { value: null, basis: "unavailable" };
}

export function portfolioPnlPercent(value: number | null, costBasis: number): number | null {
  const percent = value !== null && Number.isFinite(value) && Number.isFinite(costBasis) && costBasis !== 0
    ? value / costBasis * 100 : Number.NaN;
  return Number.isFinite(percent) ? percent : null;
}
