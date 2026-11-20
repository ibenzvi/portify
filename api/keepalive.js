// Vercel cron target: pings Supabase once a day so the free-tier project is
// never paused for inactivity. Scheduled in vercel.json ("crons").
// Uses the same env vars the app already has on Vercel.

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ ok: false, error: "Supabase env vars missing" });
    return;
  }
  try {
    const upstream = await fetch(`${url}/rest/v1/records?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok, status: upstream.status });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
               }
