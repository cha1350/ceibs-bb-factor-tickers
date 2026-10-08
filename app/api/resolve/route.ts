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
        const matches = local.filter(
          (s) =>
            s.symbol.toLowerCase() === query.toLowerCase() ||
            s.name.toLowerCase().includes(query.toLowerCase()),
        );
        const securities =
          matches.length || input.source !== "fmp"
            ? matches
            : await provider.search(query);
        const exact = securities.filter(
          (s) => s.symbol.toLowerCase() === query.toLowerCase(),
        );
        results.push({
          query,
          matches: exact.length === 1 ? exact : securities,
          error: securities.length
            ? null
            : "No matching security. Use a ticker or try another company name.",
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
