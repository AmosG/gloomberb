import { afterEach, expect, spyOn, test } from "bun:test";
import { act, useState } from "react";
import { apiClient, type CloudProxyStatementListPayload, type CloudProxyStatementPayload } from "../../../api-client";
import { PaneFooterBar, PaneFooterProvider } from "../../../components/layout/pane/footer";
import { testRender } from "../../../renderers/opentui/test-utils";
import { createInitialState } from "../../../state/app/context";
import { createTestPaneConfig, createTestTicker, TestPaneProvider } from "../../../test-support/pane";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { Box } from "../../../ui";
import { resetExecutivesPersistence } from "./data";
import { ExecutivesPane } from "./pane";

function statement(ticker: string, year: number): CloudProxyStatementPayload {
  return {
    id: `${ticker}-${year}`, ticker, proxyYear: year, fiscalYear: year - 1,
    fiscalYearLabel: `Fiscal ${year - 1}`, filedAt: `${year}-04-01`, updatedAt: `${year}-04-01`,
    company: { ticker, cik: null, name: ticker, shortName: ticker }, meetingDate: null,
    ceoName: null, ceoTitle: null, ceoTotal: null, ceoPriorYearTotal: null,
    payRatio: null, medianEmployeePay: null, sayOnPayPriorSupport: null,
    docUrl: `https://example.com/${ticker}/${year}`, ceo: null, namedExecutives: [],
    highlights: `${ticker} compensation ${year}`, keyFigures: [], otherYears: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let setup: Awaited<ReturnType<typeof testRender>> | undefined;
const restore: Array<() => void> = [];
afterEach(async () => {
  if (setup) await act(async () => setup!.renderer.destroy());
  setup = undefined;
  for (const undo of restore.splice(0)) undo();
  resetExecutivesPersistence();
});
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await setup!.renderOnce();
  });
}
async function mount() {
  const paneId = "executives:test";
  let selectTicker!: (ticker: string) => void;
  const runtime = createTestPluginRuntime();
  function Harness() {
    const [symbol, setSymbol] = useState("ALPHA");
    selectTicker = setSymbol;
    const state = createInitialState(createTestPaneConfig("/tmp/executives-test", {
      paneId: "executives", instanceId: paneId, binding: { kind: "fixed", symbol },
    }));
    state.tickers.set(symbol, createTestTicker(symbol));
    return <TestPaneProvider state={state} paneId={paneId} pluginId="ticker-research" runtime={runtime}>
      <PaneFooterProvider>{footer => <Box width={100} height={24} flexDirection="column">
        <Box height={23}><ExecutivesPane focused width={100} height={23} /></Box>
        <PaneFooterBar footer={footer} focused width={100} />
      </Box>}</PaneFooterProvider>
    </TestPaneProvider>;
  }
  setup = await testRender(<Harness />, { width: 100, height: 24 });
  await settle();
  return async (ticker: string) => { await act(async () => selectTicker(ticker)); await settle(); };
}
async function selectYear(year: number) {
  const lines = setup!.captureCharFrame().split("\n");
  const y = lines.findIndex(line => line.includes(`${year} proxy`));
  expect(y).toBeGreaterThanOrEqual(0);
  const x = lines[y]!.indexOf(`${year} proxy`);
  await act(async () => setup!.mockMouse.click(x + 2, y));
  await settle();
}

test("a different proxy year clears the prior figures and filing action, and a failed year remains recoverable", async () => {
  const earlier = deferred<CloudProxyStatementPayload>();
  const list = spyOn(apiClient, "getProxyStatements").mockResolvedValue({ company: statement("ALPHA", 2026).company, proxies: [statement("ALPHA", 2026), statement("ALPHA", 2025)] });
  const detail = spyOn(apiClient, "getProxyStatement").mockImplementation(async (ticker, year) => year === 2025 ? earlier.promise : statement(ticker, year));
  restore.push(() => list.mockRestore(), () => detail.mockRestore());
  await mount();
  expect(setup!.captureCharFrame()).toContain("ALPHA compensation 2026");
  expect(setup!.captureCharFrame()).toContain("pen filing");
  await selectYear(2025);
  expect(setup!.captureCharFrame()).not.toContain("ALPHA compensation 2026");
  expect(setup!.captureCharFrame()).not.toContain("pen filing");
  await act(async () => earlier.reject(new Error("Selected proxy unavailable")));
  await settle();
  expect(setup!.captureCharFrame()).toContain("Selected proxy unavailable");
  expect(setup!.captureCharFrame()).not.toContain("Loading...");
  await selectYear(2026);
  expect(setup!.captureCharFrame()).toContain("ALPHA compensation 2026");
  expect(setup!.captureCharFrame()).not.toContain("Selected proxy unavailable");
});

test("changing ticker waits for its own proxy years and discards a late previous-company response", async () => {
  const betaList = deferred<CloudProxyStatementListPayload>();
  const oldYear = deferred<CloudProxyStatementPayload>();
  const list = spyOn(apiClient, "getProxyStatements").mockImplementation(async ticker => ticker === "BETA" ? betaList.promise : { company: statement(ticker, 2026).company, proxies: [statement(ticker, 2026), statement(ticker, 2025)] });
  const detail = spyOn(apiClient, "getProxyStatement").mockImplementation(async (ticker, year) => ticker === "ALPHA" && year === 2025 ? oldYear.promise : statement(ticker, year));
  restore.push(() => list.mockRestore(), () => detail.mockRestore());
  const selectTicker = await mount();
  await selectYear(2025);
  await selectTicker("BETA");
  expect(detail.mock.calls.filter(([ticker]) => ticker === "BETA")).toEqual([]);
  await act(async () => oldYear.resolve(statement("ALPHA", 2025)));
  await settle();
  expect(setup!.captureCharFrame()).not.toContain("ALPHA compensation");
  await act(async () => betaList.resolve({ company: statement("BETA", 2024).company, proxies: [statement("BETA", 2024)] }));
  await settle();
  expect(detail.mock.calls.filter(([ticker]) => ticker === "BETA")).toEqual([["BETA", 2024]]);
  expect(setup!.captureCharFrame()).toContain("BETA compensation 2024");
});

test("a failed single-year request can be retried from the footer without changing ticker", async () => {
  let unavailable = true;
  const list = spyOn(apiClient, "getProxyStatements").mockResolvedValue({ company: statement("ALPHA", 2026).company, proxies: [statement("ALPHA", 2026)] });
  const detail = spyOn(apiClient, "getProxyStatement").mockImplementation(async (ticker, year) => {
    if (unavailable) throw new Error("Proxy temporarily unavailable");
    return statement(ticker, year);
  });
  restore.push(() => list.mockRestore(), () => detail.mockRestore());
  await mount();
  expect(setup!.captureCharFrame()).toContain("Proxy temporarily unavailable");
  expect(setup!.captureCharFrame()).not.toContain("pen filing");
  unavailable = false;
  await act(async () => setup!.mockInput.pressKey("r"));
  await settle();
  expect(setup!.captureCharFrame()).toContain("ALPHA compensation 2026");
  expect(setup!.captureCharFrame()).not.toContain("Proxy temporarily unavailable");
  expect(detail).toHaveBeenCalledTimes(2);
});
