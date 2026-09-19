/**
 * The rebindable half of Help > Shortcuts.
 *
 * Every row is an action from the keybinding table or a command the user bound
 * to a chord. Enter (or a click) captures the next keypress for the selected
 * row, which is the one thing a config file cannot do: show what the terminal
 * actually delivered for a combination before it is committed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  applyActionBinding,
  describeKeybindingIssue,
  formatChordForHost,
  isTypingChord,
  keyChordFromEvent,
  keyChordsOverlap,
  pluginShortcutActionId,
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
import { Badge, Section } from "../../../components";
import { ShortcutHint } from "../../../components/ui/shortcut-hint";
import { t, tf } from "../../../i18n";
import { useShortcut, type KeyEventLike } from "../../../react/input";
import { useAppDispatch, useAppSelector, useAppStateRef } from "../../../state/app/context";
import { saveConfigImmediately } from "../../../state/config-save-scheduler";
import { hoverBg } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { KeybindingsConfig } from "../../../types/config";
import type { KeyboardShortcut } from "../../../types/plugin";
import { Box, Text, TextAttributes, useUiHost, type ScrollBoxRenderable } from "../../../ui";
import { truncateToDisplayWidth } from "../../../utils/format";
import { isPlainKey } from "../../../utils/keyboard";
import { detectShortcutPlatform, getShortcutDisplayMode } from "../../../utils/shortcut-labels";
import { getSharedRegistry } from "../../registry";
import { usePluginAppActions } from "../../runtime";

const CAPTURE_SCOPE = "help-keybinding-capture";

interface EditorRow {
  id: string;
  kind: "action" | "command";
  action?: ResolvedKeybindingAction;
  command?: KeybindingCommand;
  badges: string[];
  description: string;
  custom: boolean;
  /** Shown beside a custom row so the way back is visible. */
  defaultLabel: string | null;
  /** Other targets on the same chord. */
  conflict: string | null;
  /** Line offset inside the scroll box, for keeping the selection in view. */
  line: number;
}

interface EditorSection {
  title: string;
  rows: EditorRow[];
  empty?: string;
}

type CaptureTarget =
  | { kind: "row"; row: EditorRow }
  | { kind: "new-command"; query: string };

interface Feedback {
  tone: "info" | "warning";
  text: string;
}

const HINT_ROW_LINES = 1;
const STATUS_ROW_LINES = 1;
const SECTION_CHROME_LINES = 2;
/** Columns a row note may take before the description has to give way. */
const NOTE_MAX_WIDTH = 34;

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

function conflictLabel(resolved: ResolvedKeybindings, target: string, describe: (id: string) => string): string | null {
  const others = resolved.issues
    .filter((issue): issue is Extract<typeof issue, { kind: "conflict" }> => issue.kind === "conflict" && issue.targets.includes(target))
    .flatMap((issue) => issue.targets.filter((entry) => entry !== target));
  if (others.length === 0) return null;
  return [...new Set(others)].map(describe).join(", ");
}

export function KeybindingsEditor({
  active,
  focused,
  scrollRef,
  contentTop,
}: {
  /** The Shortcuts tab is showing; keys are ignored otherwise. */
  active: boolean;
  focused: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  /** Lines above the editor inside the scroll box. */
  contentTop: number;
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
  const formatChord = useCallback((chord: KeyChord) => formatChordForHost(chord, displayMode, platform), [displayMode, platform]);

  const pluginShortcuts = useMemo(() => pluginShortcutsFromRegistry(disabledPlugins), [disabledPlugins]);
  const resolved = useMemo(
    () => resolveKeybindings(keybindingsConfig, { pluginShortcuts }),
    [keybindingsConfig, pluginShortcuts],
  );

  const describeTarget = useCallback((target: string): string => {
    if (target.startsWith("command:")) return `"${resolved.commands.find((command) => `command:${command.text}` === target)?.query ?? target.slice("command:".length)}"`;
    const action = resolved.actionsById.get(target);
    return shortLabel(action?.def ? t(action.def.description) : action?.pluginShortcut?.description ?? target);
  }, [resolved]);

  const sections = useMemo<EditorSection[]>(() => {
    let line = contentTop + HINT_ROW_LINES + STATUS_ROW_LINES;
    const build = (title: string, rows: Array<Omit<EditorRow, "line">>, empty?: string): EditorSection => {
      line += SECTION_CHROME_LINES;
      const placed = rows.map((row) => ({ ...row, line: line++ }));
      if (placed.length === 0) line += 1;
      return { title, rows: placed, empty };
    };
    const actionRow = (action: ResolvedKeybindingAction): Omit<EditorRow, "line"> => ({
      id: `action:${action.id}`,
      kind: "action",
      action,
      badges: action.chords.map(formatChord),
      description: action.def ? t(action.def.description) : action.pluginShortcut?.description ?? action.id,
      custom: action.custom,
      defaultLabel: action.custom ? action.defaults.map(formatChord).join(", ") : null,
      conflict: conflictLabel(resolved, action.id, describeTarget),
    });
    const core = resolved.actions.filter((action) => action.def && (isDesktop || !action.def.desktopOnly));
    const plugin = resolved.actions.filter((action) => action.pluginShortcut);
    return [
      build("Global Keys", core.filter((action) => action.def!.category === "Global Keys").map(actionRow)),
      build("Pane Management", core.filter((action) => action.def!.category === "Pane Management").map(actionRow)),
      build(
        "Custom Commands",
        resolved.commands.map((command) => ({
          id: `command:${command.text}`,
          kind: "command" as const,
          command,
          badges: [formatChord(command.chord)],
          description: command.query,
          custom: true,
          defaultLabel: null,
          conflict: conflictLabel(resolved, `command:${command.text}`, describeTarget),
        })),
        "No commands bound yet. Type one in the command bar and choose Bind a key.",
      ),
      ...(plugin.length > 0 ? [build("Plugin Shortcuts", plugin.map(actionRow))] : []),
    ];
  }, [contentTop, describeTarget, formatChord, isDesktop, resolved]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.id === selectedId));
  const selectedRow = rows[selectedIndex] ?? null;
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const writeKeybindings = useCallback((next: KeybindingsConfig | undefined) => {
    dispatch({ type: "SET_KEYBINDINGS", keybindings: next });
    void saveConfigImmediately(updateKeybindingsConfig(stateRef.current.config, next));
  }, [dispatch, stateRef]);

  const ensureVisible = useCallback((row: EditorRow | null) => {
    const scrollBox = scrollRef.current;
    if (!row || !scrollBox?.viewport) return;
    const viewportHeight = Math.max(1, scrollBox.viewport.height);
    if (row.line < scrollBox.scrollTop) {
      scrollBox.scrollTo(row.line);
    } else if (row.line + 1 > scrollBox.scrollTop + viewportHeight) {
      scrollBox.scrollTo(row.line + 1 - viewportHeight);
    }
  }, [scrollRef]);

  const select = useCallback((row: EditorRow) => {
    setSelectedId(row.id);
    ensureVisible(row);
  }, [ensureVisible]);

  // A row selected before it existed, such as a command just bound, scrolls
  // into view once the table has caught up.
  useEffect(() => {
    ensureVisible(rows.find((row) => row.id === selectedId) ?? null);
  }, [ensureVisible, rows, selectedId]);

  const startCapture = useCallback((target: CaptureTarget) => {
    setFeedback(null);
    setCapture(target);
    if (target.kind === "row") select(target.row);
  }, [select]);

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
    ? capture.kind === "row" ? shortLabel(capture.row.description) : `"${capture.query}"`
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
      setSelectedId(`command:${serializeKeyChord(chord)}`);
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
    setFeedback({ tone: "info", text: tf("Unbound {target}.", { target: shortLabel(selectedRow.description) }) });
  }, [selectedRow, stateRef, writeKeybindings]);

  const resetSelected = useCallback(() => {
    if (!selectedRow || selectedRow.kind !== "action" || !selectedRow.custom) return;
    const action = selectedRow.action!;
    writeKeybindings(applyActionBinding(stateRef.current.config.keybindings, action.id, action.defaults, action.defaults));
    setFeedback({ tone: "info", text: tf("{target} is back on {chord}.", { target: shortLabel(selectedRow.description), chord: action.defaults.map(formatChord).join(", ") || t("nothing") }) });
  }, [formatChord, selectedRow, stateRef, writeKeybindings]);

  const bindNewCommand = useCallback(() => {
    notify({ body: t("Type a command, then choose Bind a key.") });
    openCommandBar("");
  }, [notify, openCommandBar]);

  useShortcut((event) => {
    if (!active || !focused || capture || rows.length === 0) return;
    if (isPlainKey(event, "j", "down")) {
      select(rows[Math.min(rows.length - 1, selectedIndex + 1)]!);
    } else if (isPlainKey(event, "k", "up")) {
      select(rows[Math.max(0, selectedIndex - 1)]!);
    } else if (isPlainKey(event, "return", "enter")) {
      if (selectedRow) startCapture({ kind: "row", row: selectedRow });
    } else if (isPlainKey(event, "backspace", "delete")) {
      unbindSelected();
    } else if (isPlainKey(event, "0")) {
      resetSelected();
    } else if (isPlainKey(event, "n")) {
      bindNewCommand();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, { enabled: active && focused && !capture });

  // While capturing, a refused key explains itself in place of the prompt.
  const status: Feedback | null = capture
    ? feedback?.tone === "warning"
      ? feedback
      : { tone: "info", text: tf("Press a key for {target}. Esc cancels.", { target: captureLabel ?? "" }) }
    : feedback
      ?? (resolved.issues[0] ? { tone: "warning", text: describeKeybindingIssue(resolved.issues[0]) } : null);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2} height={HINT_ROW_LINES}>
        <ShortcutHint hotkey="Enter" label={t("Rebind")} onPress={() => selectedRow && startCapture({ kind: "row", row: selectedRow })} disabled={!selectedRow || !!capture} />
        <ShortcutHint hotkey="Backspace" label={t("Unbind")} onPress={unbindSelected} disabled={!selectedRow || !!capture} />
        <ShortcutHint hotkey="0" label={t("Default")} onPress={resetSelected} disabled={!selectedRow?.custom || selectedRow.kind !== "action" || !!capture} />
        <ShortcutHint hotkey="N" label={t("Bind a command")} onPress={bindNewCommand} disabled={!!capture} />
      </Box>
      <Box height={STATUS_ROW_LINES} overflow="hidden">
        <Text
          fg={status?.tone === "warning" ? colors.warning : capture ? colors.textBright : colors.textDim}
          attributes={capture ? TextAttributes.BOLD : 0}
          wrapMode="none"
          truncate
        >
          {status?.text ?? ""}
        </Text>
      </Box>
      {sections.map((section) => (
        <Section key={section.title} title={section.title}>
          {section.rows.length === 0 && section.empty ? (
            <Box height={1}><Text fg={colors.textDim} wrapMode="none" truncate>{t(section.empty)}</Text></Box>
          ) : null}
          {section.rows.map((row) => (
            <KeybindingRow
              key={row.id}
              row={row}
              selected={row.id === selectedRow?.id}
              capturing={capture?.kind === "row" && capture.row.id === row.id}
              onPress={() => startCapture({ kind: "row", row })}
            />
          ))}
        </Section>
      ))}
    </Box>
  );
}

function KeybindingRow({
  row,
  selected,
  capturing,
  onPress,
}: {
  row: EditorRow;
  selected: boolean;
  capturing: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const pressedRef = useRef(false);
  const background = selected ? colors.selected : hovered ? hoverBg(colors) : undefined;
  const textColor = selected ? colors.selectedText : colors.text;
  const note = row.conflict
    ? { tone: "warning" as const, text: truncateToDisplayWidth(tf("also {target}", { target: row.conflict }), NOTE_MAX_WIDTH) }
    : row.custom && row.kind === "action"
      ? { tone: "muted" as const, text: truncateToDisplayWidth(tf("custom, default {chord}", { chord: row.defaultLabel || t("none") }), NOTE_MAX_WIDTH) }
      : null;
  return (
    <Box
      flexDirection="row"
      gap={1}
      height={1}
      width="100%"
      backgroundColor={background}
      cursor="pointer"
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event?: { stopPropagation?: () => void }) => {
        pressedRef.current = true;
        event?.stopPropagation?.();
      }}
      onMouseUp={(event?: { stopPropagation?: () => void }) => {
        event?.stopPropagation?.();
        if (!pressedRef.current) return;
        pressedRef.current = false;
        onPress();
      }}
      data-gloom-role="keybinding-row"
    >
      <Text fg={selected ? colors.selectedText : colors.textDim} flexShrink={0}>{selected ? "\u25b8" : " "}</Text>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        {capturing
          ? <Badge variant="solid" tone="accent" label={t("Press a key")} />
          : row.badges.length > 0
            ? row.badges.map((badge, index) => <Badge variant="solid" key={`${badge}:${index}`} label={badge} />)
            : <Badge label={t("unbound")} />}
      </Box>
      <Text fg={textColor} wrapMode="none" truncate flexShrink={1} minWidth={0}>{row.description}</Text>
      {note ? <Text fg={note.tone === "warning" ? colors.warning : colors.textMuted} flexShrink={0}>{note.text}</Text> : null}
    </Box>
  );
}
