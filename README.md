# Behave

A city that lives the way you do. A small city grows or stalls with how you actually live: late-night screens bring smog, good food fills the markets, sleep brings clear mornings, movement grows the parks. A mayor checks in through the day and you talk to it in plain words or photos.

Built by [Jordi Albanell](https://jordialbanell.com/projects). Try it on [jordialbanell.com](https://jordialbanell.com/projects/behave).

## What it does

- Tell the mayor what you ate, or send a photo, and it logs the meal with a rough calorie count.
- Send a Screen Time screenshot and it reads your phone time, late-night use included.
- Sleep, steps and exercise arrive from an Apple Watch through an iOS Shortcut; laptop time from ActivityWatch on a Mac.
- A daily score across screens, food, sleep and movement, compared with your own baseline, with weights you can change.
- Private: only the owner can open it.

## Run your own

1. **Use this template** (green button on GitHub) to make your own copy, then clone it.
2. `npm install`
3. **Database.** Create a free [Supabase](https://supabase.com) project. Open its SQL Editor and run the `supabase/` files in number order (if Supabase warns about Row Level Security, choose "Run without RLS": the files turn it on themselves). Only the app's server, with the service role key, can read or write the data.
4. **Settings.** Copy `.env.example` to `.env.local` and fill it in. `PROJECTS_OWNER_PASSWORD` is the password you'll sign in with; `PROJECTS_OWNER_SECRET` is any long random string (for example `openssl rand -hex 32`).
5. `npm run dev`, open http://localhost:3000 and sign in with "Owner? Sign in".
6. **Deploy.** Import the repo on [Vercel](https://vercel.com/new) and paste the same settings into its Environment Variables.

**Devices:** an iOS Shortcut or a script can send numbers to `/projects/behave/api/ingest` with the header `Authorization: Bearer <BEHAVE_INGEST_TOKEN>`. The comment at the top of `app/projects/behave/api/ingest/route.ts` lists the fields.

**Time zone:** days run 4am to 4am, Singapore time. Change `BEHAVE_TZ` in `lib/behave/day.ts` (and the clock line in `lib/behave/summary.ts`) to yours.

## Built with

Next.js, React, Supabase, Amazon Bedrock, iOS Shortcuts, ActivityWatch.

## Licence and credit

MIT licence, copyright (c) 2026 Jordi Albanell. See [LICENSE](LICENSE).

In plain words: you can use this code, change it, share it and build on it, including for paid work. The one legal condition is that **every copy keeps the copyright line and the LICENSE file**, so the code always says where it came from. Removing them breaks the licence.

If you put something live that's built on it, a "Based on Behave by [Jordi Albanell](https://jordialbanell.com)" link is appreciated.
