import { TrendingUp, TrendingDown, Wallet, Package } from "lucide-react";
import ReportView from "../ReportView";
import { fmtMoney, isOrderOverdue, todayStr } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, inRange, round1, pct, monthsBetween, monthLabel, safeAll } from "./common";

// 1. Business overview: revenue, expenses, profit / loss, pending orders, collections and headline KPIs
export default function BusinessOverview() {
  const { range, controls } = useRange("this_month");
  const state = useData(async () => {
    const [invoices, expenditures, payments, allInvoices, allPayments, orders, progress, leads] = await Promise.all([
      fetchAll(() => supabase.from("invoices").select("id, amount, issue_date").gte("issue_date", range.from).lte("issue_date", range.to).order("id")),
      fetchAll(() => supabase.from("expenditures").select("id, amount, category, expense_date").gte("expense_date", range.from).lte("expense_date", range.to).order("id")),
      fetchAll(() => supabase.from("order_payments").select("id, amount, payment_date").gte("payment_date", range.from).lte("payment_date", range.to).order("id")),
      fetchAll(() => supabase.from("invoices").select("id, amount").order("id")),
      fetchAll(() => supabase.from("order_payments").select("id, amount").order("id")),
      fetchAll(() => supabase.from("orders").select("id, status, due_date, order_number").order("id")),
      fetchAll(() => supabase.from("order_progress").select("id, quantity, date").gte("date", range.from).lte("date", range.to).order("id")),
      safeAll(() => supabase.from("sales_leads").select("id, status, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("id")),
    ]);
    return { invoices, expenditures, payments, allInvoices, allPayments, orders, progress, leads };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const today = todayStr();
        const revenue = sum(d.invoices);
        const expenses = sum(d.expenditures);
        const profit = revenue - expenses;
        const collections = sum(d.payments);
        const receivables = Math.max(0, sum(d.allInvoices) - sum(d.allPayments));
        const open = d.orders.filter((o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status));
        const late = d.orders.filter((o) => isOrderOverdue(o, today));
        const pieces = sum(d.progress, (p) => p.quantity);
        const won = d.leads.filter((l) => l.status === "Won").length;
        const months = monthsBetween(range.from, range.to);
        const monthly = months.map((mk) => ({
          mk,
          revenue: sum(d.invoices.filter((i) => (i.issue_date || "").startsWith(mk))),
          expenses: sum(d.expenditures.filter((e) => e.expense_date.startsWith(mk))),
          collections: sum(d.payments.filter((p) => p.payment_date.startsWith(mk))),
        }));
        const cat = {};
        d.expenditures.forEach((e) => (cat[e.category || "Other"] = (cat[e.category || "Other"] || 0) + Number(e.amount || 0)));
        const cats = Object.entries(cat).sort((a, b) => b[1] - a[1]);
        const byStatus = {};
        d.orders.forEach((o) => (byStatus[o.status] = (byStatus[o.status] || 0) + 1));
        const collEff = pct(collections, revenue);
        return (
          <ReportView
            title="Business overview"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="business-overview"
            controls={controls}
            kpis={[
              { label: "Revenue (invoiced)", value: fmtMoney(revenue), icon: TrendingUp, tone: "good" },
              { label: "Expenses", value: fmtMoney(expenses), icon: Wallet },
              { label: profit >= 0 ? "Profit" : "Loss", value: fmtMoney(Math.abs(profit)), icon: profit >= 0 ? TrendingUp : TrendingDown, tone: profit >= 0 ? "good" : "bad", sub: revenue ? `${round1((profit / revenue) * 100)}% of revenue` : undefined },
              { label: "Collections received", value: fmtMoney(collections), sub: collEff === null ? undefined : `${round1(collEff)}% of revenue` },
              { label: "Outstanding receivables", value: fmtMoney(receivables), tone: receivables > 0 ? "warn" : "good", sub: "all invoices, all time" },
              { label: "Pending orders", value: String(open.length), icon: Package, sub: `${late.length} overdue` },
              { label: "Pieces stitched", value: Math.round(pieces).toLocaleString("en-IN") },
              { label: "Leads won", value: `${won} / ${d.leads.length}`, sub: d.leads.length ? `${round1(pct(won, d.leads.length))}% conversion` : "no leads in period" },
            ]}
            bullets={[
              `Invoiced ${fmtMoney(revenue)} and spent ${fmtMoney(expenses)} in ${range.label}, a ${profit >= 0 ? "profit" : "loss"} of ${fmtMoney(Math.abs(profit))} before unrecorded costs.`,
              `Collected ${fmtMoney(collections)} from customers; ${fmtMoney(receivables)} is still to be collected across all invoices.`,
              `${open.length} order(s) are still in progress and ${late.length} of them are past their due date.`,
            ]}
            charts={[
              { type: "bar", title: "Revenue, expenses and collections by month", labels: monthly.map((m) => monthLabel(m.mk)), series: [{ name: "Revenue", values: monthly.map((m) => m.revenue), color: "#059669" }, { name: "Expenses", values: monthly.map((m) => m.expenses), color: "#e11d48" }, { name: "Collections", values: monthly.map((m) => m.collections), color: "#4338ca" }], format: (n) => fmtMoney(n) },
              ...(cats.length ? [{ type: "pie", title: "Where the money went", labels: cats.map(([c]) => c), series: [{ name: "Spend", values: cats.map(([, v]) => v) }] }] : []),
              { type: "pie", title: "Orders by status", labels: Object.keys(byStatus), series: [{ name: "Orders", values: Object.values(byStatus) }], format: (n) => String(Math.round(n)) },
            ]}
            tables={[{
              heading: "Monthly performance",
              columns: [{ label: "Month" }, { label: "Revenue", type: "money" }, { label: "Expenses", type: "money" }, { label: "Profit / loss", type: "money" }, { label: "Collections", type: "money" }],
              rows: monthly.map((m) => [monthLabel(m.mk), m.revenue, m.expenses, m.revenue - m.expenses, m.collections]),
            }]}
            footnote="Revenue is the value of invoices issued in the period; expenses are the logged expenditures (including salaries paid and commissions paid)."
          />
        );
      }}
    </ReportShell>
  );
}
