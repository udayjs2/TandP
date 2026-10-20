import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, monthsBetween, monthLabel, sumSizes } from "./common";
import { daysBetween } from "../../lib/analytics";
import { todayStr } from "../../lib/helpers";

const BUCKETS = [["0-30 days", 0, 30], ["31-60 days", 31, 60], ["61-90 days", 61, 90], ["Over 90 days", 91, 99999]];

// Phase 2 KPI dashboard: employee productivity, quality defects, fabric wastage, inventory ageing, lead conversion, commission
export default function KpiDashboard({ profile }) {
  const { range, controls } = useRange("last_6m");
  const showCommission = ["admin", "gm", "pm"].includes(profile?.role);
  const state = useData(async () => {
    const [ops, att, emps, insp, cuts, fabrics, items, fabUse, matUse, leads, comm] = await Promise.all([
      safeAll(() => supabase.from("operation_output").select("employee_id, work_date, quantity").gte("work_date", range.from).lte("work_date", range.to).order("employee_id")),
      fetchAll(() => supabase.from("attendance").select("employee_id, date, status").gte("date", range.from).lte("date", range.to).order("employee_id").order("date")),
      fetchAll(() => supabase.from("employees").select("id, name, role").order("id")),
      fetchAll(() => supabase.from("quality_inspections").select("order_id, decision, checks, inspected_qty, defective_qty, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("created_at")),
      fetchAll(() => supabase.from("cutting_entries").select("cut_date, status, sizes, fabric_kg_used").gte("cut_date", range.from).lte("cut_date", range.to).order("id")),
      fetchAll(() => supabase.from("inventory_fabric").select("*").order("id")),
      fetchAll(() => supabase.from("inventory_items").select("*").order("id")),
      safeAll(() => supabase.from("fabric_usage").select("fabric_id, created_at, restored").order("created_at")),
      safeAll(() => supabase.from("order_material_usage").select("item_id, used_on, returned").order("used_on")),
      safeAll(() => supabase.from("sales_leads").select("id, status, lead_source, salesperson_id, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("id")),
      showCommission ? safeAll(() => supabase.from("sales_commissions").select("salesperson_id, amount, status, created_at, order_value").order("created_at")) : Promise.resolve([]),
    ]);
    return { ops, att, emps, insp, cuts, fabrics, items, fabUse, matUse, leads, comm };
  }, JSON.stringify(range) + showCommission);

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const today = todayStr();
        const months = monthsBetween(range.from, range.to);
        const nameOf = Object.fromEntries(d.emps.map((e) => [e.id, e.name]));
        const mOf = (dt) => (dt || "").slice(0, 7);

        // ---- employee productivity: pieces per present day
        const presentDays = {};
        d.att.forEach((a) => { if (a.status === "Present" || a.status === "Half Day") presentDays[a.employee_id] = (presentDays[a.employee_id] || 0) + (a.status === "Half Day" ? 0.5 : 1); });
        const outBy = groupBy(d.ops, (o) => o.employee_id);
        const prod = Object.entries(outBy).map(([id, rs]) => {
          const total = sum(rs, (r) => r.quantity);
          return { name: nameOf[id] || "—", total, days: presentDays[id] || 0, perDay: presentDays[id] ? total / presentDays[id] : 0 };
        }).sort((a, b) => b.perDay - a.perDay);
        const teamPerDay = months.map((mk) => {
          const out = sum(d.ops.filter((o) => mOf(o.work_date) === mk), (o) => o.quantity);
          const days = new Set(d.ops.filter((o) => mOf(o.work_date) === mk).map((o) => `${o.employee_id}|${o.work_date}`)).size;
          return days ? out / days : 0;
        });
        const avgPerDay = prod.length ? sum(prod, (p) => p.perDay) / prod.length : 0;

        // ---- quality defects
        const defRate = months.map((mk) => { const is = d.insp.filter((i) => mOf(i.created_at) === mk); return pct(sum(is, (i) => i.defective_qty), sum(is, (i) => i.inspected_qty)) || 0; });
        const totDef = sum(d.insp, (i) => i.defective_qty), totIns = sum(d.insp, (i) => i.inspected_qty);
        const fails = {};
        d.insp.forEach((i) => (i.checks || []).forEach((c) => { if (c.result === "Fail") fails[c.label || c.key] = (fails[c.label || c.key] || 0) + 1; }));
        const failRows = Object.entries(fails).sort((a, b) => b[1] - a[1]);

        // ---- fabric wastage (fabric logged against rejected cutting) and fabric per piece
        const wasteKg = months.map((mk) => sum(d.cuts.filter((c) => mOf(c.cut_date) === mk && c.status === "Rejected"), (c) => c.fabric_kg_used));
        const usedKg = months.map((mk) => sum(d.cuts.filter((c) => mOf(c.cut_date) === mk && c.status !== "Rejected"), (c) => c.fabric_kg_used) + wasteKg[months.indexOf(mk)]);
        const wastePct = wasteKg.map((w, i) => (usedKg[i] ? (w / usedKg[i]) * 100 : 0));
        const totWaste = sum(wasteKg, (x) => x), totUsed = sum(usedKg, (x) => x);

        // ---- inventory ageing: days since last movement (use / issue) or since it was added
        const lastUse = {};
        d.fabUse.filter((u) => !u.restored).forEach((u) => { const k = (u.created_at || "").slice(0, 10); if (k > (lastUse[u.fabric_id] || "")) lastUse[u.fabric_id] = k; });
        const lastIssue = {};
        d.matUse.filter((u) => !u.returned).forEach((u) => { if (u.used_on > (lastIssue[u.item_id] || "")) lastIssue[u.item_id] = u.used_on; });
        const aged = [
          ...d.fabrics.filter((f) => Number(f.stock_kg) > 0 || Number(f.stock_meters) > 0).map((f) => {
            const last = lastUse[f.id] || (f.created_at || "").slice(0, 10) || today;
            return { name: `${f.fabric_type}${f.color ? ` - ${f.color}` : ""}`, kind: "Fabric", stock: `${Number(f.stock_kg || 0)} kg / ${Number(f.stock_meters || 0)} m`, value: Number(f.stock_kg || 0) * Number(f.price_per_kg || 0) + Number(f.stock_meters || 0) * Number(f.price_per_meter || 0), last, age: daysBetween(last, today) };
          }),
          ...d.items.filter((i) => Number(i.quantity) > 0).map((i) => {
            const last = lastIssue[i.id] || (i.created_at || "").slice(0, 10) || today;
            return { name: i.name, kind: i.category, stock: `${Number(i.quantity)} ${i.unit || ""}`, value: Number(i.quantity) * Number(i.unit_price || 0), last, age: daysBetween(last, today) };
          }),
        ];
        const bucketVal = BUCKETS.map(([, lo, hi]) => sum(aged.filter((a) => a.age >= lo && a.age <= hi), (a) => a.value));
        const bucketN = BUCKETS.map(([, lo, hi]) => aged.filter((a) => a.age >= lo && a.age <= hi).length);
        const slow = aged.filter((a) => a.age > 90).sort((a, b) => b.value - a.value);

        // ---- lead conversion
        const created = months.map((mk) => d.leads.filter((l) => mOf(l.created_at) === mk).length);
        const won = months.map((mk) => d.leads.filter((l) => mOf(l.created_at) === mk && l.status === "Won").length);
        const conv = created.map((c, i) => (c ? (won[i] / c) * 100 : 0));
        const bySource = Object.entries(groupBy(d.leads, (l) => l.lead_source || "Unknown")).map(([s, ls]) => [s, ls.length, ls.filter((l) => l.status === "Won").length, pct(ls.filter((l) => l.status === "Won").length, ls.length)]).sort((a, b) => b[1] - a[1]);

        // ---- commission
        const commBy = (st) => months.map((mk) => sum(d.comm.filter((c) => mOf(c.created_at) === mk && (!st || c.status === st)), (c) => c.amount));
        const commTot = sum(d.comm.filter((c) => c.created_at.slice(0, 10) >= range.from && c.created_at.slice(0, 10) <= range.to), (c) => c.amount);
        const commSp = Object.entries(groupBy(d.comm, (c) => c.salesperson_id)).map(([id, cs]) => [nameOf[id] || "—", cs.length, sum(cs, (c) => c.order_value), sum(cs, (c) => c.amount), sum(cs.filter((c) => c.status === "Paid"), (c) => c.amount)]).sort((a, b) => b[3] - a[3]);

        return (
          <ReportView
            title="KPI dashboard"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="kpi-dashboard"
            controls={controls}
            kpis={[
              { label: "Avg pieces / operator / day", value: prod.length ? String(Math.round(avgPerDay)) : "—", sub: `${prod.length} operator(s) logged` },
              { label: "Defect rate", value: totIns ? `${round1(pct(totDef, totIns))}%` : "—", tone: totIns && pct(totDef, totIns) > 5 ? "bad" : "good", sub: `${Math.round(totDef)} of ${Math.round(totIns)} pcs` },
              { label: "Fabric wastage", value: `${round1(totWaste)} kg`, sub: totUsed ? `${round1((totWaste / totUsed) * 100)}% of fabric cut` : undefined, tone: totWaste ? "warn" : "good" },
              { label: "Stock over 90 days", value: fmtMoney(bucketVal[3]), tone: bucketVal[3] ? "warn" : "good", sub: `${bucketN[3]} line(s)` },
              { label: "Lead conversion", value: d.leads.length ? `${round1(pct(sum(won, (x) => x), d.leads.length))}%` : "—", sub: `${sum(won, (x) => x)} of ${d.leads.length} leads` },
              ...(showCommission ? [{ label: "Commission earned", value: fmtMoney(commTot), sub: `${fmtMoney(sum(d.comm.filter((c) => c.status === "Paid"), (c) => c.amount))} paid in total` }] : []),
            ]}
            charts={[
              { type: "line", title: "Team output per operator-day (pieces)", labels: months.map(monthLabel), series: [{ name: "Pieces / day", values: teamPerDay.map((v) => Math.round(v * 10) / 10) }], format: (n) => String(Math.round(n)) },
              { type: "line", title: "Defect rate by month (%)", labels: months.map(monthLabel), series: [{ name: "Defect %", values: defRate.map(round1) }], format: (n) => `${Math.round(n * 10) / 10}%` },
              { type: "bar", title: "Fabric in rejected cutting (kg)", labels: months.map(monthLabel), series: [{ name: "Wastage kg", values: wasteKg.map(round1) }], format: (n) => String(Math.round(n * 10) / 10) },
              { type: "bar", title: "Inventory ageing — stock value (₹)", labels: BUCKETS.map((b) => b[0]), series: [{ name: "Value", values: bucketVal.map(Math.round) }], format: (n) => fmtMoney(n) },
              { type: "bar", title: "Leads created vs won", labels: months.map(monthLabel), series: [{ name: "Created", values: created, color: "#6366f1" }, { name: "Won", values: won, color: "#059669" }], format: (n) => String(Math.round(n)) },
              ...(showCommission ? [{ type: "bar", title: "Commission by month (₹)", labels: months.map(monthLabel), series: [{ name: "Earned", values: commBy().map(Math.round), color: "#4338ca" }, { name: "Paid", values: commBy("Paid").map(Math.round), color: "#059669" }], format: (n) => fmtMoney(n) }] : []),
            ]}
            tables={[
              { heading: "Employee productivity (ranked)", columns: [{ label: "Operator" }, { label: "Pieces", type: "int" }, { label: "Days present", type: "num" }, { label: "Pieces / day", type: "int" }], rows: prod.map((p) => [p.name, p.total, p.days, p.perDay]) },
              { heading: "Quality: most common failed checks", columns: [{ label: "Check" }, { label: "Failures", type: "int" }], rows: failRows },
              { heading: "Fabric wastage by month", columns: [{ label: "Month" }, { label: "Fabric cut (kg)", type: "num" }, { label: "In rejected entries (kg)", type: "num" }, { label: "Share", type: "pct" }], rows: months.map((mk, i) => [monthLabel(mk), usedKg[i], wasteKg[i], wastePct[i]]) },
              { heading: "Inventory ageing buckets", columns: [{ label: "Days since last movement" }, { label: "Lines", type: "int" }, { label: "Value", type: "money" }], rows: BUCKETS.map((b, i) => [b[0], bucketN[i], bucketVal[i]]) },
              { heading: "Slow-moving stock (over 90 days)", columns: [{ label: "Item" }, { label: "Type" }, { label: "In stock" }, { label: "Last movement" }, { label: "Days", type: "int" }, { label: "Value", type: "money" }], rows: slow.map((a) => [a.name, a.kind, a.stock, a.last, a.age, a.value]) },
              { heading: "Lead conversion by source", columns: [{ label: "Source" }, { label: "Leads", type: "int" }, { label: "Won", type: "int" }, { label: "Conversion", type: "pct" }], rows: bySource },
              ...(showCommission ? [{ heading: "Commission by salesperson", columns: [{ label: "Salesperson" }, { label: "Orders", type: "int" }, { label: "Order value", type: "money" }, { label: "Commission", type: "money" }, { label: "Paid", type: "money" }], rows: commSp }] : []),
            ]}
            footnote="Productivity = pieces from the operation log ÷ days present. Wastage = fabric logged on rejected cutting entries. Ageing = days since the item was last used in cutting / issued to an order (or since it was added if never used)."
          />
        );
      }}
    </ReportShell>
  );
}
