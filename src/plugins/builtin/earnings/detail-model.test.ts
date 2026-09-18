import { describe, expect, test } from "bun:test";
import type { EarningsEstimateBasis, EarningsEvent } from "../../../types/data-provider";
import { buildEarningsDetail, formatGrowth, rangeBar } from "./detail-model";

const trend = (value: number, currency: string | null = "USD"): EarningsEstimateBasis => ({
  source: "earningsTrend",
  sourceValue: value,
  period: "0q",
  periodEndDate: "2026-10-31",
  ...(currency ? { currency } : {}),
});

function event(overrides: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    earningsDate: new Date("2026-11-17T21:00:00Z"),
    earningsCallDate: null,
    isDateEstimate: false,
    epsEstimate: 2.47,
    epsLow: 2.34,
    epsHigh: 2.7,
    epsYearAgo: 1.3,
    epsGrowth: 0.9027,
    epsAnalysts: 43,
    epsTrend7dAgo: 2.474,
    epsTrend30dAgo: 2.35,
    epsRevisionUp7d: 34,
    epsRevisionUp30d: 35,
    epsRevisionDown7d: 3,
    epsRevisionDown30d: 1,
    epsActual: null,
    revenueEstimate: 109e9,
    revenueLow: 104.94e9,
    revenueHigh: 116.25e9,
    revenueYearAgo: 57.01e9,
    revenueGrowth: 0.912,
    revenueAnalysts: 43,
    revenueActual: null,
    surprise: null,
    timing: "AMC",
    estimateBasis: {
      epsEstimate: trend(2.47), epsLow: trend(2.34), epsHigh: trend(2.7), epsYearAgo: trend(1.3),
      epsGrowth: trend(0.9027, null), epsAnalysts: trend(43, null),
      epsTrend7dAgo: trend(2.474), epsTrend30dAgo: trend(2.35),
      epsRevisionUp7d: trend(34, null), epsRevisionUp30d: trend(35, null),
      epsRevisionDown7d: trend(3, null), epsRevisionDown30d: trend(1, null),
      revenueEstimate: trend(109e9), revenueLow: trend(104.94e9), revenueHigh: trend(116.25e9),
      revenueYearAgo: trend(57.01e9), revenueGrowth: trend(0.912, null), revenueAnalysts: trend(43, null),
    },
    ...overrides,
  };
}

describe("buildEarningsDetail", () => {
  test("lays out the report facts and both estimate blocks", () => {
    const detail = buildEarningsDetail(event());
    expect(detail.date).toBe("Nov 17, 2026");
    expect(detail.timing).toBe("after close");
    expect(detail.dateStatus).toBe("confirmed");
    expect(detail.period).toBe("current quarter ending 2026-10-31");
    expect(detail.eps.consensus).toBe("USD 2.47");
    expect(detail.eps.position).toBeCloseTo((2.47 - 2.34) / (2.7 - 2.34), 5);
    expect(detail.eps.yearAgo).toBe("USD 1.30");
    expect(detail.revenue.consensus).toBe("USD 109B");
    expect(detail.revenue.trend).toEqual([]);
  });

  test("a move below the displayed precision reads as unchanged", () => {
    const detail = buildEarningsDetail(event());
    expect(detail.eps.trend.map((row) => [row.label, row.changeText])).toEqual([
      ["30 days ago", "+0.12 since"],
      ["7 days ago", "unchanged"],
    ]);
    expect(detail.eps.revisions).toEqual([
      { label: "30d", up: 35, down: 1 },
      { label: "7d", up: 34, down: 3 },
    ]);
  });

  test("a range from a different forecast than the consensus is not drawn", () => {
    const detail = buildEarningsDetail(event({
      estimateBasis: {
        ...event().estimateBasis,
        epsLow: { source: "calendarEvents", sourceValue: 2.34, period: null, periodEndDate: null, currency: "USD" },
      },
    }));
    expect(detail.eps.low).toBeNull();
    expect(detail.eps.position).toBeNull();
  });
});

test("rangeBar puts the marker between the ends", () => {
  expect(rangeBar(0, 7)).toBe("├●────┤");
  expect(rangeBar(1, 7)).toBe("├────●┤");
  expect(rangeBar(0.5, 7)).toBe("├──●──┤");
});

test("formatGrowth is a signed percent with one decimal", () => {
  expect(formatGrowth(0.9027)).toBe("+90.3%");
  expect(formatGrowth(-0.05)).toBe("-5.0%");
  expect(formatGrowth(null)).toBe("");
});
