import { useCallback } from "react";
import { ApiRequestError } from "../../../api-client/errors";
import { useAsyncResource } from "../../../react/async-resource";
import { usePaneTicker } from "../../../state/app/context";
import { isCloudSessionRequired } from "./research-cloud-session";

function discardDeniedResearch(error: unknown): boolean {
  return (error instanceof ApiRequestError && [401, 402, 403].includes(error.status ?? 0))
    || isCloudSessionRequired(error instanceof Error ? error.message : String(error));
}

export function useBoundTicker() {
  const { symbol, ticker } = usePaneTicker();
  return {
    symbol,
    ticker,
    exchange: ticker?.metadata.exchange ?? "",
    currency: ticker?.metadata.currency ?? "USD",
  };
}

export function useTickerRequest<T>(
  loader: (symbol: string, exchange: string, forceRefresh: boolean) => Promise<T>,
  symbol: string | null,
  exchange: string,
) {
  const request = useCallback((force: boolean) => loader(symbol!, exchange, force), [exchange, loader, symbol]);
  const { data, loading, error, reload } = useAsyncResource(symbol ? request : null, { clearOnError: discardDeniedResearch });
  return { data, loading, error: symbol ? error : "No ticker selected", reload };
}

export function formatDateTime(date: Date): string {
  const iso = date.toISOString();
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
  return hasTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
}
