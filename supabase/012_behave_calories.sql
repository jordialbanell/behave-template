-- Behave: calorie and protein estimates on each meal (estimates from the photo or description).
-- Paste into the SQL Editor and run. Safe to re-run.
alter table public.behave_meals add column if not exists kcal int check (kcal between 0 and 4000);
alter table public.behave_meals add column if not exists protein_g int check (protein_g between 0 and 300);
