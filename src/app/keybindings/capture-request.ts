/**
 * A request to bind a key to command bar text, handed from the command bar to
 * the help pane. The bar cannot capture a key itself: the moment it opens, it
 * owns the keyboard, and the capture has to outlive the bar closing.
 */
export interface KeybindingCaptureRequest {
  kind: "command";
  query: string;
}

let pending: KeybindingCaptureRequest | null = null;
const listeners = new Set<() => void>();

export function requestKeybindingCapture(request: KeybindingCaptureRequest): void {
  pending = request;
  for (const listener of listeners) listener();
}

/** Whether a request is waiting, for a pane deciding which tab to open on. */
export function hasKeybindingCaptureRequest(): boolean {
  return pending !== null;
}

/** Returns and clears the pending request, so it is honoured exactly once. */
export function takeKeybindingCaptureRequest(): KeybindingCaptureRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribeKeybindingCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
