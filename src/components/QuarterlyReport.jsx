import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, Percent } from "lucide-react";
import { supabase, fetchAll } from "../lib/fetchAll";
import { Card, StatCard, inputCls } from "./ui";
import ChartCanvas from "./ChartCanvas";
import ExportBar from "./ExportBar";
import { fmtMoney, computeLaborCost } from "../lib/helpers";
import { periodRangeFor, previousPeriod, currentQuarter, currentHalf } from "../lib/analytics";

const monthName = (mk) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4);
const pctChange = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);

// Financial report for a quarter, half-year or full financial year (Indian FY, April–March).
export default function QuarterlyReport({ initialMode = "quarter" }) {
  const now = currentQuarter();
  const [mode, setMode] = useState(initialMode); // quarter | half | year
  const [fy, setFy] = useState(now.fy);
  const [q, setQ] = useState(now.q);
  const [h, setH] = useState(currentHalf().h);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const n = mode === "quarter" ? q : mode === "half" ? h : 1;
  const range = periodRangeFor(mode, fy, n);
  const prev = previousPeriod(mode, fy, n);
  const prevRange = periodRangeFor(mode, prev.fy, prev.n);
  const unit = mode === "quarter" ? "quarter" : mode === "half" ? "half-year" : "year";

  const load = async () => {
    setData(null);
    try {
      const [invoices, expenditures, orders, finance, labor, employees] = await Promise.all([
        fetchAll(() => supabase.from("invoices").select("id, linked_order_id, amount, issue_date").gte("issue_date", prevRange.from).lte("issue_date", range.to).order("id")),
        fetchAll(() => supabase.from("expenditures").select("id, category, amount, expense_date, linked_order_id, payroll_id").gte("expense_date", prevRange.from).lte("expense_date", range.to).order("id")),
        fetchAll(() => supabase.from("orders").select("id, order_number, customer_name").order("id")),
        fetchAll(() => supabase.from("order_finance").select("*").order("order_id")),
        fetchAll(() => supabase.from("order_labor").select("*").order("id")),
        fetchAll(() => supabase.from("employees").select("id, base_salary").order("id")),
      ]);
      // every invoice of an order (not only the ones in this quarter) so order-level revenue is complete
      const orderInvoices = await fetchAll(() => supabase.from("invoices").select("linked_order_id, amount, issue_date").not("linked_order_id", "is", null).order("id"));
      const rawMaterial = await fetchAll(() => supabase.from("expenditures").select("linked_order_id, amount").not("linked_order_id", "is", null).eq("category", "Raw Material").order("id"));
      setData({ invoices, expenditures, orders, finance, labor, employees, orderInvoices, rawMaterial });
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, q, h, mode]);

  if (error) return <p className="text-sm text-rose-600">Couldn't build the report: {error}</p>;

  const picker = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-lg border border-stone-300 overflow-hidden">
        {[["quarter", "Quarterly"], ["half", "Half-yearly"], ["year", "Yearly"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMode(id)} className={`px-3 py-2 text-sm ${mode === id ? "bg-indigo-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>{label}</button>
        ))}
      </div>
      <select className={inputCls + " w-auto"} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
        {Array.from({ length: 6 }, (_, i) => now.fy - i).map((y) => <option key={y} value={y}>FY {y}-{String((y + 1) % 100).padStart(2, "0")}</option>)}
      </select>
      {mode === "quarter" && (
        <select className={inputCls + " w-auto"} value={q} onChange={(e) => setQ(Number(e.target.value))}>
          <option value={1}>Q1 (Apr–Jun)</option>
          <option value={2}>Q2 (Jul–Sep)</option>
          <option value={3}>Q3 (Oct–Dec)</option>
          <option value={4}>Q4 (Jan–Mar)</option>
        </select>
      )}
      {mode === "half" && (
        <select className={inputCls + " w-auto"} value={h} onChange={(e) => setH(Number(e.target.value))}>
          <option value={1}>H1 (Apr–Sep)</option>
          <option value={2}>H2 (Oct–Mar)</option>
        </select>
      )}
    </div>
  );
  if (!data) return <div className="space-y-4">{picker}<p className="text-sm text-stone-500">Building report…</p></div>;

  const inRange = (d, r) => d >= r.from && d <= r.to;
  const sum = (rows, f = (x) => x.amount) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

  // ----- company level
  const invQ = data.invoices.filter((i) => i.issue_date && inRange(i.issue_date, range));
  const invP = data.invoices.filter((i) => i.issue_date && inRange(i.issue_date, prevRange));
  const expQ = data.expenditures.filter((e) => inRange(e.expense_date, range));
  const expP = data.expenditures.filter((e) => inRange(e.expense_date, prevRange));
  // Paid salaries are already in the expenditures (category Salary). Only months with no
  // salary recorded yet get an estimate (current base pay), so nothing is counted twice.
  const salaryMonthly = sum(data.employees, (e) => e.base_salary);
  const estFor = (r, rows) => r.months.filter((mk) => !rows.some((e) => e.category === "Salary" && e.expense_date.startsWith(mk))).length * salaryMonthly;
  const salaryQ = estFor(range, data.expenditures);
  const salaryPaidQ = sum(data.expenditures.filter((e) => e.category === "Salary" && inRange(e.expense_date, range)));
  const revenue = sum(invQ);
  const spend = sum(expQ);
  const net = revenue - spend - salaryQ;
  const margin = revenue ? (net / revenue) * 100 : null;
  const prevRevenue = sum(invP);
  const prevNet = prevRevenue - sum(expP) - estFor(prevRange, data.expenditures);
  const revChange = pctChange(revenue, prevRevenue);

  const monthly = range.months.map((mk) => ({
    mk,
    revenue: sum(invQ.filter((i) => i.issue_date.startsWith(mk))),
    spend: sum(expQ.filter((e) => e.expense_date.startsWith(mk))),
  }));
  const byCategory = {};
  expQ.forEach((e) => (byCategory[e.category || "Other"] = (byCategory[e.category || "Other"] || 0) + Number(e.amount || 0)));
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  // ----- per order: orders whose latest invoice falls in this quarter
  const finByOrder = Object.fromEntries(data.finance.map((f) => [f.order_id, f]));
  const empById = Object.fromEntries(data.employees.map((e) => [e.id, e]));
  const laborByOrder = {};
  data.labor.forEach((l) => (laborByOrder[l.order_id] = laborByOrder[l.order_id] || []).push(l));
  const matByOrder = {};
  data.rawMaterial.forEach((m) => (matByOrder[m.linked_order_id] = (matByOrder[m.linked_order_id] || 0) + Number(m.amount || 0)));
  const invByOrder = {};
  data.orderInvoices.forEach((i) => {
    const o = (invByOrder[i.linked_order_id] = invByOrder[i.linked_order_id] || { revenue: 0, last: "" });
    o.revenue += Number(i.amount || 0);
    if ((i.issue_date || "") > o.last) o.last = i.issue_date || "";
  });
  const orderRows = data.orders
    .filter((o) => invByOrder[o.id] && invByOrder[o.id].last && inRange(invByOrder[o.id].last, range))
    .map((o) => {
      const fin = finByOrder[o.id] || {};
      const laborRows = laborByOrder[o.id] || [];
      const labour = laborRows.length ? computeLaborCost(laborRows, empById).laborCost : Number(fin.labor_cost || 0);
      const material = matByOrder[o.id] !== undefined ? matByOrder[o.id] : Number(fin.raw_material_cost || 0);
      const overhead = Number(fin.overhead_cost || 0);
      const rev = invByOrder[o.id].revenue;
      const cost = material + labour + overhead;
      const profit = rev - cost;
      return { order: o.order_number, customer: o.customer_name, revenue: rev, material, labour, overhead, cost, profit, margin: rev ? (profit / rev) * 100 : null, result: profit >= 0 ? "Profit" : "Loss" };
    })
    .sort((a, b) => b.profit - a.profit);
  const winners = orderRows.filter((r) => r.profit >= 0);
  const losers = orderRows.filter((r) => r.profit < 0);

  const monthChart = { type: "bar", title: "Revenue vs expenditure by month", labels: monthly.map((m) => monthName(m.mk)), series: [{ name: "Revenue", values: monthly.map((m) => m.revenue), color: "#059669" }, { name: "Expenditure", values: monthly.map((m) => m.spend), color: "#e11d48" }], format: (n) => fmtMoney(n) };
  const orderChart = { type: "hbar", title: "Profit / loss by order (₹)", labels: orderRows.map((r) => r.order), series: [{ name: "Profit", values: orderRows.map((r) => Math.round(r.profit)) }], signColors: true };
  const marginChart = { type: "hbar", title: "Margin % by order", labels: orderRows.map((r) => r.order), series: [{ name: "Margin", values: orderRows.map((r) => (r.margin === null ? 0 : Math.round(r.margin * 10) / 10)) }], signColors: true, format: (n) => `${Math.round(n)}%` };
  const catChart = { type: "pie", title: "Where the money went", labels: categories.map(([c]) => c), series: [{ name: "Spend", values: categories.map(([, v]) => v) }] };
  const split = { type: "pie", title: "Profitable vs loss-making orders", labels: ["Profit", "Loss"], series: [{ name: "Orders", values: [winners.length, losers.length], colors: ["#059669", "#e11d48"] }], format: (n) => String(Math.round(n)) };
  const charts = [monthChart, orderChart, ...(orderRows.length ? [marginChart, split] : []), catChart];

  const bullets = [
    `Revenue (invoiced) was ${fmtMoney(revenue)}${revChange === null ? "" : `, ${revChange >= 0 ? "up" : "down"} ${Math.abs(Math.round(revChange * 10) / 10)}% on ${prevRange.label}`}.`,
    `Spend was ${fmtMoney(spend)} (logged expenditures) including ${fmtMoney(salaryPaidQ)} of salaries paid${salaryQ ? `, plus an estimated ${fmtMoney(salaryQ)} for months with no salary recorded yet (current base pay)` : ""}. Net ${net >= 0 ? "profit" : "loss"}: ${fmtMoney(Math.abs(net))}${margin === null ? "" : ` (${Math.round(margin * 10) / 10}% of revenue)`}.`,
    orderRows.length ? `${winners.length} order(s) made a profit and ${losers.length} made a loss.` : `No orders were fully invoiced in this ${unit}.`,
    ...(winners[0] ? [`Best order: ${winners[0].order} (${winners[0].customer}) with ${fmtMoney(winners[0].profit)} profit.`] : []),
    ...(losers.length ? [`Biggest loss: ${losers[losers.length - 1].order} (${losers[losers.length - 1].customer}), ${fmtMoney(Math.abs(losers[losers.length - 1].profit))} below cost.`] : []),
    "Order profit = invoiced amount minus raw material, labour and overhead recorded for that order. An order is counted in the period of its latest invoice.",
  ];

  const buildReport = () => ({
    title: `${unit === "quarter" ? "Quarterly" : unit === "half-year" ? "Half-yearly" : "Yearly"} financial report - ${range.label}`,
    subtitle: `${range.from} to ${range.to} - T&P Textiles`,
    filename: `${unit}-report-${range.label.replace(/\s+/g, "-")}`,
    sections: [
      {
        heading: "Summary",
        kpis: [
          { label: "Revenue (invoiced)", value: fmtMoney(revenue) },
          { label: "Expenditure", value: fmtMoney(spend) },
          { label: "Salaries paid", value: fmtMoney(salaryPaidQ) },
          { label: "Est. salaries (unpaid months)", value: fmtMoney(salaryQ) },
          { label: net >= 0 ? "Net profit" : "Net loss", value: fmtMoney(Math.abs(net)) },
          { label: "Profit margin", value: margin === null ? "n/a" : `${Math.round(margin * 10) / 10}%` },
          { label: `Revenue vs last ${unit}`, value: revChange === null ? "n/a" : `${revChange >= 0 ? "+" : ""}${Math.round(revChange * 10) / 10}%` },
          { label: "Profitable orders", value: String(winners.length) },
          { label: "Loss-making orders", value: String(losers.length) },
        ],
        bullets,
      },
      { heading: "Charts", charts },
      {
        heading: "Order profit and loss",
        table: {
          columns: [{ label: "Order" }, { label: "Customer" }, { label: "Revenue", type: "money" }, { label: "Material", type: "money" }, { label: "Labour", type: "money" }, { label: "Overhead", type: "money" }, { label: "Profit", type: "money" }, { label: "Margin", type: "pct" }, { label: "Result" }],
          rows: orderRows.map((r) => [r.order, r.customer, r.revenue, r.material, r.labour, r.overhead, r.profit, r.margin, r.result]),
        },
      },
      { heading: "Monthly", table: { columns: [{ label: "Month" }, { label: "Revenue", type: "money" }, { label: "Expenditure", type: "money" }, { label: "Difference", type: "money" }], rows: monthly.map((m) => [monthName(m.mk), m.revenue, m.spend, m.revenue - m.spend]) } },
      { heading: "Expenditure by category", table: { columns: [{ label: "Category" }, { label: "Amount", type: "money" }, { label: "Share", type: "pct" }], rows: categories.map(([c, v]) => [c, v, spend ? (v / spend) * 100 : 0]) } },
    ],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {picker}
        <ExportBar buildReport={buildReport} />
      </div>
      <p className="text-xs text-stone-500">{range.label}: {range.from} to {range.to}. Indian financial year (April–March).</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Revenue" value={fmtMoney(revenue)} icon={TrendingUp} tone="good" sub={revChange === null ? "No earlier period data" : `${revChange >= 0 ? "+" : ""}${Math.round(revChange * 10) / 10}% vs ${prevRange.label}`} />
        <StatCard label="Expenditure" value={fmtMoney(spend)} icon={Wallet} sub={`incl. ${fmtMoney(salaryPaidQ)} salaries${salaryQ ? ` + ${fmtMoney(salaryQ)} est.` : ""}`} />
        <StatCard label={net >= 0 ? "Net profit" : "Net loss"} value={fmtMoney(Math.abs(net))} icon={net >= 0 ? TrendingUp : TrendingDown} tone={net >= 0 ? "good" : "bad"} sub={prevNet ? `Last ${unit}: ${fmtMoney(prevNet)}` : undefined} />
        <StatCard label="Profit margin" value={margin === null ? "—" : `${Math.round(margin * 10) / 10}%`} icon={Percent} tone={margin !== null && margin < 0 ? "bad" : "good"} sub={`${winners.length} profit · ${losers.length} loss orders`} />
      </div>

      <Card className="p-4">
        <ul className="text-sm text-stone-700 space-y-1.5 list-disc pl-5">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        {charts.map((c) => <ChartCanvas key={c.title} spec={c} height={Math.max(300, c.type === "hbar" ? 60 + c.labels.length * 30 : 300)} />)}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2.5">Order</th><th className="text-right px-3 py-2.5">Revenue</th><th className="text-right px-3 py-2.5">Material</th>
              <th className="text-right px-3 py-2.5">Labour</th><th className="text-right px-3 py-2.5">Overhead</th><th className="text-right px-3 py-2.5">Profit</th>
              <th className="text-right px-3 py-2.5">Margin</th><th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orderRows.map((r) => (
              <tr key={r.order}>
                <td className="px-3 py-2 font-medium">{r.order}<div className="text-xs text-stone-400 font-normal">{r.customer}</div></td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.revenue)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.material)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.labour)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.overhead)}</td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{fmtMoney(r.profit)}</td>
                <td className="px-3 py-2 text-right font-mono">{r.margin === null ? "—" : `${Math.round(r.margin * 10) / 10}%`}</td>
                <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.profit >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{r.result}</span></td>
              </tr>
            ))}
            {orderRows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">No orders invoiced in this period.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
