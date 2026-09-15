import type { PluginModule } from "../../plugin-module";
import { requestAccountManagementTab } from "../../account-management/navigation";
import { createCloudTeamCapability } from "./capability";
import { registerTeamCommands } from "./command";
import { teamChannelId } from "./model";
import { TeamStatusWidget } from "./status-widget";
import { teamStore } from "./store";

export { TeamFlowHost } from "./flow-host";
export { TeamsAccountTab } from "./acm-tab";
export { teamStore } from "./store";

/**
 * Teams inside the cloud plugin: the store every surface reads, the `TEAM`
 * and `FOCUS` commands, the `cloud.team` capability for other plugins, and
 * the accent chips in the status bar.
 */
export const teamModule: PluginModule = {
  capabilities: [createCloudTeamCapability()],
  slots: {
    "status:widget": () => <TeamStatusWidget />,
  },
  setup(ctx) {
    teamStore.attach(ctx.persistence);
    teamStore.setNotifier(ctx.notify, {
      openTeamChannel: (teamId) => ctx.createPaneFromTemplate("new-chat-pane", { arg: teamChannelId(teamId) }),
      openTeamInvites: () => {
        requestAccountManagementTab("teams");
        ctx.showPane("account-management");
      },
      openTeamLayout: () => {
        ctx.showPane("layout-marketplace");
      },
    });
    teamStore.start();
    registerTeamCommands(ctx);
  },
  dispose() {
    teamStore.dispose();
  },
};
