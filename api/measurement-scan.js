// POST /api/measurement-scan  { image: <base64, no prefix>, media_type: "image/jpeg", items: [{ name, fields: [...] }] }
//   with  Authorization: Bearer <supabase access token>
// Reads a photographed paper measurement sheet and returns the rows it can see. The result is only a draft:
// the app shows it to the user to correct before anything is saved.
import { userContext } from "./_lib/clients.js";

export const config = { maxDuration: 60 };

const ROLES = ["admin", "hr", "gm", "pm", "tl", "cutting_master", "cutting", "sales_manager", "sales"];
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function buildPrompt(items) {
  const list = (items || []).map((it) => `- ${it.name}: ${(it.fields || []).join(", ") || "size only"}`).join("\n");
  return `This is a photo of a paper sheet where school uniform measurements were written by hand: one row per student.
Read every student row you can see. For each student return the name, class and section (if written), and for each garment below the SIZE and any measurements written for it.

Garments and their measurements:
${list}

Reply with JSON only, no other text, in exactly this shape:
{"students":[{"name":"","class":"","section":"","roll":"","items":{"Pant":{"size":"32","Waist":"30","Length":"38"}}}],"notes":""}

Rules:
- Use the garment names exactly as listed above. Leave out a garment the student has no entry for.
- Keep numbers exactly as written; do not convert units. Sizes are usually even numbers like 28, 30, 32, or letters like S, M, L.
- If a class or section is written once at the top of the sheet, copy it to every student on that sheet.
- If a word or number is unreadable, leave that value as an empty string rather than guessing, and mention it in "notes".
- Do not invent students. Do not skip rows.`;
}

// the model's text -> { students, notes }; tolerant of ```json fences and stray text
export function parseScan(text) {
  const t = String(text || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return { students: [], notes: "No rows could be read from this photo." };
  let j;
  try { j = JSON.parse(t.slice(a, b + 1)); } catch { return { students: [], notes: "The photo could not be read. Try a clearer, straight-on photo." }; }
  const students = (Array.isArray(j.students) ? j.students : []).map((s) => {
    const items = {};
    Object.entries(s.items && typeof s.items === "object" ? s.items : {}).forEach(([name, v]) => {
      if (v && typeof v === "object") items[name] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "").trim()]));
    });
    return { name: String(s.name ?? "").trim(), class: String(s.class ?? "").trim(), section: String(s.section ?? "").trim(), roll: String(s.roll ?? "").trim(), items };
  }).filter((s) => s.name);
  return { students, notes: String(j.notes || "") };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ctx = await userContext(req);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ROLES.includes(ctx.role)) return res.status(403).json({ error: "Your role cannot add measurements." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const media = MEDIA.includes(body.media_type) ? body.media_type : "image/jpeg";
  const image = String(body.image || "").replace(/^data:[^,]+,/, "");
  if (!image) return res.status(400).json({ error: "Send a photo." });
  if (image.length > 5_500_000) return res.status(413).json({ error: "The photo is too large. Use a smaller photo." });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "Photo reading is not set up: ANTHROPIC_API_KEY is missing on the server." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 8000,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media, data: image } }, { type: "text", text: buildPrompt(Array.isArray(body.items) ? body.items.slice(0, 20) : []) }] }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: j?.error?.message || `Anthropic API error ${r.status}` });
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return res.status(200).json(parseScan(text));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
