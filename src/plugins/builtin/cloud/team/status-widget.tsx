import { useSyncExternalStore } from "react";
import { Button } from "../../../../components/ui/button";
import { colors } from "../../../../theme/colors";
import { Box, Span, Text, TextAttributes } from "../../../../ui";
import { usePluginAppActions } from "../../../runtime";
import { chatController } from "../../chat/controller";
import { countTeamUpdates, teamAccentHex, teamChannelId } from "./model";
import { teamStore } from "./store";

/**
 * One chip per team in the status bar, in the team's accent, with the unread
 * chat count and the number of pending cards (invites, layout updates). Hidden
 * teams under FOCUS keep their chip so the lens is visible, dimmed.
 */
export function TeamStatusWidget() {
  const { createPaneFromTemplate } = usePluginAppActions();
  const snapshot = useSyncExternalStore(
    (onChange) => teamStore.subscribe(onChange),
    () => teamStore.getSnapshot(),
  );
  const chat = useSyncExternalStore(
    (onChange) => chatController.subscribe(onChange),
    () => chatController.getSnapshot(),
  );
  if (snapshot.teams.length === 0) return null;

  const updates = countTeamUpdates(snapshot.notifications);
  const unreadByChannel = new Map(chat.channelStates.map((state) => [state.channelId, state.unreadCount]));

  return (
    <Box flexDirection="row" paddingRight={1}>
      {snapshot.teams.map((team) => {
        const accent = teamAccentHex(team.accentColor);
        const unread = unreadByChannel.get(teamChannelId(team.id)) ?? 0;
        const cards = updates.get(team.id) ?? 0;
        const muted =
          snapshot.focus === "personal" ||
          (typeof snapshot.focus === "object" && snapshot.focus.teamId !== team.id);
        const count = unread + cards;
        return (
          <Button
            key={team.id}
            label={`${team.name}: open team chat`}
            variant="ghost"
            compact
            stopPropagation
            onPress={() => createPaneFromTemplate("new-chat-pane", { arg: teamChannelId(team.id) })}
          >
            <Text fg={muted ? colors.textMuted : accent} attributes={count > 0 && !muted ? TextAttributes.BOLD : 0}>
              <Span fg={muted ? colors.textMuted : accent}>●</Span>
              {` ${team.shortName}`}
            </Text>
            {count > 0 ? (
              <Text fg={muted ? colors.textMuted : accent} attributes={TextAttributes.BOLD}>{`[${count}]`}</Text>
            ) : null}
            <Text> </Text>
          </Button>
        );
      })}
    </Box>
  );
}
