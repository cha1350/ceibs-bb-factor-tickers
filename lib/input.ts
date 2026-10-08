import Papa from "papaparse";
import type { Row, Dataset } from "./types";
export function parseStockInput(text: string): string[] {
  const chunks = Papa.parse<string[]>(text.replace(/;/g, ","), {
    delimiter: ",",
    skipEmptyLines: "greedy",
  })
    .data.flat()
    .map((x) => x.trim())
    .filter(Boolean);
  const tokens = chunks.flatMap((x) =>
    /^[A-Z0-9.^-]+(?:\s+[A-Z0-9.^-]+)+$/.test(x) ? x.split(/\s+/) : x,
  );
  return [...new Map(tokens.map((x) => [x.toLowerCase(), x])).values()];
}
export function parseCsv(text: string): Row[] {
  const result = Papa.parse<Row>(text, {
    header: true,
    delimiter: ",",
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
    transform: (v) => v.trim(),
  });
  if (result.errors.length) throw new Error(`CSV: ${result.errors[0].message}`);
  if (!result.meta.fields?.length || !result.data.length)
    throw new Error("CSV has no data rows.");
  if (result.data.length > 20000) throw new Error("CSV limit: 20,000 rows.");
  return result.data;
}
export function stockQueriesFromCsv(text: string): string[] {
  const rows = parseCsv(text);
  return [
    ...new Set(
      rows
        .map((r) =>
          String(r.ticker || r.symbol || r.name || r.company || "").trim(),
        )
        .filter(Boolean),
    ),
  ];
}
export function validateImport(rows: Row[], dataset: Dataset): void {
  const required: Record<Dataset, string[]> = {
    profile: ["symbol", "companyName", "sector", "currency", "exchange"],
    prices: ["symbol", "date", "close", "volume"],
    income: [
      "symbol",
      "date",
      "period",
      "publishedAt",
      "netIncome",
      "revenue",
      "operatingIncome",
      "eps",
    ],
    balance: [
      "symbol",
      "date",
      "period",
      "publishedAt",
      "totalStockholdersEquity",
      "totalDebt",
    ],
    ratios: [
      "symbol",
      "date",
      "period",
      "returnOnEquity",
      "operatingProfitMargin",
      "debtToEquityRatio",
    ],
    earnings: ["symbol", "date", "epsActual", "epsEstimated"],
    estimates: ["symbol", "date", "epsAvg"],
  };
  const fields = new Set(Object.keys(rows[0] ?? {}));
  const missing = required[dataset].filter(
    (k) =>
      !fields.has(k) &&
      !(
        k === "publishedAt" &&
        (fields.has("acceptedDate") || fields.has("filingDate"))
      ) &&
      !(k === "eps" && fields.has("epsDiluted")),
  );
  if (missing.length)
    throw new Error(
      `Missing ${dataset} columns: ${missing.join(", ")}. Download the template.`,
    );
  if (rows.some((r) => !/^[A-Za-z0-9.^-]{1,24}$/.test(String(r.symbol ?? ""))))
    throw new Error("Every dataset row needs a valid symbol.");
}
