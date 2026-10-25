import ReportView from "../ReportView";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, monthsBetween, monthLabel } from "./common";
import { daysBetween } from "../../lib/analytics";

// Phase 3: on-time delivery trend, lateness, lead time and causes of delay
export default function DeliveryPerformance() {
  const { range, controls } = useRange("last_12m");
  const state = useData(async () => {
    const [orders, deliveries, rcas] = await Promise.all([
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, due_date, order_date, status").order("id")),
      fetchAll(() => supabase.from("order_deliveries").select("order_id, date, quantity").order("date")),
      safeAll(() => supabase.from("order_delay_rca").select("order_id, causes, days_late").order("id")),
    ]);
    return { orders, deliveries, rcas };
  }, JSON.stringify(range));
  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const delBy = groupBy(d.deliveries, (x) => x.order_id);
        const lastDel = (id) => (delBy[id] || []).reduce((m, x) => (x.date > m ? x.date : m), "");
        const fin = d.orders
          .filter((o) => ["Completed", "Shipped", "Rejected by Customer"].includes(o.status) && o.due_date && lastDel(o.id) >= range.from && lastDel(o.id) <= range.to)
          .map((o) => { const done = lastDel(o.id); const late = daysBetween(o.due_date, done); return { o, done, late, onTime: late <= 0, lead: o.order_date ? daysBetween(o.order_date, done) : null }; });
        const onTime = fin.filter((x) => x.onTime);
        const lateOnes = fin.filter((x) => !x.onTime);
        const leads = fin.filter((x) => x.lead !== null && x.lead >= 0);
        const months = monthsBetween(range.from, range.to);
        const perMonth = months.map((mk) => {
          const xs = fin.filter((x) => x.done.startsWith(mk));
          return { mk, n: xs.length, rate: xs.length ? (xs.filter((x) => x.onTime).length / xs.length) * 100 : null, late: xs.length ? sum(xs.filter((x) => !x.onTime), (x) => x.late) / Math.max(1, xs.filter((x) => !x.onTime).length) : null };
        });
        const cust = Object.entries(groupBy(fin, (x) => x.o.customer_name)).map(([c, xs]) => {
          const l = xs.filter((x) => !x.onTime);
          return { c, n: xs.length, on: xs.length - l.length, rate: pct(xs.length - l.length, xs.length), avgLate: l.length ? sum(l, (x) => x.late) / l.length : 0 };
        }).sort((a, b) => a.rate - b.rate || b.n - a.n);
        const causes = {};
        const inScope = new Set(fin.map((x) => x.o.id));
        d.rcas.filter((r) => inScope.has(r.order_id)).forEach((r) => (r.causes || []).forEach((c) => { if (c.cause) causes[c.cause] = (causes[c.cause] || 0) + 1; }));
        const causeRows = Object.entries(causes).sort((a, b) => b[1] - a[1]);
        const rate = fin.length ? pct(onTime.length, fin.length) : null;
        const avgLate = lateOnes.length ? sum(lateOnes, (x) => x.late) / lateOnes.length : 0;
        return (
          <ReportView
            title="Delivery performance"
            subtitle={`${range.label} (${range.from} to ${range.to}) - orders finished in the period - T&P Textiles`}
            filename="delivery-performance"
            controls={controls}
            kpis={[
              { label: "Orders delivered", value: String(fin.length) },
              { label: "On-time delivery", value: rate === null ? "—" : `${round1(rate)}%`, tone: rate === null ? undefined : rate >= 90 ? "good" : rate >= 70 ? "warn" : "bad", sub: `${onTime.length} on time, ${lateOnes.length} late` },
              { label: "Average days late", value: lateOnes.length ? String(round1(avgLate)) : "0", sub: "late orders only", tone: lateOnes.length ? "warn" : "good" },
              { label: "Worst delay", value: lateOnes.length ? `${Math.max(...lateOnes.map((x) => x.late))} days` : "—", tone: lateOnes.length ? "bad" : undefined },
              { label: "Avg order-to-delivery", value: leads.length ? `${Math.round(sum(leads, (x) => x.lead) / leads.length)} days` : "—" },
              { label: "Customers served", value: String(cust.length) },
            ]}
            charts={[
              { type: "line", title: "On-time delivery % by month", labels: months.map(monthLabel), series: [{ name: "On-time %", values: perMonth.map((m) => (m.rate === null ? null : round1(m.rate))) }], format: (n) => `${Math.round(n)}%` },
              { type: "bar", title: "Orders delivered per month", labels: months.map(monthLabel), series: [{ name: "On time", values: months.map((mk) => fin.filter((x) => x.done.startsWith(mk) && x.onTime).length), color: "#059669" }, { name: "Late", values: months.map((mk) => fin.filter((x) => x.done.startsWith(mk) && !x.onTime).length), color: "#e11d48" }], format: (n) => String(Math.round(n)) },
              ...(causeRows.length ? [{ type: "hbar", title: "Causes of delay (from delay reviews)", labels: causeRows.map((r) => r[0]), series: [{ name: "Orders", values: causeRows.map((r) => r[1]) }], format: (n) => String(Math.round(n)) }] : []),
            ]}
            tables={[
              { heading: "Month by month", columns: [{ label: "Month" }, { label: "Delivered", type: "int" }, { label: "On-time %", type: "pct" }, { label: "Avg days late (late orders)", type: "num" }], rows: perMonth.map((m) => [monthLabel(m.mk), m.n, m.rate, m.late]) },
              { heading: "By customer (weakest first)", columns: [{ label: "Customer" }, { label: "Delivered", type: "int" }, { label: "On time", type: "int" }, { label: "On-time %", type: "pct" }, { label: "Avg days late", type: "num" }], rows: cust.map((c) => [c.c, c.n, c.on, c.rate, c.avgLate]) },
              { heading: "Late orders", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Due" }, { label: "Delivered" }, { label: "Days late", type: "int" }], rows: lateOnes.sort((a, b) => b.late - a.late).map((x) => [x.o.order_number, x.o.customer_name, x.o.due_date, x.done, x.late]) },
            ]}
            footnote="An order counts as on time when its last delivery is on or before its due date. Only Completed / Shipped orders whose last delivery fell in the period are included."
          />
        );
      }}
    </ReportShell>
  );
}
