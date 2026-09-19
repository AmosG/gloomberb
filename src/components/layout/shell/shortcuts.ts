import type { KeyEventLike } from "../../../react/input";
import {
  getDefaultKeybindings,
  isPaneKeybindingAction,
  matchKeybinding,
  menuAcceleratorFor,
  type CoreKeybindingActionId,
  type ResolvedKeybindings,
} from "../../../app/keybindings";

export type PaneManagementShortcut =
  | "settings"
  | "toggle-fullscreen"
  | "toggle-floating"
  | "pop-out"
  | "copy-screenshot"
  | "export-csv"
  | "share"
  | "close"
  | "close-all-floating"
  | "layout-gallery"
  | "gridlock-all"
  | "window-mode"
  | "window-resize-mode";

const PANE_ACTION_TO_SHORTCUT: Partial<Record<CoreKeybindingActionId, PaneManagementShortcut>> = {
  "pane-settings": "settings",
  "pane-fullscreen": "toggle-fullscreen",
  "pane-float": "toggle-floating",
  "pane-pop-out": "pop-out",
  "pane-screenshot": "copy-screenshot",
  "pane-export-csv": "export-csv",
  "pane-share": "share",
  "pane-close": "close",
  "close-floating-panes": "close-all-floating",
  "layout-gallery": "layout-gallery",
  "tidy-windows": "gridlock-all",
  "window-move-mode": "window-mode",
  "window-resize-mode": "window-resize-mode",
};

export type PaneManagementAccelerators = Record<
  "settings" | "fullscreen" | "toggleFloating" | "popOut" | "copyScreenshot" | "exportCsv" | "share" | "close"
  | "closeAllFloating" | "layoutGallery" | "gridlockAll" | "windowMode" | "windowResizeMode",
  string | undefined
>;

/** Menu accelerators for the pane actions, read from the same table the keys are. */
export function paneManagementAccelerators(keybindings: ResolvedKeybindings): PaneManagementAccelerators {
  return {
    settings: menuAcceleratorFor(keybindings, "pane-settings"),
    fullscreen: menuAcceleratorFor(keybindings, "pane-fullscreen"),
    toggleFloating: menuAcceleratorFor(keybindings, "pane-float"),
    popOut: menuAcceleratorFor(keybindings, "pane-pop-out"),
    copyScreenshot: menuAcceleratorFor(keybindings, "pane-screenshot"),
    exportCsv: menuAcceleratorFor(keybindings, "pane-export-csv"),
    share: menuAcceleratorFor(keybindings, "pane-share"),
    close: menuAcceleratorFor(keybindings, "pane-close"),
    closeAllFloating: menuAcceleratorFor(keybindings, "close-floating-panes"),
    layoutGallery: menuAcceleratorFor(keybindings, "layout-gallery"),
    gridlockAll: menuAcceleratorFor(keybindings, "tidy-windows"),
    windowMode: menuAcceleratorFor(keybindings, "window-move-mode"),
    windowResizeMode: menuAcceleratorFor(keybindings, "window-resize-mode"),
  };
}

export const PANE_MANAGEMENT_ACCELERATORS = paneManagementAccelerators(getDefaultKeybindings());

export function resolvePaneManagementShortcut(
  event: Pick<KeyEventLike, "name" | "key" | "ctrl" | "meta" | "super" | "shift" | "alt">,
  keybindings: ResolvedKeybindings = getDefaultKeybindings(),
): PaneManagementShortcut | null {
  const match = matchKeybinding(keybindings, event);
  if (!match || match.kind !== "action" || !isPaneKeybindingAction(match.id)) return null;
  return PANE_ACTION_TO_SHORTCUT[match.id as CoreKeybindingActionId] ?? null;
}

export function inputCaptureAllowsPaneManagementShortcut(
  shortcut: PaneManagementShortcut,
  event: Pick<KeyEventLike, "meta" | "super" | "targetEditable">,
): boolean {
  if (shortcut === "toggle-fullscreen") return event.meta || event.super === true;
  if (shortcut !== "close" && shortcut !== "close-all-floating") return false;
  return event.meta || event.super || event.targetEditable !== true;
}
