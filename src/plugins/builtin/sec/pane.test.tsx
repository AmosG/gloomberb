import { afterAll, afterEach, expect, test } from "bun:test";
import { act, useMemo, useState } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
const source = process.env.FILING_SOURCE ?? new URL("../../../../", import.meta.url).pathname.replace(/\/$/, ""), out = process.env.FILING_OUT;
if (out)
    mkdirSync(out, { recursive: true });
const { secModule, secHeadless } = await import(`${source}/src/plugins/builtin/sec`);
const { TestPaneProvider, createTestPaneConfig, createTestTicker } = await import(`${source}/src/test-support/pane`);
const { createStatefulTestPluginRuntime } = await import(`${source}/src/test-support/plugin-runtime`);
const { createTestDataProvider } = await import(`${source}/src/test-support/data-provider`);
const { createInitialState } = await import(`${source}/src/state/app/context`);
const { MarketDataCoordinator, setSharedMarketDataCoordinator } = await import(`${source}/src/market-data/coordinator`);
const { PaneFooterProvider, PaneFooterBar } = await import(`${source}/src/components/layout/pane/footer`);
const { testRender, settleFrame, emitKeypress } = await import(`${source}/src/renderers/opentui/test-utils`);
const { Box } = await import(`${source}/src/ui`);
const Pane = secModule.panes[0].component;
const filing = { accessionNumber: "0000000001-26-000001", form: "8-K", filingDate: new Date("2026-09-10T00:00:00Z"), cik: "1", companyName: "CONTROL issuer", primaryDocument: "current.htm", filingUrl: "https://www.sec.gov/Archives/1/filing-index.htm", primaryDocumentUrl: "https://www.sec.gov/Archives/1/current.htm" };
let setup: any, coordinator: any, footer: any, selectCompany: (symbol: string) => void;
let frames = 0;
const observations: any[] = [];
async function mount(provider: any) { coordinator = new MarketDataCoordinator(provider); setSharedMarketDataCoordinator(coordinator); function Harness() { const [symbol, setSymbol] = useState("CONTROL"); selectCompany = setSymbol; const config = createTestPaneConfig("/tmp/unused-sec-audit", { instanceId: "sec-audit", paneId: "sec", binding: { kind: "fixed", symbol } }); const state = createInitialState(config); state.tickers = new Map([[symbol, createTestTicker(symbol)]]); state.focusedPaneId = "sec-audit"; const runtime = useMemo(() => createStatefulTestPluginRuntime(), []); return <TestPaneProvider state={state} paneId="sec-audit" pluginId="ticker-research" runtime={runtime}><PaneFooterProvider>{(value: any) => { footer = value; return <Box width={110} height={36} flexDirection="column"><Box height={35}><Pane focused width={110} height={35}/></Box><PaneFooterBar footer={value} focused width={110}/></Box>; }}</PaneFooterProvider></TestPaneProvider>; } ; await act(async () => { setup = await testRender(<Harness />, { width: 110, height: 36 }); }); await settleFrame(setup, 8); }
function capture(name: string) { const frame = setup.captureCharFrame(); frames++; if (out) {
    writeFileSync(`${out}/${name}.txt`, frame);
    writeFileSync(`${out}/${name}-footer.json`, JSON.stringify(footer, null, 2));
} return frame; }
afterEach(async () => { if (setup)
    await act(async () => setup.renderer.destroy()); setup = null; coordinator?.destroy(); coordinator = null; setSharedMarketDataCoordinator(null); });
afterAll(() => { if (out)
    writeFileSync(`${out}/observations.json`, JSON.stringify({ source, frames, observations }, null, 2)); });
test("SEC reports document failures honestly and plain refresh retries only failed reading", async () => {
    let recovered = false;
    const calls: string[] = [];
    const provider = createTestDataProvider({ getSecFilings: async () => { calls.push("filings"); return [filing]; }, getSecFilingDocuments: async () => { calls.push("documents"); if (!recovered)
            throw new Error("Controlled document-index outage"); return [{ document: "current.htm", type: "8-K", url: filing.primaryDocumentUrl, isPrimary: true }]; }, getSecFilingContent: async () => { calls.push("content"); if (!recovered)
            throw new Error("Controlled primary outage"); return "Recovered acquisition agreement terms"; } });
    await mount(provider);
    capture("sec-list");
    await emitKeypress(setup, { name: "return", sequence: "\r" });
    await settleFrame(setup, 12);
    const failed = capture("sec-failed-detail");
    expect(calls).toContain("documents");
    expect(calls).toContain("content");
    expect(failed).not.toContain("No filing documents were listed");
    expect(failed).toContain("Controlled document-index outage");
    expect(failed).toContain("Controlled primary outage");
    recovered = true;
    const count = calls.length;
    await emitKeypress(setup, { name: "r", sequence: "r" });
    await settleFrame(setup, 8);
    expect(calls.length).toBe(count + 3);
    expect(capture("sec-refresh-recovered")).toContain("Recovered acquisition");
    expect(JSON.stringify(footer)).not.toContain("outage");
    const reads = calls.filter(c => c !== "filings").length;
    await emitKeypress(setup, { name: "r", sequence: "r" });
    await settleFrame(setup, 8);
    expect(calls.filter(c => c !== "filings").length).toBe(reads);
    observations.push({ case: "document-outages", calls, footer, contentEntry: coordinator.getSecContentEntry(filing.accessionNumber), documentsEntry: coordinator.getSecDocumentsEntry(filing.accessionNumber) });
});
test("cached router failures retry and true empty document results stay distinct", async () => {
    const { AssetDataRouter } = await import(`${source}/src/sources/provider-router`);
    const { AppPersistence } = await import(`${source}/src/data/app-persistence`);
    const persistence = new AppPersistence(":memory:");
    let failed = true;
    let documents = 0, contents = 0;
    const provider = createTestDataProvider({ id: "controlled-sec", getSecFilings: async () => [filing], getSecFilingDocuments: async () => { documents++; if (failed)
            throw new Error("Cached index outage"); return []; }, getSecFilingContent: async () => { contents++; if (failed)
            throw new Error("Cached primary outage"); return "Recovered cached primary document"; } });
    try {
        await mount(new AssetDataRouter(provider, [], persistence.resources));
        await emitKeypress(setup, { name: "return", sequence: "\r" });
        await settleFrame(setup, 12);
        expect(capture("cached-failure")).toContain("Cached index outage");
        failed = false;
        await emitKeypress(setup, { name: "r", sequence: "r" });
        await settleFrame(setup, 12);
        const frame = capture("cached-recovered-empty-index");
        expect(documents).toBe(2);
        expect(contents).toBe(2);
        expect(frame).toContain("No filing documents were listed");
        expect(frame).toContain("Recovered cached primary document");
        expect(JSON.stringify(footer)).not.toContain("outage");
    }
    finally {
        await act(async () => setup.renderer.destroy());
        setup = null;
        coordinator.destroy();
        coordinator = null;
        setSharedMarketDataCoordinator(null);
        persistence.close();
    }
});
test("SEC refresh joins an active request and preserves filing ownership across companies", async () => {
    let finish!: (rows: any[]) => void;
    const calls: string[] = [];
    const second = { ...filing, accessionNumber: "0000000002-26-000002", companyName: "SECOND issuer", cik: "2", primaryDocumentUrl: "https://www.sec.gov/Archives/2/current.htm", filingUrl: "https://www.sec.gov/Archives/2/index.htm" };
    const provider = createTestDataProvider({ getSecFilings: async (symbol: string) => { calls.push(symbol); return symbol === "CONTROL" ? new Promise(resolve => finish = resolve) : [second]; }, getSecFilingDocuments: async () => [], getSecFilingContent: async (item: any) => `Only ${item.companyName} source terms` });
    await mount(provider);
    await emitKeypress(setup, { name: "r", sequence: "r" });
    await settleFrame(setup, 6);
    expect(calls).toEqual(["CONTROL"]);
    await act(async () => selectCompany("SECOND"));
    await settleFrame(setup, 8);
    await emitKeypress(setup, { name: "return", sequence: "\r" });
    await settleFrame(setup, 10);
    expect(capture("second-detail-before-old-completion")).toContain("Only SECOND issuer source terms");
    await act(async () => finish([filing]));
    await settleFrame(setup, 8);
    const frame = capture("second-detail-after-old-completion");
    expect(frame).toContain("Only SECOND issuer source terms");
    expect(frame).not.toContain("CONTROL issuer");
    expect(coordinator.getSecContentEntry(second.accessionNumber).data).toBe("Only SECOND issuer source terms");
});
test("as-filed originals and amendments retain independent detail and headless accession/date identity", async () => {
    const amendment = { ...filing, accessionNumber: "0000000001-26-000003", form: "8-K/A", filingDate: new Date("2026-09-11T00:00:00Z"), acceptedAt: new Date("2026-09-11T21:05:00Z"), acceptedAtRaw: "2026-09-11T21:05:00Z", filingUrl: "https://www.sec.gov/Archives/1/amendment-index.htm", primaryDocumentUrl: "https://www.sec.gov/Archives/1/amendment.htm" };
    const provider = createTestDataProvider({ getSecFilings: async () => [amendment, filing], getSecFilingDocuments: async () => [], getSecFilingContent: async (item: any) => `As filed ${item.form}, accession ${item.accessionNumber}` });
    await mount(provider);
    await emitKeypress(setup, { name: "return", sequence: "\r" });
    await settleFrame(setup, 10);
    expect(capture("amendment-detail")).toContain("As filed 8-K/A, accession 0000000001-26-000003");
    await emitKeypress(setup, { name: "escape", sequence: "\x1b" });
    await emitKeypress(setup, { name: "down", sequence: "j" });
    await emitKeypress(setup, { name: "return", sequence: "\r" });
    await settleFrame(setup, 8);
    expect(capture("original-detail")).toContain("As filed 8-K, accession 0000000001-26-000001");
    const report = await secHeadless.load({ symbols: ["CONTROL"], options: { limit: 50 } }, { marketData: provider, signal: new AbortController().signal });
    expect(report.rows.map((row: any) => row.accessionNumber)).toEqual([amendment.accessionNumber, filing.accessionNumber]);
    expect(report.rows[0]).toMatchObject({ form: "8-K/A", filedAt: "2026-09-11T00:00:00.000Z", acceptedAt: "2026-09-11T21:05:00.000Z", url: amendment.filingUrl });
    expect(report.rows[1].acceptedAt).toBeNull();
    if (out)
        writeFileSync(`${out}/sec-headless.json`, JSON.stringify(report, null, 2));
});
test("discovery refresh failure preserves the opened as-filed document and its source action", async () => {
    let failed = false, reads = 0;
    const provider = createTestDataProvider({ getSecFilings: async () => { if (failed)
            throw new Error("Controlled discovery outage"); return [filing]; }, getSecFilingDocuments: async () => [{ document: "current.htm", type: "8-K", url: filing.primaryDocumentUrl, isPrimary: true }], getSecFilingContent: async () => { reads++; return "Immutable acquisition source terms"; } });
    await mount(provider);
    await emitKeypress(setup, { name: "return", sequence: "\r" });
    await settleFrame(setup, 10);
    failed = true;
    await emitKeypress(setup, { name: "r", sequence: "r" });
    await settleFrame(setup, 8);
    expect(capture("discovery-failed-detail-retained")).toContain("Immutable acquisition source terms");
    expect(JSON.stringify(footer)).toContain("Controlled discovery outage");
    expect(footer.hints.some((hint: any) => hint.id === "open")).toBe(true);
    expect(reads).toBe(1);
    failed = false;
    await emitKeypress(setup, { name: "r", sequence: "r" });
    await settleFrame(setup, 8);
    capture("discovery-recovered-detail-retained");
    expect(JSON.stringify(footer)).not.toContain("Controlled discovery outage");
    expect(reads).toBe(1);
});
