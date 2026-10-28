import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Btn } from "./ui";
import { fmtMoney } from "../lib/helpers";

// Actual cost of one order (Admin only):
//  fabric used x inventory price + thread / elastic / buttons issued x inventory price
//  + expenditures tagged to the order (transport, printing, packing ...) + manpower.
export default function ActualCostModal({ order, piecesMade = 0, revenue = null, bought = null, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [extra, setExtra] = useState(null); // pieces cut / stitched, damaged pieces, what was bought for this order

  useEffect(() => {
    supabase.rpc("order_actual_cost", { p_order: order.id }).then(({ data, error }) => {
      if (error) setError(error.message + " (run migration_39.sql if the function is missing)");
      else setData(data);
    });
  }, [order.id]);

  useEffect(() => {
    (async () => {
      const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0);
      const [{ data: cut }, { data: dmg }, { data: buy }, { data: fin }] = await Promise.all([
        supabase.from("cutting_entries").select("sizes, completed_sizes, status").eq("order_id", order.id),
        supabase.from("cutting_damage").select("stage, total").eq("order_id", order.id),
        supabase.from("expenditures").select("amount").eq("linked_order_id", order.id).eq("category", "Raw Material"),
        supabase.from("order_finance").select("overhead_cost, raw_material_cost").eq("order_id", order.id).maybeSingle(),
      ]);
      const live = (cut || []).filter((c) => c.status !== "Rejected");
      setExtra({
        cutPieces: live.filter((c) => c.status === "Approved").reduce((a, c) => a + sum(c.sizes), 0),
        stitched: live.reduce((a, c) => a + sum(c.completed_sizes), 0),
        dmgCut: (dmg || []).filter((d) => d.stage === "Cutting").reduce((a, d) => a + Number(d.total || 0), 0),
        dmgStitch: (dmg || []).filter((d) => d.stage === "Stitching").reduce((a, d) => a + Number(d.total || 0), 0),
        boughtMaterial: (buy || []).length ? buy.reduce((a, e) => a + Number(e.amount || 0), 0) : Number(fin?.raw_material_cost || 0),
        overhead: Number(fin?.overhead_cost || 0),
      });
    })();
  }, [order.id]);

  const num = (n) => Number(n || 0);
  const t = data?.totals;
  // pieces for the per-piece price: pieces stitched (made) first, then the Orders-tab count, then pieces cut
  const made = extra?.stitched > 0 ? extra.stitched : piecesMade;
  const pieces = made > 0 ? made : num(extra?.cutPieces);
  const piecesNote = made > 0 ? `${pieces} pieces made` : pieces > 0 ? `${pieces} pieces cut (none stitched yet)` : null;
  const perPiece = t && pieces > 0 ? t.total / pieces : null;
  const pp = (v) => (pieces > 0 ? fmtMoney(num(v) / pieces) : "—");
  const fabricMetric = (() => {
    const kg = (data?.fabric || []).reduce((a, f) => a + num(f.kg_used), 0), m = (data?.fabric || []).reduce((a, f) => a + num(f.meters_used), 0);
    const base = num(extra?.cutPieces) || pieces;
    if (!base || (!kg && !m)) return null;
    return [kg ? `${(kg / base).toFixed(3)} kg` : null, m ? `${(m / base).toFixed(3)} m` : null].filter(Boolean).join(" + ") + " per piece cut";
  })();
  // fabric & trims bought for this order vs. what the cutting / issues actually used
  const usedStock = t ? num(t.fabric) + num(t.materials) : 0;
  const boughtStock = extra ? (bought ? num(bought.material) : num(extra.boughtMaterial)) : 0;
  const leftover = boughtStock - usedStock;

  const Section = ({ title, total, children, empty }) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-semibold uppercase text-stone-600">{title}</h4>
        <span className="font-mono text-sm font-semibold">{fmtMoney(total)}</span>
      </div>
      {empty ? <p className="text-xs text-stone-400">{empty}</p> : <div className="border border-stone-100 rounded-lg divide-y divide-stone-100 text-sm">{children}</div>}
    </div>
  );
  const Row = ({ left, sub, right }) => (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0"><div className="truncate">{left}</div>{sub && <div className="text-xs text-stone-400">{sub}</div>}</div>
      <div className="font-mono text-sm shrink-0">{right}</div>
    </div>
  );

  return (
    <Modal title={`Actual cost — ${order.order_number}`} onClose={onClose}>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data && !error && <p className="text-sm text-stone-500">Calculating…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2 text-center">
            <div className="bg-indigo-50 rounded-lg p-3" data-testid="cost-used">
              <div className="text-xl font-mono font-semibold text-indigo-900">{fmtMoney(t.total)}</div>
              <div className="text-[11px] text-stone-500">Cost of what was used (fabric by cutting + trims + expenses + labour)</div>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3" data-testid="cost-per-piece">
              <div className="text-xl font-mono font-semibold text-emerald-900">{perPiece !== null ? fmtMoney(perPiece) : "—"}</div>
              <div className="text-[11px] text-stone-500">{piecesNote ? `Cost per piece · ${piecesNote}` : "Cost per piece (nothing cut or made yet)"}</div>
            </div>
          </div>
          {bought && (
            <div className="bg-stone-50 rounded-lg p-3 mb-4 flex items-center justify-between gap-3" data-testid="cost-bought">
              <div>
                <div className="text-[11px] text-stone-500">Actual cost so far — as bought (the Order Profitability figure)</div>
                <div className="text-[11px] text-stone-400">Raw material {fmtMoney(bought.material)} + labour {fmtMoney(bought.labor)} + overhead {fmtMoney(bought.overhead)}</div>
              </div>
              <div className="font-mono font-semibold">{fmtMoney(bought.total)}</div>
            </div>
          )}
          {extra && (extra.dmgCut + extra.dmgStitch > 0) && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 mb-3">
              Damaged pieces: {extra.dmgCut} during cutting · {extra.dmgStitch} during stitching. Their cost is already inside the figures above, so it is carried by the good pieces.
            </p>
          )}
          <div className="border border-stone-200 rounded-lg mb-4 overflow-hidden" data-testid="per-piece-table">
            <div className="bg-stone-50 px-3 py-1.5 text-xs font-semibold uppercase text-stone-600">Cost per piece</div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {[["Fabric used in cutting", t.fabric, fabricMetric], ["Thread, elastic & trims", t.materials], ["Other expenses (transport, printing, packing…)", t.other], ["Labour", t.manpower]].map(([label, v, sub]) => (
                  <tr key={label}><td className="px-3 py-1.5">{label}{sub && <div className="text-[11px] text-stone-400">{sub}</div>}</td><td className="px-3 py-1.5 text-right font-mono text-stone-500">{fmtMoney(v)}</td><td className="px-3 py-1.5 text-right font-mono w-28">{pp(v)}</td></tr>
                ))}
                <tr className="font-semibold bg-stone-50"><td className="px-3 py-1.5">Total</td><td className="px-3 py-1.5 text-right font-mono">{fmtMoney(t.total)}</td><td className="px-3 py-1.5 text-right font-mono">{pp(t.total)}</td></tr>
              </tbody>
            </table>
            <div className="px-3 py-1 text-[11px] text-stone-400">Columns: total for the order · per piece.</div>
          </div>
          {revenue !== null && revenue > 0 && (
            <p className="text-sm mb-3">Invoiced {fmtMoney(revenue)} → <b className={revenue - t.total >= 0 ? "text-emerald-700" : "text-rose-700"}>{revenue - t.total >= 0 ? "profit" : "loss"} {fmtMoney(Math.abs(revenue - t.total))}</b> on the cost of what was used{bought ? <> (<span className={revenue - bought.total >= 0 ? "text-emerald-700" : "text-rose-700"}>{fmtMoney(revenue - bought.total)}</span> on cost as bought)</> : null}.</p>
          )}
          {data.unpriced_lines > 0 && (
            <div className="flex gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-2.5 mb-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{data.unpriced_lines} line{data.unpriced_lines === 1 ? " has" : "s have"} no price in Inventory, so {data.unpriced_lines === 1 ? "it counts" : "they count"} as ₹0. Add the price per kg / metre (fabric) or unit price (trims) in Inventory and the cost updates.</span>
            </div>
          )}

          {extra && (boughtStock > 0 || usedStock > 0) && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-4 text-xs text-amber-950" data-testid="leftover-box">
              <div className="font-semibold mb-1">Bulk buying and leftover fabric</div>
              <div className="font-mono">Bought for this order {fmtMoney(boughtStock)} − used by cutting & trims {fmtMoney(usedStock)} = {leftover >= 0 ? `${fmtMoney(leftover)} leftover` : `${fmtMoney(-leftover)} taken from earlier stock`}</div>
              <ul className="list-disc pl-4 mt-1.5 space-y-0.5 text-amber-900">
                <li>Only the fabric and trims <b>used</b> are charged to this order (at the Inventory price per kg / metre), so buying extra does not make this order look expensive.</li>
                <li>{leftover >= 0 ? "The leftover stays in Inventory as stock, not as a loss. It is only a loss if it is scrapped or never used." : "More was used than was bought for this order, so the balance came from stock bought earlier (or for other orders)."}</li>
                <li>When leftover fabric is cut for another order, that order is charged for it at the Inventory price (a weighted average that updates with every purchase). This order's cost does not change, and nothing is counted twice.</li>
                <li>Company-wide, purchases count as spending when bought (Finance). Per order, cost counts when used. The difference between the two is the stock held in Inventory.</li>
              </ul>
            </div>
          )}
          <Section title="Fabric used" total={t.fabric} empty={data.fabric.length === 0 ? "No fabric cut for this order yet." : null}>
            {data.fabric.map((f, i) => (
              <Row key={i} left={`${f.fabric_type || "Fabric"}${f.color ? ` · ${f.color}` : ""}`}
                sub={`${num(f.kg_used) ? `${f.kg_used} kg × ${num(f.price_per_kg) ? fmtMoney(f.price_per_kg) : "no price"}` : ""}${num(f.kg_used) && num(f.meters_used) ? " + " : ""}${num(f.meters_used) ? `${f.meters_used} m × ${num(f.price_per_meter) ? fmtMoney(f.price_per_meter) : "no price"}` : ""} · ${f.cut_date}`}
                right={fmtMoney(f.cost)} />
            ))}
          </Section>

          <Section title="Thread, elastic, buttons & trims issued" total={t.materials} empty={data.materials.length === 0 ? "Nothing issued from Inventory for this order. Use “Issue to order” in Inventory → Items." : null}>
            {data.materials.map((m, i) => (
              <Row key={i} left={`${m.item_name}`} sub={`${m.quantity} ${m.unit || ""} × ${num(m.unit_price) ? fmtMoney(m.unit_price) : "no price"} · ${m.used_on}`} right={fmtMoney(m.cost)} />
            ))}
          </Section>

          <Section title={`Other expenses for this order${num(t.transport) ? ` (transport ${fmtMoney(t.transport)})` : ""}`} total={t.other} empty={data.other.length === 0 ? "No expenditures tagged to this order. Tag transport, printing, packing etc. to the order in Finance → Expenditures." : null}>
            {data.other.map((e, i) => (
              <Row key={i} left={`${e.item || e.category}`} sub={`${e.category}${e.vendor ? ` · ${e.vendor}` : ""} · ${e.expense_date}`} right={fmtMoney(e.amount)} />
            ))}
          </Section>

          <Section title="Manpower" total={t.manpower} empty={data.crew.length === 0 ? "No people allocated to this order yet." : null}>
            {Object.values(data.crew.reduce((m, c) => { (m[c.name] = m[c.name] || { name: c.name, days: 0, cost: 0 }); m[c.name].days += 1; m[c.name].cost += num(c.cost); return m; }, {})).map((c) => (
              <Row key={c.name} left={c.name} sub={`${c.days} day${c.days === 1 ? "" : "s"}`} right={fmtMoney(c.cost)} />
            ))}
          </Section>
          <p className="text-[11px] text-stone-400 -mt-2 mb-3">Manpower = each person's daily wage (base salary ÷ days in month), shared across the orders they were allocated to that day.</p>

          {data.stock_purchases.length > 0 && (
            <p className="text-[11px] text-stone-400 mb-3">
              Fabric / accessory purchase requests for this order ({fmtMoney(data.stock_purchases.reduce((s, x) => s + num(x.amount), 0))}) are not added again: they went into Inventory, and the order is charged for the stock it actually used.
            </p>
          )}
        </>
      )}
      <div className="flex justify-end"><Btn variant="ghost" onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}
