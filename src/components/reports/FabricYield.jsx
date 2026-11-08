import { useState } from "react";
import ReportView from "../ReportView";
import { inputCls } from "../ui";
import { supabase, fetchAll, useData, ReportShell, sum, sumSizes, safeAll } from "./common";

const r1 = (n) => Math.round(n * 10) / 10;
const name = (f) => `${f.fabric_type}${f.color ? ` - ${f.color}` : ""}${f.weight_gsm ? ` (${f.weight_gsm} GSM)` : ""}`;

// For every fabric: pieces cut, dresses made (stitched), fabric used, fabric per dress and — from what is left in
// stock — how many more dresses it should make at the same average use.
export default function FabricYield() {
  const [fabricId, setFabricId] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const state = useData(async () => {
    const [fabrics, usage, entries] = await Promise.all([
      fetchAll(() => supabase.from("inventory_fabric").select("*").order("fabric_type")),
      safeAll(() => supabase.from("fabric_usage").select("fabric_id, cutting_entry_id, kg_used, meters_used, restored").order("created_at")),
      safeAll(() => supabase.from("cutting_entries").select("id, item_description, sizes, completed_sizes, status").order("created_at")),
    ]);
    return { fabrics, usage, entries };
  }, "fabric-yield");

  const controls = (
    <>
      {state.data && (
        <select className={inputCls + " w-auto"} value={fabricId} onChange={(e) => setFabricId(e.target.value)} aria-label="Fabric">
          <option value="">All fabrics</option>
          {state.data.fabrics.map((f) => <option key={f.id} value={f.id}>{name(f)}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-sm text-stone-600">
        <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} aria-label="Only fabric in stock" /> Only fabric in stock
      </label>
    </>
  );

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const entry = Object.fromEntries(d.entries.map((e) => [e.id, e]));
        const live = d.usage.filter((u) => !u.restored && entry[u.cutting_entry_id] && entry[u.cutting_entry_id].status !== "Rejected");
        // an entry that drew on more than one fabric is shared out by the fabric each one gave
        const entryKg = {};
        live.forEach((u) => { entryKg[u.cutting_entry_id] = (entryKg[u.cutting_entry_id] || 0) + Number(u.kg_used || 0) + Number(u.meters_used || 0); });
        const entryParts = {};
        live.forEach((u) => { entryParts[u.cutting_entry_id] = (entryParts[u.cutting_entry_id] || 0) + 1; });
        const byFabric = {}; // fabricId -> { kg, m, cut, made, items: { item -> same } }
        const bump = (o, kg, m, cut, made) => { o.kg += kg; o.m += m; o.cut += cut; o.made += made; };
        live.forEach((u) => {
          const e = entry[u.cutting_entry_id];
          const tot = entryKg[u.cutting_entry_id];
          const share = tot > 0 ? (Number(u.kg_used || 0) + Number(u.meters_used || 0)) / tot : 1 / entryParts[u.cutting_entry_id];
          const cut = sumSizes(e.sizes) * share, made = sumSizes(e.completed_sizes) * share;
          const f = (byFabric[u.fabric_id] = byFabric[u.fabric_id] || { kg: 0, m: 0, cut: 0, made: 0, items: {} });
          bump(f, Number(u.kg_used || 0), Number(u.meters_used || 0), cut, made);
          const it = (f.items[e.item_description] = f.items[e.item_description] || { kg: 0, m: 0, cut: 0, made: 0 });
          bump(it, Number(u.kg_used || 0), Number(u.meters_used || 0), cut, made);
        });
        // how many dresses the stock left would make at this much fabric per piece (kg first, else metres)
        const predict = (stockKg, stockM, o) => {
          if (!(o.cut > 0)) return null;
          if (o.kg > 0) return Math.floor(stockKg / (o.kg / o.cut));
          if (o.m > 0) return Math.floor(stockM / (o.m / o.cut));
          return null;
        };
        const per = (o) => (o.cut > 0 ? (o.kg > 0 ? `${(o.kg / o.cut).toFixed(3)} kg` : o.m > 0 ? `${(o.m / o.cut).toFixed(2)} m` : "—") : "—");

        let fabs = d.fabrics.filter((f) => (!fabricId || f.id === fabricId) && (!inStockOnly || Number(f.stock_kg) > 0 || Number(f.stock_meters) > 0));
        const summary = fabs.map((f) => {
          const o = byFabric[f.id] || { kg: 0, m: 0, cut: 0, made: 0, items: {} };
          const p = predict(Number(f.stock_kg || 0), Number(f.stock_meters || 0), o);
          return { f, o, p };
        });
        const summaryRows = summary.map(({ f, o, p }) => [
          name(f), r1(Number(f.stock_kg || 0)), r1(Number(f.stock_meters || 0)), r1(o.kg), Math.round(o.cut), Math.round(o.made), per(o), p == null ? "no cutting yet" : p,
        ]);
        const itemRows = [];
        summary.forEach(({ f, o }) => {
          Object.entries(o.items).sort((a, b) => b[1].cut - a[1].cut).forEach(([item, x]) => {
            const p = predict(Number(f.stock_kg || 0), Number(f.stock_meters || 0), x);
            itemRows.push([name(f), item, r1(x.kg), Math.round(x.cut), Math.round(x.made), per(x), p == null ? "—" : p]);
          });
        });
        const totalCut = Math.round(sum(summary, (s) => s.o.cut)), totalMade = Math.round(sum(summary, (s) => s.o.made));
        const totalLeftKg = r1(sum(summary, (s) => s.f.stock_kg));
        const totalPred = sum(summary, (s) => s.p || 0);
        const top = summary.filter((s) => s.p != null && s.p > 0).sort((a, b) => b.p - a.p).slice(0, 10);
        const noHistory = summary.filter((s) => s.p == null && (Number(s.f.stock_kg) > 0 || Number(s.f.stock_meters) > 0)).length;
        return (
          <ReportView
            title="Fabric yield & forecast"
            subtitle="All cutting to date, by fabric - T&P Textiles"
            filename="fabric-yield-forecast"
            controls={controls}
            kpis={[
              { label: "Pieces cut", value: String(totalCut), sub: `${summary.filter((s) => s.o.cut > 0).length} fabric(s) used` },
              { label: "Dresses made (stitched)", value: String(totalMade), tone: "good", sub: totalCut ? `${Math.round((totalMade / totalCut) * 100)}% of pieces cut` : undefined },
              { label: "Fabric left in stock", value: `${totalLeftKg} kg` },
              { label: "More dresses possible", value: String(totalPred), tone: "good", sub: noHistory ? `${noHistory} fabric(s) not cut yet - no estimate` : "from the fabric left" },
            ]}
            charts={top.length ? [{ type: "hbar", title: "More dresses the leftover fabric can make", labels: top.map((s) => name(s.f)), series: [{ name: "Dresses", values: top.map((s) => s.p) }] }] : []}
            tables={[
              { heading: "By fabric", columns: [{ label: "Fabric" }, { label: "Left (kg)", type: "num" }, { label: "Left (m)", type: "num" }, { label: "Used (kg)", type: "num" }, { label: "Pieces cut", type: "int" }, { label: "Dresses made", type: "int" }, { label: "Fabric per dress" }, { label: "More dresses possible" }], rows: summaryRows },
              { heading: "By fabric and garment", columns: [{ label: "Fabric" }, { label: "Garment" }, { label: "Used (kg)", type: "num" }, { label: "Pieces cut", type: "int" }, { label: "Dresses made", type: "int" }, { label: "Fabric per dress" }, { label: "More dresses possible" }], rows: itemRows },
            ]}
            footnote="Pieces cut and fabric used come from approved / submitted cutting entries (rejected entries give their fabric back). Dresses made are the pieces stitched against those entries. 'More dresses possible' = fabric left ÷ the average fabric one dress has used so far, for the same garment mix; larger sizes use more fabric, so treat it as an estimate. A fabric that has not been cut yet has no history to estimate from."
          />
        );
      }}
    </ReportShell>
  );
}
