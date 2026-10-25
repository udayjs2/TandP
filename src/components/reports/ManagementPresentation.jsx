import { useMemo } from "react";
import { Card, StatCard } from "../ui";
import ChartCanvas from "../ChartCanvas";
import ExportBar from "../ExportBar";
import { fmtMoney, isOrderOverdue, todayStr } from "../../lib/helpers";
import { daysBetween } from "../../lib/analytics";
import { linearFit } from "../../lib/stats";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, monthsBetween, monthLabel, itemsQty } from "./common";

// Phase 3: a ready-made management deck (PowerPoint / PDF) built from live data
export default function ManagementPresentation({ profile }) {
  const { range, controls } = useRange("last_6m");
  const canMoney = ["admin", "finance"].includes(profile?.role);
  const state = useData(async () => {
    const [orders, invoices, expenditures, payments, allInvoices, allPayments, progress, deliveries, cuts, checks, leads] = await Promise.all([
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, status, due_date, items").order("id")),
      safeAll(() => supabase.from("invoices").select("amount, issue_date").gte("issue_date", range.from).lte("issue_date", range.to).order("id")),
      safeAll(() => supabase.from("expenditures").select("amount, category, expense_date").gte("expense_date", range.from).lte("expense_date", range.to).order("id")),
      safeAll(() => supabase.from("order_payments").select("amount, payment_date").gte("payment_date", range.from).lte("payment_date", range.to).order("id")),
      safeAll(() => supabase.from("invoices").select("amount").order("id")),
      safeAll(() => supabase.from("order_payments").select("amount").order("id")),
      fetchAll(() => supabase.from("order_progress").select("quantity, date").gte("date", range.from).lte("date", range.to).order("id")),
      fetchAll(() => supabase.from("order_deliveries").select("order_id, date, quantity").order("date")),
      safeAll(() => supabase.from("cutting_entries").select("status, cut_date").gte("cut_date", range.from).lte("cut_date", range.to).order("id")),
      safeAll(() => supabase.from("quality_inspections").select("decision, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("id")),
      safeAll(() => supabase.from("sales_leads").select("status, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("id")),
    ]);
    return { orders, invoices, expenditures, payments, allInvoices, allPayments, progress, deliveries, cuts, checks, leads };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => <Deck d={d} range={range} controls={controls} canMoney={canMoney} />}
    </ReportShell>
  );
}

function Deck({ d, range, controls, canMoney }) {
  const report = useMemo(() => {
    const today = todayStr();
    const months = monthsBetween(range.from, range.to);
    const ml = months.map(monthLabel);
    const revenue = sum(d.invoices), expenses = sum(d.expenditures), profit = revenue - expenses;
    const collections = sum(d.payments);
    const receivables = Math.max(0, sum(d.allInvoices) - sum(d.allPayments));
    const revM = months.map((mk) => sum(d.invoices.filter((i) => (i.issue_date || "").startsWith(mk))));
    const expM = months.map((mk) => sum(d.expenditures.filter((e) => e.expense_date.startsWith(mk))));
    const profM = revM.map((r, i) => r - expM[i]);
    const fit = linearFit(profM);
    const open = d.orders.filter((o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status));
    const late = d.orders.filter((o) => isOrderOverdue(o, today));
    const delBy = groupBy(d.deliveries, (x) => x.order_id);
    const lastDel = (id) => (delBy[id] || []).reduce((m, x) => (x.date > m ? x.date : m), "");
    const fin = d.orders.filter((o) => ["Completed", "Shipped", "Rejected by Customer"].includes(o.status) && o.due_date && lastDel(o.id) >= range.from && lastDel(o.id) <= range.to);
    const onTime = fin.filter((o) => lastDel(o.id) <= o.due_date);
    const pieces = sum(d.progress, (p) => p.quantity);
    const outM = months.map((mk) => sum(d.progress.filter((p) => p.date.startsWith(mk)), (p) => p.quantity));
    const failed = d.checks.filter((c) => c.decision === "Rejected").length;
    const rejCuts = d.cuts.filter((c) => c.status === "Rejected").length;
    const won = d.leads.filter((l) => l.status === "Won").length;
    const custOpen = Object.entries(groupBy(open, (o) => o.customer_name)).map(([c, os]) => [c, os.length, sum(os, (o) => itemsQty(o.items))]).sort((a, b) => b[2] - a[2]).slice(0, 8);

    const sections = [];
    sections.push({
      heading: "Executive summary",
      kpis: [
        ...(canMoney ? [{ label: "Revenue", value: fmtMoney(revenue) }, { label: "Profit / loss", value: fmtMoney(profit) }, { label: "Receivables", value: fmtMoney(receivables) }] : []),
        { label: "Pieces stitched", value: Math.round(pieces).toLocaleString("en-IN") },
        { label: "Open orders", value: String(open.length) },
        { label: "Delayed orders", value: String(late.length) },
        { label: "On-time delivery", value: fin.length ? `${round1(pct(onTime.length, fin.length))}%` : "—" },
        { label: "Leads won", value: `${won} / ${d.leads.length}` },
      ],
      bullets: [
        ...(canMoney ? [`Revenue of ${fmtMoney(revenue)} against expenses of ${fmtMoney(expenses)} gives a ${profit >= 0 ? "profit" : "loss"} of ${fmtMoney(Math.abs(profit))}.`] : []),
        `${late.length} of ${open.length} open orders are past their due date.`,
        fin.length ? `${onTime.length} of ${fin.length} orders finished in the period were delivered on time.` : "No orders were finished in the period.",
      ],
    });
    if (canMoney) {
      sections.push({
        heading: "Financial performance",
        kpis: [{ label: "Revenue", value: fmtMoney(revenue) }, { label: "Expenses", value: fmtMoney(expenses) }, { label: "Profit / loss", value: fmtMoney(profit) }, { label: "Collections", value: fmtMoney(collections) }],
        bullets: [months.length >= 4 ? `Monthly profit is trending ${fit.slope >= 0 ? "up" : "down"} by about ${fmtMoney(Math.abs(fit.slope))} a month.` : "Pick a longer period to see the profit trend.", `Customers still owe ${fmtMoney(receivables)}.`],
        charts: [
          { type: "bar", title: "Revenue vs expenses (₹)", labels: ml, series: [{ name: "Revenue", values: revM.map(Math.round), color: "#059669" }, { name: "Expenses", values: expM.map(Math.round), color: "#e11d48" }], format: (n) => fmtMoney(n) },
          { type: "line", title: "Monthly profit (₹)", labels: ml, series: [{ name: "Profit", values: profM.map(Math.round) }], format: (n) => fmtMoney(n) },
        ],
      });
    }
    sections.push({
      heading: "Production",
      kpis: [{ label: "Pieces stitched", value: Math.round(pieces).toLocaleString("en-IN") }, { label: "Average per month", value: Math.round(pieces / months.length).toLocaleString("en-IN") }, { label: "Rejected cutting entries", value: String(rejCuts) }],
      charts: [{ type: "bar", title: "Pieces stitched per month", labels: ml, series: [{ name: "Pieces", values: outM.map(Math.round) }], format: (n) => String(Math.round(n)) }],
    });
    sections.push({
      heading: "Quality",
      kpis: [{ label: "Inspections", value: String(d.checks.length) }, { label: "Rejected", value: String(failed) }, { label: "Rejection rate", value: d.checks.length ? `${round1(pct(failed, d.checks.length))}%` : "—" }],
      charts: [{ type: "bar", title: "Rejected inspections per month", labels: ml, series: [{ name: "Rejected", values: months.map((mk) => d.checks.filter((c) => (c.created_at || "").startsWith(mk) && c.decision === "Rejected").length) }], format: (n) => String(Math.round(n)) }],
    });
    sections.push({
      heading: "Delivery & open orders",
      kpis: [{ label: "Open orders", value: String(open.length) }, { label: "Delayed", value: String(late.length) }, { label: "On-time delivery", value: fin.length ? `${round1(pct(onTime.length, fin.length))}%` : "—" }],
      table: { columns: [{ label: "Customer" }, { label: "Open orders", type: "int" }, { label: "Ordered pcs", type: "int" }], rows: custOpen },
    });
    sections.push({
      heading: "Sales pipeline",
      kpis: [{ label: "New leads", value: String(d.leads.length) }, { label: "Won", value: String(won) }, { label: "Conversion", value: d.leads.length ? `${round1(pct(won, d.leads.length))}%` : "—" }],
      charts: [{ type: "bar", title: "New leads per month", labels: ml, series: [{ name: "Leads", values: months.map((mk) => d.leads.filter((l) => (l.created_at || "").startsWith(mk)).length) }], format: (n) => String(Math.round(n)) }],
    });
    return { title: "Management review", subtitle: `T&P Textiles - ${range.label} (${range.from} to ${range.to})`, filename: "management-presentation", sections };
  }, [d, range, canMoney]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">{controls}</div>
        <ExportBar buildReport={() => report} />
      </div>
      <p className="text-xs text-stone-500">{report.subtitle}. Download as PowerPoint or PDF - each block below becomes a slide.</p>
      {report.sections.map((s, i) => (
        <Card key={s.heading} className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-stone-800">{i + 1}. {s.heading}</h3>
          {s.kpis?.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{s.kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} />)}</div>}
          {s.bullets?.length > 0 && <ul className="text-sm text-stone-700 list-disc pl-5 space-y-1">{s.bullets.map((b, bi) => <li key={bi}>{b}</li>)}</ul>}
          {s.charts?.length > 0 && <div className="grid md:grid-cols-2 gap-3">{s.charts.map((c) => <ChartCanvas key={c.title} spec={c} height={260} />)}</div>}
          {s.table && (
            <table className="w-full text-sm"><thead className="text-xs uppercase text-stone-500"><tr>{s.table.columns.map((c, ci) => <th key={ci} className={`py-1.5 ${ci ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-stone-100">{s.table.rows.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} className={`py-1.5 ${ci ? "text-right font-mono" : ""}`}>{String(v)}</td>)}</tr>)}
                {s.table.rows.length === 0 && <tr><td colSpan={s.table.columns.length} className="py-3 text-stone-400">No open orders.</td></tr>}</tbody></table>
          )}
        </Card>
      ))}
    </div>
  );
}
