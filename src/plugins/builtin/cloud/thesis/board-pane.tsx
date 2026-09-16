import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiClient, type CloudThesis } from "../../../../api-client";
import {
  DataTableStackView,
  PaneStatusBody,
  usePaneFooter,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
  type PaneHint,
} from "../../../../components";
import { useShortcut } from "../../../../react/input";
import { usePaneStateValue } from "../../../../state/app/context";
import { colors } from "../../../../theme/colors";
import type { PaneProps } from "../../../../types/plugin";
import { Box, TextAttributes } from "../../../../ui";
import { useDialog } from "../../../../ui/dialog";
import { formatCompactCurrency } from "../../../../utils/format";
import { isPlainKey } from "../../../../utils/keyboard";
import { usePluginAppActions } from "../../../runtime";
import { SignInWall } from "../auth-actions";
import { useCloudUpgradeAction } from "../../shared/cloud-upgrade";
import { usePlanAccess } from "../../shared/plan-access";
import { teamStore } from "../team/store";
import { ThesisDetail } from "./detail";
import { useBookExposure } from "./exposure";
import * as flows from "./flows";
import {
  attentionReason,
  boardGroup,
  bookAtRisk,
  convictionRows,
  daysSince,
  daysUntil,
  describeAttention,
  describeDays,
  groupLabel,
  healthLabel,
  nextCatalyst,
  sortForBoard,
  thesesCovering,
  thesisExposure,
  untrackedSymbols,
  type BoardGroup,
} from "./model";
import { promptChoice, promptText } from "./prompts";
import { consumeRequestedThesis, subscribeRequestedThesis, type ThesisPaneRequest } from "./pane-request";
import { thesisStore } from "./store";

export const THESIS_PANE_ID = "thesis-board";

type BoardItem =
  | { kind: "header"; id: string; group: BoardGroup | "untracked" }
  | { kind: "thesis"; id: string; group: BoardGroup; thesis: CloudThesis }
  | { kind: "untracked"; id: string; group: "untracked"; symbol: string };

/** Rows grouped under one header item per group; the table draws headers in place of a row. */
function withHeaders(items: readonly BoardItem[]): BoardItem[] {
  const out: BoardItem[] = [];
  let group: BoardItem["group"] | null = null;
  for (const item of items) {
    if (item.group !== group) {
      group = item.group;
      out.push({ kind: "header", id: `header:${group}`, group });
    }
    out.push(item);
  }
  return out;
}

type BoardColumnId = "title" | "health" | "conviction" | "signals" | "weight" | "reviewed" | "catalyst" | "owner";
type WeightColumnId = "title" | "conviction" | "weight" | "value" | "gap";
type BoardColumn = DataTableColumn & { id: BoardColumnId | WeightColumnId };

function boardColumns(width: number, showOwner: boolean): BoardColumn[] {
  const narrow = width < 90;
  return [
    { id: "title", label: "Thesis", width: narrow ? 18 : 26, align: "left", flexGrow: 1 },
    { id: "health", label: "Health", width: 10, align: "left" },
    { id: "conviction", label: "Conv", width: 4, align: "right" },
    { id: "signals", label: "Open", width: 4, align: "right" },
    { id: "weight", label: "Weight", width: 7, align: "right" },
    ...(narrow ? [] : [{ id: "reviewed" as const, label: "Reviewed", width: 9, align: "right" as const }]),
    { id: "catalyst", label: "Next catalyst", width: narrow ? 14 : 22, align: "left" },
    ...(showOwner && !narrow ? [{ id: "owner" as const, label: "Owner", width: 10, align: "left" as const }] : []),
  ];
}

function weightColumns(): BoardColumn[] {
  return [
    { id: "title", label: "Thesis", width: 26, align: "left", flexGrow: 1 },
    { id: "conviction", label: "Conv", width: 4, align: "right" },
    { id: "weight", label: "Weight", width: 7, align: "right" },
    { id: "value", label: "Value", width: 12, align: "right" },
    { id: "gap", label: "Gap", width: 14, align: "left" },
  ];
}

function relative(iso: string | null): string {
  const days = daysSince(iso);
  if (days === null) return "never";
  return days === 0 ? "today" : `${days}d`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

export function ThesisBoardPane({ focused, width, height }: PaneProps) {
  const dialog = useDialog();
  const { notify } = usePluginAppActions();
  const plan = usePlanAccess();
  const openUpgrade = useCloudUpgradeAction();
  const snapshot = useSyncExternalStore((onChange) => thesisStore.subscribe(onChange), () => thesisStore.getSnapshot());
  const teams = useSyncExternalStore((onChange) => teamStore.subscribe(onChange), () => teamStore.getSnapshot()).teams;
  const signedIn = useSyncExternalStore((onChange) => apiClient.subscribeCurrentUser(onChange), () => apiClient.isVerified());
  const exposure = useBookExposure();
  const [openId, setOpenId] = usePaneStateValue<string | null>("openId", null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = usePaneStateValue<"board" | "weights">("mode", "board");
  const [busy, setBusy] = useState(false);

  const ctx = useMemo<flows.FlowContext>(() => ({ dialog, notify, hasProAccess: plan.hasProAccess, openUpgrade }), [dialog, notify, openUpgrade, plan.hasProAccess]);

  const exposures = useMemo(
    () => snapshot.theses.map((thesis) => thesisExposure(thesis, exposure.bySymbol, exposure.bookValue)),
    [exposure.bookValue, exposure.bySymbol, snapshot.theses],
  );
  const exposureById = useMemo(() => new Map(exposures.map((entry) => [entry.thesis.id, entry])), [exposures]);
  const atRisk = useMemo(() => bookAtRisk(exposures), [exposures]);
  const untracked = useMemo(
    () => untrackedSymbols(new Map(exposure.heldTickers.map((ticker) => [ticker.metadata.ticker, ticker])), snapshot.theses),
    [exposure.heldTickers, snapshot.theses],
  );

  const boardItems = useMemo<BoardItem[]>(() => withHeaders([
    ...sortForBoard(snapshot.theses).map((thesis): BoardItem => ({ kind: "thesis", id: thesis.id, group: boardGroup(thesis), thesis })),
    ...untracked.map((symbol): BoardItem => ({ kind: "untracked", id: `untracked:${symbol}`, group: "untracked", symbol })),
  ]), [snapshot.theses, untracked]);
  const weightItems = useMemo(() => convictionRows(exposures), [exposures]);

  const openThesis = openId ? thesisStore.get(openId) : null;
  useEffect(() => {
    if (openId && !openThesis && snapshot.loaded) setOpenId(null);
  }, [openId, openThesis, setOpenId, snapshot.loaded]);

  // The THESIS command and notifications ask for a specific thesis or symbol.
  const applyRequest = useCallback((request: ThesisPaneRequest) => {
    if (request.thesisId) {
      setOpenId(request.thesisId);
      return;
    }
    if (request.symbol) {
      const covering = thesesCovering(thesisStore.getSnapshot().theses, request.symbol);
      if (covering[0]) setOpenId(covering[0].id);
      else setSelectedId(`untracked:${request.symbol.toUpperCase()}`);
    }
  }, [setOpenId]);
  useEffect(() => {
    const pending = consumeRequestedThesis();
    if (pending) applyRequest(pending);
    return subscribeRequestedThesis(applyRequest);
  }, [applyRequest]);

  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const startFor = useCallback((symbol?: string) => run(async () => {
    const chosen = symbol ?? (await promptText(dialog, { label: "Thesis on which ticker?", placeholder: "NVDA" }))?.toUpperCase();
    if (!chosen) return;
    let scope: { scope: "user" } | { scope: "team"; teamId: string } = { scope: "user" };
    if (teams.length > 0) {
      const owner = await promptChoice(dialog, "Whose thesis?", [
        { id: "user", label: "Mine" },
        ...teams.map((team) => ({ id: team.id, label: team.name, description: "Shared with the team; teammates can challenge it." })),
      ], teamStore.getDefaultTeamId() ?? "user");
      if (!owner) return;
      if (owner !== "user") scope = { scope: "team", teamId: owner };
    }
    const ticker = exposure.heldTickers.find((entry) => entry.metadata.ticker.toUpperCase() === chosen);
    const thesis = await flows.startThesis(ctx, {
      symbol: chosen,
      exchange: ticker?.metadata.exchange,
      scope,
      held: !!ticker,
    });
    if (thesis) setOpenId(thesis.id);
  }), [ctx, dialog, exposure.heldTickers, run, setOpenId, teams]);

  const activate = useCallback((item: BoardItem) => {
    if (item.kind === "thesis") setOpenId(item.thesis.id);
    else if (item.kind === "untracked") void startFor(item.symbol);
  }, [setOpenId, startFor]);

  useShortcut((event) => {
    if (!focused || openId || busy) return;
    if (isPlainKey(event, "n")) void startFor();
    else if (isPlainKey(event, "w")) setMode(mode === "board" ? "weights" : "board");
    else if (isPlainKey(event, "r")) void thesisStore.refresh();
    else return;
    event.stopPropagation?.();
    event.preventDefault?.();
  });

  const columns = useMemo(
    () => (mode === "weights" ? weightColumns() : boardColumns(width, teams.length > 0)),
    [mode, teams.length, width],
  );

  const renderBoardCell = useCallback((item: BoardItem, column: BoardColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if (item.kind === "header") return { text: "" };
    if (item.kind === "untracked") {
      if (column.id === "title") return { text: item.symbol, color: selectedColor ?? colors.text, attributes: TextAttributes.BOLD };
      if (column.id === "health") return { text: "no thesis", color: selectedColor ?? colors.textDim };
      if (column.id === "weight") {
        const value = exposure.bySymbol.get(item.symbol);
        return { text: value && Number.isFinite(value.value) && exposure.bookValue > 0 ? pct(Math.abs(value.value) / exposure.bookValue) : "", color: selectedColor ?? colors.textDim };
      }
      if (column.id === "catalyst") return { text: "enter to start one", color: selectedColor ?? colors.textMuted };
      return { text: "" };
    }
    const { thesis } = item;
    const reason = attentionReason(thesis);
    switch (column.id) {
      case "title":
        return { text: thesis.title, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "health": {
        const color = thesis.health === "broken" ? colors.negative : thesis.health === "weakening" ? colors.warning : thesis.health === "intact" ? colors.positive : colors.textDim;
        return { text: thesis.status === "closed" ? (thesis.outcome?.verdict ?? "closed") : healthLabel(thesis.health).toLowerCase(), color: selectedColor ?? color };
      }
      case "conviction":
        return { text: String(thesis.conviction), color: selectedColor ?? colors.text };
      case "signals":
        return { text: thesis.openSignals ? String(thesis.openSignals) : "", color: selectedColor ?? colors.warning, attributes: thesis.openSignals ? TextAttributes.BOLD : undefined };
      case "weight": {
        const entry = exposureById.get(thesis.id);
        const text = !entry || thesis.status === "watching" || (entry.missingQuotes && entry.value === 0)
          ? ""
          : entry.weight > 0 ? `${pct(entry.weight)}${entry.hasOptions ? "*" : ""}` : "0%";
        return { text, color: selectedColor ?? colors.text };
      }
      case "reviewed":
        return { text: relative(thesis.reviewedAt), color: selectedColor ?? (reason === "review" ? colors.warning : colors.textDim) };
      case "catalyst": {
        const next = nextCatalyst(thesis.document);
        const days = next?.date ? daysUntil(next.date) : null;
        const text = reason && reason !== "review" && thesis.status !== "closed"
          ? describeAttention(reason, thesis)
          : next ? `${next.text} ${days !== null ? describeDays(days) : ""}`.trim() : "";
        const color = reason === "signals" || reason === "broken" ? colors.negative : reason === "weakening" || reason === "catalyst" ? colors.warning : days !== null && days <= 14 ? colors.warning : colors.textDim;
        return { text, color: selectedColor ?? color };
      }
      case "owner": {
        const team = thesis.owner.kind === "team" ? teamStore.getTeam(thesis.owner.id) : null;
        return { text: team ? team.shortName ?? team.name : "", color: selectedColor ?? colors.textDim };
      }
      default:
        return { text: "" };
    }
  }, [exposure.bookValue, exposure.bySymbol, exposureById]);

  const renderWeightCell = useCallback((row: ReturnType<typeof convictionRows>[number], column: BoardColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "title":
        return { text: row.thesis.title, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "conviction":
        return { text: String(row.conviction), color: selectedColor ?? colors.text };
      case "weight":
        return { text: `${pct(row.weight)}${row.hasOptions ? "*" : ""}`, color: selectedColor ?? colors.text };
      case "value":
        return { text: formatCompactCurrency(row.value, exposure.baseCurrency), color: selectedColor ?? colors.textDim };
      case "gap": {
        const text = row.gap > 0 ? "under-sized" : row.gap < 0 ? "grew big" : "in line";
        const color = row.gap > 0 ? colors.warning : row.gap < 0 ? colors.negative : colors.textDim;
        return { text: row.gap === 0 ? text : `${text} (${row.gap > 0 ? "+" : ""}${row.gap})`, color: selectedColor ?? color };
      }
      default:
        return { text: "" };
    }
  }, [exposure.baseCurrency]);

  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const segments: PaneFooterSegment[] = [];
    if (snapshot.loading) segments.push({ id: "loading", parts: [{ text: "loading", tone: "muted" }] });
    if (snapshot.offline) segments.push({ id: "offline", parts: [{ text: "offline copy", tone: "warning" }] });
    if (snapshot.error && !snapshot.offline) segments.push({ id: "error", parts: [{ text: snapshot.error, tone: "warning" }] });
    if (exposure.bookValue > 0 && snapshot.theses.length > 0) {
      segments.push({
        id: "risk",
        parts: [
          { text: "at risk", tone: "label" },
          { text: pct(atRisk), tone: atRisk >= 0.25 ? "negative" : atRisk > 0 ? "warning" : "muted" },
        ],
        title: "Share of the book on weakening or broken theses",
      });
    }
    if (untracked.length > 0 && mode === "board") {
      segments.push({ id: "untracked", parts: [{ text: `${untracked.length} without a thesis`, tone: "muted" }] });
    }
    if (exposures.some((entry) => entry.hasOptions)) {
      segments.push({ id: "options", parts: [{ text: "* includes option premium", tone: "muted" }] });
    }
    return segments;
  }, [atRisk, exposure.bookValue, exposures, mode, snapshot.error, snapshot.loading, snapshot.offline, snapshot.theses.length, untracked.length]);

  const hints = useMemo<PaneHint[]>(() => [
    { id: "new", key: "n", label: "New", onPress: () => void startFor() },
    { id: "mode", key: "w", label: mode === "board" ? "Weights" : "Board", onPress: () => setMode(mode === "board" ? "weights" : "board") },
  ], [mode, setMode, startFor]);

  usePaneFooter("thesis-board", () => (openId || !signedIn ? null : { info: footerInfo, hints }), [footerInfo, hints, openId, signedIn]);

  const handleDetailKeyDown = useCallback((_event: DataTableKeyEvent) => false, []);

  if (!signedIn) {
    return <SignInWall action="keep investment theses" hint="Theses are stored in Gloom Cloud so they follow you and your team." />;
  }
  if (!snapshot.loaded && snapshot.theses.length === 0) {
    return <PaneStatusBody loading={snapshot.loading} error={snapshot.error} subject="Theses" />;
  }

  const detail = openThesis ? (
    <ThesisDetail
      thesis={openThesis}
      width={width}
      height={height - 1}
      focused={focused}
      footerId="thesis-board-detail"
      onDeleted={() => setOpenId(null)}
    />
  ) : <Box flexGrow={1} />;

  if (mode === "weights") {
    return (
      <DataTableStackView<ReturnType<typeof convictionRows>[number], BoardColumn>
        focused={focused}
        detailOpen={!!openThesis}
        onBack={() => setOpenId(null)}
        detailContent={detail}
        detailTitle={openThesis?.title}
        onDetailKeyDown={handleDetailKeyDown}
        selection={{ kind: "id", selectedId, getId: (row) => row.thesis.id, onChange: (id) => setSelectedId(id) }}
        onActivate={(row) => setOpenId(row.thesis.id)}
        rootWidth={width}
        rootHeight={height}
        columns={columns}
        items={weightItems}
        sortColumnId={null}
        sortDirection="desc"
        onHeaderClick={() => {}}
        getItemKey={(row) => row.thesis.id}
        renderCell={renderWeightCell}
        emptyStateTitle="No active thesis with a position."
        emptyStateHint="Conviction is compared with weight once a thesis holds something."
        showHorizontalScrollbar={false}
      />
    );
  }

  return (
    <DataTableStackView<BoardItem, BoardColumn>
      focused={focused}
      detailOpen={!!openThesis}
      onBack={() => setOpenId(null)}
      detailContent={detail}
      detailTitle={openThesis?.title}
      onDetailKeyDown={handleDetailKeyDown}
      selection={{ kind: "id", selectedId, getId: (item) => item.id, onChange: (id) => setSelectedId(id) }}
      onActivate={activate}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={boardItems}
      sortColumnId={null}
      sortDirection="desc"
      onHeaderClick={() => {}}
      getItemKey={(item) => item.id}
      renderCell={renderBoardCell}
      isNavigable={(item) => item.kind !== "header"}
      renderSectionHeader={(item) => (item.kind === "header"
        ? { text: item.group === "untracked" ? "Positions without a thesis" : groupLabel(item.group), color: colors.textDim, attributes: TextAttributes.BOLD }
        : null)}
      emptyStateTitle="No theses yet."
      emptyStateHint="Press n, or open a ticker's Thesis tab."
      showHorizontalScrollbar={false}
    />
  );
}
