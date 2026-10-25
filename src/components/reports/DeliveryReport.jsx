import ReportView from "../ReportView";
import { isOrderOverdue, todayStr } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, itemsQty } from "./common";
import { daysBetween, dateList, shortDate } from "../../lib/analytics";

// 8. Delivery & order fulfilment
export default function DeliveryReport() {
  const { range, controls } = useRange("this_month");
  const state = useData(async () => {
    const [orders, deliveries, rcas] = await Promise.all([
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, items, due_date, status, order_date").order("id")),
      fetchAll(() => supabase.from("order_deliveries").select("order_id, date, quantity, item_description").order("date")),
      safeAll(() => supabase.from("order_delay_rca").select("order_id, causes, days_late").order("id")),
    ]);
    return { orders, deliveries, rcas };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const today = todayStr();
        const delBy = groupBy(d.deliveries, (x) => x.order_id);
        const delivered = (id) => sum(delBy[id] || [], (x) => x.quantity);
        const lastDel = (id) => (delBy[id] || []).reduce((m, x) => (x.date > m ? x.date : m), "");
        const open = d.orders.filter((o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status));
        const delayed = open.filter((o) => isOrderOverdue(o, today)).sort((a, b) => a.due_date.localeCompare(b.due_date));
        const dueSoon = open.filter((o) => o.due_date && o.due_date >= today && daysBetween(today, o.due_date) <= 7);
        // on-time: finished orders whose last delivery fell in the period, compared with the due date
        const finished = d.orders.filter((o) => ["Completed", "Shipped", "Rejected by Customer"].includes(o.status) && o.due_date && lastDel(o.id) >= range.from && lastDel(o.id) <= range.to);
        const onTime = finished.filter((o) => lastDel(o.id) <= o.due_date);
        const inPeriod = d.deliveries.filter((x) => x.date >= range.from && x.date <= range.to);
        const dispatched = sum(inPeriod, (x) => x.quantity);
        const days = dateList(range.from, range.to);
        const dayMap = groupBy(inPeriod, (x) => x.date);
        const dispatchByOrder = Object.entries(groupBy(inPeriod, (x) => x.order_id)).map(([id, xs]) => {
          const o = d.orders.find((z) => z.id === id);
          return [o?.order_number || "—", o?.customer_name || "—", sum(xs, (x) => x.quantity), itemsQty(o?.items), delivered(id)];
        }).sort((a, b) => b[2] - a[2]);
        const outstanding = Object.entries(groupBy(open, (o) => o.customer_name)).map(([c, os]) => {
          const ordered = sum(os, (o) => itemsQty(o.items)), del = sum(os, (o) => delivered(o.id));
          return [c, os.length, ordered, del, Math.max(0, ordered - del), os.filter((o) => isOrderOverdue(o, today)).length];
        }).sort((a, b) => b[4] - a[4]);
        const causes = {};
        d.rcas.forEach((r) => (r.causes || []).forEach((c) => { if (c.cause) causes[c.cause] = (causes[c.cause] || 0) + 1; }));
        const causeRows = Object.entries(causes).sort((a, b) => b[1] - a[1]);
        const byStatus = {};
        open.forEach((o) => (byStatus[o.status] = (byStatus[o.status] || 0) + 1));
        return (
          <ReportView
            title="Delivery & order fulfilment report"
            subtitle={`${range.label} (${range.from} to ${range.to}); open-order figures are as of today - T&P Textiles`}
            filename="delivery-fulfilment-report"
            controls={controls}
            kpis={[
              { label: "Pending orders", value: String(open.length) },
              { label: "Delayed orders", value: String(delayed.length), tone: delayed.length ? "bad" : "good", sub: "past due date, not finished" },
              { label: "Due in 7 days", value: String(dueSoon.length), tone: dueSoon.length ? "warn" : "good" },
              { label: "On-time delivery", value: finished.length ? `${round1(pct(onTime.length, finished.length))}%` : "—", sub: `${onTime.length} of ${finished.length} finished in period` },
              { label: "Pieces dispatched", value: Math.round(dispatched).toLocaleString("en-IN"), tone: "good" },
              { label: "Customers with open orders", value: String(outstanding.length) },
            ]}
            charts={[
              { type: "bar", title: "Pieces dispatched by day", labels: days.map(shortDate), series: [{ name: "Pieces", values: days.map((x) => sum(dayMap[x] || [], (r) => r.quantity)) }], format: (n) => String(Math.round(n)) },
              ...(Object.keys(byStatus).length ? [{ type: "pie", title: "Open orders by stage", labels: Object.keys(byStatus), series: [{ name: "Orders", values: Object.values(byStatus) }], format: (n) => String(Math.round(n)) }] : []),
              ...(causeRows.length ? [{ type: "hbar", title: "Causes of delay (from delay reviews)", labels: causeRows.map((r) => r[0]), series: [{ name: "Orders", values: causeRows.map((r) => r[1]) }], format: (n) => String(Math.round(n)) }] : []),
            ]}
            tables={[
              { heading: "Delayed orders", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Stage" }, { label: "Due date" }, { label: "Days late", type: "int" }, { label: "Delivered", type: "int" }, { label: "Ordered", type: "int" }], rows: delayed.map((o) => [o.order_number, o.customer_name, o.status, o.due_date, daysBetween(o.due_date, today), delivered(o.id), itemsQty(o.items)]) },
              { heading: "Customer outstanding orders", columns: [{ label: "Customer" }, { label: "Open orders", type: "int" }, { label: "Ordered pcs", type: "int" }, { label: "Delivered pcs", type: "int" }, { label: "Outstanding pcs", type: "int" }, { label: "Delayed orders", type: "int" }], rows: outstanding },
              { heading: "Dispatches in the period", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Dispatched", type: "int" }, { label: "Ordered", type: "int" }, { label: "Delivered to date", type: "int" }], rows: dispatchByOrder },
            ]}
            footnote="On-time delivery compares the date of the last delivery with the order's due date, for orders that are Completed or Shipped and whose last delivery fell in the period."
          />
        );
      }}
    </ReportShell>
  );
}
