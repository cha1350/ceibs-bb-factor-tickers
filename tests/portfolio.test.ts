import { describe, it, expect } from "vitest";
import {
  allocatePortfolio,
  constrainedWeights,
  normalizeWeights,
  portfolioRisk,
  validateConstraints,
} from "../lib/portfolio";
import { scoreUniverse } from "../lib/scoring";
import { demoData, DEMO_DATE } from "../lib/demo";
import type { Constraints } from "../lib/types";
const c: Constraints = {
  capital: 1e6,
  positionCap: 0.07,
  sectorCap: 0.25,
  cashReserve: 0.1,
};
const stocks = () => scoreUniverse(demoData(), DEMO_DATE);
describe("portfolio normalization and constraints", () => {
  it("normalizes nonnegative raw weights and handles zero totals", () => {
    expect(normalizeWeights([1, 2, 1])).toEqual([0.25, 0.5, 0.25]);
    expect(normalizeWeights([0, 0])).toEqual([0, 0]);
    expect(() => normalizeWeights([-1, 2])).toThrow();
  });
  it("keeps unallocatable capital in cash under position caps", () => {
    const w = constrainedWeights([1, 1], ["A", "B"], c);
    expect(w[0]).toBeCloseTo(0.07);
    expect(w[1]).toBeCloseTo(0.07);
    expect(1 - w.reduce((s, x) => s + x, 0)).toBeCloseTo(0.86);
  });
  it("redistributes weights after a sector saturates", () => {
    const w = constrainedWeights([10, 10, 1, 1], ["A", "A", "B", "C"], {
      ...c,
      positionCap: 0.5,
      sectorCap: 0.25,
    });
    expect(w[0] + w[1]).toBeCloseTo(0.25);
    expect(w[2]).toBeCloseTo(0.25);
    expect(w[3]).toBeCloseTo(0.25);
  });
  it("reaches the cash target when there is sufficient capacity", () => {
    const w = constrainedWeights([1, 2, 3, 4], ["A", "B", "C", "D"], {
      ...c,
      positionCap: 0.5,
      sectorCap: 0.5,
    });
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(0.9);
  });
  it("handles no eligible stocks and 100% cash", () => {
    expect(allocatePortfolio([], "factor", c).cash).toBe(1e6);
    expect(
      allocatePortfolio(stocks(), "equal", { ...c, cashReserve: 1 }).cash,
    ).toBe(1e6);
  });
  it("validates constraints", () => {
    expect(() => validateConstraints({ ...c, positionCap: 1.1 })).toThrow();
    expect(() => validateConstraints({ ...c, capital: 0 })).toThrow();
  });
  it("uses whole shares and reconciles dollars to cash without leverage", () => {
    for (const m of ["equal", "inverse", "factor"] as const) {
      const p = allocatePortfolio(stocks(), m, c);
      expect(
        p.cash + p.positions.reduce((s, x) => s + x.dollars, 0),
      ).toBeCloseTo(c.capital);
      for (const x of p.positions) {
        expect(Number.isInteger(x.shares)).toBe(true);
        expect(x.weight).toBeLessThanOrEqual(c.positionCap + 1e-12);
        expect(x.weight).toBeLessThanOrEqual(x.targetWeight + 1e-12);
      }
      expect(p.cashWeight).toBeGreaterThanOrEqual(c.cashReserve);
      for (const x of p.sectors)
        expect(x.weight).toBeLessThanOrEqual(c.sectorCap + 1e-12);
    }
  });
  it("matches unconstrained inverse and factor volatility equations", () => {
    const input = stocks().slice(0, 3);
    const free = { ...c, positionCap: 1, sectorCap: 1, cashReserve: 0 };
    for (const method of ["inverse", "factor"] as const) {
      const p = allocatePortfolio(input, method, free);
      const raw = input.map(
        (s) => (method === "factor" ? s.score! : 1) / s.metrics.volatility!,
      );
      const expected = normalizeWeights(raw);
      p.positions.forEach((x, i) =>
        expect(x.targetWeight).toBeCloseTo(expected[i]),
      );
    }
  });
  it("excludes incomplete, non-USD, and zero-volatility names", () => {
    const input = stocks();
    input[0].score = null;
    input[1].security.currency = "EUR";
    input[2].metrics.volatility = 0;
    expect(allocatePortfolio(input, "equal", c).positions).toHaveLength(
      input.length - 3,
    );
  });
  it("is deterministic and invariant to scaling raw inputs", () => {
    const a = constrainedWeights([3, 2, 1], ["A", "A", "B"], c);
    expect(constrainedWeights([30, 20, 10], ["A", "A", "B"], c)).toEqual(a);
  });
  it("preserves caps over many raw weight and sector configurations", () => {
    let seed = 17;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let j = 0; j < 150; j++) {
      const n = 1 + Math.floor(rand() * 40),
        raw = Array.from({ length: n }, () => rand() * 100),
        sectors = raw.map(() => `sector${Math.floor(rand() * 8)}`),
        cfg = {
          ...c,
          positionCap: rand() * 0.3,
          sectorCap: rand() * 0.6,
          cashReserve: rand(),
        };
      const w = constrainedWeights(raw, sectors, cfg);
      expect(w.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(
        1 - cfg.cashReserve + 1e-10,
      );
      w.forEach((x) => {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(cfg.positionCap + 1e-10);
      });
      for (const sector of new Set(sectors))
        expect(
          w.reduce((s, x, i) => s + (sectors[i] === sector ? x : 0), 0),
        ).toBeLessThanOrEqual(cfg.sectorCap + 1e-10);
    }
  });
});
describe("covariance risk", () => {
  it("reduces volatility in proportion to cash for a single stock", () => {
    const input = stocks().slice(0, 1);
    expect(portfolioRisk(input, [0.2]).volatility).toBeCloseTo(
      input[0].metrics.volatility! * 0.2,
    );
  });
  it("does not invent correlations for insufficient common history", () => {
    const input = stocks().slice(0, 2);
    input[1].bars = input[1].bars.slice(-20);
    expect(portfolioRisk(input, [0.5, 0.5]).volatility).toBeNull();
  });
  it("aligns both dates and previous-session intervals", () => {
    const input = stocks().slice(0, 2);
    input[1].bars = input[1].bars.filter((_, i) => i % 2 === 0);
    expect(portfolioRisk(input, [0.5, 0.5]).volatility).toBeNull();
  });
});
