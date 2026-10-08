import type { Dataset, Row, Security, DatasetStatus } from "../types";
export interface DatasetResult {
  rows: Row[];
  status: DatasetStatus;
}
export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<Security[]>;
  dataset(
    dataset: Dataset,
    symbol: string,
    asOf: string,
  ): Promise<DatasetResult>;
}
export class ProviderError extends Error {
  constructor(
    public endpoint: string,
    public kind:
      | "configuration"
      | "entitlement"
      | "rate-limit"
      | "upstream"
      | "invalid",
    message: string,
  ) {
    super(message);
  }
}
