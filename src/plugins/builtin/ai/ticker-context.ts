import { selectMarketCapitalization } from "../../../utils/market-capitalization";
import { hasValidQuoteObservationTime } from "../../../market-data/quotes/freshness";
import type { FinancialStatement, TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";

function money(value: number, currency?: string): string {
  // Model input needs source values and unambiguous units, including GBp and
  // very small per-share amounts. UI abbreviations/currency symbols lose both.
  return `${value} ${currency?.trim() || "(currency unavailable)"}`;
}

function sourceTime(value: string | undefined): string {
  return value && Number.isFinite(Date.parse(value)) ? value : "unavailable";
}

function statementCurrency(statement: FinancialStatement, financials: TickerFinancials): string | undefined {
  if (statement.currency?.trim()) return statement.currency.trim();
  const fallback = financials.financialCurrency?.trim();
  if (!fallback) return undefined;
  const conflicting = financials.annualStatements.some((row) => row.currency?.trim() && row.currency.trim() !== fallback);
  return conflicting ? undefined : fallback;
}

export function buildTickerAiContext(
  ticker: TickerRecord,
  financials: TickerFinancials | null,
  baseCurrency: string,
): string {
  const { metadata } = ticker;
  const quote = financials?.quote;
  const fundamentals = financials?.fundamentals;
  const profile = financials?.profile;
  const instrumentType = quote?.instrumentType ?? financials?.quoteMetadata?.instrumentType ?? metadata.assetCategory;
  const lines: string[] = [
    `Company: ${metadata.name} (${metadata.ticker})`,
    `Exchange: ${metadata.exchange}`,
    `Listing currency: ${quote?.currency || financials?.quoteMetadata?.currency || metadata.currency || "unavailable"}`,
    `User base currency preference: ${baseCurrency}`,
  ];
  const add = (label: string, value: number | undefined, format: (value: number) => string = String) => {
    if (value == null) return;
    lines.push(`${label}: ${Number.isFinite(value) ? format(value) : "unavailable"}`);
  };
  if (instrumentType) lines.push(`Instrument type: ${instrumentType}`);
  const sector = metadata.sector ?? profile?.sector;
  const industry = metadata.industry ?? profile?.industry;
  if (sector) lines.push(`Sector: ${sector}`);
  if (industry) lines.push(`Industry: ${industry}`);
  if (profile?.description) lines.push(`Description: ${profile.description}`);

  if (quote) {
    const price = (value: number) => quote.priceBasis === "percent-of-par"
      ? `${value}% of par (nominal currency ${quote.currency || "unavailable"})`
      : (instrumentType ?? "").toUpperCase() === "BOND" && quote.priceBasis !== "per-unit"
        ? `${value} (price basis unavailable; source currency ${quote.currency || "unavailable"})`
        : money(value, quote.currency);
    add("Quoted Price", quote.price, price);
    add("Quote Change", quote.change, quote.priceBasis === "percent-of-par"
      ? (value) => `${value} percentage points of par`
      : price);
    add("Quote Change Percent", quote.changePercent, (value) => `${value}%`);
    lines.push(`Quote observed: ${hasValidQuoteObservationTime(quote) ? new Date(quote.lastUpdated).toISOString() : "unavailable"}`);
    lines.push(`Quote source stale flag: ${quote.stale ?? "unavailable"}`);
    if (quote.providerId) lines.push(`Quote source: ${quote.providerId}`);
    if (quote.dataSource) lines.push(`Quote delivery class: ${quote.dataSource}`);
    add("52W Low", quote.low52w, price);
    add("52W High", quote.high52w, price);
  } else {
    lines.push("Quoted Price: unavailable");
    const source = financials?.quoteMetadata?.source;
    if (source) {
      lines.push(`Quote metadata source: ${source.providerId ?? "unavailable"}`);
      lines.push(`Quote metadata observed: ${source.lastUpdated && hasValidQuoteObservationTime({ lastUpdated: source.lastUpdated }) ? new Date(source.lastUpdated).toISOString() : "unavailable"}`);
      if (source.stale != null) lines.push(`Quote metadata stale: ${source.stale}`);
    }
  }

  const capitalization = selectMarketCapitalization(quote, fundamentals);
  if (capitalization) {
    // Native amounts retain their own source units and retrieval provenance.
    lines.push(`Market Cap: ${money(capitalization.value, capitalization.currency)}`);
    lines.push(`Market Cap source: ${capitalization.provenance.source ?? "unavailable"} ${capitalization.provenance.kind}`);
    if (capitalization.provenance.kind === "fundamentals") {
      lines.push(`Market Cap retrieved: ${sourceTime(capitalization.provenance.retrievedAt)}`);
      lines.push("Market Cap valuation date: unavailable");
      if (capitalization.provenance.stale != null) lines.push(`Market Cap stale: ${capitalization.provenance.stale}`);
    }
  }

  if (fundamentals) {
    lines.push(`Fundamentals source: ${fundamentals.source ?? "unavailable"}`);
    lines.push(`Fundamentals retrieved: ${sourceTime(fundamentals.fetchedAt)}`);
    if (fundamentals.stale != null) lines.push(`Fundamentals stale: ${fundamentals.stale}`);
    const multiple = (value: number) => value > 0 ? String(value) : `N/M (reported ${value})`;
    const fraction = (value: number) => `${value} (fraction)`;
    add("P/E (TTM)", fundamentals.trailingPE, multiple);
    add("Forward P/E", fundamentals.forwardPE, multiple);
    add("PEG", fundamentals.pegRatio);
    const reportedMoney = (value: number) => money(value, fundamentals.financialCurrency);
    add("Revenue", fundamentals.revenue, reportedMoney);
    add("Net Income", fundamentals.netIncome, reportedMoney);
    add("EPS", fundamentals.eps, reportedMoney);
    add("Operating Margin", fundamentals.operatingMargin, fraction);
    add("Profit Margin", fundamentals.profitMargin, fraction);
    add("Free Cash Flow", fundamentals.freeCashFlow, reportedMoney);
    add(`Dividend Yield${fundamentals.dividendYieldBasis ? ` (${fundamentals.dividendYieldBasis})` : ""}${fundamentals.dividendYieldSource ? ` [${fundamentals.dividendYieldSource}]` : ""}`, fundamentals.dividendYield, fraction);
    add("1Y Return", fundamentals.return1Y, fraction);
  }

  if (financials?.annualStatements.length) {
    const latest = financials.annualStatements.filter((row) => Number.isFinite(Date.parse(row.date)))
      .reduce<FinancialStatement | undefined>((current, row) => !current || Date.parse(row.date) >= Date.parse(current.date) ? row : current, undefined);
    if (latest) {
      lines.push("", `Latest Annual Statement (${latest.date}):`);
      lines.push(`  Available: ${sourceTime(latest.availableAt)}`);
      if (latest.dateSource) lines.push(`  Period date source: ${latest.dateSource}`);
      if (latest.dateEvidence) lines.push(`  Period identity filing: ${latest.dateEvidence.accessionNumber}, filed ${latest.dateEvidence.filed}`);
      if (latest.fieldAvailability) lines.push(`  Field availability: ${JSON.stringify(latest.fieldAvailability)}`);
      const reportedMoney = (value: number) => money(value, statementCurrency(latest, financials));
      for (const [label, value] of [
        ["Revenue", latest.totalRevenue], ["Net Income", latest.netIncome],
        ["Operating CF", latest.operatingCashFlow], ["Free Cash Flow", latest.freeCashFlow],
        ["Total Assets", latest.totalAssets], ["Total Debt", latest.totalDebt], ["Equity", latest.totalEquity],
      ] as const) add(`  ${label}`, value, reportedMoney);
    }
  }
  const history = financials?.statementHistory;
  if (history) {
    lines.push(`Statement history: ${history.source} ${history.status}`);
    lines.push(`Statement history retrieved: ${sourceTime(history.fetchedAt)}`);
    if (history.attemptedAt) lines.push(`Statement history attempted: ${sourceTime(history.attemptedAt)}`);
    if (history.reason) lines.push(`Statement history issue: ${history.reason}`);
  }
  return lines.join("\n");
}
