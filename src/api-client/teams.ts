import { normalizeTeamNotification } from "./normalizers";
import type { CloudApiSocket } from "./socket";
import type {
  TeamAccentColor,
  TeamInvitation,
  TeamInviteLink,
  TeamInvitePreview,
  TeamMember,
  TeamNotification,
  TeamRole,
  TeamSummary,
  TeamUsernameInvitation,
} from "./types";

type CloudApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
type TeamNotificationListener = (notification: TeamNotification) => void;
type CloudEventListener = (data: unknown) => void;

interface CloudTeamsApiOptions {
  request: CloudApiRequest;
  socket: CloudApiSocket;
}

export class CloudTeamsApi {
  constructor(private readonly options: CloudTeamsApiOptions) {}

  async listTeams(): Promise<TeamSummary[]> {
    const body = await this.options.request<{ teams: TeamSummary[] }>("/teams");
    return body.teams;
  }

  async createTeam(input: {
    name: string;
    accentColor?: TeamAccentColor;
    shortName?: string;
  }): Promise<TeamSummary> {
    return this.options.request<TeamSummary>("/teams", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getTeamMembers(
    teamId: string,
  ): Promise<{ team: TeamSummary; members: TeamMember[] }> {
    return this.options.request<{ team: TeamSummary; members: TeamMember[] }>(
      `/teams/${encodeURIComponent(teamId)}/members`,
    );
  }

  async inviteTeamMemberByUsername(
    teamId: string,
    username: string,
  ): Promise<TeamUsernameInvitation> {
    return this.options.request<TeamUsernameInvitation>(
      `/teams/${encodeURIComponent(teamId)}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ username }),
      },
    );
  }

  async listTeamInviteLinks(teamId: string): Promise<TeamInviteLink[]> {
    const body = await this.options.request<{ links: TeamInviteLink[] }>(
      `/teams/${encodeURIComponent(teamId)}/invite-links`,
    );
    return body.links;
  }

  async createTeamInviteLink(
    teamId: string,
    options?: { expiresInDays?: number; maxUses?: number | null },
  ): Promise<TeamInviteLink> {
    return this.options.request<TeamInviteLink>(
      `/teams/${encodeURIComponent(teamId)}/invite-links`,
      {
        method: "POST",
        body: JSON.stringify(options ?? {}),
      },
    );
  }

  async deleteTeamInviteLink(teamId: string, token: string): Promise<void> {
    await this.options.request<void>(
      `/teams/${encodeURIComponent(teamId)}/invite-links/${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
  }

  async previewTeamInviteLink(token: string): Promise<TeamInvitePreview> {
    return this.options.request<TeamInvitePreview>(
      `/teams/join/${encodeURIComponent(token)}`,
    );
  }

  async joinTeamThroughLink(token: string): Promise<TeamSummary> {
    return this.options.request<TeamSummary>(
      `/teams/join/${encodeURIComponent(token)}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  }

  async getTeamNotifications(): Promise<TeamNotification[]> {
    const body = await this.options.request<{
      notifications: TeamNotification[];
    }>("/teams/notifications");
    return body.notifications.map((notification) =>
      normalizeTeamNotification(notification),
    );
  }

  async inviteTeamMemberByEmail(
    teamId: string,
    email: string,
  ): Promise<TeamInvitation> {
    return this.options.request<TeamInvitation>(
      "/auth/organization/invite-member",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          role: "member",
          organizationId: teamId,
          resend: true,
        }),
      },
    );
  }

  async listTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
    const invitations = await this.options.request<TeamInvitation[]>(
      `/auth/organization/list-invitations?organizationId=${encodeURIComponent(teamId)}`,
    );
    return invitations.filter((invitation) => invitation.status === "pending");
  }

  async listMyTeamInvitations(): Promise<TeamInvitation[]> {
    const invitations = await this.options.request<TeamInvitation[]>(
      "/auth/organization/list-user-invitations",
    );
    return invitations.filter((invitation) => invitation.status === "pending");
  }

  async acceptTeamInvitation(invitationId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/accept-invitation", {
      method: "POST",
      body: JSON.stringify({ invitationId }),
    });
  }

  async rejectTeamInvitation(invitationId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/reject-invitation", {
      method: "POST",
      body: JSON.stringify({ invitationId }),
    });
  }

  async cancelTeamInvitation(invitationId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/cancel-invitation", {
      method: "POST",
      body: JSON.stringify({ invitationId }),
    });
  }

  async updateTeam(
    teamId: string,
    data: {
      name?: string;
      metadata?: {
        accentColor?: TeamAccentColor;
        shortName?: string;
        allowMemberInvites?: boolean;
      };
    },
  ): Promise<void> {
    await this.options.request<void>("/auth/organization/update", {
      method: "POST",
      body: JSON.stringify({ organizationId: teamId, data }),
    });
  }

  async updateTeamMemberRole(
    teamId: string,
    memberId: string,
    role: TeamRole,
  ): Promise<void> {
    await this.options.request<void>("/auth/organization/update-member-role", {
      method: "POST",
      body: JSON.stringify({ organizationId: teamId, memberId, role }),
    });
  }

  async removeTeamMember(teamId: string, memberId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/remove-member", {
      method: "POST",
      body: JSON.stringify({
        organizationId: teamId,
        memberIdOrEmail: memberId,
      }),
    });
  }

  async leaveTeam(teamId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/leave", {
      method: "POST",
      body: JSON.stringify({ organizationId: teamId }),
    });
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.options.request<void>("/auth/organization/delete", {
      method: "POST",
      body: JSON.stringify({ organizationId: teamId }),
    });
  }

  subscribeTeamNotifications(listener: TeamNotificationListener): () => void {
    return this.options.socket.subscribeTeamNotifications(listener);
  }

  subscribeCloudEvent(type: string, listener: CloudEventListener): () => void {
    return this.options.socket.subscribeCloudEvent(type, listener);
  }
}
