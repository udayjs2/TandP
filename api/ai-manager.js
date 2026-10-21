// POST /api/ai-manager  { action: "chat" | "report" | "recommend", ... }  with  Authorization: Bearer <supabase access token>
import { userContext, AI_ROLES } from "./_lib/clients.js";
import { runAgent, AGENTS, toolsFor } from "./_lib/agent.js";
import { daily_factory_report } from "./_lib/factory.js";
import { todayIST } from "./_lib/util.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const ctx = await userContext(req);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!AI_ROLES.includes(ctx.role)) return res.status(403).json({ error: "The AI Factory Manager is available to Admin, GM and PM." });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  try {
    if (body.action === "report") {
      return res.status(200).json(await daily_factory_report(ctx, { date: /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : todayIST() }));
    }
    if (body.action === "recommend") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : todayIST();
      const out = await runAgent(ctx, {
        agent: "management",
        messages: [{ role: "user", content: `Prepare the AI recommendations for the daily factory report of ${date}. Use your tools. Answer these four, each as one bullet starting with "- " and naming specific orders, departments or materials: 1) Which orders need immediate attention? 2) Which production department or team is falling behind? 3) Where is material wastage unusually high? 4) What should the manager prioritise tomorrow? If the data does not support an answer, say "Not enough data" for that bullet.` }],
      });
      return res.status(200).json(out);
    }
    const agent = AGENTS[body.agent] ? body.agent : "management";
    const messages = Array.isArray(body.messages) ? body.messages.filter((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim()) : [];
    if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Send a question." });
    const out = await runAgent(ctx, { agent, messages });
    return res.status(200).json({ ...out, agent, tools_available: toolsFor(ctx.role, agent) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
}
