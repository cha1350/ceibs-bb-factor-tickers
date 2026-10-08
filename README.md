# FactorLab

A working Next.js App Router + TypeScript application for stock factor scoring and hypothetical USD portfolio allocation. Tailwind CSS, shadcn-style Radix components, and Recharts power the responsive dark/light dashboard. No database, authentication, or trading integration is required.

## Run locally

Requires Node.js 22.12+ and npm. In this folder:

```sh
npm ci
cp .env.example .env.local
# Optional: edit .env.local and set FMP_API_KEY
npm run dev
```

Open http://127.0.0.1:3000. The interface initially displays **one fixed synthetic demonstration dataset**, using real ticker labels with fictional prices and fundamentals. It is not live data. The demo ends October 7, 2026 and uses generated weekdays, not an exchange holiday calendar. All results, source labels, and portfolio exports identify demo mode.

For production:

```sh
npm test
npm run typecheck
npm run build
npm start
```

This is a standard Node Next.js application. Deploy to a Next.js-compatible Node host, with `FMP_API_KEY` configured as a server environment secret. Live provider access requires server routes.

## GitHub deployment

See [GitHub hosting options](docs/GITHUB_HOSTING.md). The repository includes automated checks for tests, TypeScript, and the production build. Hosting the complete application requires a Next.js server runtime; GitHub Pages alone would require a demo/CSV-only static version.

## FMP setup and eligibility

1. Register at [FMP](https://site.financialmodelingprep.com/register) and obtain your API key in your account dashboard.
2. Review [current stable API documentation](https://site.financialmodelingprep.com/developer/docs) and the [plan comparison](https://site.financialmodelingprep.com/developer/docs/pricing). Documentation and eligibility were reviewed October 8, 2026. The published Basic plan is 250 calls/day with limited symbol/dataset coverage. Annual fundamentals and ratios are listed for Starter, full fundamentals for Premium, and broader global coverage for Ultimate. The account's actual endpoint responses determine access; this app does not assume your subscription.
3. Put `FMP_API_KEY=your_key` in `.env.local`; restart the server. Never prefix the variable with `NEXT_PUBLIC_`. No key-entry field exists in the browser.
4. Select Financial Modeling Prep, choose today's date for current full-model analysis, enter symbols or names, and click **Analyze universe**. Historical dates automatically select price-only scoring after retrieval. Ambiguous matches require a listing selection; failed queries remain visible and resolved securities can still be analyzed.
5. Expand each security under **Data & methodology** to see endpoint status, source, cache retrieval timestamp, and limitations. Access-denied, empty, invalid, and rate-limited responses are never filled with demo values.

The server calls documented stable `/search-name`, `/search-symbol`, `/profile`, `/historical-price-eod/full`, `/historical-price-eod/dividend-adjusted`, `/historical-price-eod/non-split-adjusted`, `/income-statement`, `/balance-sheet-statement`, `/ratios`, `/earnings`, and `/analyst-estimates`. Financial statement and ratio requests are **annual** (5 observations), avoiding an assumption of quarterly entitlement. ROE uses latest annual net income / average positive beginning and ending equity, with an annual provider ratio fallback; margin and debt/equity are derived from matched reports. EPS growth compares the same fiscal period approximately one year earlier. Surprise uses the latest actually reported earnings event, typically quarterly. Forecast analyst estimates are fetched for access transparency but never substitute for historical earnings consensus.

A full analysis normally needs 9 data calls per stock plus search calls. Request spacing defaults to 30/minute and a local 240-call daily budget. Configure both `.env` limits to match your plan. Results are cached in memory (15 minutes for prices, 6 hours for financial datasets, 24 hours for searches); identical concurrent fetches are deduplicated. Cached timestamps remain the original fetch times. Network/5xx failures get up to 3 attempts with exponential delay. A 429 opens a cooldown honoring numeric Retry-After, at least 60 seconds. Requests time out after 15 seconds. Live batch requests may take several minutes at conservative settings; the UI shows retrieval progress.

**No authenticated live FMP data can be verified without your key.** Provider mapping and error paths are tested with documented fixtures. Displaying or redistributing FMP data requires the applicable FMP data-display/licensing agreement; see the plan page before public deployment with real data.

## CSV and local persistence

Upload a watchlist with `ticker`, `symbol`, `name`, or `company` as its header. Text accepts commas, semicolons, or lines; a sequence of uppercase tickers can be space-separated. A full company name containing spaces stays intact; separate multiple names with commas or newlines. Symbols are deduplicated before retrieval. The initial MVP supports a maximum of 40 input securities per request.

Use **Import financial datasets** to choose a dataset and download a header-only template. Imports replace that entire dataset for matching symbols. In CSV-only mode, import profile and price history first, then add optional fundamentals. Rows must use provider-style canonical field names:

Company names and tickers may include a trailing currency qualifier, such as `Yonex JPY` or `7906.T JPY`. This searches `Yonex` or `7906.T` and filters the returned listings by JPY; it does not convert prices or establish data entitlement. Separate qualified entries with commas or new lines. For Yonex's Japanese listing, choose `7906.T` / JPX / JPY. Non-USD stocks can be ranked but are excluded from the USD portfolio until FX conversion is implemented. A successful listing search does not guarantee that an FMP plan includes its price or fundamental datasets; inspect endpoint status and import missing datasets if available.

| Dataset   | Required columns                                                               |
| --------- | ------------------------------------------------------------------------------ |
| profile   | symbol, companyName, sector, currency, exchange                                |
| prices    | symbol, date, close, volume; optional adjustedClose                            |
| income    | symbol, date, period, publishedAt, netIncome, revenue, operatingIncome, eps    |
| balance   | symbol, date, period, publishedAt, totalStockholdersEquity, totalDebt          |
| ratios    | symbol, date, period, returnOnEquity, operatingProfitMargin, debtToEquityRatio |
| earnings  | symbol, date, epsActual, epsEstimated                                          |
| estimates | symbol, date, epsAvg                                                           |

`filingDate` or `acceptedDate` may replace `publishedAt`; `epsDiluted` may replace `eps`. Dates use YYYY-MM-DD; numbers must be plain decimals without separators or `%`. Missing fields can be empty cells. Ratios/returns use decimal fractions (0.20 = 20%). `period` should be `FY` for annual reports; quarterly imports do not automatically annualize net income. Prices require 127 distinct sessions for 6-month momentum, 61 for volatility, and 20 with volume for liquidity. Imported `close` must represent the traded closing price in the security currency; `adjustedClose` is a separate consistent corporate-action-adjusted return series. CSV price duplicates, nonpositive closes, and negative volumes fail explicitly.

Settings, watchlists, and imported datasets are stored only in this browser's localStorage. CSV imports are limited to 5 MB/file, 20,000 rows/dataset and 6 MB/request. Storage-capacity failures retain the dataset in the current session and show a notice. Financial values are user-supplied and not independently verified. Removing an imported dataset applies on the next analysis. Loaded API results are not persisted between page reloads; the labeled demo remains the initial workspace.

## Scoring

Default full score: 40% Momentum + 20% Quality + 15% Earnings + 15% Low Volatility + 10% Liquidity.

- Momentum: equal-weight percentile scores of 63- and 126-session returns.
- Quality: configurable ROE / operating margin / debt-to-equity weights (default 40/40/20 within quality). Lower debt/equity is better. Missing/nonpositive equity invalidates ROE and debt/equity. All weighted quality submetrics must exist.
- Earnings: equal-weight percentiles of YoY reported EPS growth and latest reported surprise `(actual - estimate)/abs(estimate)`. Zero or negative prior EPS invalidates growth; zero/missing estimate invalidates surprise.
- Low volatility: inverse percentile of the sample standard deviation of 60 simple daily returns multiplied by sqrt(252).
- Liquidity: percentile of log(1 + average close × share volume over 20 sessions).

Percentiles use `(average zero-based rank)/(valid count - 1) × 100`. Constant metrics and singleton observations receive 50; ties share ranks; nonfinite/missing metrics are excluded from that metric's universe. Extreme values cannot exceed percentile bounds. This score is **relative to the submitted universe**, not the market. Filters change display only, not normalization or allocation eligibility.

Full-model scores remain incomplete if any required factor is missing, including factors with zero overall weights. The price-only model uses Momentum / Low Volatility / Liquidity with independent normalized weights (defaults approximately 61.54 / 23.08 / 15.38). The selected model applies to the entire table and portfolio; rankings from different models are never combined. Factor sliders always total 100% through proportional integer redistribution using largest remainders. Changes recalculate locally without refetching data.

Dividend-adjusted prices are used only if the entire required series has adjustment coverage; otherwise all returns use a single consistent close series with a warning. FMP documents its full close series as split-adjusted and its separate dividend-adjusted series as total-return-style. Dollar volume and share quantities use the separate non-split-adjusted closing price and volume, never adjusted return prices. If that endpoint is unavailable or incomplete, liquidity and/or share quantities remain unavailable; import the prices CSV to supply raw close and adjustedClose. See [FMP's price-series guide](https://site.financialmodelingprep.com/how-to/fmp-historical-price-apis-from-light-charts-to-dividendadjusted-analysis).

## Historical policy

Future dates are rejected in the UI and API. Historical prices are bounded by the selected date. The current New York calendar session is always excluded, even after close, to avoid provisional EOD data. The next calendar day makes that session eligible. The dashboard shows the actual closing-price date separately from retrieval time; prices more than 5 calendar days older than the cutoff are flagged.

For live full scoring, reports require an actual publication/accepted/filing date on or before the evaluation date; fiscal period-end alone never establishes availability. Earnings require a past report date and actual EPS. **Full historical scoring is disabled for FMP and imported datasets**: neither establishes original data vintages, restatement history, or dated analyst-consensus snapshots. Historical CSV imports do not override this policy. Price-only historical analysis is an analysis of the supplied basket, with present-day sector labels and potentially revised corporate-action series; it is not a survivorship-free backtest or point-in-time portfolio history. Demo data is fictional and its availability boundaries have no market significance.

## Allocation

Eligible securities have a complete score in the selected model, verified USD currency, positive closing price, and strictly positive historical volatility. ETFs/funds identified by provider profiles are rejected. Unknown currencies and non-USD securities can be ranked but cannot enter the USD portfolio without a future FX adapter.

Equal weight uses raw weight 1; inverse volatility uses 1/volatility; score-adjusted uses score/volatility. Raw weights are normalized first. Deterministic proportional water filling saturates position or sector caps then redistributes among remaining eligible capacity. Caps use fractions of total capital including cash. If capacity is insufficient, unallocated cash remains. Default $1,000,000 capital, 7% position cap, 25% sector cap, 10% initial cash target. A 12-stock universe cannot invest more than 84% even before sector constraints.

Shares are rounded down independently; unspent amounts remain in cash. No shorts, leverage, fractional shares, or trade submission. Weighted factor score divides by invested capital. Portfolio volatility uses `sqrt(252 × w'Σw)` from the latest 60 aligned daily return intervals, with at least 30 required. Matching return end dates and preceding dates prevent combining different holding intervals. Cash has zero modeled volatility. Insufficient common history leaves portfolio risk unavailable instead of assuming correlations. Costs, taxes, market impact, settlement, and intraday changes are not modeled.

## Source structure and verification

- `lib/scoring.ts`: reusable pure scoring, ranking, weights, and return calculations.
- `lib/portfolio.ts`: reusable allocation, constraints, whole shares, covariance risk.
- `lib/providers/interface.ts`: provider contract for future Bloomberg/LSEG integrations.
- `lib/providers/fmp.ts`: server-only stable API client, caching, retries, budgets.
- `lib/fundamentals.ts`, `lib/dates.ts`: reported-data derivation and date policies.
- `app/api/{resolve,analyze,status}`: bounded, validated server routes with same-origin checks.
- `components/dashboard.tsx`, `components/charts.tsx`: responsive workspace and visualizations.
- `public/templates/`: header-only CSV templates.
- `tests/`: numerical edge cases, allocation invariants, historical boundaries, and integration fixtures.

The daily call budget and cache are per server process and reset on restart; multi-instance production deployments need a shared rate limiter/cache. No authentication is included by request. A publicly accessible instance would let visitors consume the server's FMP budget; keep it private or add access controls before broad sharing. Batch retrieval is synchronous and intended for small competition watchlists, not bulk-market screening. Subscription limits, malformed data, or insufficient history may legitimately leave a score incomplete.
