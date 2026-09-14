import type {
  TeamAccentColor,
  TeamInvitation,
  TeamNotification,
  TeamRole,
  TeamSummary,
} from "../../../../api-client";
import { blendHex, colors } from "../../../../theme/colors";

export const TEAM_CHANNEL_PREFIX = "team:";

/** The text marker for team content on terminals without color: `MD·`. */
export function teamPrefix(team: Pick<TeamSummary, "shortName">): string {
  return `${team.shortName}·`;
}

export function teamChannelId(teamId: string): string {
  return `${TEAM_CHANNEL_PREFIX}${teamId}`;
}

export function teamIdFromChannelId(channelId: string): string | null {
  return channelId.startsWith(TEAM_CHANNEL_PREFIX)
    ? channelId.slice(TEAM_CHANNEL_PREFIX.length) || null
    : null;
}

/**
 * Accent tokens map onto the active theme rather than fixed hexes so a team
 * marker still reads as one of the theme's colors. Positive and negative are
 * avoided as bases for the greens and reds so a team never looks like P&L.
 */
export function teamAccentHex(accent: TeamAccentColor): string {
  switch (accent) {
    case "amber":
      return colors.warning;
    case "blue":
      return colors.borderFocused;
    case "cyan":
      return blendHex(colors.borderFocused, colors.positive, 0.5);
    case "green":
      return blendHex(colors.positive, colors.textBright, 0.3);
    case "magenta":
      return blendHex(colors.negative, colors.borderFocused, 0.45);
    case "orange":
      return blendHex(colors.warning, colors.negative, 0.4);
    case "red":
      return blendHex(colors.negative, colors.textBright, 0.25);
    case "violet":
      return blendHex(colors.borderFocused, colors.negative, 0.35);
    default:
      return colors.text;
  }
}

export function roleLabel(role: TeamRole): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

export function canManageTeam(role: TeamRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canInviteToTeam(team: Pick<TeamSummary, "role" | "allowMemberInvites">): boolean {
  return canManageTeam(team.role) || team.allowMemberInvites;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/^[#@]+/, "").replace(/·$/, "").toLowerCase();
}

/**
 * Resolves what someone typed after `TEAM` or `CHAT` to a team: the id, the
 * short name (`MD`), the slug, or the name. Exact matches win over prefixes so
 * `rat` finds "Rates" without ambiguity when "Rates Desk" also exists.
 */
export function findTeam(
  teams: readonly TeamSummary[],
  query: string,
): TeamSummary | null {
  const needle = normalizeQuery(query);
  if (!needle) return null;
  const exact = teams.find((team) =>
    team.id === query.trim() ||
    team.shortName.toLowerCase() === needle ||
    team.slug.toLowerCase() === needle ||
    team.name.toLowerCase() === needle,
  );
  if (exact) return exact;
  const prefixed = teams.filter((team) =>
    team.name.toLowerCase().startsWith(needle) ||
    team.shortName.toLowerCase().startsWith(needle),
  );
  return prefixed.length === 1 ? prefixed[0]! : null;
}

export function teamLabel(team: Pick<TeamSummary, "name" | "shortName">): string {
  return `${teamPrefix(team)} ${team.name}`;
}

export function describeTeam(team: TeamSummary): string {
  const members = team.memberCount === 1 ? "1 member" : `${team.memberCount} members`;
  return `${roleLabel(team.role)} · ${members}`;
}

export function invitationTeamName(invitation: TeamInvitation): string {
  return invitation.organizationName?.trim() || "a team";
}

/** Toast text for the team frames the server sends. */
export function describeTeamNotification(notification: TeamNotification): {
  title: string;
  body: string;
} {
  const data = notification.data;
  const who = (actor: { username: string | null; displayName: string }) =>
    actor.username ? `@${actor.username}` : actor.displayName;
  switch (data.kind) {
    case "team-invite":
      return {
        title: teamLabel(data.team),
        body: `${who(data.inviter)} invited you to ${data.team.name}. Run TEAM to accept.`,
      };
    case "team-joined":
      return {
        title: teamLabel(data.team),
        body: `${who(data.member)} joined ${data.team.name}.`,
      };
    case "layout-updated":
      return {
        title: teamLabel(data.team),
        body: `${who(data.author)} published ${data.layoutName} r${data.revision}.`,
      };
    default:
      return { title: "Team", body: "Team update." };
  }
}

/** Unread counts per team for the status bar: pending invites and layout updates. */
export function countTeamUpdates(
  notifications: readonly TeamNotification[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const notification of notifications) {
    const teamId = notification.data.team.id;
    counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return counts;
}
