import { describe, expect, test } from "bun:test";
import { MARKET_DATA_NOTIFY_THROTTLE_MS, MarketDataCoordinatorEvents } from "./events";

const waitMicrotask = () => Promise.resolve();
const waitTimer = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitThrottle = () => new Promise((resolve) => setTimeout(resolve, MARKET_DATA_NOTIFY_THROTTLE_MS + 20));

describe("MarketDataCoordinatorEvents", () => {
  test("coalesces version bumps before notifying external-store listeners", async () => {
    const events = new MarketDataCoordinatorEvents();
    const calls: number[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      calls.push(events.getKeysVersion(["quote:AMD"]));
    });

    events.bump("quote:AMD");
    events.bump("quote:AMD");

    expect(events.getKeysVersion(["quote:AMD"])).toBe(0);
    expect(calls).toEqual([]);

    await waitMicrotask();
    expect(events.getKeysVersion(["quote:AMD"])).toBe(1);
    expect(calls).toEqual([]);

    await waitTimer();
    expect(calls).toEqual([1]);
  });

  test("delivers bumps scheduled during notification in a later notification pass", async () => {
    const events = new MarketDataCoordinatorEvents();
    const order: string[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      order.push("AMD");
      events.bump("quote:NVDA");
    });
    events.subscribeKeys(["quote:NVDA"], () => {
      order.push("NVDA");
    });

    events.bump("quote:AMD");
    await waitMicrotask();
    await waitTimer();
    expect(order).toEqual(["AMD"]);

    await waitThrottle();
    expect(order).toEqual(["AMD", "NVDA"]);
  });

  test("a burst of ticks notifies once at the leading edge and once when the window closes", async () => {
    const events = new MarketDataCoordinatorEvents();
    const calls: number[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      calls.push(events.getKeysVersion(["quote:AMD"]));
    });

    events.bump("quote:AMD");
    await waitMicrotask();
    await waitTimer();
    expect(calls).toEqual([1]);

    // Ticks inside the window each land in their own task, as streamed quotes do.
    for (let tick = 0; tick < 5; tick += 1) {
      events.bump("quote:AMD");
      await waitMicrotask();
      await waitTimer();
    }
    expect(events.getKeysVersion(["quote:AMD"])).toBe(6);
    expect(calls).toEqual([1]);

    await waitThrottle();
    expect(calls).toEqual([1, 6]);
  });
});
