// Shared helpers for the AI Factory Manager (server side).
export const IST = "Asia/Kolkata";
export const todayIST = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: IST });
export const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const isSunday = (s) => new Date(`${s}T00:00:00Z`).getUTCDay() === 0;
export const nextWorkingDay = (s) => { let d = addDays(s, 1); while (isSunday(d)) d = addDays(d, 1); return d; };
export const sum = (rows, f = (x) => x) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
export const round = (n, p = 0) => { const k = 10 ** p; return Math.round((Number(n) || 0) * k) / k; };
export const pctOf = (a, b) => (b ? round((a / b) * 100, 1) : null);
export const groupBy = (rows, f) => { const m = {}; for (const r of rows) (m[f(r)] = m[f(r)] || []).push(r); return m; };
export const sizesTotal = (sizes) => Object.values(sizes || {}).reduce((t, v) => t + (Number(v) || 0), 0);
export const itemsQty = (items) => (items || []).reduce((t, i) => t + (Number(i.quantity) || 0), 0);
export const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

// Indian financial year (April - March)
export const fyStart = (today) => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return m >= 4 ? y : y - 1; };
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");
export function quarterOf(today, back = 0) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const fy = fyStart(today);
  const fm = (m - 4 + 12) % 12;            // 0 = April
  let q = Math.floor(fm / 3) - back, yr = fy;
  while (q < 0) { q += 4; yr -= 1; }
  const startMonthIdx = q * 3;              // months since April
  const sm = ((startMonthIdx + 3) % 12) + 1, sy = yr + (startMonthIdx + 3 >= 12 ? 1 : 0);
  const em = ((startMonthIdx + 5) % 12) + 1, ey = yr + (startMonthIdx + 5 >= 12 ? 1 : 0);
  return { from: `${sy}-${pad(sm)}-01`, to: monthEnd(ey, em), label: `Q${q + 1} FY${yr}-${String(yr + 1).slice(2)}` };
}

// period names the model can use -> {from, to, label}
export function resolveRange(args = {}, today = todayIST(), dflt = "last_7_days") {
  if (args.from && args.to) return { from: args.from, to: args.to, label: `${args.from} to ${args.to}` };
  const p = args.period || dflt;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  switch (p) {
    case "today": return { from: today, to: today, label: "today" };
    case "yesterday": { const d = addDays(today, -1); return { from: d, to: d, label: "yesterday" }; }
    case "this_week": { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; return { from: addDays(today, -dow), to: today, label: "this week (Mon-today)" }; }
    case "last_week": { const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; const mon = addDays(today, -dow - 7); return { from: mon, to: addDays(mon, 5), label: "last week (Mon-Sat)" }; }
    case "last_30_days": return { from: addDays(today, -29), to: today, label: "last 30 days" };
    case "this_month": return { from: `${y}-${pad(m)}-01`, to: today, label: "this month so far" };
    case "last_month": { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm), label: "last month" }; }
    case "this_quarter": { const q = quarterOf(today); return { from: q.from, to: today < q.to ? today : q.to, label: q.label + " so far" }; }
    case "last_quarter": { const q = quarterOf(today, 1); return { ...q }; }
    case "this_fy": { const fy = fyStart(today); return { from: `${fy}-04-01`, to: today, label: `FY${fy}-${String(fy + 1).slice(2)} so far` }; }
    case "last_7_days": default: return { from: addDays(today, -6), to: today, label: "last 7 days" };
  }
}

const PAGE = 1000;
// read every row of a query (PostgREST caps a response at 1000 rows)
export async function fetchRows(sb, table, select, build, orderCol = "id") {
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(table).select(select);
    if (build) q = build(q);
    if (orderCol) q = q.order(orderCol);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
// same, but a table the caller cannot read gives []
export async function softRows(sb, ...a) { try { return await fetchRows(sb, ...a); } catch { return []; } }
