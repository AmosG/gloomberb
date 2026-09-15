import { describe, expect, test } from "bun:test";
import type { TeamNotification, TeamSummary } from "../../../../api-client";
import {
  canInviteToTeam,
  canManageTeam,
  countTeamUpdates,
  describeTeamNotification,
  findTeam,
  teamChannelId,
  teamIdFromChannelId,
  teamLabel,
  teamPrefix,
} from "./model";

function team(overrides: Partial<TeamSummary>): TeamSummary {
  return {
    id: "org-1",
    name: "Macro Desk",
    slug: "macro-desk-abc123",
    accentColor: "magenta",
    shortName: "MD",
    allowMemberInvites: false,
    channelId: "team:org-1",
    createdAt: "2026-09-14T12:00:00.000Z",
    role: "member",
    memberCount: 3,
    ...overrides,
  };
}

describe("team markers", () => {
  test("prefix and label use the short name", () => {
    expect(teamPrefix(team({}))).toBe("MD·");
    expect(teamLabel(team({}))).toBe("MD· Macro Desk");
  });

  test("channel ids round-trip", () => {
    expect(teamChannelId("org-1")).toBe("team:org-1");
    expect(teamIdFromChannelId("team:org-1")).toBe("org-1");
    expect(teamIdFromChannelId("everyone")).toBeNull();
    expect(teamIdFromChannelId("team:")).toBeNull();
  });
});

describe("roles", () => {
  test("owners and admins manage; members invite only when allowed", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("member")).toBe(false);
    expect(canInviteToTeam(team({ role: "member" }))).toBe(false);
    expect(canInviteToTeam(team({ role: "member", allowMemberInvites: true }))).toBe(true);
    expect(canInviteToTeam(team({ role: "admin" }))).toBe(true);
  });
});

describe("findTeam", () => {
  const teams = [
    team({ id: "a", name: "Macro Desk", shortName: "MD", slug: "macro-desk-1" }),
    team({ id: "b", name: "Rates", shortName: "RT", slug: "rates-2" }),
    team({ id: "c", name: "Rates Desk", shortName: "RD", slug: "rates-desk-3" }),
  ];

  test("matches id, short name, slug, and name exactly, ignoring case and markers", () => {
    expect(findTeam(teams, "a")?.id).toBe("a");
    expect(findTeam(teams, "md")?.id).toBe("a");
    expect(findTeam(teams, "MD·")?.id).toBe("a");
    expect(findTeam(teams, "#rates-2")?.id).toBe("b");
    expect(findTeam(teams, "rates desk")?.id).toBe("c");
  });

  test("exact wins over prefix and ambiguous prefixes return nothing", () => {
    expect(findTeam(teams, "rates")?.id).toBe("b");
    expect(findTeam(teams, "rat")).toBeNull();
    expect(findTeam(teams, "mac")?.id).toBe("a");
    expect(findTeam(teams, "")).toBeNull();
    expect(findTeam(teams, "nothing")).toBeNull();
  });
});

describe("notifications", () => {
  const base = { id: "n1", channelId: "team:org-1", createdAt: "2026-09-14T12:00:00.000Z" };
  const teamCard = { id: "org-1", name: "Macro Desk", accentColor: "magenta" as const, shortName: "MD" };

  test("describes each kind for a toast", () => {
    const invite: TeamNotification = {
      ...base,
      type: "team-invite",
      data: {
        kind: "team-invite",
        team: teamCard,
        invitationId: "inv-1",
        expiresAt: "2026-09-21T12:00:00.000Z",
        inviter: { id: "u1", username: "vince", displayName: "Vince" },
      },
    };
    expect(describeTeamNotification(invite)).toEqual({
      title: "MD· Macro Desk",
      body: "@vince invited you to Macro Desk. Run TEAM to accept.",
    });

    const joined: TeamNotification = {
      ...base,
      id: "n2",
      type: "team-joined",
      data: { kind: "team-joined", team: teamCard, member: { id: "u2", username: null, displayName: "Bob Jones" } },
    };
    expect(describeTeamNotification(joined).body).toBe("Bob Jones joined Macro Desk.");

    const layout: TeamNotification = {
      ...base,
      id: "n3",
      type: "layout-updated",
      data: {
        kind: "layout-updated",
        team: teamCard,
        layoutId: "l1",
        layoutName: "Morning",
        revision: 4,
        author: { id: "u1", username: "vince", displayName: "Vince" },
      },
    };
    expect(describeTeamNotification(layout).body).toBe("@vince published Morning r4.");
    expect(countTeamUpdates([invite, joined, layout])).toEqual(new Map([["org-1", 3]]));
  });
});
