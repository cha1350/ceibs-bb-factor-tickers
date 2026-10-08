export function todayIn(zone = "Asia/Shanghai", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function validateAsOf(date: string, today = todayIn()): void {
  if (!validDate(date) || date > today)
    throw new Error("Choose a valid date on or before today.");
}
export function priceCutoff(asOf: string, now = new Date()): string {
  validateAsOf(asOf, todayIn("Asia/Shanghai", now));
  // Always exclude the current US calendar session: provider EOD bars may be provisional.
  const marketDate = todayIn("America/New_York", now);
  return asOf < marketDate
    ? asOf
    : new Date(Date.parse(marketDate) - 86400000).toISOString().slice(0, 10);
}
export function publishedBy(
  row: Record<string, unknown>,
  cutoff: string,
): boolean {
  const date = String(
    row.acceptedDate || row.filingDate || row.publishedAt || "",
  ).slice(0, 10);
  return (
    validDate(date) &&
    date <= cutoff &&
    String(row.date || "").slice(0, 10) <= cutoff
  );
}
export function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}
