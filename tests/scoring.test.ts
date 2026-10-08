import { describe, it, expect } from "vitest";
import {
  annualizedVolatility,
  percentileRanks,
  returnOver,
  dailyReturns,
  scoreUniverse,
  validateWeights,
  changeWeight,
  effectiveWeights,
  cutoffBars,
} from "../lib/scoring";
import { DEFAULT_WEIGHTS, FACTORS } from "../lib/types";
import { demoData, DEMO_DATE } from "../lib/demo";
import { priceCutoff, validateAsOf, publishedBy, todayIn } from "../lib/dates";
import { deriveFundamentals } from "../lib/fundamentals";
import {
  parseStockInput,
  parseCsv,
  validateImport,
  stockQueriesFromCsv,
} from "../lib/input";
describe("returns and volatility", () => {
  it("uses exact completed-session lookbacks", () => {
    expect(returnOver([100, 110, 121], 2)).toBeCloseTo(0.21);
    expect(returnOver([100, 110], 2)).toBeNull();
    expect(returnOver([100, 0], 1)).toBeNull();
  });
  it("computes simple daily returns", () => {
    expect(dailyReturns([100, 110, 99])[0]).toBeCloseTo(0.1);
    expect(dailyReturns([100, 110, 99])[1]).toBeCloseTo(-0.1);
  });
  it("uses sample standard deviation times sqrt(252)", () => {
    expect(annualizedVolatility([100, 110, 99], 2)).toBeCloseTo(
      Math.sqrt(0.02 * 252),
    );
  });
  it("requires 61 prices for 60 returns", () => {
    expect(annualizedVolatility(Array(60).fill(100))).toBeNull();
    expect(annualizedVolatility(Array(61).fill(100))).toBe(0);
  });
});
describe("percentile normalization", () => {
  it("spans 0–100 and reverses lower-is-better metrics", () => {
    expect(percentileRanks([1, 2, 3])).toEqual([0, 50, 100]);
    expect(percentileRanks([1, 2, 3], true)).toEqual([100, 50, 0]);
  });
  it("uses average ranks for ties", () => {
    expect(percentileRanks([1, 2, 2, 3])).toEqual([0, 50, 50, 100]);
  });
  it("returns 50 for singleton and constant values", () => {
    expect(percentileRanks([9, 9, null])).toEqual([50, 50, null]);
    expect(percentileRanks([null, 9])).toEqual([null, 50]);
  });
  it("excludes missing/nonfinite values and limits outlier influence", () => {
    expect(percentileRanks([0, 1, 1e30, null, NaN])).toEqual([
      0,
      50,
      100,
      null,
      null,
    ]);
  });
});
describe("scoring and weights", () => {
  it("matches weighted full factor equation", () => {
    const result = scoreUniverse(demoData(), DEMO_DATE);
    expect(result).toHaveLength(12);
    for (const s of result)
      expect(s.score).toBeCloseTo(
        FACTORS.reduce(
          (sum, f) => sum + (s.factors[f]! * DEFAULT_WEIGHTS[f]) / 100,
          0,
        ),
      );
    expect(result[0].score!).toBeGreaterThanOrEqual(result[1].score!);
  });
  it("marks the entire full composite incomplete when required fundamentals are missing", () => {
    const stocks = demoData();
    stocks[0].fundamentals.roe = null;
    const result = scoreUniverse(stocks, DEMO_DATE).find(
      (s) => s.security.symbol === "NVDA",
    )!;
    expect(result.score).toBeNull();
    expect(result.rank).toBeNull();
    expect(result.factors.momentum).not.toBeNull();
  });
  it("does not waive missing factors at zero overall weight", () => {
    const stocks = demoData();
    stocks[0].fundamentals.surprise = null;
    expect(
      scoreUniverse(stocks, DEMO_DATE, {
        ...DEFAULT_WEIGHTS,
        earnings: 0,
        momentum: 55,
      }).find((s) => s.security.symbol === "NVDA")!.score,
    ).toBeNull();
  });
  it("explicitly invalidates negative equity ratios", () => {
    const stock = demoData()[0];
    stock.fundamentals.equity = -1;
    const result = scoreUniverse([stock], DEMO_DATE)[0];
    expect(result.metrics.roe).toBeNull();
    expect(result.metrics.debtEquity).toBeNull();
    expect(result.score).toBeNull();
  });
  it("price-only scoring is independent of unavailable fundamentals", () => {
    const stocks = demoData();
    stocks[0].fundamentals.surprise = null;
    const result = scoreUniverse(
      stocks,
      DEMO_DATE,
      DEFAULT_WEIGHTS,
      "price",
    ).find((s) => s.security.symbol === "NVDA")!;
    const w = effectiveWeights(DEFAULT_WEIGHTS, "price");
    expect(result.mode).toBe("price");
    expect(result.score).toBeCloseTo(
      (result.factors.momentum! * w.momentum) / 100 +
        (result.factors.lowVolatility! * w.lowVolatility) / 100 +
        (result.factors.liquidity! * w.liquidity) / 100,
    );
    expect(w.momentum).toBeCloseTo((40 / 65) * 100);
  });
  it("uses all raw closes if adjustment coverage is incomplete", () => {
    const stock = demoData()[0];
    stock.bars[0].adjustedClose = null;
    stock.bars.at(-1)!.adjustedClose = 99999;
    const result = scoreUniverse([stock], DEMO_DATE)[0];
    expect(result.metrics.return3m).toBeCloseTo(
      returnOver(
        stock.bars.map((b) => b.close),
        63,
      )!,
    );
  });
  it("rejects invalid weights and zero price-model weights", () => {
    expect(() =>
      validateWeights({ ...DEFAULT_WEIGHTS, momentum: 41 }),
    ).toThrow();
    expect(() =>
      validateWeights({ ...DEFAULT_WEIGHTS, quality: -1 }),
    ).toThrow();
    expect(() =>
      effectiveWeights(
        {
          momentum: 0,
          quality: 50,
          earnings: 50,
          lowVolatility: 0,
          liquidity: 0,
        },
        "price",
      ),
    ).toThrow();
  });
  it("rebalances every slider setting without negative weights", () => {
    for (const initial of [
      DEFAULT_WEIGHTS,
      {
        momentum: 100,
        quality: 0,
        earnings: 0,
        lowVolatility: 0,
        liquidity: 0,
      },
      {
        momentum: 0,
        quality: 25,
        earnings: 25,
        lowVolatility: 25,
        liquidity: 25,
      },
    ])
      for (const factor of FACTORS)
        for (let value = 0; value <= 100; value++) {
          const weights = changeWeight(initial, factor, value);
          expect(() => validateWeights(weights)).not.toThrow();
          expect(weights[factor]).toBe(value);
        }
  });
});
describe("historical boundaries", () => {
  it("excludes prices after the selected evaluation date", () => {
    const stock = demoData()[0];
    const date = stock.bars.at(-3)!.date;
    expect(cutoffBars(stock.bars, date).at(-1)!.date).toBe(date);
    const result = scoreUniverse([stock], date)[0];
    expect(result.price).toBe(stock.bars.at(-3)!.close);
  });
  it("rejects future and impossible dates", () => {
    expect(() => validateAsOf("2026-10-09", "2026-10-08")).toThrow();
    expect(() => validateAsOf("2026-02-30", "2026-10-08")).toThrow();
  });
  it("excludes current US calendar session even when EOD is provisional", () => {
    expect(priceCutoff("2026-10-08", new Date("2026-10-08T15:00:00Z"))).toBe(
      "2026-10-07",
    );
    expect(priceCutoff("2026-10-05", new Date("2026-10-08T15:00:00Z"))).toBe(
      "2026-10-05",
    );
  });
  it("uses the requested timezone", () => {
    expect(todayIn("Asia/Shanghai", new Date("2026-10-07T18:00:00Z"))).toBe(
      "2026-10-08",
    );
  });
  it("requires disclosure dates and does not substitute fiscal period-end", () => {
    expect(publishedBy({ date: "2025-12-31" }, "2026-02-01")).toBe(false);
    expect(
      publishedBy(
        { date: "2025-12-31", filingDate: "2026-02-20" },
        "2026-02-01",
      ),
    ).toBe(false);
    expect(
      publishedBy(
        { date: "2025-12-31", filingDate: "2026-01-20" },
        "2026-02-01",
      ),
    ).toBe(true);
  });
  it("disables historical full scoring when point-in-time data is unverified", () => {
    const stock = demoData()[0];
    stock.historicalFullAllowed = false;
    expect(scoreUniverse([stock], DEMO_DATE)[0].score).toBeNull();
    expect(
      scoreUniverse([stock], DEMO_DATE, DEFAULT_WEIGHTS, "price")[0].score,
    ).not.toBeNull();
  });
  it("rejects duplicate sessions", () => {
    const s = demoData()[0];
    expect(() => cutoffBars([...s.bars, s.bars[0]], DEMO_DATE)).toThrow(
      "Duplicate",
    );
  });
});
describe("reported fundamentals", () => {
  const income = [
    {
      date: "2025-12-31",
      period: "FY",
      publishedAt: "2026-02-01",
      netIncome: 10,
      revenue: 100,
      operatingIncome: 20,
      eps: 2,
    },
    {
      date: "2024-12-31",
      period: "FY",
      publishedAt: "2025-02-01",
      netIncome: 8,
      revenue: 80,
      operatingIncome: 15,
      eps: 1,
    },
  ];
  const balance = [
    {
      date: "2025-12-31",
      period: "FY",
      publishedAt: "2026-02-01",
      totalStockholdersEquity: 50,
      totalDebt: 20,
    },
    {
      date: "2024-12-31",
      period: "FY",
      publishedAt: "2025-02-01",
      totalStockholdersEquity: 30,
      totalDebt: 20,
    },
  ];
  it("derives ROE using average equity, margin, debt/equity and comparable EPS", () => {
    const f = deriveFundamentals(
      income,
      balance,
      [],
      [{ date: "2026-02-01", epsActual: 2, epsEstimated: 1.8 }],
      "2026-03-01",
    ).fundamentals;
    expect(f.roe).toBe(0.25);
    expect(f.margin).toBe(0.2);
    expect(f.debtEquity).toBe(0.4);
    expect(f.epsGrowth).toBe(1);
    expect(f.surprise).toBeCloseTo(2 / 1.8 - 1);
  });
  it("does not skip latest reported event just because its estimate is missing", () => {
    const f = deriveFundamentals(
      income,
      balance,
      [],
      [
        { date: "2026-02-01", epsActual: 2, epsEstimated: null },
        { date: "2025-11-01", epsActual: 1, epsEstimated: 0.9 },
      ],
      "2026-03-01",
    ).fundamentals;
    expect(f.surprise).toBeNull();
    expect(f.earningsDate).toBe("2026-02-01");
  });
  it("excludes later disclosures and future earnings", () => {
    const f = deriveFundamentals(
      income,
      balance,
      [],
      [{ date: "2026-04-01", epsActual: 2, epsEstimated: 1 }],
      "2026-01-01",
    ).fundamentals;
    expect(f.period).toContain("2024-12-31");
    expect(f.epsGrowth).toBeNull();
    expect(f.surprise).toBeNull();
  });
  it("does not interpret nonpositive prior EPS as normal growth", () => {
    const f = deriveFundamentals(
      [income[0], { ...income[1], eps: -1 }],
      balance,
      [],
      [],
      "2026-03-01",
    ).fundamentals;
    expect(f.epsGrowth).toBeNull();
  });
});
describe("watchlists and CSV", () => {
  it("accepts ticker spaces and preserves company names", () => {
    expect(
      parseStockInput("AAPL MSFT\nNVIDIA, Advanced Micro Devices, AAPL"),
    ).toEqual(["AAPL", "MSFT", "NVIDIA", "Advanced Micro Devices"]);
  });
  it("reads quoted company names and duplicate entries", () => {
    expect(
      stockQueriesFromCsv('name\n"Apple, Inc."\nMicrosoft\nMicrosoft'),
    ).toEqual(["Apple, Inc.", "Microsoft"]);
  });
  it("validates import fields", () => {
    expect(() =>
      validateImport(
        parseCsv("symbol,date,close,volume\nAAPL,2026-10-01,100,500"),
        "prices",
      ),
    ).not.toThrow();
    expect(() =>
      validateImport(parseCsv("symbol,date\nAAPL,2026-10-01"), "prices"),
    ).toThrow("Missing");
  });
});
describe("price basis separation", () => {
  it("uses adjusted return history but as-traded close for liquidity and quantities", () => {
    const input = demoData();
    input[0].bars = input[0].bars.map((b) => ({
      ...b,
      tradedClose: b.close * 2,
    }));
    const s = scoreUniverse(input, DEMO_DATE).find(
      (s) => s.security.symbol === "NVDA",
    )!;
    expect(s.price).toBe(364);
    const expected =
      input[0].bars
        .slice(-20)
        .reduce((sum, b) => sum + b.close * 2 * b.volume!, 0) / 20;
    expect(s.metrics.dollarVolume).toBeCloseTo(expected);
    expect(s.metrics.return3m).toBeCloseTo(
      returnOver(
        input[0].bars.map((b) => b.adjustedClose!),
        63,
      )!,
    );
  });
  it("does not substitute adjusted prices when as-traded prices are denied", () => {
    const input = demoData();
    input[0].bars = input[0].bars.map((b) => ({ ...b, tradedClose: null }));
    const s = scoreUniverse(input, DEMO_DATE).find(
      (s) => s.security.symbol === "NVDA",
    )!;
    expect(s.price).toBeNull();
    expect(s.metrics.dollarVolume).toBeNull();
    expect(s.score).toBeNull();
  });
  it("preserves quoted company names when combined with ticker input", () => {
    expect(parseStockInput('"Apple, Inc.", MSFT AMD')).toEqual([
      "Apple, Inc.",
      "MSFT",
      "AMD",
    ]);
  });
});
