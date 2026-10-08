import { NextResponse } from "next/server";
import {
  checkOrigin,
  readBody,
  resolveSchema,
  validateImports,
  importedSecurities,
  errorMessage,
} from "@/lib/server";
import { FmpProvider } from "@/lib/providers/fmp";
import { demoData } from "@/lib/demo";
import {
  matchesSecurity,
  parseSecurityQuery,
  unresolvedSecurityMessage,
} from "@/lib/security-search";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = resolveSchema.parse(await readBody(request));
    const imports = input.imports ?? {};
    validateImports(imports);
    const provider = new FmpProvider();
    const results = [];
    for (const query of [...new Set(input.queries)]) {
      try {
        const local =
          input.source === "demo"
            ? demoData().map((s) => s.security)
            : importedSecurities(imports);
        const matches = local.filter((s) => matchesSecurity(s, query));
        const securities =
          matches.length || input.source !== "fmp"
            ? matches
            : await provider.search(query);
        const exact = securities.filter(
          (s) =>
            s.symbol.toLowerCase() ===
            parseSecurityQuery(query).query.toLowerCase(),
        );
        results.push({
          query,
          matches: exact.length === 1 ? exact : securities,
          error: securities.length ? null : unresolvedSecurityMessage(query),
        });
      } catch (e) {
        results.push({ query, matches: [], error: errorMessage(e) });
      }
    }
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
