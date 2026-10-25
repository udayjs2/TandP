import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls } from "./ui";
import { fmtMoney, ORDER_STATUS_COLORS, COMMISSION_COLORS } from "../lib/helpers";

const INVOICE_COLORS = {
  "Not invoiced": "bg-stone-100 text-stone-600",
  Invoiced: "bg-amber-100 text-amber-800",
  "Part paid": "bg-sky-100 text-sky-800",
  Paid: "bg-emerald-100 text-emerald-800",
};

// Orders that came through sales: confirmation -> production -> delivery -> invoice -> payment.
export default function SalesOrders({ profile }) {
  const manager = ["admin", "gm", "pm"].includes(profile?.role);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [sp, setSp] = useState("All");
  const [error, setError] = useState("");

  const load = async () => {
    const { data, error: err } = await supabase.rpc("sales_order_tracking");
    if (err) setError(err.message + " (run migration_40.sql)");
    else setError("");
    setRows(data || []);
  };
  useEffect(() => {
    load();
    const ch = supabase
      .channel("sales-orders-track")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  if (!rows) return <p className="text-sm text-stone-500">Loading…</p>;
  const people = [...new Map(rows.filter((r) => r.salesperson_id).map((r) => [r.salesperson_id, r.salesperson_name])).entries()];
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (sp === "All" || r.salesperson_id === sp) && (!needle || [r.order_number, r.customer_name, r.lead_number, r.salesperson_name].some((v) => String(v || "").toLowerCase().includes(needle)))
  );
  const total = shown.reduce((s, r) => s + Number(r.order_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Sales orders ({shown.length})</h2>
          <p className="text-xs text-stone-500">Total order value: {fmtMoney(total)}. Every order here is linked to its lead and salesperson.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input className={inputCls + " w-56"} placeholder="Search order, customer, lead…" value={q} onChange={(e) => setQ(e.target.value)} />
          {manager && (
            <select className={inputCls + " w-auto"} value={sp} onChange={(e) => setSp(e.target.value)}>
              <option value="All">All salespeople</option>
              {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="grid gap-2.5">
        {shown.map((r) => {
          const prodDone = ["Completed", "Shipped", "Rejected by Customer"].includes(r.status);
          const delivered = Number(r.delivered_qty) > 0 && Number(r.delivered_qty) >= Number(r.ordered_qty);
          const steps = [
            { label: "Confirmed", done: true },
            { label: "Production", done: prodDone, note: r.status },
            { label: "Delivery", done: delivered, note: Number(r.ordered_qty) ? `${Math.round(r.delivered_qty)}/${Math.round(r.ordered_qty)} pcs` : "" },
            { label: "Invoice", done: r.invoice_state !== "Not invoiced", note: r.invoice_state },
            { label: "Payment", done: r.invoice_state === "Paid", note: r.invoice_state === "Part paid" ? "Part paid" : r.invoice_state === "Paid" ? "Paid" : "" },
          ];
          return (
            <Card key={r.order_id} className="p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{r.order_number} — {r.customer_name}</div>
                  <div className="text-xs text-stone-500">
                    {r.lead_number ? `Lead ${r.lead_number} · ` : ""}Salesperson {r.salesperson_name || "—"} · Ordered {r.order_date || "—"}{r.due_date ? ` · Due ${r.due_date}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">{fmtMoney(r.order_value)}</div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[r.status] || "bg-stone-100 text-stone-700"}`}>{r.status}</span>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mt-3">
                {steps.map((s) => (
                  <div key={s.label} className={`rounded-lg border px-2 py-1.5 text-center ${s.done ? "border-emerald-300 bg-emerald-50" : "border-stone-200"}`}>
                    <div className="text-[11px] font-semibold text-stone-600 flex items-center justify-center gap-1">{s.done && <Check size={11} className="text-emerald-600" />}{s.label}</div>
                    {s.note ? <div className="text-[10px] text-stone-500 truncate">{s.note}</div> : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2 items-center">
                <span className={`px-2 py-0.5 rounded-full font-medium ${INVOICE_COLORS[r.invoice_state]}`}>{r.invoice_state}</span>
                {r.invoiced !== null && r.invoiced !== undefined && <span className="text-stone-500">Invoiced {fmtMoney(r.invoiced)} · Received {fmtMoney(r.received)} · Balance {fmtMoney(Math.max(0, r.invoiced - r.received))}</span>}
                {r.commission_status ? (
                  <span className="text-stone-500">Commission <b className="font-mono">{fmtMoney(r.commission_amount)}</b> <span className={`px-1.5 py-0.5 rounded-full ${COMMISSION_COLORS[r.commission_status]}`}>{r.commission_status}</span></span>
                ) : (
                  <span className="text-stone-400">No commission yet (see Commission tab)</span>
                )}
              </div>
            </Card>
          );
        })}
        {shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No sales orders yet. Convert a won lead into an order from the Leads tab, or link an existing order to a salesperson from Orders.</Card>}
      </div>
    </div>
  );
}
