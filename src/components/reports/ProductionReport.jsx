import ReportView from "../ReportView";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, sumSizes, itemsQty } from "./common";
import { dateList, shortDate } from "../../lib/analytics";

// 3. Production: daily output, cutting efficiency, targets, worker productivity, order progress
export default function ProductionReport() {
  const { range, controls } = useRange("last_30");
  const state = useData(async () => {
    const [progress, cuts, orders, ops, emps] = await Promise.all([
      fetchAll(() => supabase.from("order_progress").select("order_id, date, quantity").gte("date", range.from).lte("date", range.to).order("order_id").order("date")),
      fetchAll(() => supabase.from("cutting_entries").select("id, order_id, cut_date, sizes, completed_sizes, status, fabric_kg_used, fabric_meters_used").gte("cut_date", range.from).lte("cut_date", range.to).order("id")),
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, items, daily_target, due_date, status").order("id")),
      safeAll(() => supabase.from("operation_output").select("employee_id, work_date, quantity").gte("work_date", range.from).lte("work_date", range.to).order("employee_id")),
      fetchAll(() => supabase.from("employees").select("id, name").order("id")),
    ]);
    // all-time cut vs stitched for the orders still open
    const open = orders.filter((o) => !["Completed", "Shipped"].includes(o.status)).slice(0, 40);
    const summaries = await Promise.all(open.map((o) => supabase.rpc("order_count_summary", { p_order_id: o.id }).then((r) => [o.id, r.data || { cut: 0, stitched: 0 }])));
    return { progress, cuts, orders, ops, emps, summaries: Object.fromEntries(summaries) };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const ordById = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        const nameOf = Object.fromEntries(d.emps.map((e) => [e.id, e.name]));
        const stitched = sum(d.progress, (p) => p.quantity);
        const days = dateList(range.from, range.to);
        const byDay = groupBy(d.progress, (p) => p.date);
        const workingDays = Object.keys(byDay).filter((k) => sum(byDay[k], (p) => p.quantity) > 0).length;
        const approved = d.cuts.filter((c) => c.status === "Approved");
        const cutPieces = sum(approved, (c) => sumSizes(c.sizes));
        const withDone = approved.filter((c) => sumSizes(c.completed_sizes) > 0);
        const cutEff = pct(sum(withDone, (c) => sumSizes(c.completed_sizes)), sum(withDone, (c) => sumSizes(c.sizes)));
        const approvalRate = pct(approved.length, d.cuts.filter((c) => c.status !== "Submitted").length);
        const kgPerPiece = cutPieces ? sum(approved, (c) => c.fabric_kg_used) / cutPieces : null;
        const dailySeries = days.map((x) => sum(byDay[x] || [], (p) => p.quantity));
        const byOrder = groupBy(d.progress, (p) => p.order_id);

        const targetRows = Object.entries(byOrder).map(([oid, ps]) => {
          const o = ordById[oid]; if (!o) return null;
          const produced = sum(ps, (p) => p.quantity);
          const wd = new Set(ps.filter((p) => Number(p.quantity) > 0).map((p) => p.date)).size;
          const target = Number(o.daily_target || 0) * wd;
          return [o.order_number, o.customer_name, produced, wd, Number(o.daily_target || 0), target, target ? (produced / target) * 100 : null];
        }).filter(Boolean).sort((a, b) => b[2] - a[2]);

        const progressRows = d.orders.filter((o) => d.summaries[o.id]).map((o) => {
          const s = d.summaries[o.id]; const qty = itemsQty(o.items);
          return [o.order_number, o.customer_name, qty, Number(s.cut), Number(s.stitched), qty ? (Number(s.stitched) / qty) * 100 : null, o.due_date || "—"];
        }).sort((a, b) => (b[5] ?? 0) - (a[5] ?? 0));

        const byEmp = groupBy(d.ops, (r) => r.employee_id);
        const workers = Object.entries(byEmp).map(([id, rs]) => {
          const total = sum(rs, (r) => r.quantity); const wd = new Set(rs.map((r) => r.work_date)).size;
          return { name: nameOf[id] || "—", total, wd, perDay: wd ? total / wd : 0 };
        }).sort((a, b) => b.total - a.total);

        return (
          <ReportView
            title="Production report"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="production-report"
            controls={controls}
            kpis={[
              { label: "Pieces stitched", value: Math.round(stitched).toLocaleString("en-IN"), tone: "good" },
              { label: "Average per working day", value: workingDays ? Math.round(stitched / workingDays).toLocaleString("en-IN") : "—", sub: `${workingDays} working day(s)` },
              { label: "Pieces cut (approved)", value: Math.round(cutPieces).toLocaleString("en-IN") },
              { label: "Cutting efficiency", value: cutEff === null ? "—" : `${round1(cutEff)}%`, sub: "stitched ÷ cut, where logged" },
              { label: "Cutting approval rate", value: approvalRate === null ? "—" : `${round1(approvalRate)}%` },
              { label: "Fabric per piece cut", value: kgPerPiece === null ? "—" : `${Math.round(kgPerPiece * 1000) / 1000} kg` },
              { label: "Orders worked", value: String(Object.keys(byOrder).length) },
              { label: "Operators logged", value: String(workers.length) },
            ]}
            charts={[
              { type: "line", title: "Daily output (pieces)", labels: days.map(shortDate), series: [{ name: "Pieces", values: dailySeries }], format: (n) => String(Math.round(n)) },
              ...(targetRows.length ? [{ type: "hbar", title: "Output by order (pieces)", labels: targetRows.slice(0, 12).map((r) => r[0]), series: [{ name: "Pieces", values: targetRows.slice(0, 12).map((r) => Math.round(r[2])) }] }] : []),
              ...(workers.length ? [{ type: "hbar", title: "Top operators (pieces)", labels: workers.slice(0, 12).map((w) => w.name), series: [{ name: "Pieces", values: workers.slice(0, 12).map((w) => Math.round(w.total)) }] }] : []),
            ]}
            tables={[
              { heading: "Production targets", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Produced", type: "int" }, { label: "Days", type: "int" }, { label: "Daily target", type: "int" }, { label: "Target for those days", type: "int" }, { label: "Achievement", type: "pct" }], rows: targetRows },
              { heading: "Order progress (open orders, all time)", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Ordered", type: "int" }, { label: "Cut", type: "int" }, { label: "Stitched", type: "int" }, { label: "Complete", type: "pct" }, { label: "Due" }], rows: progressRows },
              { heading: "Worker productivity (operation log)", columns: [{ label: "Operator" }, { label: "Pieces", type: "int" }, { label: "Days", type: "int" }, { label: "Pieces / day", type: "int" }], rows: workers.map((w) => [w.name, w.total, w.wd, w.perDay]) },
            ]}
            footnote="Cutting efficiency compares pieces logged as stitched against pieces cut, for approved cutting entries where stitching completion was entered. Worker productivity comes from the Output module's operation log."
          />
        );
      }}
    </ReportShell>
  );
}
