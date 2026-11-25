// Which question the mayor asks is decided here, not by the model: the model was asking two or
// three questions at once, re-asking things already logged and filing answers under the wrong
// check-in. The app picks at most one due question, the model writes the rest of the reply,
// and shape() strips any questions the model added before appending the chosen one.
import { BEHAVE_TZ, addDays } from "./day";
import type { DayData } from "./score";

export const QUESTIONS = {
  meal: "Breakfast, lunch, dinner or a snack?",
  sleep_quality: "How did you sleep last night, from 1 to 5?",
  energy: "How's your energy right now, from 1 to 5?",
  mood: "How are you feeling overall today, from 1 to 5?",
  screenshot: "Could you send me yesterday's Screen Time screenshot?",
} as const;
export type QuestionKey = keyof typeof QUESTIONS;
export type CheckinKind = "sleep_quality" | "energy" | "mood";

type Turn = { role: "user" | "mayor"; content: string };

const hourNow = () =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: BEHAVE_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));

/** The single question that's due right now, if any. */
export function dueQuestion(opts: {
  today: string;
  days: DayData[]; // includes today and yesterday
  unsortedMeal: boolean;
  history: Turn[]; // today's conversation
  hour?: number;
}): QuestionKey | null {
  const hour = opts.hour ?? hourNow();
  const asked = (k: QuestionKey) => opts.history.some((t) => t.role === "mayor" && t.content.includes(QUESTIONS[k]));
  const today = opts.days.find((d) => d.day === opts.today)?.metrics ?? {};
  const yesterday = opts.days.find((d) => d.day === addDays(opts.today, -1))?.metrics ?? {};

  if (opts.unsortedMeal) return "meal";
  const window: CheckinKind = hour < 12 ? "sleep_quality" : hour < 18 ? "energy" : "mood";
  if (today[window] == null && !asked(window)) return window;
  if (hour >= 9 && yesterday.phone_minutes == null && !asked("screenshot")) return "screenshot";
  return null;
}

/** If the mayor's last message was a check-in question, the answer belongs to that check-in. */
export function pendingCheckin(history: Turn[]): CheckinKind | null {
  const last = [...history].reverse().find((t) => t.role === "mayor");
  if (!last) return null;
  for (const k of ["sleep_quality", "energy", "mood"] as const) if (last.content.includes(QUESTIONS[k])) return k;
  return null;
}

/** Questions in a row at the end of today's conversation (light chat is capped at 3). */
export function questionStreak(history: Turn[]): number {
  let n = 0;
  for (const t of [...history].reverse()) {
    if (t.role !== "mayor") continue;
    if (!t.content.trim().endsWith("?")) break;
    n++;
  }
  return n;
}

const sentences = (s: string) => s.match(/[^.!?\n]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [];

/**
 * Final reply: bullets flattened, at most one question.
 * - due question: every model question removed, the due one appended
 * - light chat allowed: the model's first question kept, others removed
 * - over the cap: all questions removed
 */
export function shape(text: string, due: QuestionKey | null, mayChat: boolean): string {
  const flat = text.replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, " ");
  const parts = sentences(flat);
  // Sentences about the machinery ("the app will ask...") never reach him.
  const statements = parts.filter((p) => !p.endsWith("?") && !/\bthe app\b|\bcheck-?ins?\b/i.test(p));
  // The model's own question is only for light chat: anything about logging or check-ins is the app's job.
  const firstQuestion = parts.find(
    (p) => p.endsWith("?") && !/\b(sleep|slept|energy|mood|feel(ing)?|meals?|eat|ate|breakfast|lunch|dinner|snack|screen|log(ging)?|check)\b/i.test(p),
  );
  const body = statements.join(" ").trim();
  if (due) return `${body} ${QUESTIONS[due]}`.trim();
  if (mayChat && firstQuestion) return `${body} ${firstQuestion}`.trim();
  return body || text.trim();
}
