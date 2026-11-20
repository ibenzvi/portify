// Vercel serverless endpoint for the in-app chat assistant.
// Receives the conversation plus an optional screenshot (base64 data URL),
// asks a vision-capable LLM to read balances off the screenshot and match
// them to the user's tracked assets, and returns { reply, values }.
//
// Auth: the caller must send their Supabase access token
// (Authorization: Bearer <token>); we verify it against Supabase before
// touching the LLM, so strangers cannot burn the API key.
//
// Provider: whichever key is configured on Vercel wins:
//   OPENAI_API_KEY  -> OpenAI chat completions (model: OPENAI_MODEL or gpt-4o-mini)
//   GEMINI_API_KEY  -> Gemini generateContent (model: GEMINI_MODEL or gemini-2.5-flash)
// No key configured -> 503 with a clear error.

const MAX_IMAGE_CHARS = 6_000_000; // ~4.5MB of base64, under Vercel's body limit
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4_000;

function buildSystemPrompt(assets) {
  return [
    "You are the assistant inside Portify, a personal portfolio tracker.",
    "The user uploads screenshots of their bank, pension or investment apps and wants the balances recorded in the tracker.",
    "",
    "The user's tracked assets as JSON (each has kind, id, name, optional symbol, currency, lastValue, lastDate):",
    JSON.stringify(assets),
    "",
    "Rules:",
    "- Read every account, fund or balance visible in the screenshot.",
    '- Match each balance to a tracked asset by name (Hebrew or English), symbol or provider hints. Use ONLY ids from the list above. Never invent an id.',
    "- If you are not confident about a match, leave it out of values and say so in reply.",
    "- Each value must be a plain number in that asset's own currency (its currency field), with no thousands separators and no currency symbols.",
    "- If the user just writes text with no screenshot, answer their question about their tracked assets using the list above.",
    "- Write the reply in the user's language (Hebrew if they write Hebrew). Keep it short: what you found, what you matched, what you could not match.",
    '- Respond with strict JSON only, no markdown: {"reply": string, "values": [{"kind": "instrument" | "manual", "id": string, "value": number}]}. values is [] when nothing was extracted.',
  ].join("\n");
}

function sanitizeValues(rawValues, assets) {
  const byId = new Map(assets.map((a) => [String(a.id), a]));
  const out = [];
  for (const v of Array.isArray(rawValues) ? rawValues : []) {
    const asset = byId.get(String(v?.id ?? ""));
    const value = Number(v?.value);
    if (!asset) continue; // drop hallucinated ids
    if (!Number.isFinite(value) || value < 0) continue;
    out.push({ kind: asset.kind, id: asset.id, value });
  }
  return out;
}

function parseModelJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  return { reply: String(parsed.reply ?? ""), values: parsed.values ?? [] };
}

async function callOpenAI({ apiKey, systemPrompt, history, userText, image }) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const userContent = [{ type: "text", text: userText || "What balances do you see?" }];
  if (image) {
    userContent.push({ type: "image_url", image_url: { url: image } });
  }
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userContent },
      ],
    }),
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(body?.error?.message || `OpenAI returned ${upstream.status}`);
  }
  return body?.choices?.[0]?.message?.content;
}

async function callGemini({ apiKey, systemPrompt, history, userText, image }) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts = [{ text: userText || "What balances do you see?" }];
  if (image) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(image);
    if (match) {
      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
    }
  }
  const contents = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts },
  ];
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { response_mime_type: "application/json" },
      }),
    },
  );
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(body?.error?.message || `Gemini returned ${upstream.status}`);
  }
  return (body?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Verify the caller's Supabase session before spending LLM tokens.
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const whoami = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
    });
    if (!whoami.ok) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
  } catch {
    res.status(502).json({ error: "Could not verify session" });
    return;
  }

  const { messages = [], image = null, assets = [], text = "" } = req.body || {};
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: "Bad messages" });
    return;
  }
  if (image && (typeof image !== "string" || image.length > MAX_IMAGE_CHARS || !image.startsWith("data:image/"))) {
    res.status(400).json({ error: "Bad image" });
    return;
  }
  const history = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  const cleanAssets = (Array.isArray(assets) ? assets : []).slice(0, 200).map((a) => ({
    kind: a?.kind === "manual" ? "manual" : "instrument",
    id: String(a?.id ?? ""),
    name: String(a?.name ?? "").slice(0, 120),
    symbol: a?.symbol ? String(a.symbol).slice(0, 30) : undefined,
    currency: a?.currency === "USD" ? "USD" : "ILS",
    lastValue: Number.isFinite(Number(a?.lastValue)) ? Number(a.lastValue) : null,
    lastDate: a?.lastDate ? String(a.lastDate).slice(0, 10) : null,
  }));

  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!openaiKey && !geminiKey) {
    res.status(503).json({ error: "No AI provider key configured on the server" });
    return;
  }

  const systemPrompt = buildSystemPrompt(cleanAssets);
  const userText = typeof text === "string" ? text.slice(0, MAX_MESSAGE_CHARS) : "";
  try {
    const raw = openaiKey
      ? await callOpenAI({ apiKey: openaiKey, systemPrompt, history, userText, image })
      : await callGemini({ apiKey: geminiKey, systemPrompt, history, userText, image });
    const { reply, values } = parseModelJson(raw);
    res.status(200).json({ reply, values: sanitizeValues(values, cleanAssets) });
  } catch (error) {
    res.status(502).json({ error: `AI request failed: ${error.message}` });
  }
}
