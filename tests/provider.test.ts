import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { todayIn } from "../lib/dates";
import type { Row } from "../lib/types";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("FMP_API_KEY", "test-secret-do-not-expose");
  vi.stubEnv("FMP_REQUESTS_PER_MINUTE", "3000");
  vi.stubEnv("FMP_DAILY_BUDGET", "100000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
) => new Response(JSON.stringify(data), { status, headers });
describe("FMP service", () => {
  it("searches the company without its currency suffix and filters actual provider listings", async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      response([
        {
          symbol: "7906.T",
          name: "YONEX Co., Ltd.",
          exchange: "JPX",
          currency: "JPY",
        },
        {
          symbol: "YONXF",
          name: "YONEX Co., Ltd.",
          exchange: "OTC",
          currency: "USD",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetcher);
    const { FmpProvider } = await import("../lib/providers/fmp");
    expect(await new FmpProvider().search("Yonex JPY")).toEqual([
      {
        symbol: "7906.T",
        name: "YONEX Co., Ltd.",
        exchange: "JPX",
        currency: "JPY",
      },
    ]);
    expect(fetcher.mock.calls).toHaveLength(2);
    for (const [url] of fetcher.mock.calls)
      expect(new URL(url).searchParams.get("query")).toBe("Yonex");
  });
  it("explains subscription denial after a successful listing search without inventing data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => response({}, 402)),
    );
    const { loadStock } = await import("../lib/server");
    const stock = await loadStock(
      { symbol: "7906.T", name: "Yonex", exchange: "JPX", currency: "JPY" },
      todayIn(),
      "fmp",
      {},
    );
    expect(stock.bars).toEqual([]);
    expect(stock.fundamentals.roe).toBeNull();
    expect(
      stock.warnings.some((w) =>
        w.includes("FMP denied dataset access for 7906.T"),
      ),
    ).toBe(true);
    expect(stock.statuses.every((s) => s.status === "unavailable")).toBe(true);
  });
  it("keeps credentials in the server request and health omits them", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response([{ symbol: "AAPL", companyName: "Apple" }]));
    vi.stubGlobal("fetch", fetcher);
    const { requestFmp, providerHealth } = await import("../lib/providers/fmp");
    await requestFmp("profile", { symbol: "AAPL" });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("apikey")).toBe(
      "test-secret-do-not-expose",
    );
    expect(JSON.stringify(providerHealth())).not.toContain("test-secret");
  });
  it("caches results and deduplicates concurrent requests with original timestamps", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ symbol: "AAPL" }]));
    vi.stubGlobal("fetch", fetcher);
    const { requestFmp } = await import("../lib/providers/fmp");
    const [a, b] = await Promise.all([
      requestFmp("profile", { symbol: "AAPL" }),
      requestFmp("profile", { symbol: "AAPL" }),
    ]);
    const c = await requestFmp("profile", { symbol: "AAPL" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.at).toBe(b.at);
    expect(c.at).toBe(a.at);
  });
  it("fails without a server key instead of using demo data", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const { requestFmp } = await import("../lib/providers/fmp");
    await expect(requestFmp("profile", { symbol: "AAPL" })).rejects.toThrow(
      "not configured",
    );
  });
  it("surfaces subscription failures without exposing upstream body or key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ message: "restricted test-secret-do-not-expose" }, 403),
        ),
    );
    const { requestFmp } = await import("../lib/providers/fmp");
    await expect(requestFmp("ratios", { symbol: "AAPL" })).rejects.toThrow(
      "access denied",
    );
  });
  it("handles HTTP 200 error objects as entitlement errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ "Error Message": "Upgrade premium subscription" }),
        ),
    );
    const { requestFmp } = await import("../lib/providers/fmp");
    await expect(
      requestFmp("ratios", { symbol: "AAPL" }),
    ).rejects.toMatchObject({ kind: "entitlement" });
  });
  it("opens a cooldown when the provider rate limits requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({}, 429, { "retry-after": "90" }));
    vi.stubGlobal("fetch", fetcher);
    const { requestFmp } = await import("../lib/providers/fmp");
    await expect(
      requestFmp("profile", { symbol: "AAPL" }),
    ).rejects.toMatchObject({ kind: "rate-limit" });
    await expect(
      requestFmp("profile", { symbol: "MSFT" }),
    ).rejects.toMatchObject({ kind: "rate-limit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries a transient upstream failure", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response([{ symbol: "AAPL" }]));
    vi.stubGlobal("fetch", fetcher);
    const { requestFmp } = await import("../lib/providers/fmp");
    const promise = requestFmp("profile", { symbol: "AAPL" });
    await vi.runAllTimersAsync();
    expect((await promise).rows).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("validates prices and never coerces missing values to zero", async () => {
    const { parseBars, number } = await import("../lib/providers/fmp");
    expect(number("")).toBeNull();
    expect(number(false)).toBeNull();
    expect(number("0")).toBe(0);
    expect(() =>
      parseBars([{ date: "2026-10-01", close: -1, volume: 20 }]),
    ).toThrow();
    expect(() =>
      parseBars([{ date: "2026-10-01", close: 1, volume: -20 }]),
    ).toThrow();
  });
  it("retains duplicate exchange listings for user selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response([
          {
            symbol: "ABC",
            name: "ABC Ltd",
            exchangeShortName: "NYSE",
            currency: "USD",
          },
          {
            symbol: "ABC",
            name: "ABC Ltd",
            exchangeShortName: "LSE",
            currency: "GBP",
          },
        ]),
      ),
    );
    const { FmpProvider } = await import("../lib/providers/fmp");
    expect(await new FmpProvider().search("ABC")).toHaveLength(2);
  });
});
describe("server integration", () => {
  it("resolves currency-qualified CSV names and rejects the wrong currency", async () => {
    const { POST } = await import("../app/api/resolve/route");
    const r = await POST(
      new Request("http://localhost/api/resolve", {
        method: "POST",
        body: JSON.stringify({
          queries: ["Yonex JPY", "Yonex EUR"],
          source: "csv",
          imports: {
            profile: [
              {
                symbol: "7906.T",
                companyName: "YONEX Co., Ltd.",
                sector: "Consumer Cyclical",
                exchange: "JPX",
                currency: "JPY",
              },
              {
                symbol: "YONXF",
                companyName: "YONEX Co., Ltd.",
                sector: "Consumer Cyclical",
                exchange: "OTC",
                currency: "USD",
              },
            ],
          },
        }),
      }),
    );
    const { results } = await r.json();
    expect(results[0].matches.map((s: { symbol: string }) => s.symbol)).toEqual(
      ["7906.T"],
    );
    expect(results[1].matches).toEqual([]);
    expect(results[1].error).toContain("No EUR listing");
  });
  it("runs ticker resolution → synthetic retrieval without a key", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const { POST: resolve } = await import("../app/api/resolve/route");
    const r = await resolve(
      new Request("http://localhost/api/resolve", {
        method: "POST",
        body: JSON.stringify({
          queries: ["Apple", "MSFT"],
          source: "demo",
          imports: {},
        }),
      }),
    );
    const body = await r.json();
    expect(body.results[0].matches[0].symbol).toBe("AAPL");
    const { POST: analyze } = await import("../app/api/analyze/route");
    const result = await analyze(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({
          securities: body.results.map(
            (r: { matches: unknown[] }) => r.matches[0],
          ),
          source: "demo",
          asOf: "2026-10-07",
          imports: {},
        }),
      }),
    );
    const data = await result.json();
    expect(data.stocks).toHaveLength(2);
    expect(data.stocks[0].source).toBe("Synthetic demo");
    expect(JSON.stringify(data)).not.toContain("test-secret");
  });
  it("supports CSV-only source with independently labeled dataset provenance", async () => {
    vi.stubEnv("FMP_API_KEY", "");
    const { loadStock } = await import("../lib/server");
    const imported = {
      profile: [
        {
          symbol: "AAPL",
          companyName: "Apple",
          sector: "Technology",
          currency: "USD",
          exchange: "NASDAQ",
        },
      ],
      prices: [
        {
          symbol: "AAPL",
          date: "2026-10-01",
          close: "100",
          volume: "500",
          adjustedClose: "99",
        },
      ],
    };
    const stock = await loadStock(
      { symbol: "AAPL", name: "Apple", currency: "USD", exchange: "NASDAQ" },
      todayIn(),
      "csv",
      imported,
    );
    expect(stock.bars).toHaveLength(1);
    expect(stock.source).toBe("User CSV");
    expect(stock.fundamentals.roe).toBeNull();
    expect(stock.statuses.find((s) => s.dataset === "prices")?.source).toBe(
      "User CSV",
    );
  });
  it("disables fundamentals historically and requests only profile and price endpoints", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        seen.push(url.pathname);
        return response(
          url.pathname.endsWith("/profile")
            ? [
                {
                  symbol: "AAPL",
                  companyName: "Apple",
                  sector: "Technology",
                  currency: "USD",
                },
              ]
            : url.pathname.endsWith("/full")
              ? [
                  { date: "2025-12-31", close: 100, volume: 500 },
                  { date: "2026-01-03", close: 999, volume: 500 },
                ]
              : [{ date: "2025-12-31", adjClose: 98 }],
        );
      }),
    );
    const { loadStock } = await import("../lib/server");
    const s = await loadStock(
      { symbol: "AAPL", name: "Apple", exchange: "NASDAQ", currency: "USD" },
      "2026-01-01",
      "fmp",
      {},
    );
    expect(s.bars).toHaveLength(1);
    expect(s.bars[0].adjustedClose).toBe(98);
    expect(s.historicalFullAllowed).toBe(false);
    expect(seen).toHaveLength(4);
    expect(s.statuses.filter((s) => s.status === "disabled")).toHaveLength(5);
  });
  it("handles missing profile explicitly, excluding unknown currency from allocation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([], 403)));
    const { loadStock } = await import("../lib/server");
    const stock = await loadStock(
      { symbol: "AAPL", name: "Apple", currency: "USD", exchange: "NASDAQ" },
      todayIn(),
      "fmp",
      {},
    );
    expect(stock.security.currency).toBe("Unknown");
    expect(stock.statuses.every((s) => s.status === "unavailable")).toBe(true);
    expect(stock.bars).toEqual([]);
  });
  it("rejects cross-origin API calls and future evaluation dates", async () => {
    const { POST } = await import("../app/api/analyze/route");
    const security = {
      symbol: "AAPL",
      name: "Apple",
      currency: "USD",
      exchange: "NASDAQ",
    };
    const cross = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: JSON.stringify({
          securities: [security],
          source: "demo",
          asOf: "2026-10-07",
          imports: {},
        }),
      }),
    );
    expect(cross.status).toBe(400);
    const future = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({
          securities: [security],
          source: "demo",
          asOf: "2099-01-01",
        }),
      }),
    );
    expect(future.status).toBe(400);
  });
  it("uses complete fundamentals from documented stable response shapes", async () => {
    const payloads: Record<string, Row[]> = {
      profile: [
        {
          symbol: "AAPL",
          companyName: "Apple",
          sector: "Technology",
          currency: "USD",
        },
      ],
      "historical-price-eod/full": [
        { date: "2026-10-01", close: 100, volume: 500 },
      ],
      "historical-price-eod/dividend-adjusted": [
        { date: "2026-10-01", adjClose: 99 },
      ],
      "income-statement": [
        {
          date: "2025-12-31",
          period: "FY",
          acceptedDate: "2026-02-01",
          netIncome: 10,
          revenue: 100,
          operatingIncome: 20,
          eps: 2,
        },
        {
          date: "2024-12-31",
          period: "FY",
          acceptedDate: "2025-02-01",
          eps: 1,
        },
      ],
      "balance-sheet-statement": [
        {
          date: "2025-12-31",
          period: "FY",
          acceptedDate: "2026-02-01",
          totalStockholdersEquity: 50,
          totalDebt: 20,
        },
        {
          date: "2024-12-31",
          period: "FY",
          acceptedDate: "2025-02-01",
          totalStockholdersEquity: 30,
          totalDebt: 20,
        },
      ],
      ratios: [],
      earnings: [{ date: "2026-07-01", epsActual: 2, epsEstimated: 1.8 }],
      "analyst-estimates": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        response(payloads[url.pathname.replace("/stable/", "")] ?? []),
      ),
    );
    const { loadStock } = await import("../lib/server");
    const stock = await loadStock(
      { symbol: "AAPL", name: "Apple", currency: "USD", exchange: "NASDAQ" },
      todayIn(),
      "fmp",
      {},
    );
    expect(stock.fundamentals.roe).toBe(0.25);
    expect(stock.fundamentals.epsGrowth).toBe(1);
    expect(stock.fundamentals.surprise).toBeCloseTo(2 / 1.8 - 1);
  });
});
describe("browser-shaped requests", () => {
  it("accepts partial imports and the public Host when Next uses an internal hostname", async () => {
    const { POST } = await import("../app/api/resolve/route");
    const r = await POST(
      new Request("http://localhost:3000/api/resolve", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          queries: ["Apple"],
          source: "demo",
          imports: {},
        }),
      }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).results[0].matches[0].symbol).toBe("AAPL");
  });
  it("rejects cross-site fetches even when the Origin host is spoofed by a nonbrowser client", async () => {
    const { POST } = await import("../app/api/resolve/route");
    const r = await POST(
      new Request("http://localhost:3000/api/resolve", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({
          queries: ["Apple"],
          source: "demo",
          imports: {},
        }),
      }),
    );
    expect(r.status).toBe(400);
  });
});
