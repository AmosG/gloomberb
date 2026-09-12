import { afterEach, expect, spyOn, test } from "bun:test";
import { MemoryPluginPersistence } from "../../../test-support/plugin-persistence";
import { createSeriesCache, type DatedObservation } from "./series-cache";

const observations = [{ date: "2026-01-01", value: 100 }];
let clock: ReturnType<typeof spyOn> | undefined;
afterEach(() => clock?.mockRestore());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("array hydration remains available without inventing retrieval metadata or requesting data", async () => {
  const cache = createSeriesCache("test", 60_000);
  cache.hydrate([["key", observations], ["empty", []]]);
  const loader = async () => { throw new Error("no cloud in snapshot renderer"); };
  expect(await cache.load("key", loader)).toBe(observations);
  expect(await cache.load("empty", loader)).toEqual([]);
  expect(await cache.loadEntry("key", loader, { force: true })).toEqual({ observations, fetchedAt: null, stale: null, source: "hydrated" });
  cache.reset();
  await expect(cache.load("key", loader)).rejects.toThrow("no cloud");
});

test("metadata loads join existing requests and preserve array cache reads", async () => {
  const cache = createSeriesCache("test", 60_000);
  const store = new MemoryPluginPersistence();
  cache.attach(store);
  const request = deferred<DatedObservation[]>();
  let calls = 0;
  const first = cache.load("key", () => { calls++; return request.promise; });
  const joined = cache.loadEntry("key", async () => { calls++; return []; }, { force: true });
  request.resolve(observations);
  expect(await first).toEqual(observations);
  expect((await joined).observations).toEqual(observations);
  expect(calls).toBe(1);
  expect(await cache.load("key", async () => { throw new Error("fresh"); })).toEqual(observations);
  expect(cache.get("key")?.stale).toBe(false);
});

test("successful retrieval in the same millisecond clears retained refresh failure", async () => {
  clock = spyOn(Date, "now").mockReturnValue(1_000_000);
  const cache = createSeriesCache("test", 60_000);
  await cache.load("key", async () => observations);
  const failure = await cache.loadEntry("key", async () => { throw new Error("outage"); }, { force: true });
  expect(failure).toMatchObject({ fetchedAt: 1_000_000, stale: true, refreshError: "outage" });
  expect(cache.get("key")).toMatchObject({ stale: true, refreshError: "outage" });
  await cache.loadEntry("key", async () => observations, { force: true });
  expect(cache.get("key")).toMatchObject({ fetchedAt: 1_000_000, stale: false });
  expect(cache.get("key")?.refreshError).toBeUndefined();
});

test("old failed requests cannot carry metadata across reset and attachment", async () => {
  clock = spyOn(Date, "now").mockReturnValue(1_000_000);
  const cache = createSeriesCache("test", 60_000);
  cache.attach(new MemoryPluginPersistence());
  await cache.load("key", async () => observations);
  const delayed = deferred<DatedObservation[]>();
  const old = cache.loadEntry("key", () => delayed.promise, { force: true });
  cache.reset();
  cache.attach(new MemoryPluginPersistence());
  await cache.load("key", async () => observations);
  delayed.reject(new Error("old owner"));
  await old;
  expect(cache.get("key")).toMatchObject({ stale: false });
  expect(cache.get("key")?.refreshError).toBeUndefined();
});

test("failure status survives distinct retrieval and persistence timestamps without another request", async () => {
  let time = 1_000_000;
  clock = spyOn(Date, "now").mockImplementation(() => time++);
  const cache = createSeriesCache("test", 60_000);
  cache.attach(new MemoryPluginPersistence());
  const initial = await cache.loadEntry("key", async () => observations);
  expect(cache.get("key")?.fetchedAt).not.toBe(initial.fetchedAt);
  await cache.loadEntry("key", async () => { throw new Error("outage"); }, { force: true });
  const cached = await cache.loadEntry("key", async () => { throw new Error("must not request"); });
  expect(cached).toMatchObject({ fetchedAt: initial.fetchedAt, stale: true, refreshError: "outage" });
  expect(cache.get("key")).toMatchObject({ stale: true, refreshError: "outage" });
});
