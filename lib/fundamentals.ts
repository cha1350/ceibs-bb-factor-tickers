import type { Fundamentals, Row } from "./types";
import { publishedBy, validDate, daysBetween } from "./dates";
export const emptyFundamentals = (): Fundamentals => ({
  roe: null,
  margin: null,
  debtEquity: null,
  epsGrowth: null,
  surprise: null,
  equity: null,
  period: null,
  publishedAt: null,
  earningsDate: null,
});
function num(x: unknown): number | null {
  if (x === null || x === undefined || x === "" || typeof x === "boolean")
    return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
export function deriveFundamentals(
  income: Row[],
  balance: Row[],
  ratios: Row[],
  earnings: Row[],
  cutoff: string,
): { fundamentals: Fundamentals; warnings: string[] } {
  const f = emptyFundamentals(),
    warnings: string[] = [];
  const reports = income
    .filter((r) => publishedBy(r, cutoff))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = reports[0];
  if (latest) {
    f.period = `${latest.period || "unknown period"} / ${String(latest.date).slice(0, 10)}`;
    f.publishedAt = String(
      latest.acceptedDate || latest.filingDate || latest.publishedAt,
    );
    const matched = balance.find(
      (r) =>
        publishedBy(r, cutoff) &&
        r.date === latest.date &&
        r.period === latest.period,
    );
    const ratio = ratios.find(
      (r) => r.date === latest.date && r.period === latest.period,
    );
    f.equity = matched ? num(matched.totalStockholdersEquity) : null;
    const annual = String(latest.period).toUpperCase() === "FY";
    const incomeValue = num(latest.netIncome),
      revenue = num(latest.revenue),
      operating = num(latest.operatingIncome);
    // ROE uses annual income / average positive beginning and ending equity.
    const priorBalance = balance.find(
      (r) =>
        publishedBy(r, cutoff) &&
        r.period === latest.period &&
        daysBetween(String(r.date), String(latest.date)) >= 330 &&
        daysBetween(String(r.date), String(latest.date)) <= 400,
    );
    const priorEquity = priorBalance
      ? num(priorBalance.totalStockholdersEquity)
      : null;
    if (f.equity !== null && f.equity > 0) {
      if (
        annual &&
        incomeValue !== null &&
        priorEquity !== null &&
        priorEquity > 0
      )
        f.roe = incomeValue / ((f.equity + priorEquity) / 2);
      else if (annual && ratio) f.roe = num(ratio.returnOnEquity);
      const debt = matched ? num(matched.totalDebt) : null;
      f.debtEquity =
        debt !== null && debt >= 0
          ? debt / f.equity
          : ratio
            ? num(ratio.debtToEquityRatio ?? ratio.debtEquityRatio)
            : null;
    } else
      warnings.push(
        "Equity missing or nonpositive: ROE and debt/equity are invalid.",
      );
    f.margin =
      revenue !== null && revenue > 0 && operating !== null
        ? operating / revenue
        : ratio
          ? num(ratio.operatingProfitMargin)
          : null;
    const prior = reports.find(
      (r) =>
        r.period === latest.period &&
        daysBetween(String(r.date), String(latest.date)) >= 330 &&
        daysBetween(String(r.date), String(latest.date)) <= 400,
    );
    const eps = num(latest.epsDiluted ?? latest.eps),
      priorEps = prior ? num(prior.epsDiluted ?? prior.eps) : null;
    if (eps !== null && priorEps !== null && priorEps > 0)
      f.epsGrowth = eps / priorEps - 1;
    else
      warnings.push(
        "EPS growth unavailable: prior-year comparable EPS missing, zero, or negative.",
      );
    if (!annual)
      warnings.push(
        "Quarterly imports: ROE requires an annual ratio or annual income and equity; quarterly income is not annualized.",
      );
  } else
    warnings.push(
      "No income statement with a valid publication or filing date available by the evaluation cutoff.",
    );
  const reported = earnings
    .filter(
      (r) =>
        validDate(String(r.date).slice(0, 10)) &&
        String(r.date).slice(0, 10) <= cutoff &&
        num(r.epsActual) !== null,
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const event = reported[0];
  if (event) {
    f.earningsDate = String(event.date).slice(0, 10);
    const actual = num(event.epsActual),
      estimated = num(event.epsEstimated);
    if (actual !== null && estimated !== null && estimated !== 0)
      f.surprise = (actual - estimated) / Math.abs(estimated);
  }
  if (f.surprise === null)
    warnings.push(
      "Latest reported EPS surprise unavailable: no reported event or valid contemporaneous estimate.",
    );
  return { fundamentals: f, warnings };
}
