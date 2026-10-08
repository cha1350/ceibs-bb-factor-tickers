import type { StockData, Security } from "./types";
import { emptyFundamentals } from "./fundamentals";
export const DEMO_DATE = "2026-10-07";
const definitions = [
  ["NVDA", "NVIDIA Corporation", "Technology", 182, 0.0018, 0.027],
  ["MSFT", "Microsoft Corporation", "Technology", 480, 0.0011, 0.014],
  ["AAPL", "Apple Inc.", "Technology", 240, 0.0007, 0.018],
  ["AMD", "Advanced Micro Devices", "Technology", 165, 0.0014, 0.029],
  ["JPM", "JPMorgan Chase & Co.", "Financials", 290, 0.0009, 0.015],
  ["V", "Visa Inc.", "Financials", 350, 0.0008, 0.013],
  ["UNH", "UnitedHealth Group", "Healthcare", 315, -0.0001, 0.024],
  ["JNJ", "Johnson & Johnson", "Healthcare", 170, 0.0003, 0.01],
  ["XOM", "Exxon Mobil Corporation", "Energy", 120, 0.0005, 0.017],
  ["CVX", "Chevron Corporation", "Energy", 160, 0.0004, 0.018],
  ["COST", "Costco Wholesale", "Consumer Staples", 950, 0.0009, 0.013],
  ["WMT", "Walmart Inc.", "Consumer Staples", 105, 0.0006, 0.011],
] as const;
export function demoData(): StockData[] {
  const dates: string[] = [];
  let day = new Date(DEMO_DATE + "T12:00:00Z");
  while (dates.length < 180) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      dates.unshift(day.toISOString().slice(0, 10));
    day = new Date(day.getTime() - 86400000);
  }
  return definitions.map(
    ([symbol, name, sector, price, drift, amplitude], i) => {
      let current = price;
      const reverse: number[] = [current];
      for (let j = dates.length - 1; j > 0; j--) {
        const r =
          drift +
          amplitude *
            (Math.sin(j * 1.731 + i * 2.1) * 0.7 +
              Math.cos(j * 0.391 + i) * 0.3);
        current /= 1 + r;
        reverse.unshift(current);
      }
      const security: Security = {
        symbol,
        name,
        exchange: ["JPM", "V", "UNH", "JNJ", "XOM", "CVX", "WMT"].includes(
          symbol,
        )
          ? "NYSE"
          : "NASDAQ",
        currency: "USD",
      };
      return {
        security,
        sector,
        bars: dates.map((date, j) => ({
          date,
          close: reverse[j],
          adjustedClose: reverse[j],
          volume: Math.round((4e6 + (12 - i) * 2e6) * (1 + 0.15 * Math.sin(j))),
        })),
        fundamentals: {
          ...emptyFundamentals(),
          roe: 0.13 + (12 - i) * 0.023,
          margin: 0.08 + (i % 5) * 0.065,
          debtEquity: 0.2 + (i % 4) * 0.4,
          equity: 20e9,
          epsGrowth: -0.05 + (12 - i) * 0.035,
          surprise: -0.025 + (i % 6) * 0.02,
          period: "Synthetic FY / 2025-12-31",
          publishedAt: "2026-02-20",
          earningsDate: "2026-07-23",
        },
        statuses: [
          {
            dataset: "all",
            source: "Synthetic demo",
            status: "available",
            message:
              "Fictional financials and generated prices. Not market data.",
            fetchedAt: "2026-10-07T20:00:00Z",
          },
        ],
        warnings: [
          "DEMO: all figures are synthetic; real tickers are used only to demonstrate the interface.",
        ],
        fetchedAt: "2026-10-07T20:00:00Z",
        source: "Synthetic demo",
        historicalFullAllowed: true,
      };
    },
  );
}
