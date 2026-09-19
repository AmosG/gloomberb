/**
 * The rebindable half of Help > Shortcuts.
 *
 * Every row is an action from the keybinding table or a command the user bound
 * to a chord. Enter (or a double click) captures the next keypress for the
 * selected row, which is the one thing a config file cannot do: show what the
 * terminal actually delivered for a combination before it is committed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyActionBinding,
  describeKeybindingIssue,
  formatChordForHost,
  isTypingChord,
  keyChordFromEvent,
  keyChordsOverlap,
  primaryModifierFor,
  removeCommandBinding,
  resolveKeybindings,
  serializeKeyChord,
  setCommandBinding,
  subscribeKeybindingCapture,
  takeKeybindingCaptureRequest,
  updateKeybindingsConfig,
  type KeyChord,
  type KeybindingCommand,
  type ResolvedKeybindingAction,
  type ResolvedKeybindings,
} from "../../../app/keybindings";
import {
  DataTableView,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { ShortcutHint } from "../../../components/ui/shortcut-hint";
import { t, tf } from "../../../i18n";
import { useShortcut } from "../../../react/input";
import { useAppDispatch, useAppSelector, useAppStateRef } from "../../../state/app/context";
import { saveConfigImmediately } from "../../../state/config-save-scheduler";
import { useThemeColors } from "../../../theme/theme-context";
import type { KeybindingsConfig } from "../../../types/config";
import type { KeyboardShortcut } from "../../../types/plugin";
import { Box, Text, TextAttributes, useUiHost } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { detectShortcutPlatform, getShortcutDisplayMode } from "../../../utils/shortcut-labels";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../runtime";

const CAPTURE_SCOPE = "help-keybinding-capture";
const KEY_COLUMN_WIDTH = 16;
const NOTE_COLUMN_WIDTH = 26;
/** Below this the note column is dropped; the status row still carries conflicts. */
const NOTE_COLUMN_MIN_TABLE_WIDTH = 76;

type KeybindingColumnId = "key" | "action" | "note";
type KeybindingColumn = DataTableColumn & { id: KeybindingColumnId };

type EditorRow =
  | { kind: "section"; key: string; label: string }
  | { kind: "hint"; key: string; label: string }
  | {
    kind: "action" | "command";
    key: string;
    /** Chords, already formatted for this host. */
    chords: string[];
    label: string;
    note: string;
    noteTone: "muted" | "warning";
    action?: ResolvedKeybindingAction;
    command?: KeybindingCommand;
  };

type BindableRow = Extract<EditorRow, { kind: "action" | "command" }>;

type CaptureTarget =
  | { kind: "row"; row: BindableRow }
  | { kind: "new-command"; query: string };

interface Feedback {
  tone: "info" | "warning";
  text: string;
}

/** The first clause of a description, for messages that name an action mid-sentence. */
function shortLabel(description: string): string {
  const clause = description.split(/[,.](?:\s|$)/)[0] ?? description;
  return clause.trim() || description.trim();
}

function pluginShortcutsFromRegistry(disabledPlugins: readonly string[]): KeyboardShortcut[] {
  const registry = getSharedRegistry();
  if (!registry?.shortcuts) return [];
  const disabled = new Set(disabledPlugins);
  return [...registry.shortcuts.values()].filter((shortcut) => {
    const pluginId = registry.getShortcutPluginId?.(shortcut.id);
    return !pluginId || !disabled.has(pluginId);
  });
}

/** The action column takes whatever the fixed columns leave, via flexGrow. */
function buildColumns(width: number): KeybindingColumn[] {
  return [
    { id: "key", label: "KEY", width: KEY_COLUMN_WIDTH, align: "left" },
    { id: "action", label: "ACTION", width: 20, align: "left", flexGrow: 1 },
    ...(width >= NOTE_COLUMN_MIN_TABLE_WIDTH
      ? [{ id: "note" as const, label: "NOTE", width: NOTE_COLUMN_WIDTH, align: "left" as const }]
      : []),
  ];
}

function conflictNote(
  resolved: ResolvedKeybindings,
  target: string,
  describe: (id: string) => string,
): string | null {
  const others = resolved.issues
    .filter((issue): issue is Extract<typeof issue, { kind: "conflict" }> => (
      issue.kind === "conflict" && issue.targets.includes(target)
    ))
    .flatMap((issue) => issue.targets.filter((entry) => entry !== target));
  if (others.length === 0) return null;
  return tf("also {target}", { target: [...new Set(others)].map(describe).join(", ") });
}

export function KeybindingsEditor({
  active,
  focused,
  width,
  height,
}: {
  /** The Shortcuts tab is showing; keys are ignored otherwise. */
  active: boolean;
  focused: boolean;
  width: number;
  height: number;
}) {
  const colors = useThemeColors();
  const uiHost = useUiHost();
  const dispatch = useAppDispatch();
  const stateRef = useAppStateRef();
  const { openCommandBar, notify } = usePluginAppActions();
  const keybindingsConfig = useAppSelector((state) => state.config.keybindings);
  const disabledPlugins = useAppSelector((state) => state.config.disabledPlugins);
  const isDesktop = uiHost.kind === "desktop-web";
  const displayMode = getShortcutDisplayMode(uiHost.kind);
  const platform = detectShortcutPlatform();
  const primaryModifier = primaryModifierFor(displayMode, platform);
  const formatChord = useCallback(
    (chord: KeyChord) => formatChordForHost(chord, displayMode, platform),
    [displayMode, platform],
  );

  const pluginShortcuts = useMemo(() => pluginShortcutsFromRegistry(disabledPlugins), [disabledPlugins]);
  const resolved = useMemo(
    () => resolveKeybindings(keybindingsConfig, { pluginShortcuts }),
    [keybindingsConfig, pluginShortcuts],
  );

  const describeTarget = useCallback((target: string): string => {
    if (target.startsWith("command:")) {
      const command = resolved.commands.find((entry) => `command:${entry.text}` === target);
      return `"${command?.query ?? target.slice("command:".length)}"`;
    }
    const action = resolved.actionsById.get(target);
    return shortLabel(action?.def ? t(action.def.description) : action?.pluginShortcut?.description ?? target);
  }, [resolved]);

  const rows = useMemo<EditorRow[]>(() => {
    const actionRow = (action: ResolvedKeybindingAction): EditorRow => {
      const conflict = conflictNote(resolved, action.id, describeTarget);
      return {
        kind: "action",
        key: `action:${action.id}`,
        chords: action.chords.map(formatChord),
        label: action.def ? t(action.def.description) : action.pluginShortcut?.description ?? action.id,
        note: conflict
          ?? (action.custom
            ? tf("custom, default {chord}", { chord: action.defaults.map(formatChord).join(", ") || t("none") })
            : ""),
        noteTone: conflict ? "warning" : "muted",
        action,
      };
    };
    const core = resolved.actions.filter((action) => action.def && (isDesktop || !action.def.desktopOnly));
    const plugin = resolved.actions.filter((action) => action.pluginShortcut);
    const section = (label: string): EditorRow => ({ kind: "section", key: `section:${label}`, label });

    return [
      section("Global Keys"),
      ...core.filter((action) => action.def!.category === "Global Keys").map(actionRow),
      section("Pane Management"),
      ...core.filter((action) => action.def!.category === "Pane Management").map(actionRow),
      section("Custom Commands"),
      ...(resolved.commands.length === 0
        ? [{
          kind: "hint" as const,
          key: "hint:commands",
          label: "No commands bound yet. Type one in the command bar and choose Bind a key.",
        }]
        : []),
      ...resolved.commands.map((command): EditorRow => {
        const conflict = conflictNote(resolved, `command:${command.text}`, describeTarget);
        return {
          kind: "command",
          key: `command:${command.text}`,
          chords: [formatChord(command.chord)],
          label: command.query,
          note: conflict ?? "",
          noteTone: conflict ? "warning" : "muted",
          command,
        };
      }),
      ...(plugin.length > 0 ? [section("Plugin Shortcuts"), ...plugin.map(actionRow)] : []),
    ];
  }, [describeTarget, formatChord, isDesktop, resolved]);

  const isBindable = (row: EditorRow): row is BindableRow => row.kind === "action" || row.kind === "command";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const effectiveSelectedKey = rows.some((row) => row.key === selectedKey && isBindable(row))
    ? selectedKey
    : rows.find(isBindable)?.key ?? null;
  const selectedRow = rows.filter(isBindable).find((row) => row.key === effectiveSelectedKey);
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const writeKeybindings = useCallback((next: KeybindingsConfig | undefined) => {
    dispatch({ type: "SET_KEYBINDINGS", keybindings: next });
    void saveConfigImmediately(updateKeybindingsConfig(stateRef.current.config, next));
  }, [dispatch, stateRef]);

  const startCapture = useCallback((target: CaptureTarget) => {
    setFeedback(null);
    setCapture(target);
    if (target.kind === "row") setSelectedKey(target.row.key);
  }, []);

  // "Bind a key" from the command bar lands here; the pane may have been
  // opened for it, so the request is read on mount as well as on change.
  useEffect(() => {
    const consume = () => {
      const request = takeKeybindingCaptureRequest();
      if (request) startCapture({ kind: "new-command", query: request.query });
    };
    consume();
    return subscribeKeybindingCapture(consume);
  }, [startCapture]);

  const captureLabel = capture
    ? capture.kind === "row" ? shortLabel(capture.row.label) : `"${capture.query}"`
    : null;

  const commitChord = useCallback((chord: KeyChord) => {
    if (!capture) return;
    const config = stateRef.current.config.keybindings;
    if (capture.kind === "new-command" || capture.row.kind === "command") {
      if (isTypingChord(chord)) {
        setFeedback({ tone: "warning", text: t("That key would fire while typing. Use Ctrl, Cmd, Alt or a function key.") });
        return;
      }
      const query = capture.kind === "new-command" ? capture.query : capture.row.command!.query;
      let next = config;
      if (capture.kind === "row") next = removeCommandBinding(next, capture.row.command!.text);
      writeKeybindings(setCommandBinding(next, chord, query));
      setSelectedKey(`command:${serializeKeyChord(chord)}`);
    } else {
      const action = capture.row.action!;
      writeKeybindings(applyActionBinding(config, action.id, [chord], action.defaults));
    }
    setCapture(null);
    const taken = resolved.actions.find((action) => (
      action.chords.some((existing) => keyChordsOverlap(existing, chord))
      && (capture.kind !== "row" || action.id !== capture.row.action?.id)
    ));
    setFeedback(taken
      ? { tone: "warning", text: tf("{chord} is also bound to {target}.", { chord: formatChord(chord), target: describeTarget(taken.id) }) }
      : { tone: "info", text: tf("Bound {target} to {chord}.", { target: captureLabel ?? "", chord: formatChord(chord) }) });
  }, [capture, captureLabel, describeTarget, formatChord, resolved.actions, stateRef, writeKeybindings]);

  // Capture owns the keyboard: a fresh scope in the earliest phase gets first
  // refusal over every app shortcut, and preventDefault keeps the desktop
  // webview from acting on chords like Cmd+W itself.
  useShortcut((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.name === "escape") {
      setCapture(null);
      setFeedback(null);
      return;
    }
    const chord = keyChordFromEvent(event, primaryModifier);
    if (chord) commitChord(chord);
  }, { enabled: capture !== null, scope: CAPTURE_SCOPE, phase: "before", allowEditable: true });

  const unbindSelected = useCallback(() => {
    if (!selectedRow) return;
    const config = stateRef.current.config.keybindings;
    if (selectedRow.kind === "command") {
      writeKeybindings(removeCommandBinding(config, selectedRow.command!.text));
      setFeedback({ tone: "info", text: tf("Removed the key for {target}.", { target: `"${selectedRow.command!.query}"` }) });
      return;
    }
    const action = selectedRow.action!;
    writeKeybindings(applyActionBinding(config, action.id, [], action.defaults));
    setFeedback({ tone: "info", text: tf("Unbound {target}.", { target: shortLabel(selectedRow.label) }) });
  }, [selectedRow, stateRef, writeKeybindings]);

  const canReset = selectedRow?.kind === "action" && selectedRow.action?.custom === true;
  const resetSelected = useCallback(() => {
    if (!selectedRow || selectedRow.kind !== "action" || !selectedRow.action?.custom) return;
    const action = selectedRow.action;
    writeKeybindings(applyActionBinding(stateRef.current.config.keybindings, action.id, action.defaults, action.defaults));
    setFeedback({
      tone: "info",
      text: tf("{target} is back on {chord}.", {
        target: shortLabel(selectedRow.label),
        chord: action.defaults.map(formatChord).join(", ") || t("nothing"),
      }),
    });
  }, [formatChord, selectedRow, stateRef, writeKeybindings]);

  const bindNewCommand = useCallback(() => {
    notify({ body: t("Type a command, then choose Bind a key.") });
    openCommandBar("");
  }, [notify, openCommandBar]);

  const handleRootKey = useCallback((event: DataTableKeyEvent): boolean | void => {
    if (!active || capture) return;
    if (isPlainKey(event, "backspace", "delete")) {
      unbindSelected();
    } else if (isPlainKey(event, "0")) {
      resetSelected();
    } else if (isPlainKey(event, "n")) {
      bindNewCommand();
    } else {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }, [active, bindNewCommand, capture, resetSelected, unbindSelected]);

  const renderCell = useCallback((
    row: EditorRow,
    column: KeybindingColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    if (row.kind === "section") return { text: "" };
    if (row.kind === "hint") {
      return column.id === "action" ? { text: t(row.label), color: colors.textDim } : { text: "" };
    }
    const capturing = capture?.kind === "row" && capture.row.key === row.key;
    if (column.id === "key") {
      if (capturing) {
        return { text: t("Press a key"), color: colors.borderFocused, attributes: TextAttributes.BOLD };
      }
      return row.chords.length > 0
        ? {
          text: row.chords.join(", "),
          color: rowState.selected ? colors.selectedText : colors.textBright,
        }
        : { text: t("unbound"), color: colors.textMuted };
    }
    if (column.id === "action") {
      return { text: row.label, color: rowState.selected ? colors.selectedText : colors.text };
    }
    return {
      text: row.note,
      color: row.noteTone === "warning" ? colors.warning : colors.textMuted,
    };
  }, [capture, colors]);

  const renderSectionHeader = useCallback((row: EditorRow) => (
    row.kind === "section"
      ? { text: t(row.label), color: colors.textBright, attributes: TextAttributes.BOLD }
      : null
  ), [colors]);

  // While capturing, a refused key explains itself in place of the prompt.
  // Otherwise the line carries the selected row's note in full, since the note
  // column truncates, and falls back to whatever the config got wrong.
  const selectedNote: Feedback | null = selectedRow?.note
    ? { tone: selectedRow.noteTone === "warning" ? "warning" : "info", text: selectedRow.note }
    : null;
  const status: Feedback | null = capture
    ? feedback?.tone === "warning"
      ? feedback
      : { tone: "info", text: tf("Press a key for {target}. Esc cancels.", { target: captureLabel ?? "" }) }
    : feedback
      ?? selectedNote
      ?? (resolved.issues[0] ? { tone: "warning", text: describeKeybindingIssue(resolved.issues[0]) } : null);

  const header = (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" gap={2} height={1}>
        <ShortcutHint
          hotkey="Enter"
          label={t("Rebind")}
          onPress={() => selectedRow && startCapture({ kind: "row", row: selectedRow })}
          disabled={!selectedRow || !!capture}
        />
        <ShortcutHint hotkey="Backspace" label={t("Unbind")} onPress={unbindSelected} disabled={!selectedRow || !!capture} />
        <ShortcutHint hotkey="0" label={t("Default")} onPress={resetSelected} disabled={!canReset || !!capture} />
        <ShortcutHint hotkey="N" label={t("Bind a command")} onPress={bindNewCommand} disabled={!!capture} />
      </Box>
      <Box height={1} overflow="hidden">
        <Text
          fg={status?.tone === "warning" ? colors.warning : capture ? colors.textBright : colors.textDim}
          attributes={capture ? TextAttributes.BOLD : 0}
          wrapMode="none"
          truncate
        >
          {status?.text ?? ""}
        </Text>
      </Box>
    </Box>
  );

  return (
    <DataTableView<EditorRow, KeybindingColumn>
      focused={focused && active && !capture}
      keyboardNavigation={!capture}
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
      isNavigable={(row) => row.kind !== "section" && row.kind !== "hint"}
      onActivate={(row) => {
        if (row.kind === "action" || row.kind === "command") startCapture({ kind: "row", row });
      }}
      onRootKeyDown={handleRootKey}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.key}
      renderSectionHeader={renderSectionHeader}
      renderCell={renderCell}
      fillAvailableWidth
      emptyStateTitle="No keybindings"
    />
  );
}
