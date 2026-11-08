import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Phone, Mail, MapPin, Search, BellRing, Check, Clock, Users, FileText, Landmark } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, fmtMoney } from "../lib/helpers";

const norm = (v) => String(v || "").trim().toLowerCase();

export default function CustomerManagement({ profile }) {
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [visitsByCustomer, setVisitsByCustomer] = useState({});
  const [remindersByCustomer, setRemindersByCustomer] = useState({});
  const [modal, setModal] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [contactModal, setContactModal] = useState(null);
  const [selKey, setSelKey] = useState(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("transactions");

  const load = async () => {
    const [{ data: custs }, { data: visits }, { data: reminders }, { data: cts }, { data: ords }, { data: invs }, { data: pays }] = await Promise.all([
      supabase.from("sales_customers").select("*").order("name", { ascending: true }),
      supabase.from("customer_visits").select("*").order("visit_date", { ascending: false }),
      supabase.from("customer_reminders").select("*").order("remind_date", { ascending: true }),
      supabase.from("customer_contacts").select("*").order("created_at", { ascending: true }),
      supabase.from("orders").select("id, order_number, customer_name, order_date, status, items"),
      supabase.from("invoices").select("id, invoice_number, customer_name, linked_order_id, issue_date, amount, advance_received, status"),
      supabase.from("order_payments").select("id, order_id, amount, payment_date, mode"),
    ]);
    setCustomers(custs || []);
    setContacts(cts || []);
    setOrders(ords || []);
    setInvoices(invs || []);
    setPayments(pays || []);
    const vByC = {};
    (visits || []).forEach((v) => { (vByC[v.customer_id] = vByC[v.customer_id] || []).push(v); });
    setVisitsByCustomer(vByC);
    const rByC = {};
    (reminders || []).forEach((r) => { (rByC[r.customer_id] = rByC[r.customer_id] || []).push(r); });
    setRemindersByCustomer(rByC);
  };

  useEffect(() => {
    // every customer name used on an order becomes a customer record
    Promise.resolve(supabase.rpc("sync_customers_from_orders")).catch(() => {}).then(load);
    const ch = supabase
      .channel("customer-crm-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_customers" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_contacts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_visits" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_reminders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // customers = saved records + any order customer name not saved yet (shown, can be saved with details)
  const list = useMemo(() => {
    const byName = new Map(customers.map((c) => [norm(c.name), { ...c, key: c.id }]));
    orders.forEach((o) => {
      const n = norm(o.customer_name);
      if (n && !byName.has(n)) byName.set(n, { id: null, key: "n:" + n, name: String(o.customer_name).trim() });
    });
    return [...byName.values()].map((c) => {
      const n = norm(c.name);
      const myOrders = orders.filter((o) => norm(o.customer_name) === n);
      const orderIds = new Set(myOrders.map((o) => o.id));
      const myInv = invoices.filter((i) => (i.linked_order_id && orderIds.has(i.linked_order_id)) || norm(i.customer_name) === n);
      const myPays = payments.filter((p) => orderIds.has(p.order_id));
      const invoiced = myInv.reduce((s, i) => s + Number(i.amount || 0), 0);
      const received = myPays.reduce((s, p) => s + Number(p.amount || 0), 0);
      return { ...c, myOrders, myInv, myPays, invoiced, received, balance: invoiced - received };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, orders, invoices, payments]);

  const shown = list.filter((c) => !q.trim() || [c.name, c.contact_person, c.contact_number, c.gstin, c.location].some((v) => norm(v).includes(norm(q))));
  const sel = list.find((c) => c.key === selKey) || shown[0] || null;
  const selContacts = sel?.id ? contacts.filter((c) => c.customer_id === sel.id) : [];

  const saveCustomer = async (cust) => {
    const { id, key, myOrders, myInv, myPays, invoiced, received, balance, ...rest } = cust;
    rest.credit_limit = rest.credit_limit === "" || rest.credit_limit == null ? null : Number(rest.credit_limit);
    const res = id
      ? await supabase.from("sales_customers").update(rest).eq("id", id)
      : await supabase.from("sales_customers").insert({ ...rest, created_by: profile?.id });
    if (res.error) { alert(`Couldn't save:\n${res.error.message}`); return; }
    setModal(null);
    load();
  };

  const removeCustomer = async (c) => {
    if (!c.id) return;
    if (!confirm("Remove this customer record? This also removes their contacts, visit history and reminders. Orders and invoices are not touched.")) return;
    await supabase.from("sales_customers").delete().eq("id", c.id);
    setSelKey(null);
    load();
  };

  const saveContact = async (f) => {
    const row = { customer_id: sel.id, name: f.name.trim(), designation: f.designation || null, phone: f.phone || null, email: f.email || null, notes: f.notes || null };
    const res = f.id ? await supabase.from("customer_contacts").update(row).eq("id", f.id) : await supabase.from("customer_contacts").insert(row);
    if (res.error) { alert(`Couldn't save contact:\n${res.error.message}`); return; }
    setContactModal(null);
    load();
  };
  const removeContact = async (id) => {
    if (!confirm("Remove this contact?")) return;
    await supabase.from("customer_contacts").delete().eq("id", id);
    load();
  };

  const today = todayStr();
  const upcoming = Object.entries(remindersByCustomer)
    .flatMap(([cid, rs]) => rs.filter((r) => !r.completed).map((r) => ({ ...r, customerName: customers.find((c) => c.id === cid)?.name || "—", overdue: r.remind_date < today })))
    .sort((a, b) => a.remind_date.localeCompare(b.remind_date));
  const toggleReminder = async (id, completed) => {
    await supabase.from("customer_reminders").update({ completed: !completed }).eq("id", id);
    load();
  };

  // transactions of the selected customer
  const tx = sel ? [
    ...sel.myOrders.map((o) => ({ k: "o" + o.id, type: "Sale order", no: o.order_number, date: o.order_date, total: null, note: o.status, qty: (o.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0) })),
    ...sel.myInv.map((i) => ({ k: "i" + i.id, type: "Invoice", no: i.invoice_number, date: i.issue_date, total: Number(i.amount || 0), note: i.status })),
    ...sel.myPays.map((p) => ({ k: "p" + p.id, type: "Payment in", no: p.mode || "", date: p.payment_date, total: Number(p.amount || 0), note: "Received", pay: true })),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))) : [];

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <Card className="p-3">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5"><BellRing size={14} className="text-amber-600" /> Upcoming reminders</h3>
          <div className="space-y-1.5">
            {upcoming.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-stone-50 rounded-lg px-3 py-1.5">
                <div>
                  <span className={`font-mono text-xs ${r.overdue ? "text-rose-700 font-semibold" : "text-stone-500"}`}>{r.remind_date}</span>
                  <span className="ml-2 font-medium">{r.customerName}</span>
                  {r.note && <span className="text-stone-400 text-xs ml-2">— {r.note}</span>}
                </div>
                <button onClick={() => toggleReminder(r.id, r.completed)} className="text-stone-400 hover:text-emerald-700 p-1" title="Mark done"><Check size={14} /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-[300px_1fr] gap-3 items-start">
        {/* left pane: parties */}
        <Card className="overflow-hidden">
          <div className="p-2.5 border-b border-stone-200 flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-2.5 text-stone-400" />
              <input className={inputCls + " pl-8"} placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Btn onClick={() => setModal({})}><Plus size={14} /> Add</Btn>
          </div>
          <div className="flex justify-between px-3 py-1.5 text-[11px] font-medium text-stone-500 uppercase bg-stone-50 border-b border-stone-100">
            <span>Customer ({shown.length})</span><span>Balance</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-stone-100">
            {shown.map((c) => (
              <button key={c.key} onClick={() => { setSelKey(c.key); setTab("transactions"); }} className={`w-full text-left px-3 py-2.5 flex justify-between gap-2 items-center hover:bg-stone-50 ${sel && sel.key === c.key ? "bg-indigo-50" : ""}`}>
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{c.name}</span>
                  <span className="block text-[11px] text-stone-400 truncate">{c.myOrders.length} order{c.myOrders.length === 1 ? "" : "s"}{c.contact_number ? ` · ${c.contact_number}` : ""}</span>
                </span>
                <span className={`font-mono text-sm whitespace-nowrap ${c.balance > 0 ? "text-emerald-700" : c.balance < 0 ? "text-rose-700" : "text-stone-400"}`}>{c.invoiced || c.received ? fmtMoney(Math.abs(c.balance)) : "—"}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No customers yet. They appear here automatically from orders.</p>}
          </div>
        </Card>

        {/* right pane: details + transactions */}
        {sel ? (
          <Card className="p-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold">{sel.name}</h2>
                {!sel.id && <p className="text-xs text-amber-700">Taken from order names — add details and save to keep them.</p>}
              </div>
              <div className="flex gap-1.5">
                <Btn variant="ghost" onClick={() => setModal(sel)}><Pencil size={13} /> {sel.id ? "Edit" : "Add details"}</Btn>
                {sel.id && <Btn variant="ghost" onClick={() => removeCustomer(sel)}><Trash2 size={13} /></Btn>}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mt-3 text-sm">
              {[
                ["Phone", sel.contact_number, Phone], ["Email", sel.email, Mail], ["Address", sel.address || sel.location, MapPin],
                ["GSTIN", sel.gstin, Landmark], ["Contact person", sel.contact_person, Users],
                ["Credit limit", sel.credit_limit != null && sel.credit_limit !== "" ? fmtMoney(sel.credit_limit) : null, null],
              ].map(([label, val]) => (
                <div key={label}><div className="text-[11px] uppercase text-stone-400">{label}</div><div className={val ? "font-medium break-words" : "text-stone-300"}>{val || "—"}</div></div>
              ))}
            </div>
            {sel.credit_limit > 0 && sel.balance > Number(sel.credit_limit) && (
              <p className="mt-2 text-xs text-rose-700 bg-rose-50 rounded px-2 py-1">Outstanding {fmtMoney(sel.balance)} is above the credit limit {fmtMoney(sel.credit_limit)}.</p>
            )}
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div className="rounded-lg bg-stone-50 py-2"><div className="text-[11px] text-stone-500">Invoiced</div><div className="font-mono font-semibold text-sm">{fmtMoney(sel.invoiced)}</div></div>
              <div className="rounded-lg bg-stone-50 py-2"><div className="text-[11px] text-stone-500">Received</div><div className="font-mono font-semibold text-sm">{fmtMoney(sel.received)}</div></div>
              <div className="rounded-lg bg-stone-50 py-2"><div className="text-[11px] text-stone-500">To receive</div><div className={`font-mono font-semibold text-sm ${sel.balance > 0 ? "text-emerald-700" : ""}`}>{fmtMoney(sel.balance)}</div></div>
            </div>

            <div className="flex gap-1.5 mt-4 border-b border-stone-200">
              {[["transactions", "Transactions", FileText], ["contacts", `Contacts (${selContacts.length})`, Users], ["visits", "Visits & reminders", Clock]].map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm flex items-center gap-1.5 border-b-2 -mb-px ${tab === id ? "border-indigo-700 text-indigo-800 font-medium" : "border-transparent text-stone-500"}`}><Icon size={13} /> {label}</button>
              ))}
            </div>

            {tab === "transactions" && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase text-stone-500 border-b border-stone-200"><th className="py-1.5">Type</th><th>No.</th><th>Date</th><th className="text-right">Total</th><th className="text-right pl-3">Status</th></tr></thead>
                  <tbody>
                    {tx.map((t) => (
                      <tr key={t.k} className="border-b border-stone-100">
                        <td className="py-1.5">{t.type}</td><td>{t.no}</td><td className="text-stone-500">{t.date || "—"}</td>
                        <td className={`text-right font-mono ${t.pay ? "text-emerald-700" : ""}`}>{t.total != null ? fmtMoney(t.total) : t.qty ? `${Math.round(t.qty)} pcs` : "—"}</td>
                        <td className="text-right pl-3 text-xs text-stone-500">{t.note}</td>
                      </tr>
                    ))}
                    {tx.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-stone-400">No transactions yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "contacts" && (
              <div className="mt-2">
                {sel.id ? (
                  <>
                    <div className="divide-y divide-stone-100">
                      {selContacts.map((c) => (
                        <div key={c.id} className="py-2 flex justify-between gap-2 text-sm">
                          <div>
                            <div className="font-medium">{c.name}{c.designation ? <span className="text-stone-400 font-normal"> · {c.designation}</span> : null}</div>
                            <div className="text-xs text-stone-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}{c.notes ? ` — ${c.notes}` : ""}</div>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setContactModal(c)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={13} /></button>
                            <button onClick={() => removeContact(c.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                      {selContacts.length === 0 && <p className="py-4 text-sm text-stone-400">No extra contacts yet.</p>}
                    </div>
                    <Btn variant="ghost" onClick={() => setContactModal({})} className="mt-2"><Plus size={13} /> Add contact</Btn>
                  </>
                ) : <p className="py-4 text-sm text-stone-400">Save the customer details first, then add contacts.</p>}
              </div>
            )}

            {tab === "visits" && (
              <div className="mt-3">
                {sel.id ? (
                  <>
                    <p className="text-sm text-stone-600">{(visitsByCustomer[sel.id] || []).length} visit(s) · {(remindersByCustomer[sel.id] || []).filter((r) => !r.completed).length} open reminder(s)</p>
                    <Btn variant="ghost" onClick={() => setDetailFor(sel)} className="mt-2"><Clock size={14} /> Open visits &amp; reminders</Btn>
                  </>
                ) : <p className="text-sm text-stone-400">Save the customer details first.</p>}
              </div>
            )}
          </Card>
        ) : (
          <Card className="p-10 text-center text-stone-400 text-sm">Select a customer on the left.</Card>
        )}
      </div>

      {modal && <CustomerModal customer={modal} onClose={() => setModal(null)} onSave={saveCustomer} />}
      {contactModal && <ContactModal contact={contactModal} onClose={() => setContactModal(null)} onSave={saveContact} />}
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
    gstin: customer.gstin || "",
    contact_person: customer.contact_person || "",
    contact_number: customer.contact_number || "",
    email: customer.email || "",
    address: customer.address || "",
    location: customer.location || "",
    credit_limit: customer.credit_limit ?? "",
    notes: customer.notes || "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const gstBad = f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase());
  return (
    <Modal title={customer.id ? "Edit customer" : customer.name ? "Customer details" : "Add customer"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return; onSave({ ...f, name: f.name.trim(), gstin: f.gstin ? f.gstin.toUpperCase().trim() : null }); }}>
        <Field label="Customer / school name"><input required className={inputCls} value={f.name} onChange={set("name")} /></Field>
        <Field label="GSTIN"><input className={inputCls} placeholder="e.g. 37ABCDE1234F1Z5" maxLength={15} value={f.gstin} onChange={set("gstin")} /></Field>
        {gstBad && <p className="text-xs text-amber-700 -mt-2 mb-2">This doesn't look like a valid 15-character GSTIN — you can still save it.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><input className={inputCls} value={f.contact_person} onChange={set("contact_person")} /></Field>
          <Field label="Phone"><input className={inputCls} value={f.contact_number} onChange={set("contact_number")} /></Field>
        </div>
        <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={set("email")} /></Field>
        <Field label="Address"><textarea rows={2} className={inputCls} value={f.address} onChange={set("address")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location / town"><input className={inputCls} value={f.location} onChange={set("location")} /></Field>
          <Field label="Credit limit (₹)"><input type="number" min="0" className={inputCls} value={f.credit_limit} onChange={set("credit_limit")} /></Field>
        </div>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ contact, onClose, onSave }) {
  const [f, setF] = useState({ id: contact.id || null, name: contact.name || "", designation: contact.designation || "", phone: contact.phone || "", email: contact.email || "", notes: contact.notes || "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={contact.id ? "Edit contact" : "Add contact"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return; onSave(f); }}>
        <Field label="Name"><input required className={inputCls} value={f.name} onChange={set("name")} /></Field>
        <Field label="Designation"><input className={inputCls} placeholder="e.g. Principal, Accountant" value={f.designation} onChange={set("designation")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={set("email")} /></Field>
        </div>
        <Field label="Other details"><textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} /></Field>
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
