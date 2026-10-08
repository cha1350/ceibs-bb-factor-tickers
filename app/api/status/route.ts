import { NextResponse } from "next/server";
import { providerHealth } from "@/lib/providers/fmp";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(providerHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
}
