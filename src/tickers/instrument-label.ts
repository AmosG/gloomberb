import type { BrokerContractRef } from "../types/instrument";

/** Identifying contract terms belong in the existing title, never in a new toolbar. */
export function tickerInstrumentLabel(symbol: string, contract?: BrokerContractRef | null): string {
  if (!contract) return symbol;
  const label = contract.localSymbol || symbol;
  const terms = [contract.lastTradeDateOrContractMonth, contract.right,
    contract.strike != null ? String(contract.strike) : undefined].filter(Boolean);
  return terms.length ? [label, ...terms].join(" ") : label;
}
