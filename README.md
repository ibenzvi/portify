# Portify

Portfolio tracker built with React, Vite, Supabase, and Vercel.

## Local development

Run `npm ci`, create `.env.local` with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, then run `npm run dev`.

The Supabase anon key is public; access to portfolio records is enforced by
the owner-only row-level security policy in
`supabase/migrations/20260610000000_records.sql`.

Run `npm run lint`, `npm run build`, and `npm run check-bundle` before deploy.
