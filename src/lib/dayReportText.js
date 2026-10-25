// Turns the stored day-report data into WhatsApp-ready text (WhatsApp *bold* markers).
const ddmmyyyy = (iso) => { const [y, m, d] = String(iso || "").split("-"); return d ? `${d}/${m}/${y}` : iso; };
const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const sum = (list, f) => list.reduce((t, x) => t + n(f(x)), 0);

export function cuttingTotals(data) {
  const rows = data?.cutting || [];
  const pcs = sum(rows, (c) => sum(Object.values(c.sizes || {}), (v) => v));
  return { pcs, meters: r2(sum(rows, (c) => c.meters)), kg: r2(sum(rows, (c) => c.kg)) };
}

export function productionText(data) {
  if (!data) return "";
  const a = data.attendance || {};
  const op = a.operators || {}, st = a.staff || {};
  const lines = [`📊 *PRODUCTION REPORT – ${ddmmyyyy(data.date)}*`, "", "👥 *Attendance*"];
  lines.push(`Operators: ${n(op.present)}/${n(op.total)} present`);
  lines.push(`Staff: ${n(st.present)}/${n(st.total)} present`);
  lines.push(`Total present: ${n(op.present) + n(st.present)}`);
  if ((op.absent || []).length) lines.push(`Absent (operators): ${op.absent.join(", ")}`);
  if ((st.absent || []).length) lines.push(`Absent (staff): ${st.absent.join(", ")}`);
  lines.push("", "🎯 *Output*");
  const teams = data.teams || [];
  if (!teams.length && !(data.unplanned || []).length) lines.push("No production logged today.");
  teams.forEach((t) => {
    lines.push(`${t.team_lead || "No Team Lead"} – ${t.order_number}${t.customer_name ? ` (${t.customer_name})` : ""}${t.item ? ` – ${t.item}` : ""}: ${n(t.output)}${n(t.target) ? ` / target ${n(t.target)}` : ""}`);
  });
  (data.unplanned || []).forEach((u) => lines.push(`Not in today's plan – ${u.order_number}${u.customer_name ? ` (${u.customer_name})` : ""} – ${u.item}: ${n(u.output)}`));
  lines.push(`*Total output: ${n(data.total_output)}*`);
  const ct = cuttingTotals(data);
  if (ct.pcs) lines.push("", `✂️ Cutting today: ${ct.pcs} pcs (see cutting report)`);
  lines.push("", "– T&P Textiles");
  return lines.join("\n");
}

export function cuttingText(data, sizeLabel = (k) => k) {
  if (!data) return "";
  const lines = [`✂️ *CUTTING REPORT – ${ddmmyyyy(data.date)}*`];
  const rows = data.cutting || [];
  if (!rows.length) lines.push("", "No cutting was logged today.");
  rows.forEach((c) => {
    const total = sum(Object.values(c.sizes || {}), (v) => v);
    lines.push("", c.by ? `*${c.by}*` : "", `${c.item}${c.order_number ? ` (${c.order_number}${c.customer_name ? ` – ${c.customer_name}` : ""})` : ""}`.trim());
    Object.entries(c.sizes || {}).filter(([, v]) => n(v) > 0).forEach(([k, v]) => lines.push(`${sizeLabel(k)} – ${n(v)}`));
    const fab = [n(c.meters) ? `${r2(c.meters)} m` : "", n(c.kg) ? `${r2(c.kg)} kg` : ""].filter(Boolean).join(" / ");
    lines.push(`Total: ${total} pcs${fab ? ` | Fabric: ${fab}` : ""}${c.status === "Submitted" ? " (awaiting approval)" : ""}`);
  });
  if (rows.length) {
    const t = cuttingTotals(data);
    lines.push("", `*Day total: ${t.pcs} pcs${t.meters ? ` | ${t.meters} m` : ""}${t.kg ? ` | ${t.kg} kg` : ""}*`);
  }
  lines.push("", "– T&P Textiles");
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export function salesText(data) {
  if (!data) return "";
  const s = data.sales || {};
  const acts = s.activities || [];
  const visits = acts.filter((x) => ["Visit", "Meeting"].includes(x.kind));
  const others = acts.filter((x) => !["Visit", "Meeting"].includes(x.kind));
  const cv = s.customer_visits || [];
  const lines = [`📈 *SALES REPORT – ${ddmmyyyy(data.date)}*`, "", `🚶 *Visits: ${visits.length + cv.length}*`];
  visits.forEach((v, i) => lines.push(`${i + 1}. ${v.company}${v.location ? ` – ${v.location}` : ""}${v.by ? ` (${v.by})` : ""}${v.response ? ` – ${v.response}` : ""}`));
  cv.forEach((v, i) => lines.push(`${visits.length + i + 1}. ${v.customer}${v.by ? ` (${v.by})` : ""}${v.notes ? ` – ${v.notes}` : ""}`));
  if (!visits.length && !cv.length) lines.push("No visits logged.");
  if (others.length) {
    lines.push("", `📞 *Calls / follow-ups: ${others.length}*`);
    others.forEach((v) => lines.push(`• ${v.kind} – ${v.company}${v.by ? ` (${v.by})` : ""}`));
  }
  const nl = s.new_leads || [];
  lines.push("", `🧲 *New leads: ${nl.length}*`);
  nl.forEach((l, i) => lines.push(`${i + 1}. ${l.company}${l.type ? ` (${l.type})` : ""}${l.by ? ` – ${l.by}` : ""}`));
  lines.push("", `📌 Follow-ups due today: ${n(s.followups_due)}`, "", "– T&P Textiles");
  return lines.join("\n");
}
