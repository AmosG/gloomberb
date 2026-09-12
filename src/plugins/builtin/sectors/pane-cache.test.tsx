import { afterAll, afterEach, expect, test } from "bun:test";
import { act, useReducer } from "react";
import { mkdirSync, writeFileSync } from "node:fs";

const source = process.env.SECTOR_CACHE_SOURCE ?? new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const out = process.env.SECTOR_CACHE_OUT;
if (out) mkdirSync(out, { recursive: true });
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
let externalAttempts = 0;
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("data:")) return originalFetch(input, init);
  externalAttempts++;
  throw new Error("External request prohibited in sector cache regression");
}) as typeof fetch;
globalThis.WebSocket = class { constructor() { externalAttempts++; throw new Error("External socket prohibited"); } } as any;

const { sectorsModule } = await import(`${source}/src/plugins/builtin/sectors/index.tsx`);
const { testRender, takeSavedTextFile } = await import(`${source}/src/renderers/opentui/test-utils.tsx`);
const { createInitialState, appReducer } = await import(`${source}/src/state/app/context/index.tsx`);
const { TestPaneProvider, createTestPaneConfig } = await import(`${source}/src/test-support/pane.tsx`);
const { createTestPluginRuntime } = await import(`${source}/src/test-support/plugin-runtime.ts`);
const { exportPaneTable } = await import(`${source}/src/state/pane-table-export-registry.ts`);
const Pane = sectorsModule.panes[0].component;
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
const cases: unknown[] = [];

afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
});
afterAll(() => {
  if (out) writeFileSync(`${out}/observations.json`, JSON.stringify({ source, externalAttempts, cases }, null, 2));
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  if (externalAttempts) throw new Error("Unexpected external attempt");
});

for (const version of ["v3", "v4"]) test(`opening without a provider handles the ${version} computed-row cache`, async () => {
  const config = createTestPaneConfig("/tmp/sector-cache-controlled", {
    instanceId: "sector-cache", paneId: "sectors", settings: { industryEtfs: ["GDX"] },
  });
  config.refreshIntervalMinutes = 0;
  const state = createInitialState(config);
  state.focusedPaneId = "sector-cache";
  state.paneState["sector-cache"] = { pluginState: { "market-overview": {
    activeCollectionId: "industries", selectedEtf: "GDX",
    [`rowsByCollection:${version}`]: { sectors: [], industries: [{
      name: "Gold Miners", etf: "GDX", price: version === "v3" ? 150 : 110, currency: "USD", changePercent: 0,
      return1M: version === "v3" ? 50 : 10, return1Y: version === "v3" ? 50 : 10,
      returnAsOfDate: "2026-09-10", return1MStartDate: version === "v3" ? "2026-08-07" : "2026-08-10",
      return1YStartDate: version === "v3" ? "2025-09-09" : "2025-09-10", loading: false,
    }] },
  } } };
  const runtime = createTestPluginRuntime(); // No provider is connected during reopening.
  function Harness() {
    const [current, dispatch] = useReducer(appReducer, state);
    return <TestPaneProvider state={current} dispatch={dispatch} paneId="sector-cache" pluginId="market-overview" runtime={runtime}>
      <Pane focused width={82} height={10} />
    </TestPaneProvider>;
  }
  await act(async () => { setup = await testRender(<Harness />, { width: 82, height: 10 }); });
  for (let index = 0; index < 4; index++) await act(async () => { await setup!.renderOnce(); });
  const frame = setup!.captureCharFrame();
  await exportPaneTable("sector-cache", `${version}.csv`);
  const csv = takeSavedTextFile()!.text;
  if (out) {
    writeFileSync(`${out}/${version}.txt`, frame);
    writeFileSync(`${out}/${version}.csv`, csv);
  }
  cases.push({ version, frame, csv });
  expect(frame).toContain("GDX");
  expect(csv).not.toContain("+50.00%");
  expect(frame).not.toContain("+50.00%");
  expect(csv.includes("+10.00%")).toBe(version === "v4");
  expect(frame.includes("+10.00%")).toBe(version === "v4");
});
