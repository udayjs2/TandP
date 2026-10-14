import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";

export const OPERATIONS = [
  "Shoulder join", "Neck rib attach", "Collar attach", "Sleeve attach", "Side seam", "Hemming",
  "Pocket attach", "Placket", "Cuff attach", "Waistband attach", "Elastic attach", "Zip attach",
  "Buttonhole", "Button attach", "Overlock", "Bar tack", "Thread trimming", "Checking", "Ironing", "Packing",
];

// Team leads / managers enter "who did which operation, how many pieces" here.
// The Insights report uses it to find bottleneck operations and uneven workloads.
export default function OperationLog({ profile }) {
  const [date, setDate] = useState(todayStr());
  const [orders, setOrders] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ order_id: "", item: "", operation: OPERATIONS[0], otherOp: "", employee_id: "", quantity: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: ord }, { data: emp }, { data: ops }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, items").not("status", "in", "(Completed,Shipped)"),
      supabase.from("employees").select("id, name").order("name"),
      supabase.from("operation_output").select("*").eq("work_date", date).order("created_at", { ascending: false }),
    ]);
    setOrders(ord || []);
    setEmployees(emp || []);
    setRows(ops || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const order = orders.find((o) => o.id === f.order_id);
  const empName = (id) => employees.find((e) => e.id === id)?.name || "—";
  const orderNo = (id) => orders.find((o) => o.id === id)?.order_number || "—";

  const add = async (e) => {
    e.preventDefault();
    const operation = f.operation === "Other" ? f.otherOp.trim() : f.operation;
    if (!f.order_id || !f.employee_id || !operation || !(Number(f.quantity) > 0)) return alert("Choose the order, person, operation and enter the pieces done.");
    setSaving(true);
    const { error } = await supabase.from("operation_output").insert({
      work_date: date,
      order_id: f.order_id,
      item_description: f.item || null,
      operation,
      employee_id: f.employee_id,
      quantity: Number(f.quantity),
      logged_by: profile?.name || null,
    });
    setSaving(false);
    if (error) return alert(`Couldn't save:\n${error.message}`);
    setF({ ...f, quantity: "" }); // keep order / operation so many people can be entered quickly
    load();
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await supabase.from("operation_output").delete().eq("id", id);
    load();
  };

  const totals = {};
  rows.forEach((r) => (totals[r.operation] = (totals[r.operation] || 0) + Number(r.quantity)));

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500 max-w-2xl">
        Log how many pieces each person finished on each operation. This is what lets the report find the slowest operation and show who is overloaded.
        Enter it at the end of the day.
      </p>
      <Card className="p-4">
        <form onSubmit={add}>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Order">
              <select className={inputCls} value={f.order_id} onChange={(e) => setF({ ...f, order_id: e.target.value, item: "" })}>
                <option value="">— select —</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>)}
              </select>
            </Field>
            <Field label="Item">
              <select className={inputCls} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} disabled={!f.order_id}>
                <option value="">— select —</option>
                {(order?.items || []).map((it) => <option key={it.description}>{it.description}</option>)}
              </select>
            </Field>
            <Field label="Operation">
              <select className={inputCls} value={f.operation} onChange={(e) => setF({ ...f, operation: e.target.value })}>
                {OPERATIONS.map((o) => <option key={o}>{o}</option>)}
                <option>Other</option>
              </select>
            </Field>
            {f.operation === "Other" && <Field label="Operation name"><input className={inputCls} value={f.otherOp} onChange={(e) => setF({ ...f, otherOp: e.target.value })} /></Field>}
            <Field label="Person">
              <select className={inputCls} value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
                <option value="">— select —</option>
                {employees.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
              </select>
            </Field>
            <Field label="Pieces done"><input type="number" min="1" className={inputCls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end"><Btn type="submit" disabled={saving}><Plus size={14} /> {saving ? "Saving…" : "Add entry"}</Btn></div>
        </form>
      </Card>

      {Object.keys(totals).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(totals).map(([op, q]) => <span key={op} className="text-xs bg-stone-100 rounded-full px-3 py-1">{op}: <b className="font-mono">{q}</b></span>)}
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr><th className="text-left px-3 py-2.5">Order</th><th className="text-left px-3 py-2.5">Item</th><th className="text-left px-3 py-2.5">Operation</th><th className="text-left px-3 py-2.5">Person</th><th className="text-right px-3 py-2.5">Pieces</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{orderNo(r.order_id)}</td>
                <td className="px-3 py-2">{r.item_description || "—"}</td>
                <td className="px-3 py-2">{r.operation}</td>
                <td className="px-3 py-2">{empName(r.employee_id)}</td>
                <td className="px-3 py-2 text-right font-mono">{r.quantity}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => remove(r.id)} className="text-stone-400 hover:text-rose-600"><Trash2 size={13} /></button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400">Nothing logged for this date.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
