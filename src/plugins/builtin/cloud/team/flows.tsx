import {
  apiClient,
  TEAM_ACCENT_COLORS,
  type TeamAccentColor,
  type TeamInvitation,
  type TeamMember,
  type TeamRole,
  type TeamSummary,
} from "../../../../api-client";
import { ApiRequestError } from "../../../../api-client/errors";
import { runPaneTemplateDialogWizard } from "../../../../app/pane-template-dialog-wizard";
import { ChoiceDialog, type ChoiceDialogChoice } from "../../../../components/ui/choice-dialog";
import { ConfirmDialog } from "../../../../components/ui/confirm-dialog";
import type { AppNotificationRequest } from "../../../../types/plugin";
import type { DialogApi, PromptContext } from "../../../../ui/dialog";
import { canInviteToTeam, canManageTeam, invitationTeamName, roleLabel, teamLabel } from "./model";
import { teamStore } from "./store";

/** What a flow needs from the host that runs it. */
export interface TeamFlowTools {
  dialog: DialogApi;
  copyText: (text: string) => Promise<void> | void;
  notify: (request: AppNotificationRequest) => void;
  openTeamChannel: (teamId: string) => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 403 && /organization|pro/i.test(error.message)) {
      return "Creating a team needs a Pro plan. Joining one is free.";
    }
    if (error.status === 402) return "Creating a team needs a Pro plan. Joining one is free.";
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

async function choose(
  dialog: DialogApi,
  title: string,
  choices: ChoiceDialogChoice[],
  footer?: string,
): Promise<string | null> {
  const choice = await dialog
    .prompt<string>({
      content: (context: PromptContext<string>) => (
        <ChoiceDialog {...context} title={title} choices={choices} footer={footer} />
      ),
    })
    .catch(() => undefined);
  return choice || null;
}

async function confirm(
  dialog: DialogApi,
  title: string,
  body: string,
  confirmLabel: string,
  confirmVariant: "danger" | "primary" = "danger",
): Promise<boolean> {
  return dialog
    .prompt<boolean>({
      content: (context: PromptContext<boolean>) => (
        <ConfirmDialog
          {...context}
          title={title}
          body={body}
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant}
        />
      ),
    })
    .then((value) => value === true)
    .catch(() => false);
}

async function askText(
  dialog: DialogApi,
  label: string,
  options: { placeholder?: string; defaultValue?: string; body?: string[]; required?: boolean } = {},
): Promise<string | null> {
  const values = await runPaneTemplateDialogWizard(dialog, [{
    key: "value",
    label,
    type: "text",
    placeholder: options.placeholder,
    defaultValue: options.defaultValue,
    required: options.required,
    body: options.body,
  }]);
  return values?.value?.trim() || null;
}

const ACCENT_OPTIONS = TEAM_ACCENT_COLORS.map((color) => ({
  value: color,
  label: color.charAt(0).toUpperCase() + color.slice(1),
}));

export async function runCreateTeamWizard(tools: TeamFlowTools): Promise<TeamSummary | null> {
  const values = await runPaneTemplateDialogWizard(tools.dialog, [
    {
      key: "name",
      label: "New team",
      type: "text",
      placeholder: "Macro Desk",
      body: ["A team shares layouts, notes, watchlists, and a chat channel.", "Creating one needs Pro. Joining is free."],
    },
    {
      key: "accentColor",
      label: "Accent color",
      type: "select",
      options: ACCENT_OPTIONS,
      defaultValue: "blue",
      body: ["Marks the team's tabs, panes, notes, and chat."],
    },
    {
      key: "shortName",
      label: "Short name",
      type: "text",
      placeholder: "MD",
      required: false,
      body: ["Up to four letters. The prefix on terminals without color.", "Leave empty to derive it from the name."],
    },
  ]);
  if (!values?.name) return null;

  let team: TeamSummary;
  try {
    team = await apiClient.createTeam({
      name: values.name,
      accentColor: values.accentColor as TeamAccentColor,
      ...(values.shortName?.trim() ? { shortName: values.shortName.trim() } : {}),
    });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not create the team."), type: "error" });
    return null;
  }
  await teamStore.refresh();
  tools.notify({
    title: teamLabel(team),
    body: `Team ${team.shortName} created. Publish a layout with LAY, then Publish to team.`,
    type: "success",
  });

  const next = await choose(tools.dialog, `Invite people to ${team.name}`, [
    { id: "link", label: "Copy an invite link", description: "Anyone with the link joins as a member. Lasts seven days." },
    { id: "username", label: "Invite by username", description: "They see the invite in their terminal." },
    { id: "later", label: "Later", description: "TEAM invite works at any time." },
  ]);
  if (next === "link") await inviteLinkFlow(tools, team);
  else if (next === "username") await inviteByUsernameFlow(tools, team);
  return team;
}

export async function inviteByUsernameFlow(
  tools: TeamFlowTools,
  team: TeamSummary,
  username?: string,
): Promise<void> {
  const target = username?.trim() || (await askText(tools.dialog, `Invite to ${team.name}`, {
    placeholder: "@username",
    body: ["The person sees the invite in their terminal under TEAM."],
  }));
  if (!target) return;
  try {
    const invitation = await apiClient.inviteTeamMemberByUsername(team.id, target);
    const name = invitation.invitee.username ? `@${invitation.invitee.username}` : invitation.invitee.displayName;
    tools.notify({ title: teamLabel(team), body: `Invited ${name}.`, type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not send the invitation."), type: "error" });
  }
}

export async function inviteByEmailFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  const email = await askText(tools.dialog, `Email an invite to ${team.name}`, {
    placeholder: "name@company.com",
    body: ["For people not on Gloom yet. They create an account with this address."],
  });
  if (!email) return;
  try {
    await apiClient.inviteTeamMemberByEmail(team.id, email);
    tools.notify({ title: teamLabel(team), body: `Invitation sent to ${email}.`, type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not send the invitation."), type: "error" });
  }
}

export async function inviteLinkFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  try {
    const existing = await apiClient.listTeamInviteLinks(team.id);
    const link = existing[0] ?? (await apiClient.createTeamInviteLink(team.id));
    await tools.copyText(link.url);
    tools.notify({
      title: teamLabel(team),
      body: `Invite link copied. ${link.maxUses ? `${link.uses}/${link.maxUses} used, ` : ""}expires ${new Date(link.expiresAt).toLocaleDateString()}.`,
      type: "success",
    });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not create the invite link."), type: "error" });
  }
}

function memberChoice(member: TeamMember, selfId: string | null): ChoiceDialogChoice {
  const name = member.user.username ? `@${member.user.username}` : member.user.displayName;
  return {
    id: member.id,
    label: `${name}${member.user.id === selfId ? " (you)" : ""}`,
    detail: roleLabel(member.role),
    description: `${member.user.displayName} · joined ${new Date(member.joinedAt).toLocaleDateString()}`,
  };
}

export async function membersFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  let members: TeamMember[];
  try {
    members = (await apiClient.getTeamMembers(team.id)).members;
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not load the members."), type: "error" });
    return;
  }
  const selfId = apiClient.getCurrentUser()?.id ?? null;
  const manager = canManageTeam(team.role);
  const memberId = await choose(
    tools.dialog,
    `${team.name} · ${members.length} ${members.length === 1 ? "member" : "members"}`,
    members.map((member) => memberChoice(member, selfId)),
    manager ? "enter to manage · esc to close" : "esc to close",
  );
  if (!memberId || !manager) return;
  const member = members.find((entry) => entry.id === memberId);
  if (!member || member.user.id === selfId) return;
  const owners = members.filter((entry) => entry.role === "owner").length;
  if (member.role === "owner" && owners <= 1) {
    tools.notify({ body: "A team keeps at least one owner.", type: "info" });
    return;
  }
  if (team.role !== "owner" && member.role !== "member") {
    tools.notify({ body: "Only the owner changes admins and owners.", type: "info" });
    return;
  }
  const name = member.user.username ? `@${member.user.username}` : member.user.displayName;
  const roles: Array<{ id: TeamRole; label: string }> = [
    { id: "member", label: "Member" },
    { id: "admin", label: "Admin" },
    ...(team.role === "owner" ? [{ id: "owner" as const, label: "Owner" }] : []),
  ];
  const action = await choose(tools.dialog, name, [
    ...roles
      .filter((role) => role.id !== member.role)
      .map((role) => ({ id: `role:${role.id}`, label: `Make ${role.label.toLowerCase()}` })),
    { id: "remove", label: "Remove from team", description: "Their linked tabs become personal copies." },
  ]);
  if (!action) return;
  try {
    if (action === "remove") {
      if (!(await confirm(tools.dialog, `Remove ${name}?`, `${name} leaves ${team.name}.`, "Remove"))) return;
      await apiClient.removeTeamMember(team.id, member.id);
      tools.notify({ title: teamLabel(team), body: `${name} was removed.`, type: "success" });
    } else {
      const role = action.slice("role:".length) as TeamRole;
      await apiClient.updateTeamMemberRole(team.id, member.id, role);
      tools.notify({ title: teamLabel(team), body: `${name} is now ${roleLabel(role).toLowerCase()}.`, type: "success" });
    }
    await teamStore.refresh();
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not update the member."), type: "error" });
  }
}

export async function settingsFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  const values = await runPaneTemplateDialogWizard(tools.dialog, [
    { key: "name", label: "Team name", type: "text", defaultValue: team.name },
    { key: "shortName", label: "Short name", type: "text", defaultValue: team.shortName },
    { key: "accentColor", label: "Accent color", type: "select", options: ACCENT_OPTIONS, defaultValue: team.accentColor },
    {
      key: "allowMemberInvites",
      label: "Who can create invite links",
      type: "select",
      options: [
        { value: "managers", label: "Owners and admins" },
        { value: "everyone", label: "Anyone in the team" },
      ],
      defaultValue: team.allowMemberInvites ? "everyone" : "managers",
    },
  ]);
  if (!values) return;
  try {
    await apiClient.updateTeam(team.id, {
      name: values.name,
      metadata: {
        accentColor: values.accentColor as TeamAccentColor,
        shortName: values.shortName,
        allowMemberInvites: values.allowMemberInvites === "everyone",
      },
    });
    await teamStore.refresh();
    tools.notify({ title: teamLabel(team), body: "Team settings saved.", type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not save the team."), type: "error" });
  }
}

export async function leaveTeamFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  if (!(await confirm(
    tools.dialog,
    `Leave ${team.name}?`,
    "The team channel, notes, and collections disappear from this terminal. Linked tabs become personal copies.",
    "Leave",
  ))) return;
  try {
    await apiClient.leaveTeam(team.id);
    await teamStore.refresh();
    tools.notify({ body: `You left ${team.name}.`, type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not leave the team. Transfer ownership first if you are the only owner."), type: "error" });
  }
}

export async function transferOwnershipFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  let members: TeamMember[];
  try {
    members = (await apiClient.getTeamMembers(team.id)).members;
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not load the members."), type: "error" });
    return;
  }
  const selfId = apiClient.getCurrentUser()?.id ?? null;
  const candidates = members.filter((member) => member.user.id !== selfId);
  if (candidates.length === 0) {
    tools.notify({ body: "Invite someone before transferring ownership.", type: "info" });
    return;
  }
  const memberId = await choose(tools.dialog, `New owner of ${team.name}`, candidates.map((member) => memberChoice(member, selfId)));
  const target = candidates.find((member) => member.id === memberId);
  if (!target) return;
  const name = target.user.username ? `@${target.user.username}` : target.user.displayName;
  if (!(await confirm(tools.dialog, `Make ${name} the owner?`, "You become an admin.", "Transfer", "primary"))) return;
  try {
    await apiClient.updateTeamMemberRole(team.id, target.id, "owner");
    const self = members.find((member) => member.user.id === selfId);
    if (self) await apiClient.updateTeamMemberRole(team.id, self.id, "admin");
    await teamStore.refresh();
    tools.notify({ title: teamLabel(team), body: `${name} now owns ${team.name}.`, type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not transfer ownership."), type: "error" });
  }
}

export async function deleteTeamFlow(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  const typed = await askText(tools.dialog, `Delete ${team.name}?`, {
    placeholder: team.name,
    body: [
      "Every member loses the channel, notes, collections, and layouts.",
      `Type ${team.name} to confirm.`,
    ],
  });
  if (typed !== team.name) {
    if (typed) tools.notify({ body: "The name did not match. Nothing was deleted.", type: "info" });
    return;
  }
  try {
    await apiClient.deleteTeam(team.id);
    await teamStore.refresh();
    tools.notify({ body: `${team.name} was deleted.`, type: "success" });
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not delete the team."), type: "error" });
  }
}

/** The action sheet behind a team in `TEAM` and in the account pane. */
export async function showTeamActions(tools: TeamFlowTools, team: TeamSummary): Promise<void> {
  const manager = canManageTeam(team.role);
  const choices: ChoiceDialogChoice[] = [
    { id: "chat", label: "Open #general", description: "The team's chat channel." },
    { id: "members", label: "Members", description: manager ? "Roles and removal." : "Who is in the team." },
    ...(canInviteToTeam(team) ? [{ id: "link", label: "Copy invite link", description: "Anyone with the link joins as a member." }] : []),
    ...(manager
      ? [
          { id: "username", label: "Invite by username" },
          { id: "email", label: "Invite by email" },
          { id: "settings", label: "Settings", description: "Name, short name, accent, invite rules." },
        ]
      : []),
    { id: "leave", label: "Leave team" },
    ...(team.role === "owner"
      ? [
          { id: "transfer", label: "Transfer ownership" },
          { id: "delete", label: "Delete team", description: "Removes it for every member." },
        ]
      : []),
  ];
  const action = await choose(tools.dialog, teamLabel(team), choices);
  switch (action) {
    case "chat":
      tools.openTeamChannel(team.id);
      return;
    case "members":
      return membersFlow(tools, team);
    case "link":
      return inviteLinkFlow(tools, team);
    case "username":
      return inviteByUsernameFlow(tools, team);
    case "email":
      return inviteByEmailFlow(tools, team);
    case "settings":
      return settingsFlow(tools, team);
    case "leave":
      return leaveTeamFlow(tools, team);
    case "transfer":
      return transferOwnershipFlow(tools, team);
    case "delete":
      return deleteTeamFlow(tools, team);
    default:
      return;
  }
}

export async function respondToInvitationFlow(
  tools: TeamFlowTools,
  invitation: TeamInvitation,
): Promise<void> {
  const teamName = invitationTeamName(invitation);
  const action = await choose(tools.dialog, `Invitation to ${teamName}`, [
    { id: "accept", label: `Join ${teamName}`, description: invitation.inviterEmail ? `Invited by ${invitation.inviterEmail}` : undefined },
    { id: "decline", label: "Decline" },
  ]);
  if (!action) return;
  try {
    if (action === "accept") {
      await apiClient.acceptTeamInvitation(invitation.id);
      await teamStore.refresh();
      const team = teamStore.getTeam(invitation.organizationId);
      tools.notify({
        title: team ? teamLabel(team) : teamName,
        body: `You joined ${teamName}. #general is in the chat sidebar.`,
        type: "success",
        ...(team ? { action: { label: "Open chat", onClick: () => tools.openTeamChannel(team.id) } } : {}),
      });
      if (team) await teamStore.dismissNotificationsForTeam(team.id, ["team-invite"]);
    } else {
      await apiClient.rejectTeamInvitation(invitation.id);
      await teamStore.refresh();
      await teamStore.dismissNotificationsForTeam(invitation.organizationId, ["team-invite"]);
    }
  } catch (error) {
    tools.notify({ body: errorText(error, "Could not answer the invitation."), type: "error" });
  }
}

/** Lists pending invitations and lets the person answer one. */
export async function reviewInvitationsFlow(tools: TeamFlowTools): Promise<void> {
  await teamStore.refresh();
  const invitations = teamStore.getSnapshot().invitations;
  if (invitations.length === 0) {
    tools.notify({ body: "No pending team invitations.", type: "info" });
    return;
  }
  if (invitations.length === 1) return respondToInvitationFlow(tools, invitations[0]!);
  const id = await choose(
    tools.dialog,
    "Team invitations",
    invitations.map((invitation) => ({
      id: invitation.id,
      label: invitationTeamName(invitation),
      description: invitation.inviterEmail ? `Invited by ${invitation.inviterEmail}` : undefined,
    })),
  );
  const invitation = invitations.find((entry) => entry.id === id);
  if (invitation) await respondToInvitationFlow(tools, invitation);
}
