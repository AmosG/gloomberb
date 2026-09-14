import { useCallback, useRef } from "react";
import {
  TickerListTableView,
  type DataTableKeyEvent,
  type TickerListVisibleRange,
} from "../../../components";
import type { QuoteFlashDirection } from "../../../components/quote-flash";
import { createRowValueCache } from "../../../components/ui/row-value-cache";
import type { ColumnConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getColumnValue, type ColumnContext } from "./metrics";
import { portfolioPnlLabel } from "./position-metrics";

export type { QuoteFlashDirection };

const objectVersions = new WeakMap<object, number>();
let nextObjectVersion = 1;

function objectVersion(value: object | undefined): number {
  if (!value) return 0;
  const existing = objectVersions.get(value);
  if (existing != null) return existing;
  const next = nextObjectVersion;
  nextObjectVersion += 1;
  objectVersions.set(value, next);
  return next;
}

function buildCellVersion(
  column: ColumnConfig,
  ticker: TickerRecord,
  financials: TickerFinancials | undefined,
  context: ColumnContext,
): string {
  const timeSensitiveNow = column.id === "latency" || column.id === "held" ? context.now : 0;
  return [
    column.id,
    objectVersion(ticker),
    objectVersion(financials),
    objectVersion(context.exchangeRates),
    context.activeTab ?? "",
    context.baseCurrency,
    context.portfolioTotalMarketValue ?? 0,
    context.supplementalVersion ?? 0,
    timeSensitiveNow,
  ].join("|");
}

export function PortfolioTickerTable({
  columns,
  focused,
  sortColumnId,
  sortDirection,
  onHeaderClick,
  sortedTickers,
  cursorSymbol,
  setCursorSymbol,
  financialsMap,
  columnContext,
  flashSymbols,
  onRootKeyDown,
  onVisibleRangeChange,
  visibleRangeBuffer,
  resetScrollKey,
  onRowActivate,
  rootHeight,
}: {
  columns: ColumnConfig[];
  focused?: boolean;
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
  onHeaderClick: (columnId: string) => void;
  sortedTickers: TickerRecord[];
  cursorSymbol: string | null;
  setCursorSymbol: (symbol: string) => void;
  financialsMap: Map<string, TickerFinancials>;
  columnContext: ColumnContext;
  flashSymbols: Map<string, QuoteFlashDirection>;
  onRootKeyDown?: (event: DataTableKeyEvent) => boolean | void;
  onVisibleRangeChange?: (range: TickerListVisibleRange) => void;
  visibleRangeBuffer?: number;
  resetScrollKey?: unknown;
  onRowActivate?: (ticker: TickerRecord) => void;
  rootHeight?: number;
}) {
  const cellCacheRef = useRef(createRowValueCache<string, ReturnType<typeof getColumnValue>>(5000));
  const resolveCell = useCallback(
    (column: ColumnConfig, ticker: TickerRecord, financials: TickerFinancials | undefined) => {
      const key = `${ticker.metadata.ticker}:${column.id}`;
      const version = buildCellVersion(column, ticker, financials, columnContext);
      return cellCacheRef.current.get(key, version, () => (
        getColumnValue(column, ticker, financials, columnContext)
      ));
    },
    [columnContext],
  );
  const pnlColumn = columns.find((column) => column.id === "pnl" || column.id === "pnl_pct");
  const pnlLabel = pnlColumn ? portfolioPnlLabel(sortedTickers.map((ticker) =>
    resolveCell({ ...pnlColumn, id: "pnl" }, ticker, financialsMap.get(ticker.metadata.ticker)).pnlBasis ?? "unavailable")) : "P&L";
  const hasNonShareQuantity = sortedTickers.some(ticker => ticker.metadata.positions.some(position =>
    (!columnContext.activeTab || position.portfolio === columnContext.activeTab) && position.shares !== 0 && (position.priceBasis === "percent-of-par" || ticker.metadata.assetCategory?.toUpperCase() === "BOND")));
  const displayColumns = columns.map((column) => column.id === "shares" && hasNonShareQuantity ? { ...column, label: "QTY" }
    : pnlLabel !== "P&L" && (column.id === "pnl" || column.id === "pnl_pct") ? {
    ...column,
    label: column.id === "pnl_pct" ? pnlLabel.replace("P&L", "%") : pnlLabel,
  } : column);

  return (
    <TickerListTableView
      focused={focused}
      columns={displayColumns}
      tickers={sortedTickers}
      cursorSymbol={cursorSymbol}
      setCursorSymbol={setCursorSymbol}
      resolveCell={resolveCell}
      financialsMap={financialsMap}
      flashSymbols={flashSymbols}
      sortColumnId={sortColumnId}
      sortDirection={sortDirection}
      onHeaderClick={onHeaderClick}
      onRootKeyDown={onRootKeyDown}
      onVisibleRangeChange={onVisibleRangeChange}
      visibleRangeBuffer={visibleRangeBuffer}
      resetScrollKey={resetScrollKey}
      onRowActivate={onRowActivate}
      rootHeight={rootHeight}
    />
  );
}
