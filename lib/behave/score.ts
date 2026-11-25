// Behave scoring. Pure functions: same inputs, same score, on server or client.
//
// Each pillar is scored 0 to 100 from the day's data, then mapped onto 20..100.
// A pillar with no data counts as 20, the floor. That is the honesty rule in numbers:
// logging something, however bad, can never score lower than logging nothing.
//
// Sleep and movement are scored against published adult guidance (7+ hours of sleep;
// WHO's 150 to 300 minutes of moderate activity a week, taken here as 30 a day).
// Screen time and food are scored against the owner's own baseline and an AI estimate,
// because there is no medical consensus on a healthy daily screen total for adults.

export type Pillar = "screen" | "food" | "sleep" | "movement";
export const PILLARS: Pillar[] = ["screen", "food", "sleep", "movement"];
export const PILLAR_NAMES: Record<Pillar, string> = { screen: "Screens", food: "Food", sleep: "Sleep", movement: "Movement" };

export type Weights = Record<Pillar, number>;
// the owner's ranking: screens, food, sleep, movement.
export const DEFAULT_WEIGHTS: Weights = { screen: 35, food: 25, sleep: 20, movement: 20 };

export const METRICS = [
  "sleep_minutes",
  "exercise_minutes",
  "steps",
  "phone_minutes",
  "phone_late_minutes",
  "laptop_minutes",
  "laptop_late_minutes",
  "sleep_quality", // 1-5, from the morning check-in
  "energy", // 1-5, afternoon check-in
  "mood", // 1-5, evening check-in
] as const;
export type Metric = (typeof METRICS)[number];
export const isMetric = (s: unknown): s is Metric => typeof s === "string" && (METRICS as readonly string[]).includes(s);

export type DayData = {
  day: string;
  metrics: Partial<Record<Metric, number>>;
  meals: { quality: number; kcal?: number | null; protein_g?: number | null }[];
};

export type Baseline = {
  /** Median phone + laptop minutes over the baseline days with a phone reading */
  screenMinutes: number | null;
  days: number;
};

export type PillarScore = { score: number; logged: boolean; why: string };
export type DayScore = { total: number; pillars: Record<Pillar, PillarScore> };

export const FLOOR = 20;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const lift = (raw: number) => Math.round(FLOOR + (100 - FLOOR) * (clamp(raw) / 100));
const missing = (why: string): PillarScore => ({ score: FLOOR, logged: false, why });
const hm = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

export const SLEEP_FULL = 7 * 60; // 7 hours scores full
export const SLEEP_ZERO = 4 * 60; // 4 hours or less scores zero
export const EXERCISE_FULL = 30; // minutes a day
export const STEPS_FULL = 8000; // fallback when no exercise minutes came in (a rule of thumb, not guidance)
export const LATE_ZERO = 60; // an hour of screens after 11pm scores zero on the late part

export function scoreSleep(d: DayData): PillarScore {
  const m = d.metrics.sleep_minutes;
  if (m == null) return missing("No sleep data from the Watch yet.");
  const raw = ((m - SLEEP_ZERO) / (SLEEP_FULL - SLEEP_ZERO)) * 100;
  return { score: lift(raw), logged: true, why: `${hm(m)} asleep (7h+ is the adult guideline).` };
}

export function scoreMovement(d: DayData): PillarScore {
  const ex = d.metrics.exercise_minutes;
  if (ex != null) return { score: lift((ex / EXERCISE_FULL) * 100), logged: true, why: `${Math.round(ex)} exercise minutes (30 a day meets WHO guidance).` };
  const steps = d.metrics.steps;
  if (steps != null) return { score: lift((steps / STEPS_FULL) * 100), logged: true, why: `${Math.round(steps).toLocaleString("en-GB")} steps (no exercise minutes came in).` };
  return missing("No movement data from the Watch yet.");
}

export function scoreScreen(d: DayData, base: Baseline): PillarScore {
  const phone = d.metrics.phone_minutes;
  if (phone == null) return missing("No Screen Time screenshot for this day.");
  const laptop = d.metrics.laptop_minutes ?? 0;
  const late = (d.metrics.phone_late_minutes ?? 0) + (d.metrics.laptop_late_minutes ?? 0);
  const lateRaw = 100 - (late / LATE_ZERO) * 100;
  const total = phone + laptop;
  // Against baseline: 30% under scores full, 30% over scores zero. No baseline yet: neutral.
  const totalRaw = base.screenMinutes ? ((1.3 - total / base.screenMinutes) / 0.6) * 100 : 50;
  const raw = 0.6 * clamp(lateRaw) + 0.4 * clamp(totalRaw);
  const vs = base.screenMinutes ? `, baseline ${hm(base.screenMinutes)}` : "";
  return { score: lift(raw), logged: true, why: `${hm(late)} after 11pm; ${hm(total)} in total${vs}.` };
}

export function scoreFood(d: DayData): PillarScore {
  if (!d.meals.length) return missing("No meals logged.");
  const avg = d.meals.reduce((s, m) => s + m.quality, 0) / d.meals.length;
  return { score: lift(avg), logged: true, why: `${d.meals.length} meal${d.meals.length === 1 ? "" : "s"} logged, average quality ${Math.round(avg)}/100 (an estimate).` };
}

export function scoreDay(d: DayData, base: Baseline, weights: Weights = DEFAULT_WEIGHTS): DayScore {
  const pillars: Record<Pillar, PillarScore> = {
    screen: scoreScreen(d, base),
    food: scoreFood(d),
    sleep: scoreSleep(d),
    movement: scoreMovement(d),
  };
  const wsum = PILLARS.reduce((s, p) => s + Math.max(0, weights[p]), 0) || 1;
  const total = Math.round(PILLARS.reduce((s, p) => s + pillars[p].score * Math.max(0, weights[p]), 0) / wsum);
  return { total, pillars };
}

/** Median of phone + laptop minutes over days that have a phone reading. */
export function computeBaseline(days: DayData[]): Baseline {
  const totals = days
    .filter((d) => d.metrics.phone_minutes != null)
    .map((d) => (d.metrics.phone_minutes ?? 0) + (d.metrics.laptop_minutes ?? 0))
    .sort((a, b) => a - b);
  if (!totals.length) return { screenMinutes: null, days: 0 };
  const mid = Math.floor(totals.length / 2);
  const median = totals.length % 2 ? totals[mid] : (totals[mid - 1] + totals[mid]) / 2;
  return { screenMinutes: median > 0 ? median : null, days: totals.length };
}

/** Estimated calories and protein for a day; null when no meal carries an estimate. Information only, never scored. */
export function dayIntake(d: DayData): { kcal: number; protein_g: number } | null {
  const est = d.meals.filter((m) => m.kcal != null);
  if (!est.length) return null;
  return { kcal: est.reduce((s, m) => s + (m.kcal ?? 0), 0), protein_g: est.reduce((s, m) => s + (m.protein_g ?? 0), 0) };
}

/** Screen minutes after 11pm, the v1 headline metric. Null when the phone part is missing. */
export function lateScreenMinutes(d: DayData): number | null {
  if (d.metrics.phone_late_minutes == null && d.metrics.laptop_late_minutes == null) return null;
  return (d.metrics.phone_late_minutes ?? 0) + (d.metrics.laptop_late_minutes ?? 0);
}
