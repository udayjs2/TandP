// The AI Factory Manager: a Claude tool-use loop over the read-only factory tools.
import * as F from "./factory.js";
import { todayIST } from "./util.js";

const PERIODS = ["today", "yesterday", "this_week", "last_week", "last_7_days", "last_30_days", "this_month", "last_month", "this_quarter", "last_quarter", "this_fy"];
const range = { period: { type: "string", enum: PERIODS, description: "Named period (Indian financial year, April-March). Omit to use the tool's default." }, from: { type: "string", description: "YYYY-MM-DD start (use with `to` for a custom range)" }, to: { type: "string", description: "YYYY-MM-DD end" } };

const TOOLS = {
  attendance_summary: { fn: F.attendance_summary, roles: ["admin", "gm", "pm"], description: "Employees present, absent, on leave and not marked for a day, attendance %, department-wise availability and names of absentees.", input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD; defaults to today" } } } },
  production_summary: { fn: F.production_summary, roles: ["admin", "gm", "pm"], description: "Stitching and cutting output by day, by order and by operation, output per present employee, plan vs actual, and team-line (per Team Lead) productivity with below-par flags.", input_schema: { type: "object", properties: range } },
  orders_status: { fn: F.orders_status, roles: ["admin", "gm", "pm"], description: "Orders by status, delayed orders with days late, orders due within 7 days, in-progress orders with pieces remaining, and orders completed today.", input_schema: { type: "object", properties: {} } },
  quality_summary: { fn: F.quality_summary, roles: ["admin", "gm", "pm"], description: "Inspections, rejected/approved pieces, defect rate, rework, top failed checks and defect rate by order.", input_schema: { type: "object", properties: range } },
  cutting_summary: { fn: F.cutting_summary, roles: ["admin", "gm", "pm"], description: "Cutting output, entries awaiting review, fabric used and fabric wasted in rejected cuts.", input_schema: { type: "object", properties: range } },
  inventory_status: { fn: F.inventory_status, roles: ["admin", "gm", "pm"], description: "Fabric stock, accessories running low, and finished pieces awaiting dispatch.", input_schema: { type: "object", properties: { low_threshold: { type: "number", description: "Quantity at or below which an accessory counts as low (default 20)" } } } },
  fabric_required_tomorrow: { fn: F.fabric_required_tomorrow, roles: ["admin", "gm", "pm"], description: "Estimated fabric (kg) needed for the next working day's planned production, per order, compared with stock.", input_schema: { type: "object", properties: {} } },
  finance_summary: { fn: F.finance_summary, roles: ["admin"], description: "Revenue invoiced, expenses by category, payments received, outstanding receivables and profit or loss for a period, with a monthly split.", input_schema: { type: "object", properties: range } },
  order_profitability: { fn: F.order_profitability, roles: ["admin"], description: "Per-order revenue vs actual cost and profit for orders invoiced in the period, loss-making orders and customers, and outstanding amounts.", input_schema: { type: "object", properties: { ...range, limit: { type: "number", description: "Max orders to cost (default 40)" } } } },
  sales_summary: { fn: F.sales_summary, roles: ["admin"], description: "Leads by status, conversion, open pipeline value, overdue follow-ups, per-salesperson leads and confirmed order value.", input_schema: { type: "object", properties: range } },
  commission_summary: { fn: F.commission_summary, roles: ["admin"], description: "The commission rule, commission pending / approved / paid and payable per salesperson, and progress against the threshold.", input_schema: { type: "object", properties: {} } },
  query_table: { fn: F.query_table, roles: ["admin", "gm", "pm"], description: "Last resort: read rows from one table with simple filters when no summary tool answers the question.", input_schema: { type: "object", properties: { table: { type: "string" }, filters: { type: "array", items: { type: "object", properties: { column: { type: "string" }, op: { type: "string", enum: ["eq", "neq", "gt", "gte", "lt", "lte"] }, value: {} }, required: ["column", "op", "value"] } }, order_by: { type: "string" }, ascending: { type: "boolean" }, limit: { type: "number" } }, required: ["table"] } },
};

// agent -> which tools it may use (the Management agent can use everything its role allows)
export const AGENTS = {
  management: { label: "Management Agent", tools: Object.keys(TOOLS), focus: "You combine information from every department and give recommendations." },
  production: { label: "Production Agent", tools: ["production_summary", "orders_status", "attendance_summary", "fabric_required_tomorrow", "query_table"], focus: "You track daily output, targets, pending work and productivity." },
  hr: { label: "HR & Attendance Agent", tools: ["attendance_summary", "query_table"], focus: "You track attendance, leave, employee availability and who is working on what." },
  cutting: { label: "Cutting Agent", tools: ["cutting_summary", "fabric_required_tomorrow", "inventory_status", "query_table"], focus: "You track fabric issued, cutting output, wastage and pending bundles." },
  quality: { label: "Quality Agent", tools: ["quality_summary", "orders_status", "query_table"], focus: "You track rejected pieces, rework, defects and quality performance." },
  inventory: { label: "Inventory Agent", tools: ["inventory_status", "fabric_required_tomorrow", "query_table"], focus: "You track fabric, accessories, finished garments and stock shortages." },
  finance: { label: "Finance Agent", tools: ["finance_summary", "order_profitability", "query_table"], focus: "You calculate order costs, revenue, expenses and profit or loss." },
  sales: { label: "Sales Agent", tools: ["sales_summary", "commission_summary", "query_table"], focus: "You track leads, customer follow-ups, confirmed orders and salesperson commissions." },
};

export function toolsFor(role, agent = "management") {
  const a = AGENTS[agent] || AGENTS.management;
  return a.tools.filter((n) => TOOLS[n].roles.includes(role));
}

export function systemPrompt(agent, role) {
  const a = AGENTS[agent] || AGENTS.management;
  return `You are the AI Factory Manager's ${a.label} for T&P Textiles, a girls' and women's wear garment factory in Chinthavaram, Andhra Pradesh. ${a.focus}
Today is ${todayIST()} (India time). The user's role is "${role}".

Rules:
- Answer ONLY from data returned by your tools. Never invent or estimate numbers that no tool returned. If a tool errors or the data is not tracked (for example machine availability, offcut wastage, finishing-stage output), say so plainly.
- Call the tools you need before answering; call several in one go when the question spans areas. Use a tool again with a different period when you need a comparison (for example "why did production fall this week" means: production_summary for this week and last week, attendance_summary for the days involved, orders_status, inventory_status and quality_summary, then state the likely reasons the data supports).
- Amounts are in rupees: write ₹1,25,000 style. Dates like 21 Oct 2026. Pieces are whole numbers.
- Style: lead with the direct answer in one sentence, then at most 6 short bullet points (start each with "- "). No tables, no headings, no emojis. Finish with one concrete recommendation when it helps.
- If the question is outside your tools or your role cannot see that data, say what you cannot see and suggest who can.`;
}

async function callClaude({ system, messages, tools, maxTokens = 1400 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error("ANTHROPIC_API_KEY is not set on the server."); e.status = 503; throw e; }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages, ...(tools.length ? { tools } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j?.error?.message || `Anthropic API error ${res.status}`); e.status = res.status === 401 ? 502 : 502; throw e; }
  return j;
}

// messages: [{role: "user"|"assistant", content: string}, ...]  ->  { text, used: [toolName...] }
export async function runAgent(ctx, { agent = "management", messages, extraSystem = "" }) {
  const allowed = toolsFor(ctx.role, agent);
  const tools = allowed.map((n) => ({ name: n, description: TOOLS[n].description, input_schema: TOOLS[n].input_schema }));
  const convo = messages.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const used = [];
  const system = systemPrompt(agent, ctx.role) + (extraSystem ? `\n\n${extraSystem}` : "");
  for (let step = 0; step < 7; step++) {
    const r = await callClaude({ system, messages: convo, tools });
    const calls = (r.content || []).filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !calls.length) {
      return { text: (r.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || "I could not produce an answer.", used: [...new Set(used)] };
    }
    convo.push({ role: "assistant", content: r.content });
    const results = [];
    for (const c of calls) {
      used.push(c.name);
      let out;
      if (!allowed.includes(c.name)) out = { error: "That tool is not available to you." };
      else { try { out = await TOOLS[c.name].fn(ctx, c.input || {}); } catch (e) { out = { error: String(e.message || e) }; } }
      let content = JSON.stringify(out);
      if (content.length > 24000) content = content.slice(0, 24000) + '…[truncated]';
      results.push({ type: "tool_result", tool_use_id: c.id, content });
    }
    convo.push({ role: "user", content: results });
  }
  return { text: "That question needed more steps than I allow. Try asking about one area at a time.", used: [...new Set(used)] };
}

export { TOOLS };
