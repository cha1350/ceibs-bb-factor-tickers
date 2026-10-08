import { NextResponse } from "next/server";
import {
  analyzeSchema,
  checkOrigin,
  readBody,
  errorMessage,
  loadStock,
  validateImports,
  getDemo,
} from "@/lib/server";
import { validateAsOf, priceCutoff, todayIn } from "@/lib/dates";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = analyzeSchema.parse(await readBody(request));
    validateAsOf(input.asOf);
    validateImports(input.imports ?? {});
    const securities = [
      ...new Map(
        input.securities.map((s) => [
          s.symbol.toUpperCase(),
          { ...s, symbol: s.symbol.toUpperCase() },
        ]),
      ).values(),
    ];
    const stocks = [],
      errors = [];
    if (input.source === "demo")
      stocks.push(...getDemo(securities, input.asOf));
    else
      for (const security of securities) {
        try {
          stocks.push(
            await loadStock(
              security,
              input.asOf,
              input.source,
              input.imports ?? {},
            ),
          );
        } catch (e) {
          errors.push(`${security.symbol}: ${errorMessage(e)}`);
        }
      }
    return NextResponse.json(
      {
        stocks,
        errors,
        cutoff: input.source === "demo" ? input.asOf : priceCutoff(input.asOf),
        historical: input.asOf < todayIn(),
        source: input.source,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
