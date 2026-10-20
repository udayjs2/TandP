import ReportView from "../ReportView";
import { fmtMoney, todayStr, LEAD_STATUSES } from "../../lib/helpers";
import { supabase, useRange, useData, ReportShell, sum, round1, pct, groupBy, safeAll, fetchAll } from "./common";

// 2. Sales & CRM: leads, conversion, salesperson performance, customer orders, revenue and commissions
export default function SalesReport() {
  const { range, controls } = useRange("this_quarter");
  const state = useData(async () => {
    const [leads, activities, emps, tracking] = await Promise.all([
      safeAll(() => supabase.from("sales_leads").select("id, status, salesperson_id, estimated_value, quotation_value, created_at, next_followup_date, lead_type").order("id")),
      safeAll(() => supabase.from("lead_activities").select("id, lead_id, kind, activity_date").gte("activity_date", range.from).lte("activity_date", range.to).order("id")),
      fetchAll(() => supabase.from("employees").select("id, name").order("id")),
      supabase.rpc("sales_order_tracking").then((r) => r.data || []),
    ]);
    return { leads, activities, emps, tracking };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const today = todayStr();
        const name = Object.fromEntries(d.emps.map((e) => [e.id, e.name]));
        const created = d.leads.filter((l) => l.created_at.slice(0, 10) >= range.from && l.created_at.slice(0, 10) <= range.to);
        const won = created.filter((l) => l.status === "Won");
        const lost = created.filter((l) => l.status === "Lost");
        const orders = d.tracking.filter((o) => o.order_date && o.order_date >= range.from && o.order_date <= range.to);
        const revenue = sum(orders, (o) => o.order_value);
        const commission = sum(orders, (o) => o.commission_amount);
        const overdue = d.leads.filter((l) => !["Won", "Lost"].includes(l.status) && l.next_followup_date && l.next_followup_date < today).length;
        const funnel = LEAD_STATUSES.map((s) => created.filter((l) => l.status === s).length);
        const spIds = [...new Set([...created.map((l) => l.salesperson_id), ...orders.map((o) => o.salesperson_id)].filter(Boolean))];
        const perSp = spIds.map((id) => {
          const ls = created.filter((l) => l.salesperson_id === id);
          const os = orders.filter((o) => o.salesperson_id === id);
          const w = ls.filter((l) => l.status === "Won").length;
          return {
            id, name: name[id] || "—", leads: ls.length, won: w, lost: ls.filter((l) => l.status === "Lost").length,
            conv: pct(w, ls.length), pipeline: sum(ls.filter((l) => !["Won", "Lost"].includes(l.status)), (l) => l.quotation_value || l.estimated_value),
            orders: os.length, value: sum(os, (o) => o.order_value), commission: sum(os, (o) => o.commission_amount),
            visits: d.activities.filter((a) => a.kind === "Visit" && ls.some((l) => l.id === a.lead_id)).length,
          };
        }).sort((a, b) => b.value - a.value);
        const byCust = groupBy(orders, (o) => o.customer_name);
        const custRows = Object.entries(byCust).map(([c, os]) => [c, os.length, sum(os, (o) => o.order_value), sum(os.filter((o) => ["Completed", "Shipped"].includes(o.status)), (o) => o.order_value)]).sort((a, b) => b[2] - a[2]);
        const byType = groupBy(created, (l) => l.lead_type || "Other");
        return (
          <ReportView
            title="Sales & CRM report"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="sales-crm-report"
            controls={controls}
            kpis={[
              { label: "Leads created", value: String(created.length) },
              { label: "Leads won", value: String(won.length), tone: "good", sub: `${lost.length} lost` },
              { label: "Conversion rate", value: created.length ? `${round1(pct(won.length, created.length))}%` : "—" },
              { label: "Overdue follow-ups", value: String(overdue), tone: overdue ? "bad" : "good" },
              { label: "Orders confirmed", value: String(orders.length) },
              { label: "Order value", value: fmtMoney(revenue), tone: "good" },
              { label: "Commission earned", value: fmtMoney(commission) },
              { label: "Visits logged", value: String(d.activities.filter((a) => a.kind === "Visit").length) },
            ]}
            charts={[
              { type: "bar", title: "Lead funnel (leads created in period)", labels: LEAD_STATUSES, series: [{ name: "Leads", values: funnel }], format: (n) => String(Math.round(n)) },
              ...(perSp.length ? [{ type: "hbar", title: "Order value by salesperson (₹)", labels: perSp.map((s) => s.name), series: [{ name: "Order value", values: perSp.map((s) => Math.round(s.value)) }] }] : []),
              ...(Object.keys(byType).length ? [{ type: "pie", title: "Leads by customer type", labels: Object.keys(byType), series: [{ name: "Leads", values: Object.values(byType).map((v) => v.length) }], format: (n) => String(Math.round(n)) }] : []),
            ]}
            tables={[
              {
                heading: "Salesperson performance",
                columns: [{ label: "Salesperson" }, { label: "Leads", type: "int" }, { label: "Won", type: "int" }, { label: "Lost", type: "int" }, { label: "Conversion", type: "pct" }, { label: "Visits", type: "int" }, { label: "Open pipeline", type: "money" }, { label: "Orders", type: "int" }, { label: "Order value", type: "money" }, { label: "Commission", type: "money" }],
                rows: perSp.map((s) => [s.name, s.leads, s.won, s.lost, s.conv, s.visits, s.pipeline, s.orders, s.value, s.commission]),
              },
              { heading: "Customer orders", columns: [{ label: "Customer" }, { label: "Orders", type: "int" }, { label: "Order value", type: "money" }, { label: "Executed value", type: "money" }], rows: custRows },
            ]}
            footnote="Conversion rate = leads created in the period that are now Won. Order value is the agreed value of orders confirmed in the period (invoiced value where no value was entered)."
          />
        );
      }}
    </ReportShell>
  );
}
