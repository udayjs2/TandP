import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, safeAll } from "./common";

// Phase 3: recorded cost sheet (Finance -> Order Profitability) versus the actual cost of each order
export default function CostVariance() {
  const { range, controls } = useRange("last_12m");
  const state = useData(async () => {
    const [orders, invoices, fin] = await Promise.all([
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, status").order("id")),
      fetchAll(() => supabase.from("invoices").select("linked_order_id, issue_date").order("id")),
      safeAll(() => supabase.from("order_finance").select("*").order("order_id")),
    ]);
    // orders with a cost sheet and either invoiced or finished in the period
    const inPeriod = new Set(invoices.filter((i) => i.linked_order_id && i.issue_date >= range.from && i.issue_date <= range.to).map((i) => i.linked_order_id));
    const ids = fin.filter((f) => inPeriod.has(f.order_id)).map((f) => f.order_id).slice(0, 80);
    const acts = await Promise.all(ids.map((id) => supabase.rpc("order_actual_cost", { p_order: id }).then((r) => [id, r.data?.totals || null])));
    return { orders, fin, acts: Object.fromEntries(acts), ids };
  }, JSON.stringify(range));
  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const ord = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        const fin = Object.fromEntries(d.fin.map((f) => [f.order_id, f]));
        const rows = d.ids.map((id) => {
          const f = fin[id], a = d.acts[id]; if (!a) return null;
          const eMat = Number(f.raw_material_cost || 0), eLab = Number(f.labor_cost || 0), eOvh = Number(f.overhead_cost || 0);
          const aMat = Number(a.fabric || 0) + Number(a.materials || 0), aLab = Number(a.manpower || 0), aOvh = Number(a.other || 0);
          const est = eMat + eLab + eOvh, act = aMat + aLab + aOvh;
          return { id, order: ord[id]?.order_number || "—", cust: ord[id]?.customer_name || "—", eMat, aMat, eLab, aLab, eOvh, aOvh, est, act, var: act - est, varPct: est ? ((act - est) / est) * 100 : null };
        }).filter(Boolean).sort((a, b) => b.var - a.var);
        const over = rows.filter((r) => r.var > 0);
        const tot = (k) => sum(rows, (r) => r[k]);
        return (
          <ReportView
            title="Cost variance"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="cost-variance"
            controls={controls}
            kpis={[
              { label: "Orders compared", value: String(rows.length) },
              { label: "Recorded cost sheets", value: fmtMoney(tot("est")) },
              { label: "Actual cost", value: fmtMoney(tot("act")) },
              { label: tot("var") > 0 ? "Overrun" : "Saving", value: fmtMoney(Math.abs(tot("var"))), tone: tot("var") > 0 ? "bad" : "good", sub: tot("est") ? `${Math.round(Math.abs(pct(tot("var"), tot("est"))) * 10) / 10}% ${tot("var") > 0 ? "over" : "under"}` : undefined },
              { label: "Orders over cost sheet", value: `${over.length} / ${rows.length}`, tone: over.length ? "warn" : "good" },
              { label: "Largest overrun", value: over[0] ? over[0].order : "—", sub: over[0] ? fmtMoney(over[0].var) : undefined, tone: "bad" },
            ]}
            charts={[
              ...(rows.length ? [{ type: "bar", title: "Cost sheet vs actual by cost type (₹)", labels: ["Materials", "Labour", "Overhead / other"], series: [{ name: "Cost sheet", values: [tot("eMat"), tot("eLab"), tot("eOvh")].map(Math.round), color: "#94a3b8" }, { name: "Actual", values: [tot("aMat"), tot("aLab"), tot("aOvh")].map(Math.round), color: "#4338ca" }], format: (n) => fmtMoney(n) }] : []),
              ...(rows.length ? [{ type: "hbar", title: "Variance by order (₹, + = over)", labels: rows.slice(0, 15).map((r) => r.order), series: [{ name: "Variance", values: rows.slice(0, 15).map((r) => Math.round(r.var)) }], signColors: false }] : []),
            ]}
            tables={[{
              heading: "Order-wise cost variance",
              columns: [{ label: "Order" }, { label: "Customer" }, { label: "Materials: sheet", type: "money" }, { label: "Materials: actual", type: "money" }, { label: "Labour: sheet", type: "money" }, { label: "Labour: actual", type: "money" }, { label: "Overhead: sheet", type: "money" }, { label: "Other: actual", type: "money" }, { label: "Total variance", type: "money" }, { label: "Variance %", type: "pct" }],
              rows: rows.map((r) => [r.order, r.cust, r.eMat, r.aMat, r.eLab, r.aLab, r.eOvh, r.aOvh, r.var, r.varPct]),
            }]}
            footnote="'Cost sheet' is the raw material, labour and overhead you entered per order in Finance → Order Profitability. 'Actual' is calculated from fabric used, trims issued, tagged expenditures and manpower. A positive variance means the order cost more than the sheet. Only orders with a cost sheet and an invoice in the period are compared."
          />
        );
      }}
    </ReportShell>
  );
}
