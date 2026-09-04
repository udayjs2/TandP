import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Receipt } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { fmtMoney, todayStr, itemsTotal } from "../lib/helpers";
import PrintInvoice from "./PrintInvoice";

export default function Invoices({ isAdmin }) {
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState({});
  const [modal, setModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printInvoice, setPrintInvoice] = useState(null);
  const today = todayStr();

  const load = async () => {
    const [{ data: inv, error: invErr }, { data: ord }, { data: set, error: setErr }] = await Promise.all([
      supabase.from("invoices").select("*").order("issue_date", { ascending: false }),
      supabase.from("orders").select("*"),
      supabase.from("settings").select("*").eq("id", 1).single(),
    ]);
    if (invErr) console.error("Failed to load invoices:", invErr.message);
    if (setErr) console.error("Failed to load business settings:", setErr.message);
    setInvoices(inv || []);
    setOrders(ord || []);
    setSettings(set || {});
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("invoices-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (inv) => {
    if (inv.id) {
      const { id, ...rest } = inv;
      const { error } = await supabase.from("invoices").update(rest).eq("id", id);
      if (error) { alert(`Couldn't save this invoice:\n${error.message}`); return; }
    } else {
      const { id, ...rest } = inv;
      const { error } = await supabase.from("invoices").insert(rest);
      if (error) { alert(`Couldn't save this invoice:\n${error.message}`); return; }
    }
    setModal(null);
    load();
  };

  const saveSettings = async (s) => {
    const { error } = await supabase.from("settings").update(s).eq("id", 1);
    if (error) { alert(`Couldn't save business details:\n${error.message}`); return; }
    setSettingsOpen(false);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this invoice?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    load();
  };

  const markPaid = async (id) => {
    await supabase.from("invoices").update({ status: "Paid" }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Invoices ({invoices.length})</h2>
        <div className="flex gap-2">
          {isAdmin && (
            <Btn variant="ghost" onClick={() => setSettingsOpen(true)}>
              Business details
            </Btn>
          )}
          <Btn onClick={() => setModal({})}>
            <Plus size={15} /> New invoice
          </Btn>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Invoice #</th>
              <th className="text-left px-4 py-2.5">Customer</th>
              <th className="text-left px-4 py-2.5">Issued</th>
              <th className="text-left px-4 py-2.5">Due</th>
              <th className="text-right px-4 py-2.5">Amount</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {invoices.map((i) => {
              const overdue = i.status !== "Paid" && i.due_date && i.due_date < today;
              const amount = i.items?.length ? itemsTotal(i.items) : Number(i.amount) || 0;
              return (
                <tr key={i.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">{i.invoice_number}</td>
                  <td className="px-4 py-2.5">{i.customer_name}</td>
                  <td className="px-4 py-2.5 text-stone-500">{i.issue_date}</td>
                  <td className="px-4 py-2.5 text-stone-500">{i.due_date || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(amount)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        i.status === "Paid" ? "bg-emerald-100 text-emerald-800" : overdue ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {i.status === "Paid" ? "Paid" : overdue ? "Overdue" : "Unpaid"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setPrintInvoice(i)} className="text-stone-400 hover:text-indigo-700 p-1" title="Print">
                        <Receipt size={14} />
                      </button>
                      {i.status !== "Paid" && (
                        <button onClick={() => markPaid(i.id)} className="text-stone-400 hover:text-emerald-700 p-1" title="Mark paid">
                          <Check size={14} />
                        </button>
                      )}
                      <button onClick={() => setModal(i)} className="text-stone-400 hover:text-indigo-700 p-1">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => remove(i.id)} className="text-stone-400 hover:text-rose-700 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {modal && <InvoiceModal inv={modal} orders={orders} onClose={() => setModal(null)} onSave={save} count={invoices.length} />}
      {settingsOpen && <BusinessSettingsModal settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />}
      {printInvoice && <PrintInvoice invoice={printInvoice} settings={settings} onClose={() => setPrintInvoice(null)} />}
    </div>
  );
}

function BusinessSettingsModal({ settings, onClose, onSave }) {
  const [f, setF] = useState({
    business_name: settings.business_name || "",
    address: settings.address || "",
    phone: settings.phone || "",
    gstin: settings.gstin || "",
    bank_name: settings.bank_name || "",
    account_name: settings.account_name || "",
    account_number: settings.account_number || "",
    ifsc: settings.ifsc || "",
    branch: settings.branch || "",
    upi: settings.upi || "",
    terms: settings.terms || "",
  });
  return (
    <Modal title="Business details" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Shown on the header, bank details box, and terms of every printed invoice.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(f);
        }}
      >
        <Field label="Business name">
          <input className={inputCls} value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} />
        </Field>
        <Field label="Address">
          <textarea rows={2} className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="GSTIN / Tax ID">
          <input className={inputCls} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} />
        </Field>

        <div className="border-t border-stone-200 my-3 pt-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Bank details</span>
          <Field label="Account name">
            <input className={inputCls} value={f.account_name} onChange={(e) => setF({ ...f, account_name: e.target.value })} />
          </Field>
          <Field label="Bank name">
            <input className={inputCls} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
          </Field>
          <Field label="Account number">
            <input className={inputCls} value={f.account_number} onChange={(e) => setF({ ...f, account_number: e.target.value })} />
          </Field>
          <Field label="IFSC code">
            <input className={inputCls} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value })} />
          </Field>
          <Field label="Branch">
            <input className={inputCls} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} />
          </Field>
          <Field label="UPI / GPay">
            <input className={inputCls} value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value })} />
          </Field>
        </div>

        <Field label="Terms & conditions (one per line)">
          <textarea rows={4} className={inputCls} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
        </Field>

        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit">
            <Check size={15} /> Save
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceModal({ inv, orders, onClose, onSave, count }) {
  const initialItems =
    inv.items && inv.items.length
      ? inv.items
      : inv.amount
      ? [{ description: "Item", quantity: 1, price: inv.amount }]
      : [{ description: "", quantity: 1, price: "" }];

  const [f, setF] = useState({
    id: inv.id || null,
    invoice_number: inv.invoice_number || `INV-${String(count + 1).padStart(4, "0")}`,
    customer_name: inv.customer_name || "",
    linked_order_id: inv.linked_order_id || "",
    issue_date: inv.issue_date || todayStr(),
    due_date: inv.due_date || "",
    status: inv.status || "Unpaid",
  });
  const [items, setItems] = useState(initialItems);

  const applyOrder = (orderId) => {
    const o = orders.find((x) => x.id === orderId);
    setF({ ...f, linked_order_id: orderId || null, customer_name: o ? o.customer_name : f.customer_name });
    if (o && o.items?.length) {
      setItems(o.items.map((it) => ({ description: it.description, quantity: it.quantity || 1, price: "" })));
    }
  };

  const addItem = () => setItems([...items, { description: "", quantity: 1, price: "" }]);
  const removeItem = (idx) => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  const updateItem = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const total = itemsTotal(items);

  return (
    <Modal title={inv.id ? "Edit invoice" : "New invoice"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.customer_name) return;
          const cleanItems = items
            .filter((it) => it.description || it.quantity || it.price)
            .map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0 }));
          onSave({ ...f, items: cleanItems, amount: itemsTotal(cleanItems) });
        }}
      >
        <Field label="Invoice number">
          <input className={inputCls} value={f.invoice_number} onChange={(e) => setF({ ...f, invoice_number: e.target.value })} />
        </Field>
        <Field label="Link to order (optional)">
          <select className={inputCls} value={f.linked_order_id || ""} onChange={(e) => applyOrder(e.target.value)}>
            <option value="">— none —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number} — {o.customer_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer">
          <input required className={inputCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
        </Field>

        <span className="block text-xs font-medium text-stone-600 mb-1">Items</span>
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-2">
          <div className="grid grid-cols-[1fr_60px_80px_28px] gap-1 bg-stone-50 px-2 py-1.5 text-[11px] font-medium text-stone-500 uppercase">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price ₹</span>
            <span></span>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_60px_80px_28px] gap-1 px-2 py-1.5 border-t border-stone-100 items-center">
              <input
                className="border border-stone-300 rounded px-2 py-1 text-sm"
                placeholder="e.g. Cotton kurta"
                value={it.description}
                onChange={(e) => updateItem(idx, { description: e.target.value })}
              />
              <input
                type="number"
                min="0"
                className="border border-stone-300 rounded px-1.5 py-1 text-sm text-right"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
              />
              <input
                type="number"
                min="0"
                className="border border-stone-300 rounded px-1.5 py-1 text-sm text-right"
                value={it.price}
                onChange={(e) => updateItem(idx, { price: e.target.value })}
              />
              <button type="button" onClick={() => removeItem(idx)} className="text-stone-400 hover:text-rose-700 justify-self-center">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="text-xs font-medium text-indigo-700 hover:text-indigo-900 flex items-center gap-1 mb-3">
          <Plus size={13} /> Add another line
        </button>

        <div className="text-right text-sm font-semibold mb-3">
          Total: <span className="font-mono">{fmtMoney(total)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue date">
            <input type="date" className={inputCls} value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputCls} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option>Unpaid</option>
            <option>Paid</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit">
            <Check size={15} /> Save
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
