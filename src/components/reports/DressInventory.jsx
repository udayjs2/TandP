import { useState } from "react";
import ReportView from "../ReportView";
import { inputCls } from "../ui";
import { supabase, useData, ReportShell, sum } from "./common";
import { fmtMoney } from "../../lib/helpers";

// Finished dresses: how many were made, how many sold (dispatched), what is left in store and what that is worth.
export default function DressInventory() {
  const [onlyStock, setOnlyStock] = useState(false);
  const [q, setQ] = useState("");
  const state = useData(async () => {
    const { data, error } = await supabase.rpc("fg_items", { p_order: null });
    if (error) throw new Error(error.message + " (run migration_64.sql and migration_65.sql)");
    return { items: Array.isArray(data) ? data : [] };
  }, "dress-inventory");

  const controls = (
    <>
      <input className={inputCls + " w-52"} placeholder="Search order, customer, item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <label className="flex items-center gap-1.5 text-sm text-stone-600">
        <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} aria-label="Only items in stock" /> Only items still in stock
      </label>
    </>
  );

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const needle = q.trim().toLowerCase();
        const rows = d.items
          .filter((i) => Number(i.made) > 0 || Number(i.dispatched) > 0 || Number(i.ordered) > 0)
          .filter((i) => (!onlyStock || Number(i.balance) > 0) && (!needle || `${i.order_number} ${i.customer_name} ${i.item_description}`.toLowerCase().includes(needle)));
        const made = sum(rows, (i) => i.made), sold = sum(rows, (i) => i.dispatched), left = sum(rows, (i) => i.balance);
        const value = sum(rows, (i) => Number(i.balance) * Number(i.unit_price || 0));
        const unpriced = rows.filter((i) => Number(i.balance) > 0 && !(Number(i.unit_price) > 0)).length;
        // per order totals
        const byOrder = {};
        rows.forEach((i) => {
          const o = (byOrder[i.order_id] = byOrder[i.order_id] || { n: i.order_number, c: i.customer_name, made: 0, sold: 0, left: 0, value: 0 });
          o.made += Number(i.made); o.sold += Number(i.dispatched); o.left += Number(i.balance); o.value += Number(i.balance) * Number(i.unit_price || 0);
        });
        const orderRows = Object.values(byOrder).sort((a, b) => b.value - a.value || b.left - a.left).map((o) => [o.n, o.c, Math.round(o.made), Math.round(o.sold), Math.round(o.left), o.value]);
        const top = Object.values(byOrder).filter((o) => o.left > 0).sort((a, b) => b.left - a.left).slice(0, 10);
        return (
          <ReportView
            title="Dress inventory"
            subtitle="Dresses made, sold and left in store - T&P Textiles"
            filename="dress-inventory"
            controls={controls}
            kpis={[
              { label: "Dresses made", value: String(Math.round(made)) },
              { label: "Dresses sold", value: String(Math.round(sold)), tone: "good", sub: made ? `${Math.round((sold / made) * 100)}% of those made` : undefined },
              { label: "Remaining in store", value: String(Math.round(left)) },
              { label: "Remaining inventory cost", value: fmtMoney(value), tone: "good", sub: unpriced ? `${unpriced} line(s) have no price yet` : "at invoice price" },
            ]}
            charts={top.length ? [{ type: "hbar", title: "Dresses left in store, by order", labels: top.map((o) => `${o.n} ${o.c}`), series: [{ name: "Dresses", values: top.map((o) => Math.round(o.left)) }] }] : []}
            tables={[
              { heading: "By order", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Made", type: "int" }, { label: "Sold", type: "int" }, { label: "Remaining", type: "int" }, { label: "Remaining cost", type: "money" }], rows: orderRows },
              { heading: "By item", columns: [{ label: "Order" }, { label: "Item" }, { label: "Ordered", type: "int" }, { label: "Made", type: "int" }, { label: "Sold", type: "int" }, { label: "Remaining", type: "int" }, { label: "Unit price", type: "money" }, { label: "Remaining cost", type: "money" }],
                rows: rows.map((i) => [i.order_number, i.item_description, Math.round(i.ordered), Math.round(i.made), Math.round(i.dispatched), Math.round(i.balance), Number(i.unit_price || 0), Number(i.balance) * Number(i.unit_price || 0)]) },
            ]}
            footnote="Made = dresses added to the store (scan IN / production count / manual); Sold = dispatched or billed by scan; Remaining = made - sold, never below zero. Cost is the remaining dresses at the price on the order's invoices (blank if the order has not been invoiced yet)."
          />
        );
      }}
    </ReportShell>
  );
}
