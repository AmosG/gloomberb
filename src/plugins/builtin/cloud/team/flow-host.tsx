import { useEffect, useRef } from "react";
import type { AppNotificationRequest, PaneTemplateCreateOptions } from "../../../../types/plugin";
import { useDialog } from "../../../../ui/dialog";
import type { TeamFlowTools } from "./flows";
import { teamChannelId } from "./model";

type TeamFlow = (tools: TeamFlowTools) => Promise<void>

const listeners = new Set<(flow: TeamFlow) => void>();
const queue: TeamFlow[] = [];

/**
 * Commands run outside React, but the team flows need the dialog host and the
 * clipboard. They hand the flow here; the host mounted in the shell runs it.
 * Returns false when nothing is mounted so callers can say so.
 */
export function requestTeamFlow(flow: TeamFlow): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(flow);
  return true;
}

interface TeamFlowHostProps {
  /** The shell's app-level actions; the host renders outside any plugin context. */
  copyText: (text: string) => Promise<void> | void;
  notify: (request: AppNotificationRequest) => void;
  createPaneFromTemplate: (templateId: string, options?: PaneTemplateCreateOptions) => void;
}

export function TeamFlowHost({ copyText, notify, createPaneFromTemplate }: TeamFlowHostProps) {
  const dialog = useDialog();
  const running = useRef(false);

  useEffect(() => {
    const tools: TeamFlowTools = {
      dialog,
      copyText,
      notify,
      openTeamChannel: (teamId) => createPaneFromTemplate("new-chat-pane", { arg: teamChannelId(teamId) }),
    };
    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await next(tools).catch((error) => {
            notify({
              body: error instanceof Error ? error.message : "Something went wrong.",
              type: "error",
            });
          });
        }
      } finally {
        running.current = false;
      }
    };
    const listener = (flow: TeamFlow) => {
      queue.push(flow);
      void drain();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [copyText, createPaneFromTemplate, dialog, notify]);

  return null;
}
