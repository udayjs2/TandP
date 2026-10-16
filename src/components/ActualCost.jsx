import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Btn } from "./ui";
import { fmtMoney } from "../lib/helpers";

// Actual cost of one order (Admin only):
//  fabric used x inventory price + thread / elastic / buttons issued x inventory price
//  + expenditures tagged to the order (transport, printing, packing ...) + manpower.
export default function ActualCostModal({ order, piecesMade = 0, revenue = null, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("order_actual_cost", { p_order: order.id }).then(({ data, error }) => {
      if (error) setError(error.message + " (run migration_39.sql if the function is missing)");
      else setData(data);
    });
  }, [order.id]);

  const num = (n) => Number(n || 0);
  const t = data?.totals;
  const perPiece = t && piecesMade > 0 ? t.total / piecesMade : null;

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
          <div className="grid grid-cols-2 gap-2 mb-4 text-center">
            <div className="bg-indigo-50 rounded-lg p-3">
              <div className="text-xl font-mono font-semibold text-indigo-900">{fmtMoney(t.total)}</div>
              <div className="text-[11px] text-stone-500">Actual cost so far</div>
            </div>
            <div className="bg-stone-50 rounded-lg p-3">
              <div className="text-xl font-mono font-semibold">{perPiece !== null ? fmtMoney(perPiece) : "—"}</div>
              <div className="text-[11px] text-stone-500">{piecesMade > 0 ? `per piece (${piecesMade} made)` : "per piece (nothing made yet)"}</div>
            </div>
          </div>
          {revenue !== null && revenue > 0 && (
            <p className="text-sm mb-3">Invoiced {fmtMoney(revenue)} → <b className={revenue - t.total >= 0 ? "text-emerald-700" : "text-rose-700"}>{revenue - t.total >= 0 ? "profit" : "loss"} {fmtMoney(Math.abs(revenue - t.total))}</b> on actual cost.</p>
          )}
          {data.unpriced_lines > 0 && (
            <div className="flex gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-2.5 mb-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{data.unpriced_lines} line{data.unpriced_lines === 1 ? " has" : "s have"} no price in Inventory, so {data.unpriced_lines === 1 ? "it counts" : "they count"} as ₹0. Add the price per kg / metre (fabric) or unit price (trims) in Inventory and the cost updates.</span>
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
