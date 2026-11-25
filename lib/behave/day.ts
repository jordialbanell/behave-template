// Behave days run 04:00 to 04:00 Singapore time, so a 1am scroll counts as the night
// before, not the next morning. Pure helpers, safe on server and client.

export const BEHAVE_TZ = "Asia/Singapore";
export const DAY_START_HOUR = 4;
export const BASELINE_DAYS = 14;

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: BEHAVE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Behave day (YYYY-MM-DD) a moment belongs to. */
export function behaveDay(at: Date = new Date()): string {
  return ymd.format(new Date(at.getTime() - DAY_START_HOUR * 3_600_000));
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 21 Oct" */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
