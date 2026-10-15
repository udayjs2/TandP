import { useEffect, useState } from "react";
import { Plus, Banknote } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { fmtMoney, todayStr, PAYMENT_MODES } from "../lib/helpers";

export const ADVANCE_PURPOSES = ["Travel", "Marketing", "Purchase", "Other"];

// remaining money in one advance = given - returned - spent (claims that are not rejected)
export function advanceBalance(adv, claims) {
  const spent = (claims || []).filter((c) => c.advance_id === adv.id && c.status !== "Rejected").reduce((s, c) => s + Number(c.amount || 0), 0);
  return { spent, left: Number(adv.amount) - Number(adv.returned_amount || 0) - spent };
}

// Admin / HR: give advances, see who holds what, settle.
export default function Advances() {
  const [employees, setEmployees] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [claims, setClaims] = useState([]);
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(false);
  const [settle, setSettle] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    const [e, a, c, o] = await Promise.all([
      supabase.from("employees").select("id, name, role").order("name"),
      supabase.from("employee_advances").select("*").order("given_date", { ascending: false }),
      supabase.from("expense_claims").select("id, employee_id, amount, status, paid_from, advance_id"),
      supabase.from("orders").select("id, order_number, customer_name"),
    ]);
    if (a.error) setError(a.error.message + " (run migration_36.sql)");
    setEmployees(e.data || []); setAdvances(a.data || []); setClaims(c.data || []); setOrders(o.data || []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("advances-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_advances" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_claims" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const name = (id) => employees.find((x) => x.id === id)?.name || "—";
  const orderLabel = (id) => { const o = orders.find((x) => x.id === id); return o ? `${o.order_number} — ${o.customer_name}` : null; };

  // per-employee summary of what is still in hand + what the company owes them
  const people = employees.map((emp) => {
    const open = advances.filter((a) => a.employee_id === emp.id && a.status === "Open");
    const inHand = open.reduce((s, a) => s + Math.max(0, advanceBalance(a, claims).left), 0);
    const owed = claims.filter((c) => c.employee_id === emp.id && c.paid_from === "Own money" && (c.status === "Approved" || c.status === "Submitted")).reduce((s, c) => s + Number(c.amount || 0), 0);
    return { emp, inHand, owed, openCount: open.length };
  }).filter((p) => p.inHand > 0 || p.owed > 0);

  const give = async (f) => {
    const { error } = await supabase.from("employee_advances").insert({
      employee_id: f.employee_id, amount: Number(f.amount), given_date: f.given_date, purpose: f.purpose,
      payment_mode: f.payment_mode || null, linked_order_id: f.linked_order_id || null, notes: f.notes || null,
    });
    if (error) { alert("Couldn't save advance:\n" + error.message); return false; }
    load(); return true;
  };
  const doSettle = async (adv, returned) => {
    const { error } = await supabase.from("employee_advances").update({ returned_amount: Number(adv.returned_amount || 0) + Number(returned || 0), status: "Settled", settled_at: new Date().toISOString() }).eq("id", adv.id);
    if (error) alert(error.message);
    setSettle(null); load();
  };
  const remove = async (a) => {
    if (!confirm("Delete this advance? Claims already paid from it stay, but are unlinked.")) return;
    const { error } = await supabase.from("employee_advances").delete().eq("id", a.id);
    if (error) alert(error.message);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Advances to staff</h2>
          <p className="text-xs text-stone-500">Cash given before a trip, marketing visit or purchase. Staff spend it by choosing "From advance" when they submit a bill.</p>
        </div>
        <Btn onClick={() => setModal(true)}><Plus size={15} /> Give advance</Btn>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {people.length > 0 && (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {people.map(({ emp, inHand, owed }) => (
            <Card key={emp.id} className="p-3.5">
              <div className="font-medium text-sm">{emp.name}</div>
              <div className="text-xs text-stone-500 mt-1">Advance still in hand: <b className="font-mono text-stone-800">{fmtMoney(inHand)}</b></div>
              {owed > 0 && <div className="text-xs text-amber-700 mt-0.5">Own money to reimburse: <b className="font-mono">{fmtMoney(owed)}</b></div>}
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Date</th><th className="text-left px-4 py-2.5">Purpose</th>
              <th className="text-right px-4 py-2.5">Given</th><th className="text-right px-4 py-2.5">Spent</th><th className="text-right px-4 py-2.5">Returned</th><th className="text-right px-4 py-2.5">Left</th>
              <th className="text-left px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {advances.map((a) => {
              const b = advanceBalance(a, claims);
              return (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 font-medium">{name(a.employee_id)}</td>
                  <td className="px-4 py-2.5 text-stone-500">{a.given_date}</td>
                  <td className="px-4 py-2.5">{a.purpose}{orderLabel(a.linked_order_id) ? <div className="text-xs text-stone-400">{orderLabel(a.linked_order_id)}</div> : null}{a.notes ? <div className="text-xs text-stone-400">{a.notes}</div> : null}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(a.amount)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(b.spent)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(a.returned_amount || 0)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold ${b.left < 0 ? "text-rose-700" : ""}`}>{fmtMoney(b.left)}</td>
                  <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.status === "Open" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{a.status}</span></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {a.status === "Open" && <button onClick={() => setSettle({ adv: a, left: b.left })} className="text-xs text-indigo-700 hover:underline mr-3">Settle</button>}
                    <button onClick={() => remove(a)} className="text-xs text-stone-400 hover:text-rose-700">Delete</button>
                  </td>
                </tr>
              );
            })}
            {advances.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-stone-400">No advances given yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {modal && <GiveModal employees={employees} orders={orders} onClose={() => setModal(false)} onSave={give} />}
      {settle && <SettleModal {...settle} name={name(settle.adv.employee_id)} onClose={() => setSettle(null)} onSettle={doSettle} />}
    </div>
  );
}

function GiveModal({ employees, orders, onClose, onSave }) {
  const [f, setF] = useState({ employee_id: "", amount: "", given_date: todayStr(), purpose: "Travel", payment_mode: "Cash", linked_order_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.employee_id) return alert("Choose the employee.");
    if (!(Number(f.amount) > 0)) return alert("Enter the advance amount.");
    setSaving(true);
    const ok = await onSave(f);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Give advance" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Employee">
          <select className={inputCls} value={f.employee_id} onChange={set("employee_id")}>
            <option value="">— select —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><input type="number" min="1" className={inputCls} value={f.amount} onChange={set("amount")} /></Field>
          <Field label="Date given"><input type="date" className={inputCls} value={f.given_date} onChange={set("given_date")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="For">
            <select className={inputCls} value={f.purpose} onChange={set("purpose")}>{ADVANCE_PURPOSES.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
          <Field label="Paid by">
            <select className={inputCls} value={f.payment_mode} onChange={set("payment_mode")}>{PAYMENT_MODES.map((p) => <option key={p}>{p}</option>)}</select>
          </Field>
        </div>
        <Field label="Order (optional)">
          <select className={inputCls} value={f.linked_order_id} onChange={set("linked_order_id")}>
            <option value="">Not order-specific</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>)}
          </select>
        </Field>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={set("notes")} placeholder="e.g. Tirupur fabric purchase trip" /></Field>
        <p className="text-xs text-stone-400">An advance is not an expense. It reaches Finance → Expenditures only as the employee's approved bills.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Give advance"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function SettleModal({ adv, left, name, onClose, onSettle }) {
  const [ret, setRet] = useState(left > 0 ? String(left) : "0");
  return (
    <Modal title="Settle advance" onClose={onClose}>
      <p className="text-sm text-stone-600 mb-3">{name} was given {fmtMoney(adv.amount)} for {adv.purpose}. Left unspent: <b>{fmtMoney(left)}</b>.</p>
      <Field label="Cash handed back (₹)">
        <input type="number" min="0" className={inputCls} value={ret} onChange={(e) => setRet(e.target.value)} />
      </Field>
      <p className="text-xs text-stone-400">Settling closes this advance so no more bills can be charged to it.</p>
      <div className="flex justify-end gap-2 mt-4">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSettle(adv, ret)}><Banknote size={14} /> Settle</Btn>
      </div>
    </Modal>
  );
}
