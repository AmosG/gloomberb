import { describe, expect, test } from "bun:test";
import type { PaneTemplateContext } from "../../../types/plugin";
import { chartComposerModule } from "./index";
import {
  CHART_INTERACTION_VIEWPORT_SETTING_KEY,
  CHART_SPEC_SETTING_KEY,
  parseChartInteractionViewport,
  parseChartSpec,
} from "./chart-spec";
import {
  CHART_DRAWINGS_SETTING_KEY,
  parseChartDrawings,
} from "../../../components/chart/composite/tools";
import { buildCustomChartPreset, buildPriceChartPreset, setPairStudies } from "./presets";
import { applyChartComposerPaneSetting, CHART_SETTING_KEYS } from "./settings";

const context: PaneTemplateContext = {
  config: {} as PaneTemplateContext["config"],
  layout: { dockRoot: null, instances: [], floating: [], detached: [] },
  focusedPaneId: null,
  activeTicker: null,
  activeCollectionId: null,
};

describe("chart pane sharing", () => {
  test("persisted and shared authored formulas survive toggling another formula", async () => {
    const template = chartComposerModule.paneTemplates?.find((entry) => entry.id === "chart-composer-pane");
    const spec = setPairStudies(buildCustomChartPreset("TARGET:NASDAQ:market.close,ACQUIRER:NASDAQ:market.close"), ["spread", "correlation"]);
    spec.studies = spec.studies.map((study) => ({ ...study,
      parameters: study.kind === "spread" ? { multiplier: 0.5 } : { period: 13, returns: 0 },
      color: "#f5a524", axis: "right", panelId: `authored-${study.kind}`, visible: study.kind !== "correlation",
    }));
    const authoredPanels = spec.studies.map((study) => ({ id: study.panelId, label: `Controlled ${study.kind}`, height: 0.3 }));
    spec.panels.push(...authoredPanels);
    const shared = template?.publicShare?.serialize({
      pane: { instanceId: "controlled-chart", paneId: "chart-composer", settings: { chartSpec: spec } }, paneState: {},
    });
    const options = template?.publicShare?.restore(shared!.data);
    const instance = await template?.createInstance?.(context, options ?? undefined);
    for (const initial of [JSON.parse(JSON.stringify({ chartSpec: spec })), instance!.settings!]) {
      expect(parseChartSpec(initial.chartSpec)?.studies).toEqual(parseChartSpec(spec)?.studies);
      let settings = initial;
      for (const selected of [["spread", "correlation", "ratio"], ["spread", "correlation"]]) {
        settings = applyChartComposerPaneSetting(settings, { key: CHART_SETTING_KEYS.formulas, label: "Formulas", type: "multi-select", options: [] }, selected);
        const updated = parseChartSpec(settings.chartSpec)!;
        expect(updated.studies.filter(({ kind }) => kind !== "ratio")).toEqual(parseChartSpec(spec)?.studies);
        expect(updated.panels.filter(({ id }) => id.startsWith("authored-")))
          .toEqual(parseChartSpec(spec)?.panels.filter(({ id }) => id.startsWith("authored-")));
        expect(updated.studies.some(({ kind }) => kind === "ratio")).toBe(selected.includes("ratio"));
      }
      expect(parseChartSpec(initial.chartSpec)?.studies).toEqual(parseChartSpec(spec)?.studies);
    }
  });

  test("round-trips chart setup, drawings, and the panned viewport", async () => {
    const template = chartComposerModule.paneTemplates?.find((entry) => entry.id === "chart-composer-pane");
    const spec = buildPriceChartPreset("AAPL");
    const drawings = [{
      id: "line-1",
      panelId: "main",
      color: "#f5a524",
      points: [
        { time: 1_779_000_000_000, value: 182.4 },
        { time: 1_780_000_000_000, value: 205.8 },
      ],
    }];
    const viewport = {
      authoredViewportKey: "AAPL:1Y:1d",
      start: "2026-04-01T00:00:00.000Z",
      end: "2026-07-01T00:00:00.000Z",
      adaptive: false,
    };
    const shared = template?.publicShare?.serialize({
      pane: {
        instanceId: "chart-1",
        paneId: "chart-composer",
        title: "AAPL Price",
        settings: {
          [CHART_SPEC_SETTING_KEY]: spec,
          [CHART_DRAWINGS_SETTING_KEY]: drawings,
          [CHART_INTERACTION_VIEWPORT_SETTING_KEY]: viewport,
          privateCursor: "not-shared",
        },
      },
      paneState: { selectedPoint: 12 },
    });

    expect(shared?.title).toBe("AAPL Price");
    expect(shared?.data).toEqual({
      chartSpec: parseChartSpec(spec),
      chartDrawings: drawings,
      chartInteractionViewport: viewport,
    });
    const options = template?.publicShare?.restore(shared!.data);
    const instance = await template?.createInstance?.(context, options ?? undefined);
    expect(parseChartSpec(instance?.settings?.[CHART_SPEC_SETTING_KEY])).toEqual(parseChartSpec(spec));
    expect(parseChartDrawings(instance?.settings?.[CHART_DRAWINGS_SETTING_KEY])).toEqual(drawings);
    expect(parseChartInteractionViewport(instance?.settings?.[CHART_INTERACTION_VIEWPORT_SETTING_KEY])).toEqual(viewport);
    expect(JSON.stringify(shared)).not.toContain("privateCursor");
  });
});
