import { describe, expect, test } from "bun:test";
import type { CloudJobsSummaryPayload } from "../../../api-client/types";
import {
  buildPostingColumns,
  buildShareBars,
  formatAge,
  formatSalaryRange,
  moversHaveWeekHistory,
  primaryChart,
  weeklyToChartPoints,
} from "./model";

function summary(overrides: Partial<CloudJobsSummaryPayload> = {}): CloudJobsSummaryPayload {
  return {
    status: "ok",
    ticker: "NVDA",
    companyName: "NVIDIA",
    coverage: { status: "active", vendor: "workday", careersUrl: null, lastCollectedAt: null, firstObservedAt: null, daysObserved: 1, employeeCount: null },
    openCount: 10,
    openPerThousandEmployees: null,
    new7d: 10,
    new30d: 10,
    closed30d: 0,
    change30d: null,
    change90d: null,
    postingVelocity: null,
    remoteShare: null,
    medianAgeDays: null,
    series: [{ day: "2026-09-17", open: 10, new: 10, closed: 0 }],
    postedByWeek: [],
    functions: [],
    countries: [],
    seniority: [],
    tags: [],
    salary: null,
    recent: [],
    ...overrides,
  };
}

describe("weeklyToChartPoints", () => {
  test("fills the missing weeks with zeros and pins the axis at zero", () => {
    const points = weeklyToChartPoints({
      postedByWeek: [
        { weekStart: "2026-08-31", count: 4 },
        { weekStart: "2026-09-14", count: 9 },
      ],
    });
    expect(points.map((point) => [point.date.toISOString().slice(0, 10), point.close])).toEqual([
      ["2026-08-31", 4],
      ["2026-09-07", 0],
      ["2026-09-14", 9],
    ]);
    // With no empty week in the window, one is added in front so the axis starts at zero.
    const dense = weeklyToChartPoints({ postedByWeek: [{ weekStart: "2026-09-07", count: 3 }, { weekStart: "2026-09-14", count: 9 }] });
    expect(dense.map((point) => point.close)).toEqual([0, 3, 9]);
  });
});

describe("primaryChart", () => {
  test("shows the intake curve until a week of daily history exists", () => {
    expect(primaryChart(summary()).kind).toBe("intake");
    const series = Array.from({ length: 7 }, (_, index) => ({ day: `2026-09-1${index}`, open: 10 + index, new: 1, closed: 0 }));
    expect(primaryChart(summary({ series })).kind).toBe("history");
  });
});

describe("buildShareBars", () => {
  test("keeps the top rows, folds the rest, and sizes bars against the largest", () => {
    const rows = buildShareBars(
      [
        { id: "a", label: "A", count: 50, share: 0.5, previous: 40 },
        { id: "b", label: "B", count: 30, share: 0.3, previous: null },
        { id: "c", label: "C", count: 15, share: 0.15, previous: 15 },
        { id: "d", label: "D", count: 5, share: 0.05, previous: 9 },
      ],
      2,
    );
    expect(rows.map((row) => [row.key, row.count, row.ratio, row.delta])).toEqual([
      ["a", 50, 1, 10],
      ["b", 30, 0.6, null],
      ["rest", 20, 0.4, null],
    ]);
    expect(rows[2]!.label).toBe("2 more");
  });
});

describe("formatting", () => {
  test("pay ranges read like the postings write them", () => {
    expect(formatSalaryRange(120000, 150000, "USD", "year")).toBe("$120k–150k");
    expect(formatSalaryRange(45, 52, "USD", "hour")).toBe("$45–52/h");
    expect(formatSalaryRange(60000, 60000, "GBP", "year")).toBe("£60k");
    expect(formatSalaryRange(null, null, null, null)).toBe("");
  });

  test("ages carry a plus when the source only gave a floor", () => {
    const now = new Date("2026-09-17T00:00:00Z");
    expect(formatAge("2026-09-14", "exact", now)).toBe("3d");
    expect(formatAge("2026-08-18", "floor", now)).toBe("4w+");
    expect(formatAge("2026-05-01", "exact", now)).toBe("5mo");
  });
});

describe("table layout", () => {
  test("the role column takes what the fixed columns leave", () => {
    const wide = buildPostingColumns(120, true);
    expect(wide.map((column) => column.id)).toEqual(["title", "function", "location", "posted", "salary"]);
    expect(wide[0]!.width).toBe(120 - (24 + 24 + 8 + 14) - 6);
    const narrow = buildPostingColumns(80, true);
    expect(narrow.map((column) => column.id)).toEqual(["title", "function", "location", "posted"]);
  });

  test("the new-this-week column only appears after the first read", () => {
    const mover = (openCount: number, new7d: number) => ({
      key: "x",
      mover: { ticker: "X", companyName: null, openCount, employeeCount: null, change30d: null, postingVelocity: null, new7d, topFunction: null },
      ticker: "X", company: "", open: "", change: "", changeValue: null, velocity: "", velocityValue: null, new7d: "", function: "",
    });
    expect(moversHaveWeekHistory([mover(100, 100), mover(50, 50)])).toBe(false);
    expect(moversHaveWeekHistory([mover(100, 100), mover(50, 3)])).toBe(true);
  });
});
