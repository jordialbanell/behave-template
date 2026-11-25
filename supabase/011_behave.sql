-- Behave tables in the shared database.
-- Paste this whole file into the SQL Editor and run it. Safe to re-run.
-- Only the server touches these (owner-gated pages and a token-gated ingest API),
-- so RLS is on with no policies and the public roles have no grants.
-- Photos and screenshots are never stored: only the numbers and notes read from them.

-- One number per day, metric and source (a re-sent day overwrites, never duplicates).
-- day = the Behave day, which runs 04:00 to 04:00 Singapore time.
create table if not exists public.behave_metrics (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  day         date not null,
  metric      text not null,
  value       numeric not null,
  source      text not null,
  unique (day, metric, source)
);
create index if not exists behave_metrics_day_idx on public.behave_metrics (day);

-- Meals: a photo or a line of text, scored by the model.
create table if not exists public.behave_meals (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  day          date not null,
  meal         text not null,          -- breakfast | lunch | dinner | snack
  description  text not null,
  quality      int  not null check (quality between 0 and 100),
  note         text,
  from_photo   boolean not null default false
);
create index if not exists behave_meals_day_idx on public.behave_meals (day);

-- The mayor chat.
create table if not exists public.behave_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  day         date not null,
  role        text not null check (role in ('user', 'mayor')),
  content     text not null
);
create index if not exists behave_messages_created_idx on public.behave_messages (created_at);

-- Small key/value settings (baseline start, weights).
create table if not exists public.behave_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.behave_metrics  enable row level security;
alter table public.behave_meals    enable row level security;
alter table public.behave_messages enable row level security;
alter table public.behave_settings enable row level security;

revoke all on public.behave_metrics, public.behave_meals, public.behave_messages, public.behave_settings from anon, authenticated;
