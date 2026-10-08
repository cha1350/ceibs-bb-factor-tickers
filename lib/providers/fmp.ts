import "server-only";
import type { Dataset, Row, Security } from "../types";
import type { MarketDataProvider, DatasetResult } from "./interface";
import { ProviderError } from "./interface";
import { validDate } from "../dates";
const BASE = "https://financialmodelingprep.com/stable/";
const cache = new Map<string, { rows: Row[]; at: string; expires: number }>();
const pending = new Map<string, Promise<{ rows: Row[]; at: string }>>();
let queue: Promise<void> = Promise.resolve();
let nextRequest = 0;
let blockedUntil = 0;
let calls = 0;
let budgetDay = "";
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function boundedSetting(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.min(maximum, Math.floor(n))
    : fallback;
}
async function throttle() {
  const turn = queue.then(async () => {
    if (blockedUntil > Date.now())
      throw new ProviderError(
        "FMP",
        "rate-limit",
        "FMP rate limit reached. Wait before retrying or import CSV.",
      );
    const day = new Date().toISOString().slice(0, 10);
    if (day !== budgetDay) {
      budgetDay = day;
      calls = 0;
    }
    const budget = boundedSetting(process.env.FMP_DAILY_BUDGET, 240, 100000);
    if (calls >= budget)
      throw new ProviderError(
        "FMP",
        "rate-limit",
        "Local daily request budget exhausted; use CSV or retry tomorrow.",
      );
    await pause(Math.max(0, nextRequest - Date.now()));
    nextRequest =
      Date.now() +
      60000 / boundedSetting(process.env.FMP_REQUESTS_PER_MINUTE, 30, 3000);
    calls++;
  });
  queue = turn.catch(() => {});
  await turn;
}
export async function requestFmp(
  endpoint: string,
  parameters: Record<string, string>,
  ttl = 15 * 60000,
): Promise<{ rows: Row[]; at: string }> {
  const key = process.env.FMP_API_KEY;
  if (!key)
    throw new ProviderError(
      endpoint,
      "configuration",
      "FMP_API_KEY is not configured. Add it to .env.local on the server, or import CSV.",
    );
  const id = endpoint + "?" + new URLSearchParams(parameters).toString();
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return { rows: hit.rows, at: hit.at };
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const work = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await throttle();
      const url = new URL(endpoint, BASE);
      Object.entries(parameters).forEach(([k, v]) =>
        url.searchParams.set(k, v),
      );
      url.searchParams.set("apikey", key);
      let response: Response;
      try {
        response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        if (attempt < 2) {
          await pause(500 * 2 ** attempt);
          continue;
        }
        throw new ProviderError(
          endpoint,
          "upstream",
          `${endpoint}: network timeout; retry later or import CSV.`,
        );
      }
      if (response.status === 429) {
        const retry = Number(response.headers.get("retry-after"));
        blockedUntil =
          Date.now() +
          Math.max(60000, Number.isFinite(retry) ? retry * 1000 : 60000);
        throw new ProviderError(
          endpoint,
          "rate-limit",
          `${endpoint}: FMP rate limit reached. Retry after cooldown or import CSV.`,
        );
      }
      if ([401, 402, 403].includes(response.status))
        throw new ProviderError(
          endpoint,
          "entitlement",
          `${endpoint}: access denied (${response.status}). Check your API key, subscription, and symbol coverage; CSV is supported.`,
        );
      if (response.status >= 500 && attempt < 2) {
        await pause(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok)
        throw new ProviderError(
          endpoint,
          "upstream",
          `${endpoint}: provider returned HTTP ${response.status}.`,
        );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError(
          endpoint,
          "invalid",
          `${endpoint}: invalid JSON response.`,
        );
      }
      if (!Array.isArray(body)) {
        const object = body as Record<string, unknown> | null;
        const isEntitlement =
          /premium|subscription|upgrade|restricted|invalid api|limit/i.test(
            String(
              object?.["Error Message"] ??
                object?.error ??
                object?.message ??
                "",
            ),
          );
        throw new ProviderError(
          endpoint,
          isEntitlement ? "entitlement" : "invalid",
          `${endpoint}: ${isEntitlement ? "subscription, key, or usage restriction" : "unexpected provider response"}. Check your FMP account; import CSV if unavailable.`,
        );
      }
      if (body.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
        throw new ProviderError(
          endpoint,
          "invalid",
          `${endpoint}: malformed dataset.`,
        );
      const rows = body as Row[],
        at = new Date().toISOString();
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(id, { rows, at, expires: Date.now() + ttl });
      return { rows, at };
    }
    throw new ProviderError(
      endpoint,
      "upstream",
      `${endpoint}: retry limit reached.`,
    );
  })();
  pending.set(id, work);
  try {
    return await work;
  } finally {
    pending.delete(id);
  }
}
const endpoints: Record<Dataset, string> = {
  profile: "profile",
  prices: "historical-price-eod/full",
  income: "income-statement",
  balance: "balance-sheet-statement",
  ratios: "ratios",
  earnings: "earnings",
  estimates: "analyst-estimates",
};
export class FmpProvider implements MarketDataProvider {
  readonly name = "Financial Modeling Prep";
  async search(query: string): Promise<Security[]> {
    const result = await Promise.allSettled(
      ["search-symbol", "search-name"].map((endpoint) =>
        requestFmp(endpoint, { query, limit: "30" }, 86400000),
      ),
    );
    const hits = result.flatMap((r) =>
      r.status === "fulfilled" ? r.value.rows : [],
    );
    if (!hits.length && result.some((r) => r.status === "rejected")) {
      const rejected = result.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      throw rejected.reason;
    }
    const unique = new Map<string, Security>();
    hits.forEach((r) => {
      if (typeof r.symbol === "string" && typeof r.name === "string") {
        const s = {
          symbol: r.symbol,
          name: r.name,
          exchange: String(r.exchangeShortName || r.exchange || "Unknown"),
          currency: String(r.currency || "Unknown"),
        };
        unique.set(`${s.symbol}:${s.exchange}`, s);
      }
    });
    return [...unique.values()].sort(
      (a, b) =>
        Number(b.symbol.toLowerCase() === query.toLowerCase()) -
          Number(a.symbol.toLowerCase() === query.toLowerCase()) ||
        a.symbol.localeCompare(b.symbol),
    );
  }
  async dataset(
    dataset: Dataset,
    symbol: string,
    asOf: string,
  ): Promise<DatasetResult> {
    const endpoint = endpoints[dataset];
    const parameters: Record<string, string> = { symbol };
    if (dataset === "prices") {
      const from = new Date(Date.parse(asOf) - 400 * 86400000)
        .toISOString()
        .slice(0, 10);
      parameters.from = from;
      parameters.to = asOf;
    }
    if (["income", "balance", "ratios"].includes(dataset)) {
      parameters.period = "annual";
      parameters.limit = "5";
    }
    if (dataset === "estimates") {
      parameters.period = "annual";
      parameters.limit = "5";
    }
    const { rows, at } = await requestFmp(
      endpoint,
      parameters,
      dataset === "prices" ? 15 * 60000 : 6 * 3600000,
    );
    return {
      rows,
      status: {
        dataset,
        source: this.name,
        status: rows.length ? "available" : "unavailable",
        message: rows.length
          ? ["income", "balance", "ratios"].includes(dataset)
            ? "Annual reported data"
            : "Provider data"
          : "No data returned; import CSV if available.",
        fetchedAt: at,
      },
    };
  }
  async adjustments(symbol: string, asOf: string) {
    const from = new Date(Date.parse(asOf) - 400 * 86400000)
      .toISOString()
      .slice(0, 10);
    return requestFmp("historical-price-eod/dividend-adjusted", {
      symbol,
      from,
      to: asOf,
    });
  }
  async tradedPrices(symbol: string, asOf: string) {
    const from = new Date(Date.parse(asOf) - 400 * 86400000)
      .toISOString()
      .slice(0, 10);
    return requestFmp("historical-price-eod/non-split-adjusted", {
      symbol,
      from,
      to: asOf,
    });
  }
}
export function providerHealth() {
  return {
    configured: Boolean(process.env.FMP_API_KEY),
    provider: "Financial Modeling Prep",
    requestsToday: calls,
    budget: boundedSetting(process.env.FMP_DAILY_BUDGET, 240, 100000),
    documentation: "https://site.financialmodelingprep.com/developer/docs",
    note: "Entitlements are verified per endpoint when data is requested. No API key is returned.",
  };
}
export function parseBars(rows: Row[]) {
  const seen = new Set<string>();
  return rows
    .map((r) => {
      const date = String(r.date ?? "").slice(0, 10);
      const close = number(r.close);
      const volume = number(r.volume);
      const adjustedClose = number(r.adjustedClose ?? r.adjClose);
      if (
        !validDate(date) ||
        close === null ||
        close <= 0 ||
        (volume !== null && volume < 0) ||
        (adjustedClose !== null && adjustedClose <= 0)
      )
        throw new Error(
          "Invalid price row: require date, positive close, nonnegative volume, and positive optional adjustedClose.",
        );
      if (seen.has(date)) throw new Error(`Duplicate price session: ${date}`);
      seen.add(date);
      return { date, close, volume, adjustedClose };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function number(x: unknown): number | null {
  if (x === null || x === undefined || x === "" || typeof x === "boolean")
    return null;
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}
