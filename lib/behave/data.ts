// Server-only Behave data access on the shared Supabase database (behave_* tables).
import "server-only";
import { sharedDb } from "../shared-db";
import { addDays, behaveDay, BASELINE_DAYS } from "./day";
import { computeBaseline, DEFAULT_WEIGHTS, PILLARS, type Baseline, type DayData, type Metric, type Weights } from "./score";

export type Meal = {
  id: string;
  created_at: string;
  day: string;
  meal: string;
  description: string;
  quality: number;
  kcal: number | null;
  protein_g: number | null;
  note: string | null;
  from_photo: boolean;
};

export type Message = { id: string; created_at: string; day: string; role: "user" | "mayor"; content: string };

export type MetricRow = { day: string; metric: Metric; value: number; source: string };

export type Settings = { baselineStart: string | null; weights: Weights };

export const MEAL_KINDS = ["breakfast", "lunch", "dinner", "snack"] as const;

// ---- metrics ----

export async function upsertMetrics(rows: MetricRow[]) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const { error } = await sharedDb()
    .from("behave_metrics")
    .upsert(rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "day,metric,source" });
  if (error) throw new Error(error.message);
  await ensureBaselineStart(rows.map((r) => r.day).sort()[0]);
}

/** Every day from `from` to `to` inclusive, with its metrics and meal scores. */
export async function getDays(from: string, to: string): Promise<DayData[]> {
  const db = sharedDb();
  const [metrics, meals] = await Promise.all([
    db.from("behave_metrics").select("day, metric, value, source, updated_at").gte("day", from).lte("day", to),
    db.from("behave_meals").select("day, quality, kcal, protein_g").gte("day", from).lte("day", to),
  ]);
  if (metrics.error) throw new Error(metrics.error.message);
  if (meals.error) throw new Error(meals.error.message);

  const out = new Map<string, DayData>();
  for (let d = from; d <= to; d = addDays(d, 1)) out.set(d, { day: d, metrics: {}, meals: [] });

  // If two sources report the same metric for a day, the newest reading wins.
  const seen = new Map<string, string>();
  for (const r of (metrics.data ?? []) as (MetricRow & { updated_at: string })[]) {
    const day = out.get(r.day);
    if (!day) continue;
    const key = `${r.day}:${r.metric}`;
    const prev = seen.get(key);
    if (prev && prev > r.updated_at) continue;
    seen.set(key, r.updated_at);
    day.metrics[r.metric] = Number(r.value);
  }
  for (const m of (meals.data ?? []) as { day: string; quality: number; kcal: number | null; protein_g: number | null }[]) {
    out.get(m.day)?.meals.push({ quality: m.quality, kcal: m.kcal, protein_g: m.protein_g });
  }
  return [...out.values()];
}

// ---- meals ----

export async function addMeal(m: Omit<Meal, "id" | "created_at">) {
  const { data, error } = await sharedDb().from("behave_meals").insert(m).select("*").single();
  if (error) throw new Error(error.message);
  await ensureBaselineStart(m.day);
  return data as Meal;
}

export async function updateMeal(id: string, patch: Partial<Pick<Meal, "meal" | "description" | "kcal" | "protein_g">>) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Bad meal id");
  const { data, error } = await sharedDb().from("behave_meals").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Meal;
}

export async function deleteMeal(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const { error } = await sharedDb().from("behave_meals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listMeals(day: string): Promise<Meal[]> {
  const { data, error } = await sharedDb().from("behave_meals").select("*").eq("day", day).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Meal[];
}

// ---- mayor chat ----

export async function listMessages(limit = 40): Promise<Message[]> {
  const { data, error } = await sharedDb()
    .from("behave_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Message[]).reverse();
}

export async function addMessage(role: Message["role"], content: string): Promise<Message> {
  const { data, error } = await sharedDb()
    .from("behave_messages")
    .insert({ role, content, day: behaveDay() })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Message;
}

// ---- settings and baseline ----

export async function getSettings(): Promise<Settings> {
  const { data, error } = await sharedDb().from("behave_settings").select("key, value");
  if (error) throw new Error(error.message);
  const map = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const start = map.get("baseline_start");
  const w = map.get("weights") as Partial<Weights> | undefined;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const p of PILLARS) if (typeof w?.[p] === "number") weights[p] = w[p] as number;
  return { baselineStart: typeof start === "string" ? start : null, weights };
}

export async function setSetting(key: string, value: unknown) {
  const { error } = await sharedDb()
    .from("behave_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/**
 * The baseline starts on the earliest day with data. A reading for an earlier day (yesterday's
 * Screen Time, say) can pull it back while the baseline is still running; once it ends, it's fixed.
 */
async function ensureBaselineStart(day: string | undefined) {
  if (!day) return;
  const { baselineStart } = await getSettings();
  if (!baselineStart) return setSetting("baseline_start", day);
  const running = behaveDay() <= addDays(baselineStart, BASELINE_DAYS - 1);
  if (running && day < baselineStart) await setSetting("baseline_start", day);
}

export type BaselineState = {
  start: string | null;
  end: string | null; // last baseline day
  dayNumber: number; // 1..14 during the baseline, 0 before it starts
  done: boolean;
  baseline: Baseline;
};

export async function getBaseline(today: string, start: string | null): Promise<BaselineState> {
  if (!start) return { start: null, end: null, dayNumber: 0, done: false, baseline: { screenMinutes: null, days: 0 } };
  const end = addDays(start, BASELINE_DAYS - 1);
  const done = today > end;
  const days = await getDays(start, done ? end : today);
  const dayNumber = done ? BASELINE_DAYS : days.length;
  return { start, end, dayNumber, done, baseline: computeBaseline(days) };
}
