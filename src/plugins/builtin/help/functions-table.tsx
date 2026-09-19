/**
 * Help > Functions: every typed prefix the bar understands, as a table.
 *
 * The list is long and the job is scanning one column, so prefix, argument and
 * description get their own columns instead of running together in a row of
 * badges. Enter drops the prefix into the command bar, ready to run.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
} from "../../../components";
import { t } from "../../../i18n";
import { useThemeColors } from "../../../theme/theme-context";
import { TextAttributes } from "../../../ui";
import type { HelpShortcutEntry } from "./components";
import { groupShortcutEntries } from "./shortcut-model";

type FunctionsColumnId = "prefix" | "argument" | "description";
type FunctionsColumn = DataTableColumn & { id: FunctionsColumnId };

type FunctionsRow =
  | { kind: "section"; key: string; label: string }
  | { kind: "entry"; key: string; prefix: string; argument: string; description: string };

const PREFIX_COLUMN_WIDTH = 10;
const ARGUMENT_COLUMN_WIDTH = 16;
/** Below this the argument folds into the prefix column. */
const ARGUMENT_COLUMN_MIN_TABLE_WIDTH = 64;

/** The description column takes whatever the fixed columns leave, via flexGrow. */
function buildColumns(width: number): FunctionsColumn[] {
  return [
    { id: "prefix", label: "FN", width: PREFIX_COLUMN_WIDTH, align: "left" },
    ...(width >= ARGUMENT_COLUMN_MIN_TABLE_WIDTH
      ? [{ id: "argument" as const, label: "ARG", width: ARGUMENT_COLUMN_WIDTH, align: "left" as const }]
      : []),
    { id: "description", label: "OPENS", width: 20, align: "left", flexGrow: 1 },
  ];
}

/**
 * Entry badges are `[prefix]` or `[prefix, <arg>]`; the argument is the one
 * wrapped in angle brackets.
 */
function splitEntryBadges(badges: readonly string[]): { prefix: string; argument: string } {
  const argument = badges.find((badge) => badge.startsWith("<")) ?? "";
  const prefix = badges.filter((badge) => badge !== argument).join(" ");
  return { prefix, argument };
}

function buildRows(
  groups: Array<{ title: string; entries: HelpShortcutEntry[] }>,
  namespace: string,
): FunctionsRow[] {
  return groups.flatMap((group) => [
    { kind: "section" as const, key: `section:${namespace}:${group.title}`, label: group.title },
    ...group.entries.map((entry): FunctionsRow => ({
      kind: "entry",
      key: entry.id,
      ...splitEntryBadges(entry.badges),
      description: entry.description,
    })),
  ]);
}

export function FunctionsTable({
  commandShortcuts,
  windowTemplates,
  focused,
  width,
  height,
  header,
  onRunPrefix,
}: {
  commandShortcuts: HelpShortcutEntry[];
  windowTemplates: HelpShortcutEntry[];
  focused: boolean;
  width: number;
  height: number;
  /** Sits above the table inside the same frame, so the table keeps the rest. */
  header?: ReactNode;
  /** Opens the command bar on the prefix, so a row is one Enter from running. */
  onRunPrefix: (prefix: string) => void;
}) {
  const colors = useThemeColors();
  const rows = useMemo(() => [
    ...buildRows(groupShortcutEntries(commandShortcuts), "command"),
    ...buildRows(groupShortcutEntries(windowTemplates), "template"),
  ], [commandShortcuts, windowTemplates]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const effectiveSelectedKey = rows.some((row) => row.key === selectedKey)
    ? selectedKey
    : rows.find((row) => row.kind === "entry")?.key ?? null;

  const renderCell = useCallback((
    row: FunctionsRow,
    column: FunctionsColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.kind === "section") return { text: "" };
    if (column.id === "prefix") {
      return {
        text: row.prefix,
        color: rowState.selected ? colors.selectedText : colors.textBright,
        attributes: TextAttributes.BOLD,
      };
    }
    if (column.id === "argument") {
      return { text: row.argument, color: colors.textMuted };
    }
    return {
      text: t(row.description),
      color: rowState.selected ? colors.selectedText : colors.text,
    };
  }, [colors]);

  const renderSectionHeader = useCallback((row: FunctionsRow) => (
    row.kind === "section"
      ? { text: t(row.label), color: colors.textBright, attributes: TextAttributes.BOLD }
      : null
  ), [colors]);

  return (
    <DataTableView<FunctionsRow, FunctionsColumn>
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={header}
      columns={buildColumns(width)}
      items={rows}
      selection={{
        kind: "id",
        selectedId: effectiveSelectedKey,
        getId: (row) => row.key,
        onChange: (id) => setSelectedKey(id),
      }}
      isNavigable={(row) => row.kind === "entry"}
      onActivate={(row) => {
        if (row.kind === "entry") onRunPrefix(row.argument ? `${row.prefix} ` : row.prefix);
      }}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      renderSectionHeader={renderSectionHeader}
      renderCell={renderCell}
      fillAvailableWidth
      emptyStateTitle="No command prefixes are registered."
    />
  );
}
