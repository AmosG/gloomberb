import { resolveCurrencyUnit } from "./currency-units";
import { formatCompact, formatCurrency, formatNumber } from "./format";

/** Keep reported monetary amounts in their own units, independently of a quote. */
export function formatReportedMoney(value: number | undefined, currency?: string, perShare = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const amount = perShare ? formatNumber(value, 2) : formatCompact(value);
  const unit = currency?.trim();
  if (!unit) return `${amount} (ccy?)`;
  // Intl uppercases currency codes: GBp must not become GBP without scaling.
  if (perShare && /^[a-z]{3}$/i.test(unit) && resolveCurrencyUnit(unit).divisor === 1) {
    return formatCurrency(value, unit);
  }
  return `${amount} ${unit}`;
}
