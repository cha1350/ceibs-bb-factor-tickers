import type {
  ScoredStock,
  Constraints,
  AllocationMethod,
  Portfolio,
} from "./types";
import { finite, sampleVariance, dailyReturns } from "./scoring";
export function validateConstraints(c: Constraints): void {
  if (
    !finite(c.capital) ||
    c.capital <= 0 ||
    c.capital > 1e12 ||
    [c.positionCap, c.sectorCap, c.cashReserve].some(
      (x) => !finite(x) || x < 0 || x > 1,
    )
  )
    throw new Error(
      "Capital must be positive; caps and cash reserve must be between 0% and 100%.",
    );
}
export function normalizeWeights(raw: number[]): number[] {
  if (raw.some((x) => !finite(x) || x < 0))
    throw new Error("Invalid raw allocation weight.");
  const sum = raw.reduce((a, b) => a + b, 0);
  return sum > 0 ? raw.map((x) => x / sum) : raw.map(() => 0);
}
export function constrainedWeights(
  raw: number[],
  sectors: string[],
  c: Constraints,
): number[] {
  validateConstraints(c);
  if (raw.length !== sectors.length)
    throw new Error("Sector mapping mismatch.");
  normalizeWeights(raw);
  const weights = raw.map(() => 0);
  let remaining = 1 - c.cashReserve;
  // Proportional water filling; each iteration saturates a position, a sector, or the target.
  for (
    let iteration = 0;
    iteration <= raw.length * 2 + 2 && remaining > 1e-12;
    iteration++
  ) {
    const sectorTotals: Record<string, number> = {};
    weights.forEach((w, i) => {
      sectorTotals[sectors[i]] = (sectorTotals[sectors[i]] ?? 0) + w;
    });
    const active = raw
      .map((v, i) => i)
      .filter(
        (i) =>
          raw[i] > 0 &&
          weights[i] < c.positionCap - 1e-12 &&
          (sectorTotals[sectors[i]] ?? 0) < c.sectorCap - 1e-12,
      );
    if (!active.length) break;
    const norm = normalizeWeights(active.map((i) => raw[i]));
    const proposals = active.map((i, j) => norm[j] * remaining);
    let scale = 1;
    const sectorProposals: Record<string, number> = {};
    active.forEach((i, j) => {
      scale = Math.min(scale, (c.positionCap - weights[i]) / proposals[j]);
      sectorProposals[sectors[i]] =
        (sectorProposals[sectors[i]] ?? 0) + proposals[j];
    });
    Object.entries(sectorProposals).forEach(([sector, amount]) => {
      scale = Math.min(
        scale,
        (c.sectorCap - (sectorTotals[sector] ?? 0)) / amount,
      );
    });
    let added = 0;
    active.forEach((i, j) => {
      const delta = proposals[j] * Math.max(0, scale);
      weights[i] += delta;
      added += delta;
    });
    remaining = Math.max(0, remaining - added);
    if (added < 1e-14) break;
  }
  return weights;
}
export function portfolioRisk(
  stocks: ScoredStock[],
  weights: number[],
): { volatility: number | null; sessions: number } {
  const active = stocks
    .map((s, i) => ({ s, w: weights[i] }))
    .filter((x) => x.w > 0);
  if (!active.length) return { volatility: 0, sessions: 0 };
  const series = active.map(({ s }) => {
    const adjusted = s.bars.every(
      (b) => finite(b.adjustedClose) && b.adjustedClose! > 0,
    );
    const prices = s.bars.map((b) => (adjusted ? b.adjustedClose! : b.close));
    const returns = dailyReturns(prices);
    return new Map(
      s.bars
        .slice(1)
        .map((b, i) => [
          b.date,
          { value: returns[i], previous: s.bars[i].date },
        ]),
    );
  });
  const dates = [...series[0].keys()]
    .filter((d) =>
      series.every(
        (m) => m.has(d) && m.get(d)!.previous === series[0].get(d)!.previous,
      ),
    )
    .sort()
    .slice(-60);
  if (dates.length < 30) return { volatility: null, sessions: dates.length };
  // Variance of weighted aligned returns is w'Σw; cash has zero volatility.
  const weighted = dates.map((d) =>
    active.reduce((sum, x, i) => sum + x.w * series[i].get(d)!.value, 0),
  );
  return {
    volatility: Math.sqrt(sampleVariance(weighted)! * 252),
    sessions: dates.length,
  };
}
export function allocatePortfolio(
  stocks: ScoredStock[],
  method: AllocationMethod,
  c: Constraints,
): Portfolio {
  validateConstraints(c);
  const eligible = stocks.filter(
    (s) =>
      s.score !== null &&
      s.price !== null &&
      s.price > 0 &&
      s.security.currency === "USD" &&
      s.metrics.volatility !== null &&
      s.metrics.volatility > 1e-8,
  );
  const raw = eligible.map((s) =>
    method === "equal"
      ? 1
      : method === "inverse"
        ? 1 / s.metrics.volatility!
        : s.score! / s.metrics.volatility!,
  );
  const target = constrainedWeights(
    normalizeWeights(raw),
    eligible.map((s) => s.sector),
    c,
  );
  const positions = eligible.map((s, i) => {
    const shares = Math.floor((target[i] * c.capital + 1e-8) / s.price!);
    const dollars = shares * s.price!;
    return {
      symbol: s.security.symbol,
      sector: s.sector,
      targetWeight: target[i],
      weight: dollars / c.capital,
      dollars,
      shares,
      score: s.score!,
      price: s.price!,
    };
  });
  const invested = positions.reduce((sum, p) => sum + p.dollars, 0);
  const sectorMap: Record<string, number> = {};
  positions.forEach((p) => {
    sectorMap[p.sector] = (sectorMap[p.sector] ?? 0) + p.dollars;
  });
  const risk = portfolioRisk(
    eligible,
    positions.map((p) => p.weight),
  );
  const targetCashWeight = 1 - target.reduce((s, w) => s + w, 0);
  const warnings: string[] = [];
  if (eligible.length < stocks.length)
    warnings.push(
      `${stocks.length - eligible.length} securities excluded: incomplete score, invalid risk/price, or non-USD currency.`,
    );
  if (targetCashWeight > c.cashReserve + 1e-6)
    warnings.push("Position or sector caps leave excess capital in cash.");
  if (risk.volatility === null)
    warnings.push(
      `Portfolio volatility unavailable: only ${risk.sessions} aligned return sessions; at least 30 required.`,
    );
  if (
    positions.some((p) => p.weight > 0.15) ||
    Object.values(sectorMap).some((x) => x / c.capital > 0.35)
  )
    warnings.push(
      "Concentration risk: a position exceeds 15% or a sector exceeds 35%.",
    );
  return {
    method,
    positions,
    sectors: Object.entries(sectorMap)
      .map(([name, dollars]) => ({
        name,
        dollars,
        weight: dollars / c.capital,
      }))
      .sort((a, b) => b.weight - a.weight),
    cash: c.capital - invested,
    cashWeight: 1 - invested / c.capital,
    targetCashWeight,
    weightedScore:
      invested > 0
        ? positions.reduce((sum, p) => sum + p.dollars * p.score, 0) / invested
        : null,
    volatility: risk.volatility,
    covarianceSessions: risk.sessions,
    warnings,
  };
}
