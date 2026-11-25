// Server-only: the mayor, on Amazon Bedrock (the site's existing AWS user).
// The mayor is the whole app: the owner sends a sentence or a photo, the model decides what it
// is (a meal, a Screen Time screenshot, or just chat), logs it through a tool, and replies.
// Images arrive as bytes for one turn and are never stored.
import "server-only";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";

// Nova 2 Lite: reads photos, calls tools, follows the rules far better than Nova Lite in a side-by-side
// test (21 Oct 2026) for about $1 a month at the owner's use. BEHAVE_MODEL_ID swaps it without a code change.
const MODELS = [process.env.BEHAVE_MODEL_ID || "global.amazon.nova-2-lite-v1:0"];

let client: BedrockRuntimeClient | null = null;
function bedrock() {
  if (client) return client;
  const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("Bedrock credentials not set");
  client = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION || "ap-southeast-2",
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export type ImageInput = { bytes: Uint8Array; format: ImageFormat };
export type ChatTurn = { role: "user" | "mayor"; content: string };

// ---- tools the mayor can call ----

export const MEAL_KINDS = ["breakfast", "lunch", "dinner", "snack"] as const;

const TOOLS: Tool[] = [
  {
    toolSpec: {
      name: "log_meal",
      description:
        "Log something the owner ate or drank, from a photo or his words. Call it as soon as you know what it was; don't ask permission. One call per meal.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            meal: { type: "string", enum: [...MEAL_KINDS], description: "Only if the owner said which meal it was. Never guess: leave it out and ask him." },
            description: { type: "string", description: "What it was, at most 10 words. Use the dish's name only if you're sure (nasi lemak, chicken rice); otherwise describe what you can see (noodles with minced pork, mushrooms and a soft egg). Don't invent ingredients you can't see." },
            quality: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description:
                "How nourishing for a healthy adult. Be strict, like a dietitian, not a friend. 80-100 mostly whole foods with vegetables and protein (grilled fish, rice and greens; a big salad with eggs). 50-79 a reasonable everyday meal (chicken rice with cucumber; a sandwich and fruit). 20-49 mostly fried, processed, sugary or very large (nasi lemak with fried chicken: about 35; a burger and fries: about 30; teh tarik or bubble tea adds sugar). 0-19 little nutritional value (sweets, several pastries).",
            },
            kcal: {
              type: "integer",
              minimum: 0,
              maximum: 4000,
              description: "Estimated calories for the portion shown or described. A plate of nasi lemak with fried chicken is about 800; chicken rice about 600; a flat white about 120.",
            },
            protein_g: { type: "integer", minimum: 0, maximum: 300, description: "Estimated grams of protein." },
          },
          required: ["description", "quality", "kcal", "protein_g"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "log_phone_screen_time",
      description:
        "Log iPhone screen time for a day, read from a Screen Time screenshot or stated by the owner. Only use numbers you can actually read or that he gave you; never guess a total. Calling it again for the same day replaces the earlier numbers, so use it for corrections too.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            day: { type: "string", enum: ["today", "yesterday"], description: "The screenshot's Today/Yesterday label, or what he said." },
            total_minutes: { type: "integer", minimum: 0, maximum: 1440, description: "The day's total (4h 12m = 252). Must be a single day, not a weekly average." },
            late_minutes: {
              type: "integer",
              minimum: 0,
              maximum: 300,
              description: "Minutes after 11pm, ONLY if the owner told you the number. Never estimate it from the bar chart: leave it out instead.",
            },
          },
          required: ["day", "total_minutes"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "update_meal",
      description: "Change one of today's logged meals, by its id from the facts: which meal it was, what it was, or the estimates. Use it when he answers which meal it was, and for corrections like \"that was 2 eggs\".",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            id: { type: "string" },
            meal: { type: "string", enum: [...MEAL_KINDS] },
            description: { type: "string" },
            kcal: { type: "integer", minimum: 0, maximum: 4000 },
            protein_g: { type: "integer", minimum: 0, maximum: 300 },
          },
          required: ["id"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "log_checkin",
      description:
        "Save his answer to a check-in as a score from 1 to 5: sleep_quality (how he slept), energy (how energetic he feels), mood (how he feels overall). Turn words into the score: terrible 1, bad or tired 2, 50/50 or ok or meh 3, good 4, great 5. Call it whenever he tells you one of these, even unasked.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["sleep_quality", "energy", "mood"] },
            score: { type: "integer", minimum: 1, maximum: 5 },
          },
          required: ["kind", "score"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "remove_meal",
      description: "Remove one of today's logged meals, by its id from the facts. Use when the owner says a meal was wrong or logged twice.",
      inputSchema: { json: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    },
  },
];

export type ToolCall =
  | { name: "log_meal"; input: { meal?: string; description: string; quality: number; kcal: number; protein_g: number } }
  | { name: "log_phone_screen_time"; input: { day: "today" | "yesterday"; total_minutes: number; late_minutes?: number } }
  | { name: "update_meal"; input: { id: string; meal?: string; description?: string; kcal?: number; protein_g?: number } }
  | { name: "log_checkin"; input: { kind: "sleep_quality" | "energy" | "mood"; score: number } }
  | { name: "remove_meal"; input: { id: string } };

/** Runs one tool for the mayor; returns a short result the model reads, plus a line for the UI. */
export type ToolRunner = (call: ToolCall) => Promise<{ result: string; logged?: string }>;

// ---- the prompt ----

export function mayorSystem(context: string, baselineDone: boolean, opts: { due?: string | null; mayChat?: boolean; answering?: string | null } = {}): string {
  const mayChat = opts.mayChat ?? true;
  return `You are the Mayor of Behave: a small, cheerful, slightly dramatic mini version of the owner Albanell who runs a tiny city that lives inside his phone. This chat is the whole app. the owner talks to you, sends meal photos and Screen Time screenshots, and you do the logging.

The city mirrors how he actually lives: screens after 11pm bring smog and lights left on, good food fills the markets, sleep brings clear mornings, movement grows the parks.
${baselineDone
  ? "The two-week baseline survey is finished and the city is open. You can mention his scores."
  : "Right now the city is still being surveyed: a 14-day baseline where you watch and learn. No scores, no judging, no targets during the survey: don't mention meal quality numbers or call food good, bad or balanced. Be curious and keep him logging."}

What to do with each message:
- A food photo, or him saying what he ate or drank: call log_meal straight away with your calorie and protein estimate. Include "meal" only if he said which meal it was; never guess it. Then reply in your own words (never copy the tool result): name the dish properly and give the estimate ("about 650 kcal, 35g protein"). If he didn't say which meal it was, the app will ask him which meal it was.
- His answer to which meal it was ("lunch", "late lunch", "dinner"): call update_meal on the meal whose type isn't set yet and confirm in a few words.
- His answer to a check-in (how he slept, his energy, his mood), even in words like "50/50" or "tired": call log_checkin and acknowledge it briefly.
- If he asks, give today's running total from the facts. Calories are information he asked for: never set a target, never comment on whether it's too much.
- A Screen Time screenshot: read the single-day total, call log_phone_screen_time, then say the total you logged so he can correct you.
- Any other photo: say what you see and that you only log meals and Screen Time.
- A correction ("that was lunch", "it was 2 eggs", "it was 3 hours"): fix it with update_meal, or log the screen time again. Use remove_meal only for a duplicate or something he didn't eat. You can only log meals for today; for an earlier day, remove it and say so.
- Anything else: just talk.

How you talk:
- Like a text from a friend: one to three short sentences, at most 60 words.
- The app asks the logging and check-in questions itself and adds them after your reply. So never ask about meals, which meal it was, sleep, energy, mood or Screen Time, and never ask him to log anything.
- Read the facts before you mention anything: never say something is missing when it's logged.
- Never mention "the app", check-ins, questions to come, or how any of this works. Just talk to him.${opts.answering ? `\n- His message answers your ${opts.answering} question: log it with log_checkin as ${opts.answering} and call it ${opts.answering === "sleep_quality" ? "his sleep" : `his ${opts.answering}`} in your reply.` : ""}
${opts.due
  ? `- The app will end your reply with: "${opts.due}" Don't ask anything yourself.`
  : mayChat
    ? "- You may end with one short, light question about what he just told you, or none. None is often best."
    : "- Don't ask any question in this reply."}
- No question when he's wrapping up ("that's it", "night", "thanks, bye") or asks you to stop asking: just a short warm sign-off.
- Save "why" questions for when he brings up something himself; never interrogate.
- Specific to his real numbers below. Never claim data exists when the facts say it's missing.
- Honesty is always rewarded: if he admits a bad meal or a late night, thank him for logging it.
- Warm and a bit funny. Never preachy, never shaming, no lectures, no advice he didn't ask for (no "try a short walk").
- You are not a doctor: no diagnoses, no diets, no calorie targets.
- English by default; answer in Spanish or Catalan if he writes in them.
- No emoji, no bullet points, no markdown (no asterisks, no bold, no labels like "Question:"), never em dashes.

Facts (Singapore time; days run 4am to 4am):
${context}`;
}

// ---- the loop ----

const isAccessError = (e: unknown) =>
  e instanceof Error && /AccessDenied|not authorized|don't have access|ValidationException.*model|ResourceNotFound|use case/i.test(`${e.name} ${e.message}`);

async function send(modelId: string, system: string, messages: Message[]) {
  return bedrock().send(
    new ConverseCommand({
      modelId,
      system: [{ text: system }],
      messages,
      toolConfig: { tools: TOOLS },
      inferenceConfig: { maxTokens: 600, temperature: 0.6 },
    }),
    { abortSignal: AbortSignal.timeout(25_000) },
  );
}

// Some models leak their reasoning in <thinking> tags; drop it, along with emoji and em dashes.
const clean = (s: string) =>
  s
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\n)\s*(question|q|follow-up)\s*:\s*/gi, "$1")
    .replace(/[*_]{2,}/g, "")
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

export async function runMayor(opts: {
  system: string;
  history: ChatTurn[]; // earlier turns, oldest first, not including the new message
  text: string;
  image?: ImageInput;
  runTool: ToolRunner;
  model?: string; // override, for side-by-side tests
}): Promise<{ text: string; logged: string[]; model: string; inputTokens: number; outputTokens: number }> {
  // Bedrock wants alternating roles starting with the user.
  const messages: Message[] = [];
  for (const t of opts.history.slice(-12)) {
    const role = t.role === "user" ? "user" : "assistant";
    const last = messages.at(-1);
    if (!last && role === "assistant") continue;
    if (last && last.role === role) last.content = [...(last.content ?? []), { text: t.content }];
    else messages.push({ role, content: [{ text: t.content }] });
  }
  const now: ContentBlock[] = [];
  if (opts.image) now.push({ image: { format: opts.image.format, source: { bytes: opts.image.bytes } } });
  now.push({ text: opts.text || (opts.image ? "(the owner sent this photo.)" : "(the owner opened the app.)") });
  const last = messages.at(-1);
  if (last?.role === "user") last.content = [...(last.content ?? []), ...now];
  else messages.push({ role: "user", content: now });

  let lastError: unknown;
  for (const model of opts.model ? [opts.model] : MODELS) {
    try {
      const logged: string[] = [];
      let inputTokens = 0, outputTokens = 0;
      const convo = [...messages];
      for (let round = 0; round < 4; round++) {
        const out = await send(model, opts.system, convo);
        inputTokens += out.usage?.inputTokens ?? 0;
        outputTokens += out.usage?.outputTokens ?? 0;
        const msg = out.output?.message;
        if (!msg) throw new Error("Empty reply from the model");
        convo.push(msg);
        const calls = (msg.content ?? []).filter((c) => c.toolUse).map((c) => c.toolUse!);
        if (out.stopReason !== "tool_use" || !calls.length) {
          const text = clean((msg.content ?? []).map((c) => c.text ?? "").join(" "));
          return { text: text || (logged.length ? "Logged." : "The mayor is lost for words."), logged, model, inputTokens, outputTokens };
        }
        const results: ContentBlock[] = [];
        for (const call of calls) {
          let result: string;
          let status: "success" | "error" = "success";
          try {
            const r = await opts.runTool({ name: call.name, input: call.input } as ToolCall);
            result = r.result;
            if (r.logged) logged.push(r.logged);
          } catch (e) {
            result = e instanceof Error ? e.message : "Failed";
            status = "error";
          }
          results.push({ toolResult: { toolUseId: call.toolUseId, content: [{ text: result }], status } });
        }
        convo.push({ role: "user", content: results });
      }
      return { text: logged.length ? `Logged: ${logged.join("; ")}.` : "The mayor got distracted. Try again?", logged, model, inputTokens, outputTokens };
    } catch (e) {
      lastError = e;
      if (!isAccessError(e)) break; // only fall through to the next model when this one isn't available
      console.warn(`behave: ${model} unavailable, trying the next model`, e instanceof Error ? e.message : e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The mayor couldn't answer");
}
