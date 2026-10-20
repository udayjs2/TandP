import ReportView from "../ReportView";
import { todayStr } from "../../lib/helpers";
import { addDays, daysBetween, isSunday, shortDate } from "../../lib/analytics";
import { linearFit, projectLinear } from "../../lib/stats";
import { supabase, fetchAll, useData, ReportShell, sum, groupBy, itemsQty, round1 } from "./common";

const mondayOf = (d) => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, -((dow + 6) % 7)); };

// Phase 3: weekly output forecast + projected finish date of every open order
export default function ProductionForecast() {
  const state = useData(async () => {
    const today = todayStr();
    const from = addDays(mondayOf(today), -7 * 8);
    const [progress, orders] = await Promise.all([
      fetchAll(() => supabase.from("order_progress").select("order_id, date, quantity").gte("date", from).order("order_id").order("date")),
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, items, daily_target, due_date, status").order("id")),
    ]);
    const open = orders.filter((o) => !["Completed", "Shipped"].includes(o.status)).slice(0, 50);
    const sums = await Promise.all(open.map((o) => supabase.rpc("order_count_summary", { p_order_id: o.id }).then((r) => [o.id, Number(r.data?.stitched || 0)])));
    return { progress, open, stitched: Object.fromEntries(sums), from };
  }, "forecast");

  return (
    <ReportShell state={state} controls={null}>
      {(d) => {
        const today = todayStr();
        const thisMon = mondayOf(today);
        const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisMon, -7 * (8 - i)));  // 8 full past weeks (Mon starts)
        const wk = (dt) => mondayOf(dt);
        const byWeek = groupBy(d.progress, (p) => wk(p.date));
        const weekly = weeks.map((w) => sum(byWeek[w] || [], (p) => p.quantity));
        const nz = weekly.filter((x) => x > 0).length;
        const fit = linearFit(weekly);
        const fc = projectLinear(weekly, 4, true);
        const avgWeek = sum(weekly, (x) => x) / 8;
        const last4 = sum(weekly.slice(4), (x) => x) / 4;
        // daily run-rate over the last 14 days (working days only)
        const since = addDays(today, -13);
        const recent = d.progress.filter((p) => p.date >= since);
        const recentByDay = groupBy(recent, (p) => p.date);
        const workDays = Object.keys(recentByDay).filter((k) => sum(recentByDay[k], (p) => p.quantity) > 0 && !isSunday(k)).length;
        const companyDaily = workDays ? sum(recent, (p) => p.quantity) / workDays : 0;
        const activeOrders = d.open.filter((o) => recent.some((p) => p.order_id === o.id));
        const share = activeOrders.length || 1;
        const rows = d.open.map((o) => {
          const ordered = itemsQty(o.items), done = d.stitched[o.id] || 0, left = Math.max(0, ordered - done);
          const mine = recent.filter((p) => p.order_id === o.id);
          const myDays = new Set(mine.filter((p) => Number(p.quantity) > 0).map((p) => p.date)).size;
          const rate = myDays ? sum(mine, (p) => p.quantity) / myDays : Number(o.daily_target) > 0 ? Number(o.daily_target) : companyDaily / share;
          const basis = myDays ? "recent output" : Number(o.daily_target) > 0 ? "daily target" : "company average";
          let eta = null;
          if (left > 0 && rate > 0) { let n = Math.ceil(left / rate), dt = today; while (n > 0) { dt = addDays(dt, 1); if (!isSunday(dt)) n -= 1; } eta = dt; }
          else if (left === 0) eta = today;
          const slack = eta && o.due_date ? daysBetween(eta, o.due_date) : null; // + = days to spare
          const state = left === 0 ? "Cut/stitch complete" : !eta ? "No output rate" : slack === null ? "No due date" : slack < 0 ? "Will miss due date" : slack <= 2 ? "Tight" : "On track";
          return { o, ordered, done, left, rate, basis, eta, slack, state };
        }).sort((a, b) => (a.slack ?? 9999) - (b.slack ?? 9999));
        const atRisk = rows.filter((r) => r.state === "Will miss due date").length;
        const remaining = sum(rows, (r) => r.left);
        const daysAll = companyDaily ? Math.ceil(remaining / companyDaily) : null;
        const labels = [...weeks, ...Array.from({ length: 4 }, (_, i) => addDays(thisMon, 7 * i))].map(shortDate);
        return (
          <ReportView
            title="Production forecast"
            subtitle={`Based on the last 8 weeks of output, as of ${today} - T&P Textiles`}
            filename="production-forecast"
            kpis={[
              { label: "Avg output / week (8 wks)", value: Math.round(avgWeek).toLocaleString("en-IN"), sub: `last 4 weeks: ${Math.round(last4).toLocaleString("en-IN")}` },
              { label: "Output trend", value: nz >= 4 ? `${fit.slope >= 0 ? "+" : "-"}${Math.round(Math.abs(fit.slope))} pcs / week` : "—", tone: fit.slope >= 0 ? "good" : "bad", sub: nz >= 4 ? undefined : "needs 4+ weeks of output" },
              { label: "Forecast next 4 weeks", value: nz >= 4 ? Math.round(sum(fc, (x) => x)).toLocaleString("en-IN") : "—", sub: "pieces, straight-line" },
              { label: "Pieces still to stitch", value: Math.round(remaining).toLocaleString("en-IN"), sub: `${rows.length} open order(s)` },
              { label: "Daily run-rate", value: Math.round(companyDaily).toLocaleString("en-IN"), sub: `${workDays} working day(s) in last 14` },
              { label: "Orders that will miss due date", value: String(atRisk), tone: atRisk ? "bad" : "good", sub: daysAll ? `all open work ≈ ${daysAll} working days at today's rate` : undefined },
            ]}
            charts={[
              { type: "bar", title: "Weekly output (pieces) and forecast", labels, series: [{ name: "Actual", values: [...weekly.map(Math.round), ...fc.map(() => 0)] , color: "#4338ca" }, { name: "Forecast", values: [...weekly.map(() => 0), ...fc.map(Math.round)], color: "#f59e0b" }], format: (n) => String(Math.round(n)) },
            ]}
            tables={[{
              heading: "Projected finish of open orders",
              columns: [{ label: "Order" }, { label: "Customer" }, { label: "Ordered", type: "int" }, { label: "Stitched", type: "int" }, { label: "Left", type: "int" }, { label: "Pieces / day", type: "int" }, { label: "Rate from" }, { label: "Projected finish" }, { label: "Due" }, { label: "Days to spare", type: "int" }, { label: "Outlook" }],
              rows: rows.map((r) => [r.o.order_number, r.o.customer_name, r.ordered, r.done, r.left, r.rate, r.basis, r.eta || "—", r.o.due_date || "—", r.slack, r.state]),
            }]}
            footnote="Projected finish = pieces left ÷ the order's recent daily output (or its daily target, or a share of the company run-rate when there is no recent output), skipping Sundays. It assumes each order keeps its current pace."
          />
        );
      }}
    </ReportShell>
  );
}
