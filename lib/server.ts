import "server-only";
import { z } from "zod";
import {
  DATASETS,
  type StockData,
  type DatasetStatus,
  type Imports,
  type Security,
  type Dataset,
  type Row,
  type Bar,
} from "./types";
import { FmpProvider, parseBars, number } from "./providers/fmp";
import { emptyFundamentals, deriveFundamentals } from "./fundamentals";
import { todayIn, validateAsOf, priceCutoff, daysBetween } from "./dates";
import { cutoffBars } from "./scoring";
import { demoData } from "./demo";
import { validateImport } from "./input";
export const securitySchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9.^-]{1,24}$/),
  name: z.string().max(160),
  exchange: z.string().max(80),
  currency: z.string().max(12),
});
export const importsSchema = z
  .partialRecord(
    z.enum(DATASETS),
    z
      .array(
        z.record(
          z.string(),
          z.union([
            z.string().max(500),
            z.number().finite(),
            z.boolean(),
            z.null(),
          ]),
        ),
      )
      .max(20000),
  )
  .optional();
export const analyzeSchema = z.object({
  securities: z.array(securitySchema).min(1).max(40),
  asOf: z.string(),
  source: z.enum(["demo", "fmp", "csv"]),
  imports: importsSchema,
});
export const resolveSchema = z.object({
  queries: z.array(z.string().min(1).max(120)).min(1).max(40),
  source: z.enum(["demo", "fmp", "csv"]),
  imports: importsSchema,
});
export async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > 6 * 1024 * 1024)
    throw new Error("Request is too large (6 MB maximum).");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Request is too large (6 MB maximum).");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next may construct the internal URL with localhost. The browser-facing Host
  // header is the relevant authority, including port, for same-origin requests.
  const host = request.headers.get("host") || new URL(request.url).host;
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && (origin === "null" || new URL(origin).host !== host))
  )
    throw new Error("Cross-origin requests are not permitted.");
}
export function errorMessage(error: unknown) {
  return error instanceof z.ZodError
    ? "Invalid request fields."
    : error instanceof Error
      ? error.message
      : "Request failed.";
}
export function validateImports(imports: Imports) {
  Object.entries(imports).forEach(([dataset, rows]) => {
    if (rows?.length) validateImport(rows, dataset as Dataset);
  });
}
export function importedSecurities(imports: Imports): Security[] {
  return (imports.profile ?? []).map((r) => ({
    symbol: String(r.symbol).toUpperCase(),
    name: String(r.companyName),
    exchange: String(r.exchange),
    currency: String(r.currency),
  }));
}
export async function loadStock(
  security: Security,
  asOf: string,
  source: "fmp" | "csv",
  imports: Imports,
): Promise<StockData> {
  validateAsOf(asOf);
  const historical = asOf < todayIn();
  const cutoff = priceCutoff(asOf);
  const now = new Date().toISOString();
  const provider = new FmpProvider();
  const statuses: DatasetStatus[] = [];
  const data: Partial<Record<Dataset, Row[]>> = {};
  const warnings: string[] = [];
  for (const dataset of DATASETS) {
    if (historical && !["prices", "profile"].includes(dataset)) {
      data[dataset] = [];
      statuses.push({
        dataset,
        source: "Point-in-time policy",
        status: "disabled",
        message:
          "Full historical scoring disabled: data vintage and estimate publication history are not verified.",
        fetchedAt: now,
      });
      continue;
    }
    const imported = imports[dataset]?.filter(
      (r) => String(r.symbol).toUpperCase() === security.symbol.toUpperCase(),
    );
    if (imported?.length) {
      data[dataset] = imported;
      statuses.push({
        dataset,
        source: "User CSV",
        status: "available",
        message:
          "User-supplied dataset; verify source and adjustment convention.",
        fetchedAt: now,
      });
      continue;
    }
    if (source === "csv") {
      data[dataset] = [];
      statuses.push({
        dataset,
        source: "User CSV",
        status: "unavailable",
        message: "Dataset not imported.",
        fetchedAt: now,
      });
      continue;
    }
    try {
      const result = await provider.dataset(dataset, security.symbol, asOf);
      data[dataset] = result.rows;
      statuses.push(result.status);
    } catch (e) {
      data[dataset] = [];
      statuses.push({
        dataset,
        source: provider.name,
        status: "unavailable",
        message: errorMessage(e),
        fetchedAt: now,
      });
    }
  }
  let bars: Bar[] = parseBars(data.prices ?? []);
  if (statuses.some((s) => /access denied \((402|403)\)/.test(s.message)))
    warnings.push(
      `FMP denied dataset access for ${security.symbol}. Finding a listing does not confirm your subscription includes its market data. Review endpoint status below and import missing CSV datasets, or confirm coverage with FMP.`,
    );
  if (
    bars.length &&
    source === "fmp" &&
    !imports.prices?.some(
      (r) => String(r.symbol).toUpperCase() === security.symbol.toUpperCase(),
    )
  ) {
    try {
      const adj = await provider.adjustments(security.symbol, asOf);
      const map = new Map(
        adj.rows.map((r) => [String(r.date), Number(r.adjClose)]),
      );
      bars = bars.map((b) => ({
        ...b,
        adjustedClose:
          Number.isFinite(map.get(b.date)) && map.get(b.date)! > 0
            ? map.get(b.date)!
            : null,
      }));
      statuses.push({
        dataset: "adjusted prices",
        source: provider.name,
        status: "available",
        message: "Dividend-adjusted series requested.",
        fetchedAt: adj.at,
      });
    } catch (e) {
      statuses.push({
        dataset: "adjusted prices",
        source: provider.name,
        status: "unavailable",
        message: errorMessage(e),
        fetchedAt: now,
      });
    }
    // Split-adjusted closes are return series, not historical execution prices.
    try {
      const raw = await provider.tradedPrices(security.symbol, asOf);
      const map = new Map(
        raw.rows.map((r) => [
          String(r.date),
          { price: number(r.adjClose ?? r.close), volume: number(r.volume) },
        ]),
      );
      bars = bars.map((b) => {
        const row = map.get(b.date);
        return {
          ...b,
          tradedClose:
            row?.price !== null && row?.price !== undefined && row.price > 0
              ? row.price
              : null,
          volume:
            row?.volume !== null && row?.volume !== undefined && row.volume >= 0
              ? row.volume
              : null,
        };
      });
      const available = bars.every(
        (b) => b.tradedClose !== null && b.volume !== null,
      );
      statuses.push({
        dataset: "as-traded prices",
        source: provider.name,
        status: available ? "available" : "unavailable",
        message: available
          ? "Unadjusted closing price and share volume for liquidity and shares."
          : "Incomplete unadjusted price/volume coverage. Import prices CSV.",
        fetchedAt: raw.at,
      });
    } catch (e) {
      bars = bars.map((b) => ({ ...b, tradedClose: null }));
      statuses.push({
        dataset: "as-traded prices",
        source: provider.name,
        status: "unavailable",
        message: errorMessage(e),
        fetchedAt: now,
      });
    }
    if (bars.some((b) => b.tradedClose === null))
      warnings.push(
        "As-traded prices unavailable: dollar liquidity or estimated shares may be unavailable. Import a prices CSV with raw close and adjustedClose.",
      );
  }
  bars = cutoffBars(bars, cutoff);
  if (!bars.length)
    warnings.push("No completed-session prices at the evaluation cutoff.");
  if (!bars.length || !bars.every((b) => b.adjustedClose !== null))
    warnings.push(
      source === "fmp"
        ? "Dividend-adjusted coverage incomplete: all return metrics use the FMP full close series (split-adjusted according to FMP), excluding dividends."
        : "Adjusted prices incomplete: all return metrics use imported close prices. Verify corporate-action treatment.",
    );
  const profile = data.profile?.[0];
  const currency = profile ? String(profile.currency || "Unknown") : "Unknown";
  const returnedExchange = String(
    profile?.exchangeShortName || profile?.exchange || "Unknown",
  );
  const exchangeCode = (name: string) =>
    name.toUpperCase().replace(/[^A-Z]/g, "");
  if (
    profile &&
    security.exchange !== "Unknown" &&
    returnedExchange !== "Unknown" &&
    exchangeCode(security.exchange) !== exchangeCode(returnedExchange)
  )
    throw new Error(
      `Selected exchange ${security.exchange} does not match the returned profile exchange ${returnedExchange}. Choose the provider listing or import a verified profile.`,
    );
  if (!profile)
    warnings.push(
      "Profile unavailable: currency unverified; excluded from USD allocations. Import a profile CSV.",
    );
  if (
    profile?.isEtf === true ||
    profile?.isFund === true ||
    profile?.isEtf === "true" ||
    profile?.isFund === "true"
  )
    throw new Error(
      "Only individual stocks are supported; this profile is a fund or ETF.",
    );
  if (currency !== "USD")
    warnings.push(
      "Non-USD or unknown currency: ranking is shown, but portfolio allocation requires USD prices; FX conversion is not implemented.",
    );
  const fundamentals = historical
    ? {
        fundamentals: emptyFundamentals(),
        warnings: [
          "Historical full scoring disabled: FMP responses do not prove historical data vintage or consensus availability. Use price-only mode. Current sector labels may differ from historical classifications.",
        ],
      }
    : deriveFundamentals(
        data.income ?? [],
        data.balance ?? [],
        data.ratios ?? [],
        data.earnings ?? [],
        asOf,
      );
  warnings.push(...fundamentals.warnings);
  if (bars.at(-1) && daysBetween(bars.at(-1)!.date, cutoff) > 5)
    warnings.push(`Stale closing price: ${bars.at(-1)!.date}.`);
  if (
    fundamentals.fundamentals.publishedAt &&
    daysBetween(fundamentals.fundamentals.publishedAt.slice(0, 10), asOf) > 450
  )
    warnings.push("Annual fundamentals are older than 450 days.");
  return {
    security: {
      ...security,
      name: profile
        ? String(profile.companyName || security.name)
        : security.name,
      exchange:
        returnedExchange === "Unknown" ? security.exchange : returnedExchange,
      currency,
    },
    sector: String(profile?.sector || "Unknown"),
    bars,
    fundamentals: fundamentals.fundamentals,
    statuses,
    warnings,
    fetchedAt: now,
    source:
      source === "csv"
        ? "User CSV"
        : statuses.some((s) => s.source === "User CSV")
          ? "FMP + User CSV"
          : provider.name,
    historicalFullAllowed: !historical,
  };
}
export function getDemo(securities: Security[], asOf: string): StockData[] {
  validateAsOf(asOf);
  return demoData()
    .filter((s) => securities.some((x) => x.symbol === s.security.symbol))
    .map((s) => ({
      ...s,
      bars: cutoffBars(s.bars, asOf),
      historicalFullAllowed: asOf >= "2026-07-23",
      fundamentals: asOf >= "2026-07-23" ? s.fundamentals : emptyFundamentals(),
    }));
}
