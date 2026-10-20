import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, monthsBetween, monthLabel, safeAll } from "./common";

// 7. Finance & profitability (Admin)
export default function FinanceReport() {
  const { range, controls } = useRange("this_quarter");
  const state = useData(async () => {
    const [invoices, payments, expenditures, investments, loans, loanPays, orders] = await Promise.all([
      fetchAll(() => supabase.from("invoices").select("id, linked_order_id, customer_name, amount, issue_date").order("id")),
      fetchAll(() => supabase.from("order_payments").select("id, order_id, amount, payment_date").order("id")),
      fetchAll(() => supabase.from("expenditures").select("id, category, amount, expense_date").order("id")),
      safeAll(() => supabase.from("investments").select("amount, invested_date").order("invested_date")),
      safeAll(() => supabase.from("loans").select("id, loan_amount, emi_amount").order("id")),
      safeAll(() => supabase.from("loan_payments").select("loan_id, amount, payment_date").order("payment_date")),
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, status").order("id")),
    ]);
    // actual cost of every order invoiced in the period (up to 60)
    const invIn = invoices.filter((i) => i.issue_date && i.issue_date >= range.from && i.issue_date <= range.to && i.linked_order_id);
    const ids = [...new Set(invIn.map((i) => i.linked_order_id))].slice(0, 60);
    const costs = await Promise.all(ids.map((id) => supabase.rpc("order_actual_cost", { p_order: id }).then((r) => [id, r.data?.totals?.total ?? null, r.data?.unpriced_lines || 0])));
    return { invoices, payments, expenditures, investments, loans, loanPays, orders, costs: Object.fromEntries(costs.map(([id, t, u]) => [id, { total: t, unpriced: u }])), capped: invIn.length && new Set(invIn.map((i) => i.linked_order_id)).size > 60 };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const inR = (dt) => dt && dt >= range.from && dt <= range.to;
        const invR = d.invoices.filter((i) => inR(i.issue_date));
        const payR = d.payments.filter((p) => inR(p.payment_date));
        const expR = d.expenditures.filter((e) => inR(e.expense_date));
        const invstR = d.investments.filter((i) => inR(i.invested_date));
        const lpR = d.loanPays.filter((p) => inR(p.payment_date));
        const income = sum(invR), received = sum(payR), expense = sum(expR);
        const profit = income - expense;
        const ord = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        // receivables by customer (all time): invoiced - received per order, grouped by customer
        const invByOrder = groupBy(d.invoices.filter((i) => i.linked_order_id), (i) => i.linked_order_id);
        const payByOrder = groupBy(d.payments, (p) => p.order_id);
        const recv = {};
        Object.entries(invByOrder).forEach(([oid, is]) => {
          const bal = sum(is) - sum(payByOrder[oid] || []);
          if (bal > 0) { const c = ord[oid]?.customer_name || is[0].customer_name; recv[c] = (recv[c] || 0) + bal; }
        });
        const recvRows = Object.entries(recv).sort((a, b) => b[1] - a[1]);
        const receivables = sum(recvRows, (r) => r[1]);
        const loanOut = Math.max(0, sum(d.loans, (l) => l.loan_amount) - sum(d.loanPays));
        const emi = sum(d.loans, (l) => l.emi_amount);
        // order-wise profit / loss on actual cost
        const orderRows = Object.entries(groupBy(invR.filter((i) => i.linked_order_id), (i) => i.linked_order_id)).map(([oid]) => {
          const revenue = sum(invByOrder[oid] || []);
          const c = d.costs[oid];
          const cost = c?.total ?? null;
          return [ord[oid]?.order_number || "—", ord[oid]?.customer_name || "—", revenue, cost, cost === null ? null : revenue - cost, cost === null || !revenue ? null : ((revenue - cost) / revenue) * 100, c?.unpriced ? "prices missing" : ""];
        }).sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0));
        const months = monthsBetween(range.from, range.to);
        let running = 0;
        const monthly = months.map((mk) => {
          const rev = sum(invR.filter((i) => i.issue_date.startsWith(mk)));
          const exp = sum(expR.filter((e) => e.expense_date.startsWith(mk)));
          const inflow = sum(payR.filter((p) => p.payment_date.startsWith(mk))) + sum(invstR.filter((i) => i.invested_date.startsWith(mk)));
          const outflow = exp + sum(lpR.filter((p) => p.payment_date.startsWith(mk)));
          running += inflow - outflow;
          return { mk, rev, exp, inflow, outflow, net: inflow - outflow, running };
        });
        const cat = {};
        expR.forEach((e) => (cat[e.category || "Other"] = (cat[e.category || "Other"] || 0) + Number(e.amount || 0)));
        const cats = Object.entries(cat).sort((a, b) => b[1] - a[1]);
        const inflowTotal = sum(monthly, (m) => m.inflow), outflowTotal = sum(monthly, (m) => m.outflow);
        const profitable = orderRows.filter((r) => r[4] !== null && r[4] >= 0).length;
        return (
          <ReportView
            title="Finance & profitability report"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="finance-profitability-report"
            controls={controls}
            kpis={[
              { label: "Income (invoiced)", value: fmtMoney(income), tone: "good" },
              { label: "Expenses", value: fmtMoney(expense) },
              { label: profit >= 0 ? "Profit" : "Loss", value: fmtMoney(Math.abs(profit)), tone: profit >= 0 ? "good" : "bad", sub: income ? `${round1((profit / income) * 100)}% margin` : undefined },
              { label: "Cash received", value: fmtMoney(received) },
              { label: "Receivables", value: fmtMoney(receivables), tone: receivables ? "warn" : "good", sub: "unpaid invoices, all time" },
              { label: "Payables (loans)", value: fmtMoney(loanOut), sub: `EMI ${fmtMoney(emi)} / month` },
              { label: "Net cash flow", value: fmtMoney(inflowTotal - outflowTotal), tone: inflowTotal - outflowTotal >= 0 ? "good" : "bad", sub: "inflow minus outflow" },
              { label: "Profitable orders", value: `${profitable} / ${orderRows.length}` },
            ]}
            charts={[
              { type: "bar", title: "Income vs expenses by month", labels: monthly.map((m) => monthLabel(m.mk)), series: [{ name: "Income", values: monthly.map((m) => m.rev), color: "#059669" }, { name: "Expenses", values: monthly.map((m) => m.exp), color: "#e11d48" }], format: (n) => fmtMoney(n) },
              { type: "line", title: "Cumulative net cash flow (₹)", labels: monthly.map((m) => monthLabel(m.mk)), series: [{ name: "Cash", values: monthly.map((m) => Math.round(m.running)) }], format: (n) => fmtMoney(n) },
              ...(orderRows.some((r) => r[4] !== null) ? [{ type: "hbar", title: "Profit / loss by order (₹)", labels: orderRows.filter((r) => r[4] !== null).slice(0, 15).map((r) => r[0]), series: [{ name: "Profit", values: orderRows.filter((r) => r[4] !== null).slice(0, 15).map((r) => Math.round(r[4])) }], signColors: true }] : []),
              ...(cats.length ? [{ type: "pie", title: "Expenses by category", labels: cats.map((c) => c[0]), series: [{ name: "Spend", values: cats.map((c) => c[1]) }] }] : []),
            ]}
            tables={[
              { heading: "Order-wise profit / loss (actual cost)", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Invoiced", type: "money" }, { label: "Actual cost", type: "money" }, { label: "Profit / loss", type: "money" }, { label: "Margin", type: "pct" }, { label: "Note" }], rows: orderRows },
              { heading: "Monthly financial performance", columns: [{ label: "Month" }, { label: "Income", type: "money" }, { label: "Expenses", type: "money" }, { label: "Profit / loss", type: "money" }, { label: "Cash in", type: "money" }, { label: "Cash out", type: "money" }, { label: "Net cash", type: "money" }], rows: monthly.map((m) => [monthLabel(m.mk), m.rev, m.exp, m.rev - m.exp, m.inflow, m.outflow, m.net]) },
              { heading: "Receivables by customer", columns: [{ label: "Customer" }, { label: "Outstanding", type: "money" }], rows: recvRows },
              { heading: "Expenses by category", columns: [{ label: "Category" }, { label: "Amount", type: "money" }, { label: "Share", type: "pct" }], rows: cats.map(([c, v]) => [c, v, expense ? (v / expense) * 100 : 0]) },
            ]}
            footnote={`Order profit uses the actual cost (fabric used, trims issued, order expenses and manpower)${d.capped ? "; only the first 60 orders are costed" : ""}. Cash in = customer payments + investments; cash out = expenditures + loan repayments. Receivables count invoices linked to orders.`}
          />
        );
      }}
    </ReportShell>
  );
}
