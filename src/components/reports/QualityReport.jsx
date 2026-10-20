import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll } from "./common";

// 4. Quality: defect rates, rejection costs, rework, inspection results, quality by order / inspector
export default function QualityReport({ profile }) {
  const { range, controls } = useRange("last_30");
  const isAdmin = profile?.role === "admin";
  const state = useData(async () => {
    const [insp, orders, fin] = await Promise.all([
      fetchAll(() => supabase.from("quality_inspections").select("id, order_id, decision, checks, inspected_qty, defective_qty, stitched_total, inspected_by_name, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("created_at")),
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name").order("id")),
      isAdmin ? safeAll(() => supabase.from("order_finance").select("*").order("order_id")) : Promise.resolve([]),
    ]);
    // inspections of the same orders before the period tell us whether a rejected order was later approved (rework)
    const ids = [...new Set(insp.map((i) => i.order_id))];
    const history = ids.length ? await safeAll(() => supabase.from("quality_inspections").select("order_id, decision, created_at").in("order_id", ids).order("created_at")) : [];
    return { insp, orders, fin, history };
  }, JSON.stringify(range) + isAdmin);

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const ord = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        const finBy = Object.fromEntries(d.fin.map((f) => [f.order_id, f]));
        const rejected = d.insp.filter((i) => i.decision === "Rejected");
        const approvedN = d.insp.length - rejected.length;
        const inspected = sum(d.insp, (i) => i.inspected_qty);
        const defective = sum(d.insp, (i) => i.defective_qty);
        const defectRate = pct(defective, inspected);
        const passRate = pct(approvedN, d.insp.length);
        // rework: orders rejected at least once and approved afterwards
        const hist = groupBy(d.history, (h) => h.order_id);
        const reworked = Object.values(hist).filter((hs) => { const ri = hs.findIndex((h) => h.decision === "Rejected"); return ri >= 0 && hs.slice(ri + 1).some((h) => h.decision === "Approved"); }).length;
        const costPerPiece = (oid, stitched) => { const f = finBy[oid]; if (!f || !stitched) return null; return (Number(f.raw_material_cost || 0) + Number(f.labor_cost || 0) + Number(f.overhead_cost || 0)) / stitched; };
        let rejCost = 0;
        d.insp.forEach((i) => { const c = costPerPiece(i.order_id, Number(i.stitched_total)); if (c) rejCost += c * Number(i.defective_qty || 0); });
        const fails = {};
        d.insp.forEach((i) => (i.checks || []).forEach((c) => { if (c.result === "Fail") fails[c.label || c.key] = (fails[c.label || c.key] || 0) + 1; }));
        const failRows = Object.entries(fails).sort((a, b) => b[1] - a[1]);
        const byOrder = Object.entries(groupBy(d.insp, (i) => i.order_id)).map(([oid, is]) => {
          const ins = sum(is, (i) => i.inspected_qty), def = sum(is, (i) => i.defective_qty);
          return [ord[oid]?.order_number || "—", ord[oid]?.customer_name || "—", is.length, is.filter((i) => i.decision === "Rejected").length, ins, def, pct(def, ins)];
        }).sort((a, b) => (b[6] ?? -1) - (a[6] ?? -1));
        const byInsp = Object.entries(groupBy(d.insp, (i) => i.inspected_by_name || "—")).map(([n, is]) => {
          const ins = sum(is, (i) => i.inspected_qty), def = sum(is, (i) => i.defective_qty);
          return [n, is.length, is.filter((i) => i.decision === "Rejected").length, ins, def, pct(def, ins)];
        });
        return (
          <ReportView
            title="Quality report"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="quality-report"
            controls={controls}
            kpis={[
              { label: "Inspections", value: String(d.insp.length) },
              { label: "Pass rate", value: passRate === null ? "—" : `${round1(passRate)}%`, tone: passRate !== null && passRate < 80 ? "warn" : "good", sub: `${rejected.length} rejected` },
              { label: "Defect rate", value: defectRate === null ? "—" : `${round1(defectRate)}%`, tone: defectRate !== null && defectRate > 5 ? "bad" : "good", sub: `${Math.round(defective)} of ${Math.round(inspected)} pieces` },
              { label: "Orders reworked & passed", value: String(reworked), sub: "rejected, fixed, then approved" },
              { label: "Rejection cost (estimate)", value: isAdmin ? fmtMoney(rejCost) : "Admin only", sub: isAdmin ? "defective pieces × order cost per piece" : undefined },
            ]}
            charts={[
              { type: "pie", title: "Inspection results", labels: ["Approved", "Rejected"], series: [{ name: "Inspections", values: [approvedN, rejected.length], colors: ["#059669", "#e11d48"] }], format: (n) => String(Math.round(n)) },
              ...(failRows.length ? [{ type: "hbar", title: "Most common failed checks", labels: failRows.slice(0, 10).map((r) => r[0]), series: [{ name: "Failures", values: failRows.slice(0, 10).map((r) => r[1]) }], format: (n) => String(Math.round(n)) }] : []),
              ...(byOrder.some((r) => r[6]) ? [{ type: "hbar", title: "Defect rate by order (%)", labels: byOrder.slice(0, 10).map((r) => r[0]), series: [{ name: "Defect %", values: byOrder.slice(0, 10).map((r) => Math.round((r[6] || 0) * 10) / 10) }], format: (n) => `${Math.round(n)}%` }] : []),
            ]}
            tables={[
              { heading: "Quality by order", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Inspections", type: "int" }, { label: "Rejected", type: "int" }, { label: "Inspected pcs", type: "int" }, { label: "Defective pcs", type: "int" }, { label: "Defect rate", type: "pct" }], rows: byOrder },
              { heading: "Quality by inspector", columns: [{ label: "Inspector" }, { label: "Inspections", type: "int" }, { label: "Rejected", type: "int" }, { label: "Inspected pcs", type: "int" }, { label: "Defective pcs", type: "int" }, { label: "Defect rate", type: "pct" }], rows: byInsp },
              { heading: "Failed checks", columns: [{ label: "Check" }, { label: "Failures", type: "int" }], rows: failRows },
            ]}
            footnote="Inspections are recorded per order, so quality is reported by order and by inspector. Rejection cost is an estimate from the order's recorded costs and is visible to the Admin only."
          />
        );
      }}
    </ReportShell>
  );
}
