// Server-only: everything the page and the mayor need for "today", in one read.
import "server-only";
import { addDays, behaveDay, dayLabel } from "./day";
import { getBaseline, getDays, getSettings, listMeals, type BaselineState, type Meal, type Settings } from "./data";
import { dayIntake, lateScreenMinutes, PILLAR_NAMES, PILLARS, scoreDay, type DayData, type DayScore } from "./score";

export type Snapshot = {
  today: string;
  settings: Settings;
  baseline: BaselineState;
  days: DayData[]; // the last 7 days, oldest first, today last
  scores: DayScore[]; // same order as days
  meals: Meal[]; // today's
};

export async function getSnapshot(): Promise<Snapshot> {
  const today = behaveDay();
  const settings = await getSettings();
  const [baseline, days, meals] = await Promise.all([
    getBaseline(today, settings.baselineStart),
    getDays(addDays(today, -6), today),
    listMeals(today),
  ]);
  const scores = days.map((d) => scoreDay(d, baseline.baseline, settings.weights));
  return { today, settings, baseline, days, scores, meals };
}

const hm = (min: number | undefined | null) => {
  if (min == null) return "not logged";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

function dayLine(d: DayData, s: DayScore, withScore: boolean): string {
  const m = d.metrics;
  const late = lateScreenMinutes(d);
  const parts = [
    `sleep ${hm(m.sleep_minutes)}`,
    `exercise ${m.exercise_minutes != null ? `${Math.round(m.exercise_minutes)}m` : "not logged"}`,
    `steps ${m.steps != null ? Math.round(m.steps) : "not logged"}`,
    `phone ${hm(m.phone_minutes)}`,
    `laptop ${hm(m.laptop_minutes)}`,
    `screens after 11pm ${hm(late)}`,
    `meals ${d.meals.length ? `${d.meals.length} logged${dayIntake(d) ? `, about ${dayIntake(d)!.kcal} kcal and ${dayIntake(d)!.protein_g}g protein` : ""}` : "none logged"}`,
  ];
  return `${dayLabel(d.day)}: ${parts.join(", ")}${withScore ? `. Score ${s.total}/100` : ""}`;
}

/** Plain-text facts for the mayor's system prompt. */
export function mayorContext(snap: Snapshot): string {
  const b = snap.baseline;
  const lines: string[] = [];
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  lines.push(`Now: ${dayLabel(snap.today)}, ${clock} Singapore time.`);
  if (b.start) {
    lines.push(b.done
      ? `Baseline finished (${dayLabel(b.start)} to ${dayLabel(b.end!)}). Baseline screen time: ${hm(b.baseline.screenMinutes)} a day.`
      : `Baseline survey: day ${b.dayNumber} of 14, ends ${dayLabel(b.end!)}.`);
  } else {
    lines.push("Nothing has been logged yet, ever. The survey starts with his first meal, screenshot or Watch reading.");
  }
  lines.push("Last 7 days, oldest first:");
  snap.days.forEach((d, i) => lines.push(`- ${dayLine(d, snap.scores[i], b.done)}`));
  if (snap.meals.length) {
    lines.push("Today's meals:");
    for (const m of snap.meals) lines.push(`- ${m.meal === "unsorted" ? "MEAL TYPE NOT SET YET (ask him or wait for his answer)" : m.meal}: ${m.description} (quality ${m.quality}/100${m.kcal != null ? `, about ${m.kcal} kcal, ${m.protein_g ?? "?"}g protein` : ""}, id ${m.id})`);
  } else {
    lines.push("No meals logged today yet.");
  }
  const t0 = snap.days.at(-1)!.metrics;
  const words = ["", "terrible", "bad", "so-so", "good", "great"];
  const ci = (k: "sleep_quality" | "energy" | "mood", label: string) =>
    t0[k] != null ? `${label} ${t0[k]}/5 (${words[Math.round(t0[k]!)]}), done` : `${label} not asked yet`;
  lines.push(`Today's check-ins: ${ci("sleep_quality", "sleep quality")}; ${ci("energy", "energy")}; ${ci("mood", "mood")}.`);
  if (b.done) {
    const t = snap.scores.at(-1)!;
    lines.push(`Today's pillar scores: ${PILLARS.map((p) => `${PILLAR_NAMES[p]} ${t.pillars[p].score}`).join(", ")}.`);
  }
  return lines.join("\n");
}
