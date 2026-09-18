/**
 * What the board should open when it appears or is brought back: a thesis by
 * id, or whichever thesis covers a symbol (falling back to starting one).
 * Commands and notification cards set it before creating the pane; an open
 * pane consumes it as it arrives.
 */
export interface ThesisPaneRequest {
  thesisId?: string | null;
  symbol?: string | null;
}

let pending: ThesisPaneRequest | null = null;
const listeners = new Set<(request: ThesisPaneRequest) => void>();

export function requestThesisPane(request: ThesisPaneRequest): void {
  pending = request;
  if (listeners.size === 0) return;
  for (const listener of listeners) listener(request);
  pending = null;
}

export function consumeRequestedThesis(): ThesisPaneRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribeRequestedThesis(listener: (request: ThesisPaneRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const THESIS_PANE_TEMPLATE_ID = "thesis-board-pane";

/** Opens (or refocuses) the single thesis board on the requested thesis. */
export function openThesisPane(
  createPaneFromTemplate: (templateId: string, options?: { arg?: string }) => void,
  request: ThesisPaneRequest = {},
): void {
  requestThesisPane(request);
  createPaneFromTemplate(THESIS_PANE_TEMPLATE_ID);
}
