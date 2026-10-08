import {
  FACTORS,
  DEFAULT_WEIGHTS,
  type Weights,
  type Bar,
  type Metrics,
  type StockData,
  type ScoredStock,
  type Mode,
} from "./types";
import { validDate } from "./dates";
export const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
export function validateWeights(weights: Weights): void {
  if (
    FACTORS.some(
      (f) => !finite(weights[f]) || weights[f] < 0 || weights[f] > 100,
    ) ||
    Math.abs(FACTORS.reduce((s, f) => s + weights[f], 0) - 100) > 1e-6
  )
    throw new Error("Factor weights must be nonnegative and total 100%.");
}
export function effectiveWeights(weights: Weights, mode: Mode): Weights {
  validateWeights(weights);
  if (mode === "full") return weights;
  const sum = weights.momentum + weights.lowVolatility + weights.liquidity;
  if (sum <= 0)
    throw new Error("Price-only mode requires a positive price-factor weight.");
  return {
    momentum: (weights.momentum / sum) * 100,
    quality: 0,
    earnings: 0,
    lowVolatility: (weights.lowVolatility / sum) * 100,
    liquidity: (weights.liquidity / sum) * 100,
  };
}
export function changeWeight(
  weights: Weights,
  factor: keyof Weights,
  value: number,
): Weights {
  const target = Math.round(Math.max(0, Math.min(100, value)));
  const other = FACTORS.filter((f) => f !== factor);
  const previous = other.reduce((s, f) => s + weights[f], 0);
  const result = { ...weights, [factor]: target };
  const proportional = other.map((f) => ({
    f,
    value:
      (100 - target) *
      (previous > 0 ? weights[f] / previous : 1 / other.length),
  }));
  proportional.forEach(({ f, value }) => {
    result[f] = Math.floor(value);
  });
  const remaining = 100 - target - other.reduce((sum, f) => sum + result[f], 0);
  proportional
    .sort((a, b) => (b.value % 1) - (a.value % 1))
    .slice(0, remaining)
    .forEach(({ f }) => {
      result[f]++;
    });
  return result;
}
export function cutoffBars(bars: Bar[], cutoff: string): Bar[] {
  const seen = new Set<string>();
  return [...bars]
    .filter(
      (b) =>
        validDate(b.date) && b.date <= cutoff && finite(b.close) && b.close > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((b) => {
      if (seen.has(b.date))
        throw new Error(`Duplicate price session: ${b.date}`);
      seen.add(b.date);
      return true;
    });
}
export function returnOver(prices: number[], sessions: number): number | null {
  if (prices.length <= sessions || prices.some((p) => !finite(p) || p <= 0))
    return null;
  return prices.at(-1)! / prices[prices.length - 1 - sessions] - 1;
}
export function dailyReturns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}
export function sampleVariance(xs: number[]): number | null {
  if (xs.length < 2 || xs.some((x) => !finite(x))) return null;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);
}
export function annualizedVolatility(
  prices: number[],
  sessions = 60,
): number | null {
  if (prices.length < sessions + 1 || prices.some((p) => !finite(p) || p <= 0))
    return null;
  const v = sampleVariance(dailyReturns(prices.slice(-sessions - 1)));
  return v === null ? null : Math.sqrt(v * 252);
}
export function percentileRanks(
  values: (number | null)[],
  lowerBetter = false,
): (number | null)[] {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  return values.map((v) => {
    if (!finite(v)) return null;
    if (sorted.length <= 1 || sorted[0] === sorted.at(-1)) return 50;
    const first = sorted.indexOf(v),
      last = sorted.lastIndexOf(v);
    const p = ((first + last) / 2 / (sorted.length - 1)) * 100;
    return lowerBetter ? 100 - p : p;
  });
}
export function metricsFor(stock: StockData, cutoff: string): Metrics {
  const bars = cutoffBars(stock.bars, cutoff);
  // Never splice adjusted and raw series; use adjustments only with complete coverage.
  const adjusted =
    bars.length > 0 &&
    bars.every((b) => finite(b.adjustedClose) && b.adjustedClose > 0);
  const prices = bars.map((b) => (adjusted ? b.adjustedClose! : b.close));
  const last20 = bars.slice(-20);
  const tradedClose = (b: Bar) =>
    b.tradedClose === undefined ? b.close : b.tradedClose;
  const dollarVolume =
    last20.length === 20 &&
    last20.every(
      (b) =>
        finite(b.volume) &&
        b.volume >= 0 &&
        finite(tradedClose(b)) &&
        tradedClose(b)! > 0,
    )
      ? last20.reduce((s, b) => s + tradedClose(b)! * b.volume!, 0) / 20
      : null;
  const f = stock.fundamentals;
  return {
    return3m: returnOver(prices, 63),
    return6m: returnOver(prices, 126),
    volatility: annualizedVolatility(prices),
    dollarVolume,
    roe: f.equity !== null && f.equity > 0 ? f.roe : null,
    margin: f.margin,
    debtEquity:
      f.equity !== null &&
      f.equity > 0 &&
      f.debtEquity !== null &&
      f.debtEquity >= 0
        ? f.debtEquity
        : null,
    epsGrowth: f.epsGrowth,
    surprise: f.surprise,
  };
}
function combine(values: (number | null)[], weights: number[]): number | null {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0) || values.some((v, i) => weights[i] > 0 && !finite(v)))
    return null;
  return values.reduce<number>(
    (s, v, i) => s + ((v ?? 0) * weights[i]) / sum,
    0,
  );
}
export function scoreUniverse(
  stocks: StockData[],
  cutoff: string,
  weights: Weights = DEFAULT_WEIGHTS,
  mode: Mode = "full",
  qualityWeights = [40, 40, 20],
): ScoredStock[] {
  const w = effectiveWeights(weights, mode);
  if (
    qualityWeights.length !== 3 ||
    qualityWeights.some((x) => !finite(x) || x < 0) ||
    qualityWeights.reduce((a, b) => a + b, 0) <= 0
  )
    throw new Error(
      "Quality weights must be nonnegative with a positive total.",
    );
  const metrics = stocks.map((s) => metricsFor(s, cutoff));
  const keys = Object.keys(metrics[0] ?? {}) as (keyof Metrics)[];
  const ranks = Object.fromEntries(
    keys.map((k) => [
      k,
      percentileRanks(
        metrics.map((m) =>
          k === "dollarVolume"
            ? m[k] !== null && m[k]! > 0
              ? Math.log1p(m[k]!)
              : m[k]
            : m[k],
        ),
        k === "volatility" || k === "debtEquity",
      ),
    ]),
  ) as Record<keyof Metrics, (number | null)[]>;
  const results = stocks
    .map((s, i): ScoredStock => {
      const subScores = Object.fromEntries(
        keys.map((k) => [k, ranks[k][i]]),
      ) as Record<keyof Metrics, number | null>;
      const factors = {
        momentum: combine([subScores.return3m, subScores.return6m], [1, 1]),
        quality: combine(
          [subScores.roe, subScores.margin, subScores.debtEquity],
          qualityWeights,
        ),
        earnings: combine([subScores.epsGrowth, subScores.surprise], [1, 1]),
        lowVolatility: subScores.volatility,
        liquidity: subScores.dollarVolume,
      };
      const required =
        mode === "full"
          ? FACTORS
          : FACTORS.filter((f) => f !== "quality" && f !== "earnings");
      const missing = required
        .filter((f) => factors[f] === null)
        .map((f) => f as string);
      if (mode === "full" && !s.historicalFullAllowed)
        missing.push("Point-in-time fundamentals unavailable");
      const bars = cutoffBars(s.bars, cutoff);
      const score = missing.length
        ? null
        : FACTORS.reduce((sum, f) => sum + ((factors[f] ?? 0) * w[f]) / 100, 0);
      const latest = bars.at(-1);
      const price = latest
        ? latest.tradedClose === undefined
          ? latest.close
          : latest.tradedClose
        : null;
      return {
        ...s,
        bars,
        metrics: metrics[i],
        subScores,
        factors,
        score,
        rank: null,
        missing,
        price,
        priceDate: latest?.date ?? null,
        mode,
      };
    })
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) ||
        a.security.symbol.localeCompare(b.security.symbol),
    );
  let last: number | null = null,
    rank = 0;
  results.forEach((s, i) => {
    if (s.score !== null) {
      if (last === null || Math.abs(s.score - last) > 1e-9) rank = i + 1;
      s.rank = rank;
      last = s.score;
    }
  });
  return results;
}
