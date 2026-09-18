import { formatMarketPriceWithCurrency, type MarketFormatOptions } from "../../../market-data/market/format";
import type { ResolvedSeries, TimeSeriesPoint } from "../../../time-series/types";
import type { CompositeAxisDomain } from "./types";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
};

const CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));

const HOUR_MS = 60 * 60 * 1_000;
const INTRADAY_SPAN_MAX_MS = 36 * HOUR_MS;

function compactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(absolute >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(absolute >= 10_000_000_000 ? 0 : 1)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}K`;
  if (absolute >= 100) return value.toFixed(0);
  if (absolute >= 10) return value.toFixed(1);
  if (absolute >= 1) return value.toFixed(2);
  if (absolute === 0) return "0";
  return value.toPrecision(3);
}

function unitCurrencyCode(unit: string): string | null {
  const currency = unit.trim().toUpperCase().split(/[\s/]/)[0] ?? "";
  return CURRENCY_CODES.has(currency) ? currency : null;
}

function currencyPrefix(unit: string): string {
  const currency = unitCurrencyCode(unit);
  return currency ? CURRENCY_SYMBOLS[currency] ?? "" : "";
}

function formatFullCurrencyValue(
  value: number,
  unit: string,
  assetCategory?: string,
  options: MarketFormatOptions = {},
): string | null {
  const currency = unitCurrencyCode(unit);
  return currency ? formatMarketPriceWithCurrency(value, currency, { ...options, assetCategory }) : null;
}

/** An axis can serve several price series. Keep the most precise value the
 * shared formatter produces, rather than inheriting the first asset's rounding. */
function formatAxisPriceValue(value: number, domain: CompositeAxisDomain, options: MarketFormatOptions = {}): string {
  const categories = domain.priceAssetCategories?.length ? domain.priceAssetCategories : [undefined];
  return categories.reduce<string>((best, category) => {
    const formatted = formatFullCurrencyValue(value, domain.unit, category, options) ?? "";
    return formatted.length > best.length ? formatted : best;
  }, "");
}

const AXIS_TICK_COUNT = 3;

function axisTickValue(domain: CompositeAxisDomain, ratio: number): number {
  return domain.scale === "log"
    ? Math.exp(Math.log(domain.max) + (Math.log(domain.min) - Math.log(domain.max)) * ratio)
    : domain.max + (domain.min - domain.max) * ratio;
}

/** The narrowest distance between neighbouring ticks. A log axis bunches its
 * lowest ticks together, so the tightest pair is what every label has to stay
 * legible against. */
function narrowestAxisTickGap(domain: CompositeAxisDomain): number | null {
  const values = Array.from(
    { length: AXIS_TICK_COUNT },
    (_, index) => axisTickValue(domain, index / (AXIS_TICK_COUNT - 1)),
  );
  const gap = Math.min(...values.slice(1).map((value, index) => Math.abs(value - values[index]!)));
  return Number.isFinite(gap) && gap > 0 ? gap : null;
}

/** What compactNumber's final digit is worth. Ticks nearer to each other than
 * this render as the same label. */
function compactResolution(value: number): number {
  const absolute = Math.abs(value);
  for (const divisor of [1e12, 1e9, 1e6, 1e3]) {
    if (absolute >= divisor) return absolute >= divisor * 10 ? divisor : divisor / 10;
  }
  if (absolute >= 100) return 1;
  if (absolute >= 10) return 0.1;
  if (absolute >= 1) return 0.01;
  // Sub-unit values keep three significant digits.
  return absolute > 0 ? 10 ** (Math.floor(Math.log10(absolute)) - 2) : 0;
}

export function formatCompositeSeriesValue(value: number, series: ResolvedSeries): string {
  return formatChartLegendValue(value, series.unit, series.unitGroup, series.priceAssetCategory);
}

export function formatChartLegendValue(value: number, unit: string, unitGroup = "", assetCategory?: string): string {
  const trimmed = unit.trim();
  const group = unitGroup.toLowerCase();
  const compact = compactNumber(value);
  if (group.includes("percent") || trimmed === "%" || trimmed.toLowerCase().includes("percent")) {
    return `${compact}%`;
  }
  if (group.includes("ratio") || trimmed.toLowerCase() === "x") return `${compact}x`;
  if (group.startsWith("derived-unit:")) return `${compact} ${trimmed}`;
  if (group.split(":")[0] === "currency-total") {
    const scale = ([[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const)
      .find(([divisor]) => Math.abs(value) >= divisor);
    if (scale) {
      const amount = `${Number((value / scale[0]).toFixed(2))}${scale[1]}`;
      const prefix = currencyPrefix(trimmed);
      return prefix ? `${prefix}${amount}` : `${amount} ${trimmed}`.trim();
    }
  }
  const fullPrice = formatFullCurrencyValue(value, trimmed, assetCategory);
  if (fullPrice) return fullPrice;
  return trimmed && trimmed.length <= 6 ? `${compact}${trimmed.startsWith("/") ? "" : " "}${trimmed}` : compact;
}

export function formatCompositeAxisValue(value: number, domain: CompositeAxisDomain): string {
  const compact = compactNumber(value);
  const group = domain.unitGroup.toLowerCase();
  if (group.includes("percent") || domain.unit === "%") return `${compact}%`;
  if (group.includes("ratio") || domain.unit.toLowerCase() === "x") return `${compact}x`;
  // Derived dimensions are included in the legend value. Axis labels stay
  // numeric so a narrow gutter cannot truncate USD/JPY into a false USD label.
  if (group.startsWith("derived-unit:")) return compact;
  // Compact labels suit a wide view, but a zoomed one can hold several ticks
  // inside a single rounding step and print one repeated price down the gutter.
  // Where that happens the axis spends the digits needed to tell them apart,
  // shared across every tick so the column reads as one scale.
  const gap = narrowestAxisTickGap(domain);
  if (gap !== null && gap < compactResolution(value)) {
    const resolved = formatAxisPriceValue(value, domain, {
      fixedFractionDigits: Math.max(0, Math.ceil(-Math.log10(gap))),
    });
    if (resolved) return resolved;
  }
  return `${currencyPrefix(domain.unit)}${compact}`;
}

export function formatCompositeCursorValue(value: number, domain: CompositeAxisDomain): string {
  const group = domain.unitGroup.toLowerCase();
  if (group.startsWith("derived-unit:")) return compactNumber(value);
  if (group.split(":")[0] === "currency-total") {
    return formatChartLegendValue(value, domain.unit, domain.unitGroup);
  }
  const fullPrice = formatAxisPriceValue(value, domain);
  if (fullPrice) return fullPrice;
  return formatCompositeAxisValue(value, domain);
}

export type CompositeAxisValueFormatter = (value: number, domain: CompositeAxisDomain) => string;

export function compositeAxisTicks(
  domain: CompositeAxisDomain,
  count = 3,
  format: CompositeAxisValueFormatter = formatCompositeAxisValue,
): Array<{ ratio: number; value: number; label: string }> {
  const tickCount = Math.max(2, Math.floor(count));
  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const value = axisTickValue(domain, ratio);
    return { ratio, value, label: format(value, domain) };
  });
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function isIntradaySpan(startTime: number, endTime: number): boolean {
  return Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && Math.abs(endTime - startTime) <= INTRADAY_SPAN_MAX_MS;
}

/** Shared-cursor timestamp using the chart's explicit UTC convention. */
export function formatCompositeCursorDate(date: Date, startTime: number, endTime: number): string {
  return isIntradaySpan(startTime, endTime)
    ? `${utcDate(date)} ${utcTime(date)} UTC`
    : utcDate(date);
}

function validUtcTimestamp(date: Date | undefined): string | null {
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.getUTCHours() === 0
      && date.getUTCMinutes() === 0
      && date.getUTCSeconds() === 0
      && date.getUTCMilliseconds() === 0
    ? utcDate(date)
    : `${utcDate(date)} ${utcTime(date)} UTC`;
}

/**
 * Concise, audit-friendly context for an observation. Kept separate from the
 * visible legend so fiscal-period and availability metadata is available on
 * demand without reducing chart density.
 */
export function formatCompositePointDetails(point: TimeSeriesPoint | null | undefined): string {
  if (!point) return "";
  const details: string[] = [];
  const periodLabel = point.periodLabel?.trim();
  const observedAt = validUtcTimestamp(point.observedAt);
  const availableAt = validUtcTimestamp(point.availableAt);

  if (periodLabel) details.push(periodLabel);
  const labelIncludesObservedDate = ["Quarter", "Year", "TTM"].some((period) => periodLabel === `${period} ended ${observedAt}`);
  if (observedAt && !labelIncludesObservedDate) {
    const isFiscalPeriod = periodLabel && periodLabel.toLowerCase() !== "current";
    details.push(`${isFiscalPeriod ? "Period ended" : "Observed"} ${observedAt}`);
  }
  if (availableAt && availableAt !== observedAt) details.push(`Available ${availableAt}`);

  const quality = point.provenance?.quality;
  if (quality) details.push(`${quality[0]!.toUpperCase()}${quality.slice(1)}`);
  const providerId = point.provenance?.providerId?.trim();
  if (providerId) details.push(`Source ${providerId}`);

  return details.join(" · ");
}

/** Compact UTC tick label selected from the full visible chart span. */
export function formatCompositeTimeAxisDate(date: Date, startTime: number, endTime: number): string {
  if (!isIntradaySpan(startTime, endTime)) return utcDate(date);
  const startDate = utcDate(new Date(startTime));
  const endDate = utcDate(new Date(endTime));
  return startDate === endDate
    ? `${utcTime(date)} UTC`
    : `${utcDate(date).slice(5)} ${utcTime(date)} UTC`;
}
