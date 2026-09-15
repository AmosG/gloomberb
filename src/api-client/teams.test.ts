import { afterEach, describe, expect, test } from "bun:test";
import type { AuthUser, TeamNotification } from "./index";
import { apiClient, setCloudApiFetchTransport } from "./index";

const originalWebSocket = globalThis.WebSocket;

const verifiedUser: AuthUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  username: "test",
  emailVerified: true,
  image: null,
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z",
};

function createResponse(body: unknown): Response {
  const headers = {
    getSetCookie: () => [],
    get: () => null,
  } as unknown as Headers;

  return {
    ok: true,
    status: 200,
    headers,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface RecordedRequest {
  path: string;
  search: string;
  method: string;
  body: unknown;
}

function recordRequests(
  respond: (request: RecordedRequest) => unknown,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  setCloudApiFetchTransport(async (url, init) => {
    const parsed = new URL(url);
    const request: RecordedRequest = {
      path: parsed.pathname,
      search: parsed.search,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    requests.push(request);
    return createResponse(respond(request));
  });
  return requests;
}

class TestWebSocket {
  static readonly OPEN = 1;
  readyState = 1;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.onopen?.({});
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function installTestWebSocket(): TestWebSocket[] {
  const sockets: TestWebSocket[] = [];

  class InstalledTestWebSocket extends TestWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  }

  globalThis.WebSocket = InstalledTestWebSocket as unknown as typeof WebSocket;
  return sockets;
}

afterEach(() => {
  apiClient.dispose();
  globalThis.WebSocket = originalWebSocket;
  setCloudApiFetchTransport(null);
  apiClient.setSessionToken(null);
  apiClient.setWebSocketToken(null);
  apiClient.setCookieSessionMode(false);
});

describe("apiClient teams", () => {
  test("unwraps the team list and posts created teams", async () => {
    const team = {
      id: "team-1",
      name: "Research Desk",
      slug: "research-desk",
      accentColor: "violet" as const,
      shortName: "RD",
      allowMemberInvites: true,
      channelId: "team-1-channel",
      createdAt: "2026-05-01T00:00:00.000Z",
      role: "owner" as const,
      memberCount: 1,
    };
    const requests = recordRequests((request) =>
      request.method === "POST" ? team : { teams: [team] },
    );

    await expect(apiClient.listTeams()).resolves.toEqual([team]);
    await expect(
      apiClient.createTeam({
        name: "Research Desk",
        accentColor: "violet",
        shortName: "RD",
      }),
    ).resolves.toEqual(team);

    expect(requests).toEqual([
      { path: "/teams", search: "", method: "GET", body: null },
      {
        path: "/teams",
        search: "",
        method: "POST",
        body: { name: "Research Desk", accentColor: "violet", shortName: "RD" },
      },
    ]);
  });

  test("invites by email through the organization plugin", async () => {
    const requests = recordRequests(() => ({
      id: "invitation-1",
      organizationId: "team-1",
      email: "analyst@example.com",
      role: "member",
      status: "pending",
      expiresAt: "2026-05-08T00:00:00.000Z",
      inviterId: "user-1",
    }));

    const invitation = await apiClient.inviteTeamMemberByEmail(
      "team-1",
      "analyst@example.com",
    );

    expect(requests).toEqual([
      {
        path: "/auth/organization/invite-member",
        search: "",
        method: "POST",
        body: {
          email: "analyst@example.com",
          role: "member",
          organizationId: "team-1",
          resend: true,
        },
      },
    ]);
    expect(invitation.id).toBe("invitation-1");
  });

  test("keeps only pending invitations", async () => {
    const invitation = (id: string, status: string) => ({
      id,
      organizationId: "team-1",
      email: `${id}@example.com`,
      role: "member",
      status,
      expiresAt: "2026-05-08T00:00:00.000Z",
      inviterId: "user-1",
    });
    const requests = recordRequests(() => [
      invitation("pending-1", "pending"),
      invitation("canceled-1", "canceled"),
      invitation("accepted-1", "accepted"),
    ]);

    const invitations = await apiClient.listTeamInvitations("team-1");

    expect(requests[0]?.path).toBe("/auth/organization/list-invitations");
    expect(requests[0]?.search).toBe("?organizationId=team-1");
    expect(invitations.map((entry) => entry.id)).toEqual(["pending-1"]);
  });

  test("normalizes team notification timestamps", async () => {
    recordRequests(() => ({
      notifications: [
        {
          id: "n1",
          type: "team-invite",
          channelId: "team-1-channel",
          createdAt: "2026-05-01 07:30:00.000",
          data: {
            kind: "team-invite",
            team: {
              id: "team-1",
              name: "Research Desk",
              accentColor: "violet",
              shortName: "RD",
            },
            invitationId: "invitation-1",
            expiresAt: "2026-05-08T00:00:00.000Z",
            inviter: { id: "user-1", username: "vince", displayName: "Vince" },
          },
        },
      ],
    }));

    const notifications = await apiClient.getTeamNotifications();

    expect(notifications[0]?.createdAt).toBe("2026-05-01T07:30:00.000Z");
  });

  test("routes team notifications and cloud events to their subscribers", () => {
    const sockets = installTestWebSocket();
    apiClient.setSessionToken("session-token");
    apiClient.restoreCachedUser(verifiedUser);

    const seenNotifications: TeamNotification[] = [];
    const seenNotes: unknown[] = [];
    const unsubscribeNotifications = apiClient.subscribeTeamNotifications(
      (notification) => {
        seenNotifications.push(notification);
      },
    );
    const unsubscribeNotes = apiClient.subscribeCloudEvent(
      "note.updated",
      (data) => {
        seenNotes.push(data);
      },
    );

    const socket = sockets[0]!;
    socket.open();
    socket.receive({
      type: "team.notification",
      data: {
        id: "n1",
        type: "team-joined",
        channelId: "team-1-channel",
        createdAt: "2026-05-01 07:30:00.000",
        data: {
          kind: "team-joined",
          team: {
            id: "team-1",
            name: "Research Desk",
            accentColor: "violet",
            shortName: "RD",
          },
          member: { id: "user-2", username: "bob", displayName: "Bob" },
        },
      },
    });
    socket.receive({ type: "note.updated", data: { noteId: "note-1" } });
    socket.receive({ type: "chat.presence", onlineCount: 3 });

    expect(seenNotifications).toHaveLength(1);
    expect(seenNotifications[0]?.createdAt).toBe("2026-05-01T07:30:00.000Z");
    expect(seenNotes).toEqual([{ noteId: "note-1" }]);

    unsubscribeNotifications();
    unsubscribeNotes();
  });
});
