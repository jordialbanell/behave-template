// Where devices send numbers without anyone signed in: the iOS Shortcut (Apple Watch data)
// and the ActivityWatch sync script on the Mac. Guarded by a long secret token
// (BEHAVE_INGEST_TOKEN) sent as "Authorization: Bearer <token>".
//
// Body (JSON), every field optional except at least one number:
//   { "source": "watch" | "activitywatch", "day": "YYYY-MM-DD",
//     "sleep_minutes" | "sleep_hours", "exercise_minutes", "steps",
//     "laptop_minutes", "laptop_late_minutes" }
// "day" defaults to the current Behave day (4am to 4am, Singapore time).
// Numbers may come as strings ("7.5", "6 541"): Shortcuts sends both.
import { createHash, timingSafeEqual } from "node:crypto";
import { upsertMetrics, type MetricRow } from "@/lib/behave/data";
import { behaveDay, isDay } from "@/lib/behave/day";
import type { Metric } from "@/lib/behave/score";

const SOURCES: Record<string, Metric[]> = {
  watch: ["sleep_minutes", "exercise_minutes", "steps"],
  activitywatch: ["laptop_minutes", "laptop_late_minutes"],
};
const LIMITS: Partial<Record<Metric, number>> = { steps: 200_000 };
const DAY_MAX = 24 * 60;

function authorised(req: Request): boolean {
  const real = process.env.BEHAVE_INGEST_TOKEN;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!real || real.length < 24 || !got) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(real));
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "Not authorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }

  const source = typeof body.source === "string" && body.source in SOURCES ? body.source : "watch";
  const day = isDay(body.day) ? body.day : behaveDay();
  if (body.day != null && !isDay(body.day)) return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });

  if (body.sleep_minutes == null && body.sleep_hours != null) {
    const h = num(body.sleep_hours);
    if (h != null) body.sleep_minutes = h * 60;
  }

  const rows: MetricRow[] = [];
  const skipped: string[] = [];
  for (const metric of SOURCES[source]) {
    if (body[metric] == null || body[metric] === "") continue;
    const v = num(body[metric]);
    const max = LIMITS[metric] ?? DAY_MAX;
    if (v == null || v < 0 || v > max) {
      skipped.push(metric);
      continue;
    }
    rows.push({ day, metric, value: Math.round(v * 10) / 10, source });
  }
  if (!rows.length) {
    return Response.json({ error: `No usable numbers for source "${source}"`, expected: SOURCES[source], skipped }, { status: 400 });
  }

  try {
    await upsertMetrics(rows);
  } catch (e) {
    console.error("behave ingest failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not save" }, { status: 500 });
  }
  return Response.json({ ok: true, day, saved: Object.fromEntries(rows.map((r) => [r.metric, r.value])), skipped });
}
