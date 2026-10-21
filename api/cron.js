// Scheduled AI workflows (Vercel Cron -> GET /api/cron?kind=...). Needs CRON_SECRET (Vercel sends it as a Bearer token).
import { serviceClient } from "./_lib/clients.js";
import { runAgent } from "./_lib/agent.js";
import { daily_factory_report } from "./_lib/factory.js";
import { todayIST, addDays, isSunday } from "./_lib/util.js";
import { sendWhatsApp, reportRecipients } from "./_lib/whatsapp.js";

export const config = { maxDuration: 60 };

const JOBS = {
  morning: { title: "Morning briefing - today's production priorities and material shortages", skipSunday: true,
    prompt: "It is 9:00 AM. Summarise today's production priorities and material shortages for the manager: which orders to push today (delayed or due within 3 days), how many people are available (attendance_summary for today), what fabric and accessories are short (inventory_status, fabric_required_tomorrow). Give 5-7 bullets and a one-line priority list." },
  midday: { title: "Midday check - orders at risk of delay", skipSunday: true,
    prompt: "It is 1:00 PM. Identify orders at risk of delay: use orders_status and production_summary (today and the last 7 days). For each at-risk order say the due date, pieces left, recent pace and the days it would need. Rank the worst first, at most 8 bullets." },
  evening: { title: "Daily production and attendance report", skipSunday: true,
    prompt: "It is 5:30 PM. Write the end-of-day report: attendance (attendance_summary), output today vs plan and vs the 7-day average (production_summary), quality (quality_summary today), orders completed or delayed (orders_status). End with what to prioritise tomorrow. At most 9 bullets." },
  weekly: { title: "Weekly comparison - production, quality and labour productivity", skipSunday: false,
    prompt: "It is Saturday evening. Compare this week with last week: production_summary and quality_summary for this_week vs last_week, output per present person-day, attendance. Explain the biggest changes with what the data supports and give three actions for next week. At most 9 bullets." },
  monthly: { title: "Monthly revenue, expenses and order profitability", skipSunday: false, financial: true,
    prompt: "It is month-end. Prepare the monthly report: finance_summary and order_profitability for this_month (revenue, expenses by category, profit or loss, receivables), loss-making orders and customers, plus commission_summary. At most 10 bullets, then three recommendations." },
};

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  const kind = String(req.query?.kind || "");
  const job = JOBS[kind];
  if (!job) return res.status(400).json({ error: `kind must be one of ${Object.keys(JOBS).join(", ")}` });
  const sb = serviceClient();
  if (!sb) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." });
  const today = todayIST();
  if (job.skipSunday && isSunday(today)) return res.status(200).json({ skipped: "Sunday" });
  if (kind === "monthly" && addDays(today, 1).slice(8) !== "01") return res.status(200).json({ skipped: "not the last day of the month" });
  try {
    const ctx = { sb, role: job.financial ? "admin" : "pm", svc: true }; // only the monthly report may read money data
    const { text, used } = await runAgent(ctx, { agent: "management", messages: [{ role: "user", content: job.prompt }] });
    let attachments = null;
    if (kind === "evening") attachments = await daily_factory_report(ctx, { date: today });
    const { data: row, error } = await sb.from("ai_reports").insert({ kind, title: `${job.title} - ${today}`, body: text, data: attachments, report_date: today, audience: job.financial ? "admin" : "managers" }).select("id").single();
    if (error) throw new Error(`Saving the report failed (run migration_43.sql?): ${error.message}`);
    let sent = 0;
    try { for (const r of await reportRecipients(sb, job.financial)) { await sendWhatsApp(r.phone, `*${job.title}*\n\n${text}`); sent += 1; } } catch (e) { console.error("whatsapp push failed", e); }
    return res.status(200).json({ ok: true, id: row.id, tools: used, whatsapp_sent: sent });
  } catch (e) {
    return res.status(e.status || 500).json({ error: String(e.message || e) });
  }
}
