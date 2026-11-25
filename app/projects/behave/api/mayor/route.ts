// The mayor chat, which is the whole app. POST { message?: string, image?: dataURL }.
// Saves the owner's message, lets the mayor log meals or screen time through tools,
// saves and returns the reply plus what was logged. An empty body is the daily hello.
// Owner only. Photos are read for this one turn and never stored.
import { isOwner } from "@/lib/owner";
import { MEAL_KINDS, mayorSystem, runMayor, type ToolCall } from "@/lib/behave/ai";
import { addMeal, addMessage, deleteMeal, listMeals, listMessages, updateMeal, upsertMetrics, type MetricRow } from "@/lib/behave/data";
import { addDays, behaveDay, dayLabel } from "@/lib/behave/day";
import { imageFromDataUrl } from "@/lib/behave/image";
import { getSnapshot, mayorContext } from "@/lib/behave/summary";
import { dueQuestion, pendingCheckin, questionStreak, QUESTIONS, shape } from "@/lib/behave/questions";

export const maxDuration = 60;
const MAX_CHARS = 1000;

const est = (v: unknown, max: number) => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

const hm = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export async function POST(req: Request) {
  if (!(await isOwner())) return Response.json({ error: "Only the owner can talk to the mayor." }, { status: 403 });
  let body: { message?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_CHARS) : "";
  const image = body.image != null ? imageFromDataUrl(body.image) : null;
  if (body.image != null && !image) return Response.json({ error: "That photo couldn't be read. Try a JPEG or PNG." }, { status: 400 });

  const today = behaveDay();
  // If the owner named the meal in this message, that wins over whatever the model passes or forgets.
  const saidMeal = (() => {
    const m = message.toLowerCase().match(/\b(breakfast|brunch|lunch|dinner|supper|snack)\b/);
    if (!m) return null;
    return m[1] === "brunch" ? "breakfast" : m[1] === "supper" ? "dinner" : m[1];
  })();
  let pending: ReturnType<typeof pendingCheckin> = null;
  let loggedUnsorted = false;
  const checkinsNow: string[] = [];
  const runTool = async (call: ToolCall) => {
    if (call.name === "log_meal") {
      // Never guessed: "unsorted" until the owner says which meal it was.
      const fromModel = (MEAL_KINDS as readonly string[]).includes(call.input.meal ?? "") ? call.input.meal! : null;
      const meal = saidMeal ?? fromModel ?? "unsorted";
      const named = meal !== "unsorted";
      if (!named) loggedUnsorted = true;
      const quality = Math.max(0, Math.min(100, Math.round(Number(call.input.quality))));
      if (!Number.isFinite(quality)) throw new Error("quality must be a number from 0 to 100");
      const description = String(call.input.description ?? "").trim().slice(0, 120) || "Meal";
      const kcal = est(call.input.kcal, 4000);
      const protein_g = est(call.input.protein_g, 300);
      const saved = await addMeal({ day: today, meal, description, quality, kcal, protein_g, note: null, from_photo: !!image });
      const intake = kcal != null ? `, about ${kcal} kcal${protein_g != null ? `, ${protein_g}g protein` : ""}` : "";
      const next = named ? "" : " Meal type not set: ask him which meal it was.";
      return {
        result: `Saved${named ? ` as ${meal}` : ""}${intake}. id ${saved.id}.${next} Now reply in your own words.`,
        logged: `${named ? `${meal}: ` : ""}${description}${intake}`,
      };
    }
    if (call.name === "log_phone_screen_time") {
      const day = call.input.day === "yesterday" ? addDays(today, -1) : today;
      const total = Math.round(Number(call.input.total_minutes));
      if (!Number.isFinite(total) || total < 0 || total > 1440) throw new Error("total_minutes must be 0 to 1440");
      const rows: MetricRow[] = [{ day, metric: "phone_minutes", value: total, source: "screenshot" }];
      const lateRaw = call.input.late_minutes;
      const late = lateRaw == null ? null : Math.round(Number(lateRaw));
      if (late != null && Number.isFinite(late) && late >= 0 && late <= total) rows.push({ day, metric: "phone_late_minutes", value: late, source: "screenshot" });
      await upsertMetrics(rows);
      const lateText = rows.length > 1 ? `, ${hm(late!)} after 11pm` : "";
      return { result: `Saved for ${dayLabel(day)}: ${total} minutes${lateText}.`, logged: `phone ${dayLabel(day)}: ${hm(total)}${lateText}` };
    }
    if (call.name === "update_meal") {
      const meals = await listMeals(today);
      const m = meals.find((x) => x.id === call.input.id);
      if (!m) throw new Error("No meal with that id today");
      const patch: Parameters<typeof updateMeal>[1] = {};
      if ((MEAL_KINDS as readonly string[]).includes(call.input.meal ?? "")) patch.meal = call.input.meal!;
      else if (saidMeal && m.meal === "unsorted") patch.meal = saidMeal;
      if (call.input.description?.trim()) patch.description = call.input.description.trim().slice(0, 120);
      const kcal = est(call.input.kcal, 4000);
      const protein_g = est(call.input.protein_g, 300);
      if (kcal != null) patch.kcal = kcal;
      if (protein_g != null) patch.protein_g = protein_g;
      if (!Object.keys(patch).length) throw new Error("Nothing to change");
      const u = await updateMeal(m.id, patch);
      return { result: `Updated: ${u.meal}, ${u.description}${u.kcal != null ? `, about ${u.kcal} kcal` : ""}.`, logged: `${u.meal}: ${u.description}` };
    }
    if (call.name === "log_checkin") {
      const kinds = ["sleep_quality", "energy", "mood"] as const;
      // An answer to the check-in question just asked belongs to that check-in, whatever the model says.
      const kind = pending ?? kinds.find((k) => k === call.input.kind);
      const score = Math.round(Number(call.input.score));
      if (!kind || !Number.isFinite(score) || score < 1 || score > 5) throw new Error("kind must be sleep_quality, energy or mood, score 1 to 5");
      await upsertMetrics([{ day: today, metric: kind, value: score, source: "checkin" }]);
      checkinsNow.push(kind);
      const label = kind === "sleep_quality" ? "sleep" : kind;
      return { result: `Saved ${label} ${score}/5 for today.`, logged: `${label} ${score}/5` };
    }
    if (call.name === "remove_meal") {
      const meals = await listMeals(today);
      const m = meals.find((x) => x.id === call.input.id);
      if (!m) throw new Error("No meal with that id today");
      await deleteMeal(m.id);
      return { result: `Removed ${m.meal}: ${m.description}.`, logged: `removed ${m.meal}: ${m.description}` };
    }
    throw new Error("Unknown tool");
  };

  try {
    // Only today's conversation is context; logged data from earlier days reaches him through the facts.
    const [snap, recent] = await Promise.all([getSnapshot(), listMessages(12)]);
    const history = recent.filter((m) => m.day === today);
    pending = pendingCheckin(history);
    const due = dueQuestion({ today, days: snap.days, unsortedMeal: snap.meals.some((m) => m.meal === "unsorted"), history });
    // Light chat is welcome but can't go on forever: after three questions in a row, one reply with none.
    const mayChat = questionStreak(history) < 3;
    const signingOff = /((^|[.,!]\s*|good\s*)night\W*$|\bbye\b|\bthat'?s (it|all)\b|\bstop asking\b|\bno more questions\b|\bheading to bed\b)/i.test(message);
    const stored = image ? `[photo]${message ? ` ${message}` : ""}` : message;
    const mine = stored ? await addMessage("user", stored) : null;
    const { text: said, logged } = await runMayor({
      system: mayorSystem(mayorContext(snap), snap.baseline.done, { due: signingOff ? null : due ? QUESTIONS[due] : null, mayChat: mayChat && !signingOff, answering: pending }),
      history,
      text: message,
      image: image ?? undefined,
      runTool,
    });
    // A meal saved this turn without its type takes priority over any other question.
    // A check-in he answered this turn (even unasked) isn't asked again.
    const finalDue = signingOff ? null : loggedUnsorted ? "meal" : due && checkinsNow.includes(due) ? null : due;
    const text = shape(said, finalDue, mayChat && !signingOff);
    const reply = await addMessage("mayor", text);
    return Response.json({ mine, reply, logged });
  } catch (e) {
    console.error("behave mayor failed", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return Response.json({ error: "The mayor is out of the office. Try again in a moment." }, { status: 502 });
  }
}
