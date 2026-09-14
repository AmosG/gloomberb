import { apiClient } from "../../../../api-client";
import type { CommandResultDef, GloomPluginContext } from "../../../../types/plugin";
import { requestAuthDialog } from "../auth-dialog";
import { requestTeamFlow } from "./flow-host";
import {
  inviteByUsernameFlow,
  inviteLinkFlow,
  respondToInvitationFlow,
  reviewInvitationsFlow,
  runCreateTeamWizard,
  settingsFlow,
  showTeamActions,
} from "./flows";
import {
  canInviteToTeam,
  canManageTeam,
  describeTeam,
  findTeam,
  invitationTeamName,
  teamChannelId,
  teamLabel,
} from "./model";
import { teamStore } from "./store";

const TEAM_SUBCOMMAND = /^(invite|new|settings|members|leave|focus)\b\s*(.*)$/i;

function notAvailable(ctx: GloomPluginContext) {
  ctx.notify({ body: "Teams are not available right now.", type: "error" });
}

function run(ctx: GloomPluginContext, flow: Parameters<typeof requestTeamFlow>[0]) {
  if (!requestTeamFlow(flow)) notAvailable(ctx);
}

function requireSignIn(ctx: GloomPluginContext): boolean {
  if (apiClient.isVerified()) return true;
  const opened = requestAuthDialog({ mode: apiClient.isSignedIn() ? "login" : "signup" });
  if (!opened) ctx.notify({ body: "Sign in to use teams.", type: "info" });
  return false;
}

function openTeamChannel(ctx: GloomPluginContext, teamId: string) {
  ctx.createPaneFromTemplate("new-chat-pane", { arg: teamChannelId(teamId) });
}

export function buildTeamCommandResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const snapshot = teamStore.getSnapshot();
  const trimmed = arg.trim();
  const sub = TEAM_SUBCOMMAND.exec(trimmed);
  const category = "Teams";

  if (!apiClient.isVerified()) {
    return [{
      id: "sign-in",
      label: "Sign in to use teams",
      detail: "Teams share layouts, notes, watchlists, and a chat channel.",
      category,
      right: "TEAM",
      execute: () => {
        requireSignIn(ctx);
      },
    }];
  }

  if (sub) {
    const verb = sub[1]!.toLowerCase();
    const rest = sub[2]?.trim() ?? "";
    const focused = teamStore.getTeam(teamStore.getDefaultTeamId()) ?? snapshot.teams[0] ?? null;
    if (verb === "new") {
      return [{
        id: "new",
        label: "New team",
        detail: "Name, accent color, invites. Needs Pro.",
        category,
        right: "TEAM",
        execute: () => run(ctx, async (tools) => {
          await runCreateTeamWizard(tools);
        }),
      }];
    }
    if (verb === "invite") {
      const teams = snapshot.teams.filter(canInviteToTeam);
      if (teams.length === 0) {
        return [{
          id: "invite:none",
          label: "No team to invite to",
          detail: "Create one with TEAM new.",
          category,
          right: "TEAM",
          disabled: true,
          execute: () => {},
        }];
      }
      const linkOnly = rest.toLowerCase() === "link";
      const username = !linkOnly && rest.startsWith("@") ? rest : null;
      return teams.map((team) => ({
        id: `invite:${team.id}`,
        label: linkOnly
          ? `Copy invite link for ${team.name}`
          : username
            ? `Invite ${username} to ${team.name}`
            : `Invite to ${team.name}`,
        detail: linkOnly ? "Anyone with the link joins as a member." : describeTeam(team),
        category,
        right: team.shortName,
        current: focused?.id === team.id,
        execute: () => run(ctx, async (tools) => {
          if (linkOnly) await inviteLinkFlow(tools, team);
          else await inviteByUsernameFlow(tools, team, username ?? undefined);
        }),
      }));
    }
    if (verb === "settings" || verb === "members" || verb === "leave") {
      const teams = verb === "settings" ? snapshot.teams.filter((team) => canManageTeam(team.role)) : snapshot.teams;
      return teams.map((team) => ({
        id: `${verb}:${team.id}`,
        label: `${verb === "settings" ? "Settings for" : verb === "members" ? "Members of" : "Leave"} ${team.name}`,
        detail: describeTeam(team),
        category,
        right: team.shortName,
        current: focused?.id === team.id,
        execute: () => run(ctx, async (tools) => {
          if (verb === "settings") await settingsFlow(tools, team);
          else await showTeamActions(tools, team);
        }),
      }));
    }
    if (verb === "focus") {
      return buildFocusResults(ctx, rest);
    }
  }

  const results: CommandResultDef[] = [];
  for (const invitation of snapshot.invitations) {
    results.push({
      id: `invitation:${invitation.id}`,
      label: `Invitation to ${invitationTeamName(invitation)}`,
      detail: invitation.inviterEmail ? `From ${invitation.inviterEmail}. Accept or decline.` : "Accept or decline.",
      category: "Invitations",
      right: "NEW",
      execute: () => run(ctx, (tools) => respondToInvitationFlow(tools, invitation)),
    });
  }

  const matched = trimmed ? findTeam(snapshot.teams, trimmed) : null;
  const teams = trimmed
    ? snapshot.teams.filter((team) =>
        matched ? team.id === matched.id : teamLabel(team).toLowerCase().includes(trimmed.toLowerCase()),
      )
    : snapshot.teams;
  for (const team of teams) {
    results.push({
      id: `team:${team.id}`,
      label: teamLabel(team),
      detail: `${describeTeam(team)} · enter for actions`,
      category,
      right: team.shortName,
      keywords: [team.name, team.shortName, team.slug],
      current: teamStore.getDefaultTeamId() === team.id,
      execute: () => run(ctx, (tools) => showTeamActions(tools, team)),
    });
  }

  if (snapshot.teams.length === 0 && snapshot.invitations.length === 0 && !trimmed) {
    results.push({
      id: "new",
      label: "Create a team",
      detail: "Share layouts, notes, watchlists, and a chat channel. Needs Pro; joining is free.",
      category,
      right: "TEAM",
      execute: () => run(ctx, async (tools) => {
        await runCreateTeamWizard(tools);
      }),
    });
  } else if (!trimmed) {
    results.push({
      id: "new",
      label: "New team",
      detail: "TEAM new",
      category,
      right: "TEAM",
      execute: () => run(ctx, async (tools) => {
        await runCreateTeamWizard(tools);
      }),
    });
  }

  if (results.length === 0) {
    results.push({
      id: "none",
      label: `No team matches "${trimmed}"`,
      detail: "TEAM lists your teams. TEAM new creates one.",
      category,
      right: "TEAM",
      disabled: true,
      execute: () => {},
    });
  }
  return results;
}

/** FOCUS lens: collapse other groups' tabs and mute their channels. */
export function buildFocusResults(ctx: GloomPluginContext, arg: string): CommandResultDef[] {
  const snapshot = teamStore.getSnapshot();
  const current = snapshot.focus;
  const trimmed = arg.trim().toLowerCase();
  const results: CommandResultDef[] = [
    {
      id: "focus:all",
      label: "All",
      detail: "Every tab and channel.",
      category: "Focus",
      right: "FOCUS",
      current: current === "all",
      execute: () => {
        teamStore.setFocus("all");
        ctx.notify({ body: "Focus: everything.", type: "info" });
      },
    },
    {
      id: "focus:personal",
      label: "Personal",
      detail: "Team tabs collapse and team channels go quiet.",
      category: "Focus",
      right: "FOCUS",
      current: current === "personal",
      execute: () => {
        teamStore.setFocus("personal");
        ctx.notify({ body: "Focus: personal.", type: "info" });
      },
    },
    ...snapshot.teams.map((team) => ({
      id: `focus:${team.id}`,
      label: teamLabel(team),
      detail: "Only this team's tabs and channels, and its content by default in owner pickers.",
      category: "Focus",
      right: team.shortName,
      current: typeof current === "object" && current.teamId === team.id,
      keywords: [team.name, team.shortName],
      execute: () => {
        teamStore.setFocus({ teamId: team.id });
        ctx.notify({ body: `Focus: ${team.name}.`, type: "info" });
      },
    })),
  ];
  if (!trimmed) return results;
  const matched = findTeam(snapshot.teams, trimmed);
  return results.filter((result) =>
    matched ? result.id === `focus:${matched.id}` : result.label.toLowerCase().includes(trimmed),
  );
}

export function registerTeamCommands(ctx: GloomPluginContext): void {
  ctx.registerCommand({
    id: "team",
    label: "Team",
    description: "Your teams: chat, invites, members, settings",
    keywords: ["team", "teams", "invite", "members", "collaborate", "share"],
    category: "navigation",
    shortcut: "TEAM",
    shortcutArg: {
      placeholder: "[team | new | invite [@user|link] | settings | members | leave | focus]",
      kind: "text",
      parse: (arg) => ({ query: arg.trim() }),
    },
    buildResults: (arg) => buildTeamCommandResults(ctx, arg),
    execute: async (values) => {
      const query = values?.query ?? values?.shortcut ?? "";
      if (!requireSignIn(ctx)) return;
      const results = buildTeamCommandResults(ctx, query);
      const first = results.find((result) => !result.disabled);
      if (!first) return;
      if (query.trim() && results.length === 1 && first.id.startsWith("team:")) {
        openTeamChannel(ctx, first.id.slice("team:".length));
        return;
      }
      if (!query.trim() && teamStore.getSnapshot().teams.length === 0) {
        if (teamStore.getSnapshot().invitations.length > 0) {
          run(ctx, reviewInvitationsFlow);
          return;
        }
        run(ctx, async (tools) => {
          await runCreateTeamWizard(tools);
        });
        return;
      }
      await first.execute();
    },
  });

  ctx.registerCommand({
    id: "team-focus",
    label: "Focus",
    description: "Show one team, personal only, or everything",
    keywords: ["focus", "team", "personal", "lens", "collapse", "mute"],
    category: "navigation",
    shortcut: "FOCUS",
    shortcutArg: {
      placeholder: "[all | personal | team]",
      kind: "text",
      parse: (arg) => ({ query: arg.trim() }),
    },
    hidden: () => !apiClient.isVerified() || teamStore.getSnapshot().teams.length === 0,
    buildResults: (arg) => buildFocusResults(ctx, arg),
    execute: async (values) => {
      const query = values?.query ?? values?.shortcut ?? "";
      const results = buildFocusResults(ctx, query);
      const target = query.trim() ? results[0] : results.find((result) => result.current) ?? results[0];
      await target?.execute();
    },
  });
}
