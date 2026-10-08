import type { Security } from "./types";

// Currency qualifiers identify a listing; they do not convert its prices.
const CURRENCIES = new Set([
  "USD",
  "JPY",
  "EUR",
  "GBP",
  "HKD",
  "CNY",
  "TWD",
  "KRW",
  "AUD",
  "CAD",
  "CHF",
  "INR",
  "SGD",
  "NZD",
  "BRL",
  "ZAR",
  "SEK",
  "NOK",
  "DKK",
  "THB",
  "MXN",
  "IDR",
  "MYR",
  "PHP",
  "TRY",
  "ILS",
  "AED",
  "SAR",
  "PLN",
  "CZK",
]);

export function parseSecurityQuery(input: string): {
  query: string;
  currency?: string;
} {
  const query = input.trim().replace(/\s+/g, " ");
  const match = /^(.*?)\s+([A-Za-z]{3})$/.exec(query);
  if (match && CURRENCIES.has(match[2].toUpperCase()))
    return { query: match[1], currency: match[2].toUpperCase() };
  return { query };
}

export function matchesSecurity(security: Security, input: string): boolean {
  const { query, currency } = parseSecurityQuery(input);
  return (
    (!currency || security.currency.toUpperCase() === currency) &&
    (security.symbol.toLowerCase() === query.toLowerCase() ||
      security.name.toLowerCase().includes(query.toLowerCase()))
  );
}

export function unresolvedSecurityMessage(input: string): string {
  const { query, currency } = parseSecurityQuery(input);
  return currency
    ? `No ${currency} listing found for ${query}. Try its exchange-qualified ticker or import a profile CSV. FMP search coverage does not guarantee access to prices or financials.`
    : "No matching security. Try its exchange-qualified ticker or company name, or import a profile CSV. FMP subscription and market coverage may limit access.";
}
