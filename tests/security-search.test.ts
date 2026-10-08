import { describe, expect, it } from "vitest";
import { parseStockInput } from "../lib/input";
import { matchesSecurity, parseSecurityQuery } from "../lib/security-search";

describe("currency-qualified security input", () => {
  it("preserves qualified company names and still splits ticker lists", () => {
    expect(parseStockInput("YONEX JPY, AAPL MSFT\n7906.T jpy")).toEqual([
      "YONEX JPY",
      "AAPL",
      "MSFT",
      "7906.T jpy",
    ]);
  });
  it("keeps multiword names and trims currency qualifiers", () => {
    expect(parseSecurityQuery("  Yonex   jpy ")).toEqual({
      query: "Yonex",
      currency: "JPY",
    });
    expect(parseSecurityQuery("Bank of America USD")).toEqual({
      query: "Bank of America",
      currency: "USD",
    });
    expect(parseSecurityQuery("JPY")).toEqual({ query: "JPY" });
    expect(parseSecurityQuery("Acme ABC")).toEqual({ query: "Acme ABC" });
  });
  it("matches only the requested currency without manufacturing a listing", () => {
    const japan = {
      symbol: "7906.T",
      name: "YONEX Co., Ltd.",
      exchange: "JPX",
      currency: "JPY",
    };
    expect(matchesSecurity(japan, "Yonex JPY")).toBe(true);
    expect(matchesSecurity(japan, "7906.T jpy")).toBe(true);
    expect(
      matchesSecurity(
        { ...japan, symbol: "YONXF", currency: "USD" },
        "Yonex JPY",
      ),
    ).toBe(false);
    expect(matchesSecurity(japan, "Unknown company JPY")).toBe(false);
  });
});
