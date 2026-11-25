import { Suspense } from "react";
import { isOwner } from "@/lib/owner";
import { getSnapshot } from "@/lib/behave/summary";
import OwnerSignIn from "../_owner/OwnerSignIn";
import BehaveApp from "./_components/BehaveApp";
import Mayor from "./_components/Mayor";

export default function BehavePage() {
  return (
    <main className="bh-page">
      <Suspense fallback={<div className="bh-empty">Opening the city…</div>}>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  const owner = await isOwner();
  if (!owner) return <Outside />;

  // Every visit starts with a clean chat; the mayor still reads today's earlier messages for context.
  const loaded = await getSnapshot().then(
    (snap) => ({ snap, error: null }),
    (e: unknown) => ({ snap: null, error: e instanceof Error ? e.message : String(e) }),
  );
  if (!loaded.snap) {
    return (
      <div className="bh-empty">
        Behave can&apos;t load its data right now.
        <div className="bh-err">{loaded.error}</div>
        <div className="bh-err">First run? The behave_* tables come from supabase/011_behave.sql.</div>
      </div>
    );
  }
  return <BehaveApp snap={loaded.snap} />;
}

function Outside() {
  return (
    <section className="bh-outside">
      <Mayor size={88} />
      <h1 className="bh-h1">Behave</h1>
      <p className="bh-lead">
        A small city that grows or stalls with how you actually live. Late-night screens bring smog, good food fills the
        markets, sleep brings clear mornings and movement grows the parks. A mini mayor checks in through the day.
      </p>
      <p className="bh-muted">It runs on personal health data, so for now it&apos;s the owner&apos;s alone.</p>
      <OwnerSignIn owner={false} tone="light" />
    </section>
  );
}
