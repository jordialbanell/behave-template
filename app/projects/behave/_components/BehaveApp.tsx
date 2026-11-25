"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, SendHorizontal, X } from "lucide-react";
import type { Message } from "@/lib/behave/data";
import type { Snapshot } from "@/lib/behave/summary";
import { BASELINE_DAYS, dayLabel } from "@/lib/behave/day";
import { dayIntake, lateScreenMinutes } from "@/lib/behave/score";
import Mayor from "./Mayor";
import { postJson, shrinkImage } from "./shrink";

const hm = (min: number | null | undefined) => {
  if (min == null) return "–";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

// One chat is the whole app. Messages from this visit can carry a photo preview and
// the list of what the mayor logged; older ones come back from the database as text.
type ChatItem = Message & { preview?: string; logged?: string[] };
type Reply = { mine: Message | null; reply: Message; logged: string[] };

export default function BehaveApp({ snap }: { snap: Snapshot }) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The message box grows with what's typed, up to about six lines, then scrolls.
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  async function send(text: string, image: string | null) {
    setBusy(true);
    setError(null);
    const tmpId = `tmp-${Date.now()}`;
    if (text || image) {
      setItems((m) => [...m, { id: tmpId, created_at: new Date().toISOString(), day: snap.today, role: "user", content: text, preview: image ?? undefined }]);
    }
    try {
      const r = await postJson<Reply>("/projects/behave/api/mayor", { message: text, image: image ?? undefined });
      setItems((m) => [
        ...m.map((x) => (x.id === tmpId && r.mine ? { ...r.mine, preview: x.preview } : x)),
        { ...r.reply, logged: r.logged },
      ]);
      if (r.logged.length) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The mayor didn't answer.");
    } finally {
      setBusy(false);
    }
  }

  // Every visit opens with a fresh hello from the mayor.
  useEffect(() => {
    const t = setTimeout(() => void send("", null), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (file.current) file.current.value = "";
    if (!f) return;
    try {
      setPhoto(await shrinkImage(f, 1600, 0.88)); // big enough for Screen Time numbers to stay legible
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that photo.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (busy || (!text && !photo)) return;
    setDraft("");
    requestAnimationFrame(() => grow(box.current));
    const image = photo;
    setPhoto(null);
    void send(text, image);
  }

  return (
    <div className="bh-shell">
      <Strip snap={snap} week={week} onWeek={() => setWeek((w) => !w)} />
      {week && <WeekTable snap={snap} />}

      <div className="bh-chat-list" ref={list}>
        {items.length === 0 && !busy && (
          <div className="bh-hello">
            <Mayor size={72} />
            <p>Send the mayor a photo of what you&apos;re eating, a Screen Time screenshot, or just tell him how the day went.</p>
          </div>
        )}
        {items.map((m) => (
          <div key={m.id} className={`bh-row ${m.role === "mayor" ? "is-mayor" : "is-me"}`}>
            {m.role === "mayor" && <Mayor size={28} />}
            <div className="bh-bubble-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.preview && <img src={m.preview} alt="Photo you sent" className="bh-photo" />}
              {!m.preview && m.content.startsWith("[photo]") && <div className="bh-photo-chip">Photo</div>}
              {m.content.replace(/^\[photo\]\s?/, "") && <div className="bh-msg">{m.content.replace(/^\[photo\]\s?/, "")}</div>}
              {m.logged?.map((l) => <div key={l} className="bh-logged">Logged {l}</div>)}
            </div>
          </div>
        ))}
        {busy && (
          <div className="bh-row is-mayor">
            <Mayor size={28} />
            <div className="bh-msg is-typing" aria-label="The mayor is typing"><span /><span /><span /></div>
          </div>
        )}
      </div>

      {error && <div className="bh-error">{error}</div>}

      <form className="bh-composer" onSubmit={submit}>
        {photo && (
          <div className="bh-pending">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Photo to send" />
            <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo"><X size={14} /></button>
          </div>
        )}
        <div className="bh-composer-row">
          <label className="bh-icon-btn" aria-label="Add a photo or screenshot">
            <ImagePlus size={22} />
            <input ref={file} type="file" accept="image/*" onChange={pick} hidden />
          </label>
          <textarea
            ref={box}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              grow(e.target);
            }}
            onKeyDown={(e) => {
              // On a keyboard, Enter sends and Shift+Enter adds a line; on a phone, Return always adds a line.
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={photo ? "Add a note (optional)" : "Message the mayor"}
            aria-label="Message the mayor"
            maxLength={1000}
          />
          <button className="bh-icon-btn is-send" type="submit" disabled={busy || (!draft.trim() && !photo)} aria-label="Send">
            <SendHorizontal size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}

function Strip({ snap, week, onWeek }: { snap: Snapshot; week: boolean; onWeek: () => void }) {
  const d = snap.days.at(-1)!;
  const m = d.metrics;
  const b = snap.baseline;
  const screens = m.phone_minutes != null || m.laptop_minutes != null ? (m.phone_minutes ?? 0) + (m.laptop_minutes ?? 0) : null;
  const intake = dayIntake(d);
  const status = !b.start
    ? "Survey starts with your first log"
    : b.done
      ? `Score ${snap.scores.at(-1)!.total}`
      : `Survey day ${b.dayNumber} of ${BASELINE_DAYS}`;
  return (
    <div className="bh-strip">
      <div className="bh-strip-top">
        <span className="bh-strong">{status}</span>
        <span className="bh-strip-links">
          <button type="button" className="bh-link" onClick={onWeek}>{week ? "Hide week" : "Week"}</button>
          <Link href="/projects/behave/setup" className="bh-link">Setup</Link>
        </span>
      </div>
      <div className="bh-stats">
        <Stat name="Screens" value={hm(screens)} />
        <Stat name="Food" value={intake ? `${intake.kcal.toLocaleString("en-GB")} kcal` : snap.meals.length ? `${snap.meals.length} meal${snap.meals.length === 1 ? "" : "s"}` : "–"} />
        <Stat name="Sleep" value={hm(m.sleep_minutes)} />
        <Stat name="Moves" value={m.exercise_minutes != null ? `${Math.round(m.exercise_minutes)}m` : "–"} />
      </div>
    </div>
  );
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div className={`bh-stat${value === "–" ? " is-empty" : ""}`}>
      <div className="bh-stat-name">{name}</div>
      <div className="bh-stat-value">{value}</div>
    </div>
  );
}

function WeekTable({ snap }: { snap: Snapshot }) {
  const done = snap.baseline.done;
  const rows = snap.days.map((d, i) => ({ d, s: snap.scores[i] })).reverse();
  return (
    <div className="bh-week">
      <table className="bh-table">
        <thead>
          <tr>
            <th>Day</th><th>After 11pm</th><th>Phone</th><th>Laptop</th><th>Meals</th><th>kcal</th><th>Protein</th><th>Sleep</th><th>Slept</th><th>Energy</th><th>Mood</th><th>Moves</th>
            {done && <th>Score</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, s }) => (
            <tr key={d.day}>
              <td>{dayLabel(d.day)}</td>
              <td className="bh-strong">{hm(lateScreenMinutes(d))}</td>
              <td>{hm(d.metrics.phone_minutes)}</td>
              <td>{hm(d.metrics.laptop_minutes)}</td>
              <td>{d.meals.length || "–"}</td>
              <td>{dayIntake(d)?.kcal.toLocaleString("en-GB") ?? "–"}</td>
              <td>{dayIntake(d) ? `${dayIntake(d)!.protein_g}g` : "–"}</td>
              <td>{hm(d.metrics.sleep_minutes)}</td>
              <td>{d.metrics.sleep_quality != null ? `${d.metrics.sleep_quality}/5` : "–"}</td>
              <td>{d.metrics.energy != null ? `${d.metrics.energy}/5` : "–"}</td>
              <td>{d.metrics.mood != null ? `${d.metrics.mood}/5` : "–"}</td>
              <td>{d.metrics.exercise_minutes != null ? `${Math.round(d.metrics.exercise_minutes)}m` : "–"}</td>
              {done && <td className="bh-strong">{s.total}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
