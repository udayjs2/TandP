import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, round1, groupBy } from "./common";

// Phase 3: revenue, actual cost, profit and outstanding by customer
export default function CustomerProfitability() {
  const { range, controls } = useRange("last_12m");
  const state = useData(async () => {
    const [orders, invoices, payments] = await Promise.all([
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name").order("id")),
      fetchAll(() => supabase.from("invoices").select("linked_order_id, customer_name, amount, issue_date").order("id")),
      fetchAll(() => supabase.from("order_payments").select("order_id, amount").order("id")),
    ]);
    const invIn = invoices.filter((i) => i.issue_date && i.issue_date >= range.from && i.issue_date <= range.to && i.linked_order_id);
    const ids = [...new Set(invIn.map((i) => i.linked_order_id))].slice(0, 80);
    const costs = await Promise.all(ids.map((id) => supabase.rpc("order_actual_cost", { p_order: id }).then((r) => [id, { cost: r.data?.totals?.total ?? null, unpriced: r.data?.unpriced_lines || 0 }])));
    return { orders, invoices, payments, costs: Object.fromEntries(costs), ids, capped: new Set(invIn.map((i) => i.linked_order_id)).size > 80 };
  }, JSON.stringify(range));
  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const ord = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        const invByOrder = groupBy(d.invoices.filter((i) => i.linked_order_id), (i) => i.linked_order_id);
        const payByOrder = groupBy(d.payments, (p) => p.order_id);
        const perCustomer = {};
        d.ids.forEach((id) => {
          const c = ord[id]?.customer_name || "—";
          const invs = invByOrder[id] || [];
          const rev = sum(invs.filter((i) => i.issue_date >= range.from && i.issue_date <= range.to));
          const total = sum(invs);
          const r = (perCustomer[c] = perCustomer[c] || { orders: 0, revenue: 0, cost: 0, costed: 0, outstanding: 0, unpriced: 0 });
          r.orders += 1; r.revenue += rev;
          const k = d.costs[id];
          if (k && k.cost !== null) { r.cost += k.cost; r.costed += rev; }
          if (k?.unpriced) r.unpriced += 1;
          r.outstanding += Math.max(0, total - sum(payByOrder[id] || []));
        });
        const rows = Object.entries(perCustomer).map(([c, r]) => {
          const profit = r.costed - r.cost;
          return { c, ...r, profit, margin: r.costed ? (profit / r.costed) * 100 : null };
        }).sort((a, b) => b.profit - a.profit);
        const totalRev = sum(rows, (r) => r.revenue), totalProfit = sum(rows, (r) => r.profit);
        const losers = rows.filter((r) => r.profit < 0);
        return (
          <ReportView
            title="Customer profitability"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="customer-profitability"
            controls={controls}
            kpis={[
              { label: "Customers invoiced", value: String(rows.length) },
              { label: "Revenue", value: fmtMoney(totalRev) },
              { label: "Profit on actual cost", value: fmtMoney(totalProfit), tone: totalProfit >= 0 ? "good" : "bad" },
              { label: "Loss-making customers", value: String(losers.length), tone: losers.length ? "bad" : "good" },
              { label: "Most profitable", value: rows[0]?.c || "—", sub: rows[0] ? fmtMoney(rows[0].profit) : undefined, tone: "good" },
              { label: "Outstanding from customers", value: fmtMoney(sum(rows, (r) => r.outstanding)), tone: "warn" },
            ]}
            charts={[
              ...(rows.length ? [{ type: "hbar", title: "Profit by customer (₹)", labels: rows.slice(0, 15).map((r) => r.c), series: [{ name: "Profit", values: rows.slice(0, 15).map((r) => Math.round(r.profit)) }], signColors: true }] : []),
              ...(rows.length ? [{ type: "pie", title: "Revenue share by customer", labels: rows.slice(0, 8).map((r) => r.c), series: [{ name: "Revenue", values: rows.slice(0, 8).map((r) => r.revenue) }] }] : []),
            ]}
            tables={[{
              heading: "Customer-wise profitability",
              columns: [{ label: "Customer" }, { label: "Orders", type: "int" }, { label: "Revenue", type: "money" }, { label: "Actual cost", type: "money" }, { label: "Profit / loss", type: "money" }, { label: "Margin", type: "pct" }, { label: "Outstanding", type: "money" }, { label: "Note" }],
              rows: rows.map((r) => [r.c, r.orders, r.revenue, r.cost, r.profit, r.margin, r.outstanding, r.unpriced ? `${r.unpriced} order(s) missing prices` : ""]),
            }]}
            footnote={`Profit = invoiced revenue minus actual cost (fabric used, trims issued, order expenses, manpower) for orders invoiced in the period${d.capped ? "; only the first 80 orders are costed" : ""}. Orders missing inventory prices look more profitable than they are.`}
          />
        );
      }}
    </ReportShell>
  );
}
