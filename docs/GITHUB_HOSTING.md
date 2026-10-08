# GitHub hosting options

FactorLab can live in a GitHub repository. The complete app needs a server runtime for its FMP API routes; GitHub Pages serves static files and cannot run those routes.

## Full application: GitHub repository and a Next.js host

1. Create a repository for the contents of this `factorlab` directory. A private repository is suitable for personal research. Do not upload the surrounding CEIBS research folders.
2. Push the application source, lockfile, `.env.example`, templates, and tests. `.env.local`, dependencies, generated builds, and local settings are excluded by `.gitignore`.
3. Import that repository into a Next.js-compatible host. For Vercel, select **Next.js**, Node.js **22.x**, and the repository root as the root directory. Use `npm ci` to install and `npm run build` to build.
4. Set `FMP_API_KEY`, `FMP_REQUESTS_PER_MINUTE`, and `FMP_DAILY_BUDGET` as runtime environment variables in the hosting dashboard. Keep the key server-side. Redeploy after setting it.
5. Verify the deployed page, demo analysis, CSV analysis, and live FMP availability. The absence of a key still permits the explicitly labeled demo and CSV workflows.

Vercel's GitHub integration can deploy subsequent commits automatically. Review the host's maximum function duration before choosing it: FactorLab's synchronous batch requests are paced at 30 upstream calls/minute by default, and a larger live universe can exceed a serverless timeout. A persistent Node server avoids that platform-specific function timeout. The in-memory rate limiter and cache are per process, so multiple instances need shared limits before serving a broad audience. Start with a private deployment and a small watchlist.

The included `.github/workflows/ci.yml` runs the existing tests, TypeScript check, and production build on pushes and pull requests. It requires no FMP API key. No deployment secret is stored in the repository, and the workflow does not publish by itself.

## GitHub Pages only

A Pages version would need a separate static build with demo analysis and CSV parsing/scoring performed in the browser. Live FMP retrieval and API company-name search would be disabled, or supplied by a separately hosted backend. The current server-backed Next.js build cannot be uploaded to Pages unchanged. Putting an FMP key in a static site or its JavaScript is not a supported workaround.

## Documentation

- [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Next.js static-export limitations](https://nextjs.org/docs/app/guides/static-exports#unsupported-features)
- [Vercel integration with GitHub](https://vercel.com/docs/git/vercel-for-github)
