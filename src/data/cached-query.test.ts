import { expect, test } from "bun:test";
import { CachedQuery, type CachedValue } from "./cached-query";

const value = (name: string, time = Date.now()): CachedValue<string> => ({
  value: name, fetchedAt: time, staleAt: time + 600_000, expiresAt: time + 3_600_000, source: "test",
});

test("hydration, cache reads and failed refreshes retain successful response identity", async () => {
  const seeded = value("hydrated");
  let calls = 0;
  let fail = false;
  const query = new CachedQuery({ read: () => seeded, fetch: async () => {
    calls++;
    if (fail) throw new Error("offline");
    return value(`response-${calls}`, seeded.fetchedAt);
  } });
  expect(await query.load()).toBe(seeded);
  expect(calls).toBe(0);
  expect(seeded.responseSequence).toBeUndefined();
  const first = await query.load({ force: true });
  expect(first.responseSequence).toBeGreaterThan(0);
  expect(await query.load()).toBe(first);
  fail = true;
  const refresh = query.load({ force: true });
  expect(query.getSnapshot().result).toBe(first);
  expect(query.getSnapshot().loading).toBe(true);
  expect((await refresh).responseSequence).toBe(first.responseSequence);
  expect(query.getSnapshot().result).toBe(first);
  expect(query.getSnapshot().error).toBeInstanceOf(Error);
  fail = false;
  const recovered = await query.load({ force: true });
  expect(recovered.fetchedAt).toBe(first.fetchedAt);
  expect(recovered.responseSequence).toBeGreaterThan(first.responseSequence!);
  expect(query.getSnapshot().error).toBeNull();
});

test("cross-query order follows accepted completion, excluding superseded and disposed results", async () => {
  const pending: Array<(result: CachedValue<string>) => void> = [];
  const query = new CachedQuery({ read: () => null, fetch: () => new Promise<CachedValue<string>>((resolve) => pending.push(resolve)) });
  const first = query.load(); await Promise.resolve();
  const replacement = query.load({ force: true, replace: true }); await Promise.resolve();
  const time = Date.now();
  pending[1]!(value("accepted", time));
  const accepted = await replacement;
  pending[0]!(value("superseded", time));
  expect((await first).responseSequence).toBeUndefined();
  expect(query.getSnapshot().result).toBe(accepted);
  const disposedRequest = query.load({ force: true }); await Promise.resolve();
  query.dispose(); pending[2]!(value("disposed", time));
  expect((await disposedRequest).responseSequence).toBeUndefined();
  expect(query.getSnapshot().result).toBe(accepted);
  const peer = new CachedQuery({ read: () => null, fetch: async () => value("peer", time) });
  const later = await peer.load();
  expect(later.fetchedAt).toBe(accepted.fetchedAt);
  expect(later.responseSequence).toBe(accepted.responseSequence! + 1);
});
