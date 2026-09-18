import type { EarningsEstimateField, EarningsEvent } from "../../../types/data-provider";
import { formatCompact, formatNumber } from "../../../utils/format";
import { coherentEarningsValue, earningsForecastPeriod } from "./estimate-basis";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface EstimateBlock {
  label: string;
  /** Consensus with its currency, or null when the provider has none. */
  consensus: string | null;
  analysts: number | null;
  low: number | null;
  high: number | null;
  /** Where the consensus sits between low and high, 0..1, when all three exist. */
  position: number | null;
  lowText: string;
  highText: string;
  yearAgo: string | null;
  growth: number | null;
  /** Consensus 30 and 7 days ago, with the change since. EPS only. */
  trend: Array<{ label: string; value: string; change: number | null; changeText: string }>;
  /** Up and down revisions over 30 and 7 days. EPS only. */
  revisions: Array<{ label: string; up: number | null; down: number | null }>;
}

export interface EarningsDetail {
  symbol: string;
  name: string;
  /** "Nov 17, 2026" */
  date: string;
  /** "after close", "before open", the call time, or null. */
  timing: string | null;
  dateStatus: "estimated" | "confirmed" | null;
  /** "3Q2027 ending 2026-10-31" when every shown estimate agrees on the period. */
  period: string | null;
  eps: EstimateBlock;
  revenue: EstimateBlock;
}

function money(event: EarningsEvent, field: EarningsEstimateField, formatter: (value: number) => string): string | null {
  const value = coherentEarningsValue(event, field);
  if (value == null) return null;
  const currency = event.estimateBasis?.[field]?.currency;
  return currency ? `${currency} ${formatter(value)}` : formatter(value);
}

function position(low: number | null, high: number | null, value: number | null): number | null {
  if (low == null || high == null || value == null || high <= low) return null;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

function block(
  event: EarningsEvent,
  label: string,
  fields: { estimate: EarningsEstimateField; low: EarningsEstimateField; high: EarningsEstimateField; yearAgo: EarningsEstimateField; growth: EarningsEstimateField; analysts: EarningsEstimateField },
  formatter: (value: number) => string,
  withTrend: boolean,
): EstimateBlock {
  const estimate = coherentEarningsValue(event, fields.estimate);
  const low = coherentEarningsValue(event, fields.low);
  const high = coherentEarningsValue(event, fields.high);
  const trend: EstimateBlock["trend"] = [];
  const revisions: EstimateBlock["revisions"] = [];
  if (withTrend) {
    for (const [label, field] of [["30 days ago", "epsTrend30dAgo"], ["7 days ago", "epsTrend7dAgo"]] as const) {
      const prior = coherentEarningsValue(event, field);
      if (prior == null) continue;
      const change = estimate != null ? estimate - prior : null;
      const changeText = change == null ? "" : formatter(Math.abs(change));
      // A move below the displayed precision is no move.
      const flat = change != null && /^0(\.0+)?$/.test(changeText);
      trend.push({
        label,
        value: formatter(prior),
        change: flat ? 0 : change,
        changeText: change == null ? "" : flat ? "unchanged" : `${change > 0 ? "+" : "-"}${changeText} since`,
      });
    }
    for (const [label, up, down] of [["30d", "epsRevisionUp30d", "epsRevisionDown30d"], ["7d", "epsRevisionUp7d", "epsRevisionDown7d"]] as const) {
      const upCount = coherentEarningsValue(event, up);
      const downCount = coherentEarningsValue(event, down);
      if (upCount == null && downCount == null) continue;
      revisions.push({ label, up: upCount, down: downCount });
    }
  }
  return {
    label,
    consensus: money(event, fields.estimate, formatter),
    analysts: coherentEarningsValue(event, fields.analysts),
    low,
    high,
    position: position(low, high, estimate),
    lowText: low == null ? "" : formatter(low),
    highText: high == null ? "" : formatter(high),
    yearAgo: money(event, fields.yearAgo, formatter),
    growth: coherentEarningsValue(event, fields.growth),
    trend,
    revisions,
  };
}

function timingLabel(event: EarningsEvent): string | null {
  switch (event.timing) {
    case "BMO":
      return "before open";
    case "AMC":
      return "after close";
    case "TNS":
      return "time not supplied";
    default:
      return event.earningsCallDate
        ? `call ${event.earningsCallDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : null;
  }
}

/** Yahoo labels forecast periods relative to now; say what they mean. */
const PERIOD_LABELS: Record<string, string> = {
  "0q": "current quarter",
  "+1q": "next quarter",
  "0y": "current year",
  "+1y": "next year",
};

export function buildEarningsDetail(event: EarningsEvent): EarningsDetail {
  const date = event.earningsDate;
  const period = earningsForecastPeriod(event);
  return {
    symbol: event.symbol,
    name: event.name,
    date: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
    timing: timingLabel(event),
    dateStatus: event.isDateEstimate == null ? null : event.isDateEstimate ? "estimated" : "confirmed",
    period: period ? `${PERIOD_LABELS[period.period] ?? period.period} ending ${period.periodEndDate}` : null,
    eps: block(
      event,
      "EPS",
      { estimate: "epsEstimate", low: "epsLow", high: "epsHigh", yearAgo: "epsYearAgo", growth: "epsGrowth", analysts: "epsAnalysts" },
      (value) => formatNumber(value, 2),
      true,
    ),
    revenue: block(
      event,
      "Revenue",
      { estimate: "revenueEstimate", low: "revenueLow", high: "revenueHigh", yearAgo: "revenueYearAgo", growth: "revenueGrowth", analysts: "revenueAnalysts" },
      formatCompact,
      false,
    ),
  };
}

/** `├────●───┤` with the marker at `position`, `width` cells wide. */
export function rangeBar(position: number, width: number): string {
  const inner = Math.max(3, width - 2);
  const marker = Math.round(position * (inner - 1));
  let bar = "";
  for (let index = 0; index < inner; index += 1) bar += index === marker ? "●" : "─";
  return `├${bar}┤`;
}

/** Year-over-year growth as a signed percent with one decimal. */
export function formatGrowth(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}
