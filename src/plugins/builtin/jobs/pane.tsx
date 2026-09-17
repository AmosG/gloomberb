import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudJobsSummaryPayload } from "../../../api-client/types";
import {
  Badge,
  Button,
  DataTableView,
  EmptyState,
  PaneStatusBody,
  SectionHeading,
  StaticChartSurface,
  Tabs,
  usePaneFooter,
  usePaneTicker,
  type DataTableCell,
  type PaneFooterSegment,
} from "../../../components";
import { resolveChartPalette } from "../../../components/chart/core/palette";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { blendHex, colors } from "../../../theme/colors";
import { Box, Text, TextAttributes, useRendererHost, useUiCapabilities } from "../../../ui";
import { formatCompact, formatNumber } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { SignInWall } from "../cloud/auth-actions";
import { useCloudPlanAction, useCloudUpgradeAction } from "../shared/cloud-upgrade";
import { usePlanAccess } from "../shared/plan-access";
import { usePluginPaneState, usePluginTickerActions } from "../../runtime";
import { fetchJobs, fetchJobsMovers, type JobsCompanyState } from "./client";
import {
  DEFAULT_MOVER_SORT,
  DEFAULT_POSTING_SORT,
  buildMoverColumns,
  buildMoverRows,
  buildPostingColumns,
  buildPostingRows,
  buildShareBars,
  changeTone,
  formatChange,
  formatCollectedAgo,
  formatSalaryRange,
  formatShare,
  moversHaveWeekHistory,
  nextMoverSort,
  nextPostingSort,
  primaryChart,
  sortMoverRows,
  sortPostingRows,
  type MoverColumn,
  type MoverRow,
  type MoverSort,
  type PostingColumn,
  type PostingRow,
  type PostingSort,
} from "./model";
import { ShareBars } from "./share-bars";

export const JOBS_PANE_ID = "jobs";

const PENDING_POLL_MS = 20_000;
const VENDOR_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  workday: "Workday",
  oracle: "Oracle",
  eightfold: "Eightfold",
  phenom: "Phenom",
  bamboohr: "BambooHR",
  recruitee: "Recruitee",
  icims: "iCIMS",
  successfactors: "SuccessFactors",
  jobvite: "Jobvite",
  jsonld: "careers site",
};

type DetailTab = "roles" | "locations" | "seniority" | "salary";

function toneColor(tone: "positive" | "negative" | "neutral"): string {
  return tone === "positive" ? colors.positive : tone === "negative" ? colors.negative : colors.textDim;
}

/** One headline figure: a big number with a small label under it. */
function Stat({ label, value, detail, color, width }: { label: string; value: string; detail?: string; color?: string; width: number }) {
  return (
    <Box flexDirection="column" width={width} flexShrink={0} overflow="hidden">
      <Box height={1} flexDirection="row">
        <Text fg={color ?? colors.textBright} attributes={TextAttributes.BOLD}>{value}</Text>
        {detail ? <Text fg={colors.textDim}>{`  ${detail}`}</Text> : null}
      </Box>
      <Box height={1}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
    </Box>
  );
}

function ProWall({ action }: { action: string }) {
  const openUpgrade = useCloudUpgradeAction();
  const openPlan = useCloudPlanAction();
  return (
    <Box flexDirection="column" paddingX={1}>
      <EmptyState
        title="Hiring data is part of Gloom Cloud Pro."
        message={`Gloomberb reads every listed company's own careers system daily: open roles over time, hiring by function and location, new roles, and pay ranges. ${action}`}
        actions={<>
          <Button label="Upgrade to Pro" onPress={openUpgrade} />
          <Button label="Manage account" variant="secondary" onPress={openPlan} />
        </>}
      />
    </Box>
  );
}

// Company view ----------------------------------------------------------------

function CompanyHeader({ summary, width }: { summary: CloudJobsSummaryPayload; width: number }) {
  const history = summary.change30d;
  const trend = history ?? null;
  const columns = Math.max(2, Math.min(5, Math.floor(width / 18)));
  const statWidth = Math.floor((width - 2) / columns);
  // Details only fit beside the figure on a roomy column.
  const roomy = statWidth >= 26;
  const stats: Array<{ label: string; value: string; detail?: string; color?: string }> = [
    {
      label: "open roles",
      value: formatNumber(summary.openCount, 0),
      detail: roomy && summary.openPerThousandEmployees != null ? `${formatNumber(summary.openPerThousandEmployees, 1)}/1k staff` : undefined,
    },
    trend
      ? { label: "30 days", value: formatChange(trend), color: toneColor(changeTone(trend.count)) }
      : summary.postingVelocity
        ? {
            label: "posting pace",
            value: summary.postingVelocity.percent != null
              ? `${summary.postingVelocity.percent > 0 ? "+" : ""}${formatNumber(summary.postingVelocity.percent, 0)}%`
              : `${summary.postingVelocity.recent} vs ${summary.postingVelocity.prior}`,
            detail: roomy ? "30d vs prior 30d" : undefined,
            color: toneColor(changeTone(summary.postingVelocity.percent)),
          }
        : summary.posted30d != null
          ? { label: "posted last 30d", value: formatNumber(summary.posted30d, 0) }
          : { label: "closed 30d", value: formatNumber(summary.closed30d, 0) },
    { label: "new this week", value: formatNumber(summary.new7d, 0), detail: roomy && summary.coverage.daysObserved <= 1 ? "first read" : undefined },
    { label: "remote", value: summary.remoteShare != null ? formatShare(summary.remoteShare) : "-" },
    { label: "median age", value: summary.medianAgeDays != null ? `${summary.medianAgeDays}d` : "-" },
  ];
  return (
    <Box flexDirection="row" paddingX={1} height={2} flexShrink={0}>
      {stats.slice(0, columns).map((stat) => (
        <Stat key={stat.label} {...stat} width={statWidth} />
      ))}
    </Box>
  );
}

function Chart({ summary, width, height }: { summary: CloudJobsSummaryPayload; width: number; height: number }) {
  const chart = useMemo(() => primaryChart(summary), [summary]);
  const tone = chart.kind === "history" ? changeTone(summary.change30d?.count ?? summary.change90d?.count) : "neutral";
  const accent = tone === "positive" ? colors.positive : tone === "negative" ? colors.negative : colors.borderFocused;
  const palette = {
    ...resolveChartPalette(colors, tone),
    lineColor: accent,
    fillColor: blendHex(colors.bg, accent, 0.22),
    gridColor: blendHex(colors.bg, colors.border, 0.55),
  };
  if (chart.points.length < 2) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" paddingX={1}>
        <Text fg={colors.textDim}>
          {chart.kind === "history"
            ? "The open-roles history starts today."
            : summary.datesReliable === false
              ? "This careers system re-dates roles on refresh, so posting dates are not shown; the history builds from today."
              : "Posting dates are not published by this careers system; the history builds from today."}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1} paddingX={1} flexDirection="row">
        <Text fg={colors.textDim} attributes={TextAttributes.BOLD}>{chart.title}</Text>
        {chart.kind === "intake" ? <Text fg={colors.textMuted}>{"  open roles by posting week"}</Text> : null}
      </Box>
      <StaticChartSurface
        points={chart.points}
        width={Math.max(20, width - 2)}
        height={Math.max(3, height - 1)}
        mode="area"
        calendarSpaced
        colors={palette}
        showTimeAxis
        timeAxisColor={colors.textDim}
        yAxisColor={colors.textDim}
        formatYAxisValue={(value: number) => formatCompact(Math.round(value))}
      />
    </Box>
  );
}

function Signals({ summary }: { summary: CloudJobsSummaryPayload }) {
  const tags = summary.tags.filter((tag) => tag.count >= Math.max(2, summary.openCount * 0.02)).slice(0, 6);
  if (tags.length === 0) return null;
  return (
    <Box flexDirection="row" paddingX={1} height={1} gap={1} overflow="hidden">
      {tags.map((tag) => (
        <Badge key={tag.id} label={`${tag.label} ${tag.count}`} tone={tag.id === "ai_ml" ? "accent" : "neutral"} />
      ))}
    </Box>
  );
}

function SalaryPanel({ summary, width }: { summary: CloudJobsSummaryPayload; width: number }) {
  const salary = summary.salary;
  if (!salary) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text fg={colors.textDim}>No pay ranges in the postings collected so far.</Text>
      </Box>
    );
  }
  const rows = buildShareBars(
    salary.byFunction.map((band) => ({ id: band.id, label: band.label, count: band.count, share: band.count / salary.count, previous: null })),
    8,
  );
  const bandFor = new Map(salary.byFunction.map((band) => [band.id, band]));
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box height={1} flexDirection="row">
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {formatSalaryRange(salary.medianMin, salary.medianMax, salary.currency, salary.period)}
        </Text>
        <Text fg={colors.textDim}>{`  median range across ${formatNumber(salary.count, 0)} postings with published pay`}</Text>
      </Box>
      <Box height={1} />
      {rows.filter((row) => row.key !== "rest").map((row) => {
        const band = bandFor.get(row.key);
        return (
          <Box key={row.key} flexDirection="row" height={1}>
            <Box width={Math.min(20, Math.floor(width * 0.3))} flexShrink={0} overflow="hidden">
              <Text fg={colors.text}>{row.label}</Text>
            </Box>
            <Box width={22} flexShrink={0}>
              <Text fg={colors.textBright}>{band ? formatSalaryRange(band.medianMin, band.medianMax, salary.currency, salary.period) : ""}</Text>
            </Box>
            <Text fg={colors.textDim}>{`${row.count} postings`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function CompanyView({
  summary,
  width,
  height,
  focused,
  loading,
  error,
  reload,
  registrationId,
}: {
  summary: CloudJobsSummaryPayload;
  width: number;
  height: number;
  focused: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
  registrationId: string;
}) {
  const { nativePaneChrome } = useUiCapabilities();
  const rendererHost = useRendererHost();
  const [tab, setTab] = usePluginPaneState<DetailTab>("jobs:tab", "roles");
  const [sort, setSort] = usePluginPaneState<PostingSort>("jobs:sort", DEFAULT_POSTING_SORT);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const rows = useMemo(() => sortPostingRows(buildPostingRows(summary.recent), sort), [summary, sort]);
  const hasSalary = summary.recent.some((posting) => posting.salaryMin != null || posting.salaryMax != null);
  const columns = useMemo(() => buildPostingColumns(width, hasSalary), [width, hasSalary]);
  const functionRows = useMemo(() => buildShareBars(summary.functions, 7), [summary]);
  const countryRows = useMemo(() => buildShareBars(summary.countries, 10), [summary]);
  const seniorityRows = useMemo(() => buildShareBars(summary.seniority, 8), [summary]);

  const selected = rows[Math.min(selectedIdx, rows.length - 1)] ?? null;
  const openSelected = useCallback(() => {
    if (selected?.posting.url) void rendererHost.openExternal(selected.posting.url);
  }, [rendererHost, selected]);

  useShortcut((event) => {
    if (!focused) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      reload();
    } else if (isPlainKey(event, "o") && tab === "roles") {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
    } else if (isPlainKey(event, "c") && summary.coverage.careersUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      void rendererHost.openExternal(summary.coverage.careersUrl);
    }
  });

  usePaneFooter(registrationId, () => {
    const info: PaneFooterSegment[] = [];
    if (loading) info.push({ id: "loading", parts: [{ text: "refreshing", tone: "muted" }] });
    if (error) info.push({ id: "error", parts: [{ text: error.slice(0, 60), tone: "warning" }] });
    const vendor = summary.coverage.vendor ? VENDOR_LABELS[summary.coverage.vendor] ?? summary.coverage.vendor : null;
    const collected = formatCollectedAgo(summary.coverage.lastCollectedAt);
    if (vendor || collected) {
      info.push({ id: "source", parts: [{ text: [vendor, collected && `read ${collected}`].filter(Boolean).join(" · "), tone: "muted" }] });
    }
    if (summary.coverage.daysObserved > 1) {
      info.push({ id: "history", parts: [{ text: `${summary.coverage.daysObserved}d of history`, tone: "muted" }] });
    }
    const hints = [
      ...(tab === "roles" && selected?.posting.url ? [{ id: "open", key: "o", label: "pen role", onPress: openSelected }] : []),
      ...(summary.coverage.careersUrl
        ? [{ id: "careers", key: "c", label: "areers site", onPress: () => void rendererHost.openExternal(summary.coverage.careersUrl!) }]
        : []),
    ];
    return { info, hints };
  }, [loading, error, summary, tab, selected, openSelected, rendererHost]);

  const renderCell = useCallback((row: PostingRow, column: PostingColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "title":
        return { text: row.title, color: selectedColor ?? colors.textBright };
      case "function":
        return { text: row.seniority && width >= 96 ? `${row.function} · ${row.seniority}` : row.function, color: selectedColor ?? colors.text };
      case "location":
        return { text: row.location, color: selectedColor ?? colors.textDim };
      case "posted":
        return { text: row.posted, color: selectedColor ?? (row.posting.postedAt && !row.posted.includes("mo") ? colors.text : colors.textDim) };
      case "salary":
        return { text: row.salary, color: selectedColor ?? colors.positive };
    }
  }, [width]);

  const wide = width >= 96;
  const headerHeight = 2;
  const signalsHeight = summary.tags.length > 0 ? 1 : 0;
  const upperHeight = Math.max(8, Math.min(12, Math.floor((height - headerHeight - signalsHeight) * 0.42)));
  const lowerHeight = Math.max(4, height - headerHeight - signalsHeight - upperHeight - 2 - (nativePaneChrome ? 1 : 0));
  const chartWidth = wide ? Math.floor(width * 0.58) : width;
  const barsWidth = wide ? width - chartWidth - 1 : width;

  const tabs = [
    { label: `Roles ${summary.recent.length < summary.openCount ? `${summary.recent.length} of ${formatCompact(summary.openCount)}` : summary.openCount}`, value: "roles" },
    { label: "Locations", value: "locations" },
    { label: "Seniority", value: "seniority" },
    { label: "Pay", value: "salary" },
  ];

  return (
    <Box flexDirection="column" width={width} height={height}>
      <CompanyHeader summary={summary} width={width} />
      <Box flexDirection="row" height={upperHeight} flexShrink={0} marginTop={1}>
        <Chart summary={summary} width={chartWidth} height={upperHeight} />
        {wide ? (
          <Box flexDirection="column" width={barsWidth} paddingX={1}>
            <SectionHeading title="By function" />
            <ShareBars rows={functionRows} width={barsWidth - 2} showDelta />
          </Box>
        ) : null}
      </Box>
      {signalsHeight ? <Signals summary={summary} /> : null}
      <Box height={1} paddingX={1} marginTop={1}>
        <Tabs tabs={tabs} activeValue={tab} onSelect={(value) => setTab(value as DetailTab)} compact variant="underline" focused={focused} />
      </Box>
      <Box flexGrow={1} height={lowerHeight}>
        {tab === "roles" ? (
          <DataTableView<PostingRow, PostingColumn>
            focused={focused}
            selection={{ kind: "index", selectedIndex: rows.length ? Math.min(selectedIdx, rows.length - 1) : -1, onChange: setSelectedIdx }}
            onActivate={() => openSelected()}
            rootWidth={width}
            rootHeight={lowerHeight}
            columns={columns}
            freezeFirstColumn
            items={rows}
            sortColumnId={sort.columnId}
            sortDirection={sort.direction}
            onHeaderClick={(columnId) => setSort((current) => nextPostingSort(current, columnId))}
            getItemKey={(row) => row.key}
            renderCell={renderCell}
            emptyStateTitle="No open roles"
          />
        ) : tab === "locations" ? (
          <Box flexDirection="column" paddingX={1} paddingTop={1}>
            {countryRows.length === 0
              ? <Text fg={colors.textDim}>No locations in the postings collected so far.</Text>
              : <ShareBars rows={countryRows} width={Math.min(width - 2, 80)} color={colors.warning} />}
          </Box>
        ) : tab === "seniority" ? (
          <Box flexDirection="column" paddingX={1} paddingTop={1}>
            <ShareBars rows={seniorityRows} width={Math.min(width - 2, 80)} color={colors.neutral} showDelta />
            {!wide ? (
              <Box flexDirection="column" marginTop={1}>
                <SectionHeading title="By function" />
                <ShareBars rows={functionRows} width={Math.min(width - 2, 80)} showDelta />
              </Box>
            ) : null}
          </Box>
        ) : (
          <SalaryPanel summary={summary} width={width} />
        )}
      </Box>
    </Box>
  );
}

// Movers view ------------------------------------------------------------------

function MoversView({ width, height, focused, registrationId }: { width: number; height: number; focused: boolean; registrationId: string }) {
  const { nativePaneChrome } = useUiCapabilities();
  const { navigateTicker } = usePluginTickerActions();
  const request = useCallback(() => fetchJobsMovers(), []);
  const resource = useAsyncResource(request);
  const { data, status, error, reload } = resource;
  const [sort, setSort] = usePluginPaneState<MoverSort>("jobs:movers-sort", DEFAULT_MOVER_SORT);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const rows = useMemo(() => sortMoverRows(buildMoverRows(data?.movers ?? []), sort), [data, sort]);
  const hasHistory = rows.some((row) => row.mover.change30d != null);
  const hasWeek = moversHaveWeekHistory(rows);
  const columns = useMemo(() => buildMoverColumns(width, hasHistory, hasWeek), [width, hasHistory, hasWeek]);

  useShortcut((event) => {
    if (!focused) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      reload();
    }
  });

  usePaneFooter(registrationId, () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: error.slice(0, 60), tone: "warning" as const }] }] : []),
      ...(data ? [{ id: "covered", parts: [{ text: `${formatNumber(data.covered, 0)} companies covered`, tone: "muted" as const }] }] : []),
    ],
  }), [status, error, data]);

  const renderCell = useCallback((row: MoverRow, column: MoverColumn, _index: number, rowState: { selected: boolean }): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "ticker":
        return { text: row.ticker, color: selectedColor ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "company":
        return { text: row.company, color: selectedColor ?? colors.text };
      case "open":
        return { text: row.open, color: selectedColor ?? colors.textBright };
      case "change":
        return { text: row.change, color: selectedColor ?? toneColor(changeTone(row.changeValue)) };
      case "velocity":
        return { text: row.velocity, color: selectedColor ?? toneColor(changeTone(row.velocityValue)) };
      case "new7d":
        return { text: row.new7d, color: selectedColor ?? colors.text };
      case "function":
        return { text: row.function, color: selectedColor ?? colors.textDim };
    }
  }, []);

  if (status === "loading" && !data) return <PaneStatusBody loading align="center" loadingLabel="Loading hiring data..." />;
  if (status === "error" && !data) return <PaneStatusBody error={error ?? "Could not load hiring data."} errorTitle="Could not load hiring data." />;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<MoverRow, MoverColumn>
        focused={focused}
        selection={{ kind: "index", selectedIndex: rows.length ? Math.min(selectedIdx, rows.length - 1) : -1, onChange: setSelectedIdx }}
        onActivate={(row) => navigateTicker(row.ticker)}
        rootWidth={width}
        rootHeight={Math.max(3, height - (nativePaneChrome ? 1 : 0))}
        columns={columns}
        freezeFirstColumn
        items={rows}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={(columnId) => setSort((current) => nextMoverSort(current, columnId))}
        getItemKey={(row) => row.key}
        renderCell={renderCell}
        emptyStateTitle={status === "loading" ? "Loading..." : "No companies covered yet"}
      />
    </Box>
  );
}

// Pane ----------------------------------------------------------------------

export interface JobsViewProps {
  width: number;
  height: number;
  focused: boolean;
  /** The research tab always shows the company; the pane shows movers when unbound. */
  companyOnly?: boolean;
}

export function JobsView({ width, height, focused, companyOnly = false }: JobsViewProps) {
  const { ticker } = usePaneTicker();
  const symbol = ticker?.metadata.ticker ?? null;
  const companyName = ticker?.metadata.name ?? null;
  const access = usePlanAccess();
  const registrationId = JOBS_PANE_ID;

  const request = useCallback(
    (force: boolean) => fetchJobs(symbol!, { name: companyName, force }),
    [symbol, companyName],
  );
  const resource = useAsyncResource<JobsCompanyState>(symbol ? request : null);
  const { data, status, error, reload } = resource;

  // While the server is looking for the company, ask again on a timer.
  useEffect(() => {
    if (data?.kind !== "pending") return;
    const timer = setTimeout(() => reload(), PENDING_POLL_MS);
    return () => clearTimeout(timer);
  }, [data, reload]);

  const deniedStatus = data?.kind === "denied" ? data.status : null;
  const signInRequired = !access.signedIn || deniedStatus === 401;
  const verificationRequired = !signInRequired && (!access.emailVerified || deniedStatus === 403);
  const proRequired = !signInRequired && !verificationRequired && (!access.hasProAccess || deniedStatus === 402);

  if (signInRequired || verificationRequired) {
    return <SignInWall action="see who is hiring" needsVerification={verificationRequired} />;
  }
  if (proRequired) {
    return <ProWall action={symbol ? `Open ${symbol}'s hiring picture with Pro.` : ""} />;
  }

  if (!symbol) {
    if (companyOnly) return <EmptyState title="No ticker selected." message="Select a ticker to see its hiring." />;
    return <MoversView width={width} height={height} focused={focused} registrationId={registrationId} />;
  }

  if ((status === "idle" || status === "loading") && !data) {
    return <PaneStatusBody loading align="center" loadingLabel={`Loading ${symbol} hiring...`} />;
  }
  if (status === "error" && !data) {
    return <PaneStatusBody error={error ?? "Could not load hiring data."} errorTitle="Could not load hiring data." actions={<Button label="Try again" onPress={reload} />} />;
  }
  if (!data || data.kind === "denied") return null;

  if (data.kind === "pending") {
    return (
      <PaneStatusBody
        loading
        align="center"
        loadingLabel={`Looking for ${symbol}'s careers system. First read lands within a few minutes.`}
      />
    );
  }
  if (data.kind === "uncovered") {
    return (
      <EmptyState
        title={`No careers system found for ${symbol}.`}
        message="Gloomberb reads companies' own careers systems. This one either has none we can read or lists roles only on third-party job boards."
        actions={<Button label="Look again" onPress={reload} />}
      />
    );
  }

  return (
    <CompanyView
      summary={data.summary}
      width={width}
      height={height}
      focused={focused}
      loading={status === "loading"}
      error={status === "error" ? error : null}
      reload={reload}
      registrationId={registrationId}
    />
  );
}

export function JobsPane(props: { width: number; height: number; focused: boolean }) {
  return <JobsView {...props} />;
}

export function JobsResearchTab(props: { width: number; height: number; focused: boolean }) {
  return <JobsView {...props} companyOnly />;
}
