import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, MapPin, Phone, Bell, BellRing, Check, Clock } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";

export default function CustomerManagement({ profile }) {
  const [customers, setCustomers] = useState([]);
  const [visitsByCustomer, setVisitsByCustomer] = useState({});
  const [remindersByCustomer, setRemindersByCustomer] = useState({});
  const [modal, setModal] = useState(null);
  const [detailFor, setDetailFor] = useState(null);

  const load = async () => {
    const [{ data: custs }, { data: visits }, { data: reminders }] = await Promise.all([
      supabase.from("sales_customers").select("*").order("name", { ascending: true }),
      supabase.from("customer_visits").select("*").order("visit_date", { ascending: false }),
      supabase.from("customer_reminders").select("*").order("remind_date", { ascending: true }),
    ]);
    setCustomers(custs || []);
    const vByC = {};
    (visits || []).forEach((v) => {
      vByC[v.customer_id] = vByC[v.customer_id] || [];
      vByC[v.customer_id].push(v);
    });
    setVisitsByCustomer(vByC);
    const rByC = {};
    (reminders || []).forEach((r) => {
      rByC[r.customer_id] = rByC[r.customer_id] || [];
      rByC[r.customer_id].push(r);
    });
    setRemindersByCustomer(rByC);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("customer-crm-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_customers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_visits" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_reminders" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const saveCustomer = async (cust) => {
    if (cust.id) {
      const { id, ...rest } = cust;
      const { error } = await supabase.from("sales_customers").update(rest).eq("id", id);
      if (error) { alert(`Couldn't save:\n${error.message}`); return; }
    } else {
      const { id, ...rest } = cust;
      const { error } = await supabase.from("sales_customers").insert({ ...rest, created_by: profile?.id });
      if (error) { alert(`Couldn't save:\n${error.message}`); return; }
    }
    setModal(null);
    load();
  };

  const removeCustomer = async (id) => {
    if (!confirm("Remove this customer? This also removes their visit history and reminders.")) return;
    await supabase.from("sales_customers").delete().eq("id", id);
    load();
  };

  const today = todayStr();
  const allReminders = Object.values(remindersByCustomer).flat();
  const upcomingReminders = allReminders
    .filter((r) => !r.completed)
    .map((r) => ({ ...r, customerName: customers.find((c) => c.id === r.customer_id)?.name || "—", overdue: r.remind_date < today }))
    .sort((a, b) => a.remind_date.localeCompare(b.remind_date));

  const toggleReminder = async (id, completed) => {
    await supabase.from("customer_reminders").update({ completed: !completed }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Customers</h2>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add customer
        </Btn>
      </div>

      {upcomingReminders.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <BellRing size={14} className="text-amber-600" /> Upcoming reminders
          </h3>
          <div className="space-y-1.5">
            {upcomingReminders.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-stone-50 rounded-lg px-3 py-2">
                <div>
                  <span className={`font-mono text-xs ${r.overdue ? "text-rose-700 font-semibold" : "text-stone-500"}`}>{r.remind_date}</span>
                  <span className="ml-2 font-medium">{r.customerName}</span>
                  {r.note && <span className="text-stone-400 text-xs ml-2">— {r.note}</span>}
                </div>
                <button onClick={() => toggleReminder(r.id, r.completed)} className="text-stone-400 hover:text-emerald-700 p-1" title="Mark done">
                  <Check size={14} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {customers.map((c) => {
          const visits = visitsByCustomer[c.id] || [];
          const reminders = (remindersByCustomer[c.id] || []).filter((r) => !r.completed);
          return (
            <Card key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  {c.location && (
                    <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                      <MapPin size={11} /> {c.location}
                    </div>
                  )}
                  {(c.contact_person || c.contact_number) && (
                    <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                      <Phone size={11} /> {c.contact_person}{c.contact_person && c.contact_number ? " · " : ""}{c.contact_number}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setModal(c)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                  <button onClick={() => removeCustomer(c.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-500 mt-2">
                <span>{visits.length} visit{visits.length === 1 ? "" : "s"}</span>
                {reminders.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-700">
                    <Bell size={11} /> {reminders.length} reminder{reminders.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <Btn variant="ghost" onClick={() => setDetailFor(c)} className="mt-3">
                <Clock size={14} /> Visits &amp; reminders
              </Btn>
            </Card>
          );
        })}
        {customers.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm md:col-span-2">No customers added yet.</Card>}
      </div>

      {modal && <CustomerModal customer={modal} onClose={() => setModal(null)} onSave={saveCustomer} />}
      {detailFor && (
        <CustomerDetailModal
          customer={detailFor}
          visits={visitsByCustomer[detailFor.id] || []}
          reminders={remindersByCustomer[detailFor.id] || []}
          profile={profile}
          onClose={() => setDetailFor(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSave }) {
  const [f, setF] = useState({
    id: customer.id || null,
    name: customer.name || "",
    location: customer.location || "",
    contact_person: customer.contact_person || "",
    contact_number: customer.contact_number || "",
    notes: customer.notes || "",
  });
  return (
    <Modal title={customer.id ? "Edit customer" : "Add customer"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.name) return; onSave(f); }}>
        <Field label="Customer / school name"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Location"><input className={inputCls} placeholder="e.g. Turpu Kanupur, Andhra Pradesh" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Contact person"><input className={inputCls} value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} /></Field>
        <Field label="Contact number"><input className={inputCls} value={f.contact_number} onChange={(e) => setF({ ...f, contact_number: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDetailModal({ customer, visits, reminders, profile, onClose, onChanged }) {
  const [visitDate, setVisitDate] = useState(todayStr());
  const [visitNotes, setVisitNotes] = useState("");
  const [remindDate, setRemindDate] = useState(todayStr());
  const [remindNote, setRemindNote] = useState("");

  const addVisit = async (e) => {
    e.preventDefault();
    await supabase.from("customer_visits").insert({ customer_id: customer.id, visit_date: visitDate, notes: visitNotes || null, logged_by: profile?.name || null });
    setVisitNotes("");
    onChanged();
  };

  const addReminder = async (e) => {
    e.preventDefault();
    if (!remindNote && !remindDate) return;
    await supabase.from("customer_reminders").insert({ customer_id: customer.id, remind_date: remindDate, note: remindNote || null });
    setRemindNote("");
    onChanged();
  };

  const toggleReminder = async (id, completed) => {
    await supabase.from("customer_reminders").update({ completed: !completed }).eq("id", id);
    onChanged();
  };

  const removeVisit = async (id) => {
    await supabase.from("customer_visits").delete().eq("id", id);
    onChanged();
  };

  const removeReminder = async (id) => {
    await supabase.from("customer_reminders").delete().eq("id", id);
    onChanged();
  };

  return (
    <Modal title={`${customer.name} — visits & reminders`} onClose={onClose}>
      <div className="mb-4">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">Log a visit</div>
        <form onSubmit={addVisit} className="flex gap-2 mb-2">
          <input type="date" className={inputCls} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          <input placeholder="Notes (optional)" className={inputCls} value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} />
          <Btn type="submit" className="whitespace-nowrap">Add</Btn>
        </form>
        <div className="space-y-1 max-h-28 overflow-y-auto">
          {visits.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-xs border-b border-stone-100 pb-1">
              <span>{v.visit_date}{v.notes ? ` — ${v.notes}` : ""}{v.logged_by ? ` (${v.logged_by})` : ""}</span>
              <button onClick={() => removeVisit(v.id)} className="text-stone-400 hover:text-rose-700"><Trash2 size={12} /></button>
            </div>
          ))}
          {visits.length === 0 && <p className="text-xs text-stone-400">No visits logged yet.</p>}
        </div>
      </div>

      <div className="border-t border-stone-200 pt-3">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">Set a reminder</div>
        <form onSubmit={addReminder} className="flex gap-2 mb-2">
          <input type="date" className={inputCls} value={remindDate} onChange={(e) => setRemindDate(e.target.value)} />
          <input placeholder="e.g. Follow up on quotation" className={inputCls} value={remindNote} onChange={(e) => setRemindNote(e.target.value)} />
          <Btn type="submit" className="whitespace-nowrap">Add</Btn>
        </form>
        <div className="space-y-1 max-h-28 overflow-y-auto">
          {reminders.map((r) => (
            <div key={r.id} className={`flex items-center justify-between text-xs border-b border-stone-100 pb-1 ${r.completed ? "opacity-50" : ""}`}>
              <span>{r.remind_date}{r.note ? ` — ${r.note}` : ""}{r.completed ? " (done)" : ""}</span>
              <div className="flex gap-2">
                <button onClick={() => toggleReminder(r.id, r.completed)} className="text-stone-400 hover:text-emerald-700"><Check size={12} /></button>
                <button onClick={() => removeReminder(r.id)} className="text-stone-400 hover:text-rose-700"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {reminders.length === 0 && <p className="text-xs text-stone-400">No reminders set yet.</p>}
        </div>
      </div>

      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}
