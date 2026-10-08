export const FACTORS = [
  "momentum",
  "quality",
  "earnings",
  "lowVolatility",
  "liquidity",
] as const;
export type Factor = (typeof FACTORS)[number];
export type Weights = Record<Factor, number>;
export const DEFAULT_WEIGHTS: Weights = {
  momentum: 40,
  quality: 20,
  earnings: 15,
  lowVolatility: 15,
  liquidity: 10,
};
export const FACTOR_LABELS: Record<Factor, string> = {
  momentum: "Momentum",
  quality: "Quality",
  earnings: "Earnings",
  lowVolatility: "Low volatility",
  liquidity: "Liquidity",
};
export type Mode = "full" | "price";
export type SourceMode = "demo" | "fmp" | "csv";
export type Row = Record<string, unknown>;
export const DATASETS = [
  "profile",
  "prices",
  "income",
  "balance",
  "ratios",
  "earnings",
  "estimates",
] as const;
export type Dataset = (typeof DATASETS)[number];
export type Imports = Partial<Record<Dataset, Row[]>>;
export interface Security {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
}
export interface Bar {
  date: string;
  close: number;
  volume: number | null;
  adjustedClose: number | null;
  tradedClose?: number | null;
}
export interface DatasetStatus {
  dataset: string;
  source: string;
  status: "available" | "unavailable" | "disabled";
  message: string;
  fetchedAt: string;
}
export interface Fundamentals {
  roe: number | null;
  margin: number | null;
  debtEquity: number | null;
  epsGrowth: number | null;
  surprise: number | null;
  equity: number | null;
  period: string | null;
  publishedAt: string | null;
  earningsDate: string | null;
}
export interface StockData {
  security: Security;
  sector: string;
  bars: Bar[];
  fundamentals: Fundamentals;
  statuses: DatasetStatus[];
  warnings: string[];
  fetchedAt: string;
  source: string;
  historicalFullAllowed: boolean;
}
export interface Metrics {
  return3m: number | null;
  return6m: number | null;
  volatility: number | null;
  dollarVolume: number | null;
  roe: number | null;
  margin: number | null;
  debtEquity: number | null;
  epsGrowth: number | null;
  surprise: number | null;
}
export interface ScoredStock extends StockData {
  metrics: Metrics;
  factors: Record<Factor, number | null>;
  subScores: Record<keyof Metrics, number | null>;
  score: number | null;
  rank: number | null;
  missing: string[];
  price: number | null;
  priceDate: string | null;
  mode: Mode;
}
export interface Constraints {
  capital: number;
  positionCap: number;
  sectorCap: number;
  cashReserve: number;
}
export type AllocationMethod = "equal" | "inverse" | "factor";
export const METHOD_LABELS: Record<AllocationMethod, string> = {
  equal: "Equal weight",
  inverse: "Inverse volatility",
  factor: "Score / volatility",
};
export interface Position {
  symbol: string;
  sector: string;
  targetWeight: number;
  weight: number;
  dollars: number;
  shares: number;
  score: number;
  price: number;
}
export interface Portfolio {
  method: AllocationMethod;
  positions: Position[];
  sectors: { name: string; weight: number; dollars: number }[];
  cash: number;
  cashWeight: number;
  targetCashWeight: number;
  weightedScore: number | null;
  volatility: number | null;
  covarianceSessions: number;
  warnings: string[];
}
