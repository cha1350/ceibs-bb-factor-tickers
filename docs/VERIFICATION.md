# Verification — October 8, 2026

- `npm ci`: clean installation from the committed lockfile succeeded (Node 22.22.3, npm 10.9.8).
- `npm test`: 70 tests passed across scoring, portfolio, currency-qualified input, and provider/server integration.
- `npm run typecheck`: passed.
- `npm run build`: Next.js 16.4.0 production build passed; page and three server API routes generated successfully.
- `npm audit --omit=dev --audit-level=high`: zero reported production dependency vulnerabilities.
- Production HTTP checks: page returned 200; company-name resolution and four-stock demo retrieval completed with browser-shaped Origin headers and an empty imports object; source labels and historical price cutoff verified.
- Browser checks: company-name analysis, ranking changes, factor slider updates, independent price-only labeling, all three allocation methods, whole-share targets, and cash retained under a binding sector cap.
- Responsive check: narrow viewport rendered stacked cards and contained horizontal table scrolling without page-level overflow. Temporary viewport override was reset.
- Fixed synthetic demo and CSV-only fixture workflows were exercised. Provider tests cover documented response shapes, endpoint restrictions, caching, deduplication, rate-limit cooldown, and transient retry.

The initial source build used fixtures without an FMP key. A subsequent live check of the user's Vercel deployment verified that `Yonex` and `7906.T` resolve to the JPX/JPY listing, while its profile, prices, income, balance, ratios, earnings, and estimates all returned HTTP 402 with the deployed account. No market data was returned for Yonex. The search fix accepts `Yonex JPY` as a name with a currency qualifier and surfaces dataset access restrictions explicitly; it does not bypass subscription limits.

Fixtures are not represented as live data. Fundamental frequency is annual; historical full-model scores are disabled; portfolio allocation requires USD prices. Server cache and request budget are per process.

The browser screenshot in `dashboard.jpg` is a labeled synthetic demo from the production preview.
