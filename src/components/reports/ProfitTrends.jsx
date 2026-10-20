import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { linearFit, movingAvg, projectLinear } from "../../lib/stats";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, round1, monthsBetween, monthLabel } from "./common";

const nextMonths = (last, k) => {
  let y = Number(last.slice(0, 4)), m = Number(last.slice(5, 7));
  return Array.from({ length: k }, () => { m += 1; if (m > 12) { m = 1; y += 1; } return `${y}-${String(m).padStart(2, "0")}`; });
};

// Phase 3: profit trends with moving average and a straight-line projection
export default function ProfitTrends() {
  const { range, controls } = useRange("last_12m");
  const state = useData(async () => {
    const [invoices, expenditures] = await Promise.all([
      fetchAll(() => supabase.from("invoices").select("amount, issue_date").gte("issue_date", range.from).lte("issue_date", range.to).order("id")),
      fetchAll(() => supabase.from("expenditures").select("amount, expense_date").gte("expense_date", range.from).lte("expense_date", range.to).order("id")),
    ]);
    return { invoices, expenditures };
  }, JSON.stringify(range));
  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const months = monthsBetween(range.from, range.to);
        const rev = months.map((mk) => sum(d.invoices.filter((i) => (i.issue_date || "").startsWith(mk))));
        const exp = months.map((mk) => sum(d.expenditures.filter((e) => e.expense_date.startsWith(mk))));
        const profit = rev.map((r, i) => r - exp[i]);
        const margin = rev.map((r, i) => (r ? (profit[i] / r) * 100 : 0));
        const ma = movingAvg(profit, 3);
        const fit = linearFit(profit);
        const future = nextMonths(months[months.length - 1], 3);
        const proj = projectLinear(profit, 3);
        const best = profit.indexOf(Math.max(...profit)), worst = profit.indexOf(Math.min(...profit));
        const total = sum(profit, (x) => x);
        const enough = months.length >= 4;
        const labels = [...months, ...future].map(monthLabel);
        const pad = (arr) => [...arr, ...future.map(() => null)];
        return (
          <ReportView
            title="Profit trends"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="profit-trends"
            controls={controls}
            kpis={[
              { label: "Net profit / loss", value: fmtMoney(total), tone: total >= 0 ? "good" : "bad" },
              { label: "Average per month", value: fmtMoney(total / months.length) },
              { label: "Trend", value: enough ? `${fit.slope >= 0 ? "+" : "-"}${fmtMoney(Math.abs(fit.slope))} / month` : "—", tone: fit.slope >= 0 ? "good" : "bad", sub: enough ? (fit.r2 > 0.5 ? "clear trend" : "weak trend — month-to-month swings dominate") : "needs 4+ months" },
              { label: "Best month", value: `${monthLabel(months[best])}`, sub: fmtMoney(profit[best]), tone: "good" },
              { label: "Worst month", value: `${monthLabel(months[worst])}`, sub: fmtMoney(profit[worst]), tone: profit[worst] < 0 ? "bad" : undefined },
              { label: "Next 3 months (projection)", value: enough ? fmtMoney(sum(proj, (x) => x)) : "—", sub: "straight-line, not a promise" },
            ]}
            bullets={[
              enough ? `Profit is ${fit.slope >= 0 ? "rising" : "falling"} by about ${fmtMoney(Math.abs(fit.slope))} a month on average over the period.` : "Choose a longer period (4+ months) to see a trend and projection.",
              `Average margin was ${round1(sum(margin, (x) => x) / months.length)}% of monthly invoiced revenue.`,
            ]}
            charts={[
              { type: "line", title: "Monthly profit, 3-month average and projection (₹)", labels, series: [{ name: "Profit", values: pad(profit.map(Math.round)) }, { name: "3-month average", values: pad(ma.map(Math.round)) }, ...(enough ? [{ name: "Projection", values: [...months.map((_, i) => (i === months.length - 1 ? Math.round(profit[i]) : null)), ...proj.map(Math.round)] }] : [])], format: (n) => fmtMoney(n) },
              { type: "bar", title: "Revenue vs expenses (₹)", labels: months.map(monthLabel), series: [{ name: "Revenue", values: rev.map(Math.round), color: "#059669" }, { name: "Expenses", values: exp.map(Math.round), color: "#e11d48" }], format: (n) => fmtMoney(n) },
              { type: "line", title: "Profit margin (%)", labels: months.map(monthLabel), series: [{ name: "Margin", values: margin.map(round1) }], format: (n) => `${Math.round(n)}%` },
            ]}
            tables={[
              { heading: "Month by month", columns: [{ label: "Month" }, { label: "Revenue", type: "money" }, { label: "Expenses", type: "money" }, { label: "Profit / loss", type: "money" }, { label: "Margin", type: "pct" }, { label: "3-mth average", type: "money" }], rows: months.map((mk, i) => [monthLabel(mk), rev[i], exp[i], profit[i], margin[i], ma[i]]) },
              ...(enough ? [{ heading: "Projection (straight-line trend)", columns: [{ label: "Month" }, { label: "Projected profit", type: "money" }], rows: future.map((mk, i) => [monthLabel(mk), proj[i]]) }] : []),
            ]}
            footnote="Revenue = invoices issued in the month; expenses = logged expenditures. The projection extends the straight-line trend of past profit and ignores seasonality and known future orders."
          />
        );
      }}
    </ReportShell>
  );
}
