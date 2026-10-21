// WhatsApp webhook (Meta Cloud API): authorised numbers can ask questions and get answers from the same AI agent.
import crypto from "node:crypto";
import { serviceClient } from "./_lib/clients.js";
import { runAgent } from "./_lib/agent.js";
import { sendWhatsApp } from "./_lib/whatsapp.js";

export const config = { maxDuration: 60, api: { bodyParser: false } };

const rawBody = (req) => new Promise((resolve, reject) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); req.on("error", reject); });

export default async function handler(req, res) {
  if (req.method === "GET") { // webhook verification
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] && q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(q["hub.challenge"]);
    return res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).end();
  const raw = await rawBody(req);
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = String(req.headers["x-hub-signature-256"] || "").replace("sha256=", "");
    const want = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(401).end();
  }
  let body; try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).end(); }
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.status(200).json({ ok: true }); // delivery receipts etc.
  const sb = serviceClient();
  if (!sb) return res.status(200).json({ ok: false });
  try {
    // Meta retries slow webhooks: handle each message id once
    const { error: dup } = await sb.from("ai_whatsapp_log").insert({ message_id: msg.id, phone: msg.from, question: msg.type === "text" ? msg.text.body.slice(0, 1000) : `(${msg.type})` });
    if (dup) return res.status(200).json({ ok: true, duplicate: true });
    const { data: user } = await sb.from("ai_whatsapp_users").select("name, role, active").eq("phone", msg.from).maybeSingle();
    if (!user || !user.active) { await sendWhatsApp(msg.from, "Sorry, this number is not authorised for the T&P Textiles AI Factory Manager."); return res.status(200).json({ ok: true }); }
    if (msg.type !== "text") { await sendWhatsApp(msg.from, "Please send your question as text."); return res.status(200).json({ ok: true }); }
    const { text } = await runAgent({ sb, role: user.role, svc: true }, { agent: "management", messages: [{ role: "user", content: msg.text.body }], extraSystem: "You are replying on WhatsApp: keep the answer under 900 characters." });
    await sendWhatsApp(msg.from, text);
    await sb.from("ai_whatsapp_log").update({ answer: text.slice(0, 3000) }).eq("message_id", msg.id);
  } catch (e) {
    console.error("whatsapp handler", e);
    try { await sendWhatsApp(msg.from, "Sorry, I could not answer that just now. Please try again."); } catch { /* ignore */ }
  }
  return res.status(200).json({ ok: true });
}
