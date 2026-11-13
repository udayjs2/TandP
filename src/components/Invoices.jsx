import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Receipt } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn, SearchBox, matchQ } from "./ui";
import ScanBox from "./ScanBox";
import { fmtMoney, todayStr, itemsTotal, gstBreakup, invoiceTotal } from "../lib/helpers";
import PrintInvoice from "./PrintInvoice";

export default function Invoices({ isAdmin }) {
  const [invoices, setInvoices] = useState([]);
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState({});
  const [modal, setModal] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [printInvoice, setPrintInvoice] = useState(null);
  const [payments, setPayments] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [view, setView] = useState("open"); // open | paid
  const [q, setQ] = useState("");
  const today = todayStr();

  // Payments logged against an order are applied to that order's invoices, oldest first.
  const amountOf = (i) => (i.items?.length ? invoiceTotal(i) : Number(i.amount) || 0);
  const paidById = (() => {
    const pool = {};
    payments.forEach((p) => (pool[p.order_id] = (pool[p.order_id] || 0) + Number(p.amount || 0)));
    const out = {};
    const lastOf = {};
    [...invoices]
      .sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || "") || (a.created_at || "").localeCompare(b.created_at || ""))
      .forEach((i) => {
        const total = amountOf(i);
        if (i.linked_order_id) {
          const share = Math.min(pool[i.linked_order_id] || 0, total);
          pool[i.linked_order_id] = (pool[i.linked_order_id] || 0) - share;
          out[i.id] = i.status === "Paid" ? Math.max(share, total) : share; // a manually-marked Paid invoice counts as fully paid
          lastOf[i.linked_order_id] = i.id;
        } else {
          out[i.id] = i.status === "Paid" ? total : Number(i.advance_received || 0);
        }
      });
    // money received beyond the invoiced total is kept on the order's latest invoice, so the balance shows as negative (excess received)
    Object.entries(lastOf).forEach(([oid, iid]) => { if ((pool[oid] || 0) > 0) out[iid] += pool[oid]; });
    return out;
  })();

  // "part 2 of 3" for the invoices raised against one order (batch invoices)
  const partOf = (() => {
    const byOrder = {};
    [...invoices].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")).forEach((i) => { if (i.linked_order_id) (byOrder[i.linked_order_id] = byOrder[i.linked_order_id] || []).push(i); });
    const out = {};
    Object.entries(byOrder).forEach(([oid, list]) => list.forEach((i, k) => { out[i.id] = { n: k + 1, of: list.length, order: orders.find((o) => o.id === oid)?.order_number }; }));
    return out;
  })();

  const load = async () => {
    const [{ data: inv, error: invErr }, { data: ord }, { data: set, error: setErr }, { data: pay }, { data: dlv }] = await Promise.all([
      supabase.from("invoices").select("*").order("issue_date", { ascending: false }),
      supabase.from("orders").select("*"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("order_payments").select("order_id, amount"),
      supabase.from("order_deliveries").select("id, order_id, date, item_description, quantity, invoice_id"),
    ]);
    setPayments(pay || []);
    setDeliveries(dlv || []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_payments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (inv) => {
    const { id, deliveryIds, ...rest } = inv;
    let invId = id;
    if (id) {
      const { error } = await supabase.from("invoices").update(rest).eq("id", id);
      if (error) { alert(`Couldn't save this invoice:\n${error.message}`); return; }
    } else {
      const { data, error } = await supabase.from("invoices").insert(rest).select("id").single();
      if (error) { alert(`Couldn't save this invoice:\n${error.message}`); return; }
      invId = data?.id;
    }
    // dispatch batches billed on this invoice (each batch can be billed only once)
    if (invId && rest.linked_order_id) {
      const { data: lk, error: lkErr } = await supabase.rpc("set_invoice_deliveries", { p_invoice: invId, p_deliveries: deliveryIds || [] });
      if (lkErr || lk?.ok === false) alert(`Invoice saved, but the dispatches could not be linked to it:\n${lkErr?.message || lk?.error}`);
    }
    // dresses added by scanning count as sold (reduce finished stock)
    const lines = (rest.items || []).filter((it) => it.fg_order_id).map((it) => ({ order_id: it.fg_order_id, item: it.fg_item, qty: it.quantity }));
    if (invId && (lines.length || id)) {
      const { error } = await supabase.rpc("fg_invoice_sync", { p_invoice: invId, p_lines: lines });
      if (error) alert(`Invoice saved, but finished stock was not updated:\n${error.message}`);
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

  const paidFlag = (i) => {
    const amount = amountOf(i);
    return i.status === "Paid" || (amount > 0 && amount - (paidById[i.id] || 0) <= 0);
  };
  const openInvoices = invoices.filter((i) => !paidFlag(i));
  const paidInvoices = invoices.filter(paidFlag);
  const needle = q.trim().toLowerCase();
  const shownInvoices = (view === "open" ? openInvoices : paidInvoices).filter(
    (i) => !needle || [i.invoice_number, i.customer_name, i.issue_date, i.status].some((v) => String(v || "").toLowerCase().includes(needle))
  );

  return (
    <div className="space-y-4">
      <div className="subtab-bar">
        {[["open", `Unpaid & part paid (${openInvoices.length})`], ["paid", `Paid (${paidInvoices.length})`], ["orders", "By order (part deliveries)"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`subtab ${view === id ? "subtab-active" : ""}`}>{label}</button>
        ))}
      </div>
      {view === "orders" && (
        <ByOrder orders={orders} invoices={invoices} deliveries={deliveries} amountOf={amountOf} paidById={paidById} partOf={partOf} q={q} setQ={setQ}
          onNew={(o) => setModal({ linked_order_id: o.id, customer_name: o.customer_name })} onEdit={(i) => setModal(i)}
          onPrint={(i) => setPrintInvoice({ ...i, advance_received: i.linked_order_id ? paidById[i.id] || 0 : i.advance_received })} />
      )}
      {view !== "orders" && (<>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">{view === "open" ? "Invoices" : "Paid invoices"} ({shownInvoices.length})</h2>
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
      <input className={inputCls} placeholder="Search by invoice number, customer or date…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Invoice #</th>
              <th className="text-left px-4 py-2.5">Customer</th>
              <th className="text-left px-4 py-2.5">Issued</th>
              <th className="text-left px-4 py-2.5">Due</th>
              <th className="text-right px-4 py-2.5">Amount</th>
              <th className="text-right px-4 py-2.5">Paid</th>
              <th className="text-right px-4 py-2.5">Balance</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shownInvoices.map((i) => {
              const amount = amountOf(i);
              const paid = paidById[i.id] || 0;
              const balanceDue = amount - paid;
              const isPaid = i.status === "Paid" || (amount > 0 && balanceDue <= 0);
              const overdue = !isPaid && i.due_date && i.due_date < today;
              return (
                <tr key={i.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">{i.invoice_number}{partOf[i.id] && <div className="text-[11px] font-normal text-stone-400">{partOf[i.id].order} · {partOf[i.id].of > 1 ? `part ${partOf[i.id].n} of ${partOf[i.id].of}` : "full order"}</div>}</td>
                  <td className="px-4 py-2.5">{i.customer_name}</td>
                  <td className="px-4 py-2.5 text-stone-500">{i.issue_date}</td>
                  <td className="px-4 py-2.5 text-stone-500">{i.due_date || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(amount)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{fmtMoney(paid)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold ${balanceDue > 0 ? "text-rose-700" : balanceDue < 0 ? "text-amber-700" : "text-stone-400"}`} title={balanceDue < 0 ? "More has been received than this invoice total" : undefined}>{fmtMoney(balanceDue)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        isPaid ? "bg-emerald-100 text-emerald-800" : overdue ? "bg-rose-100 text-rose-800" : paid > 0 ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {isPaid ? (balanceDue < 0 ? "Paid (excess)" : "Paid") : overdue ? "Overdue" : paid > 0 ? "Part paid" : "Unpaid"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setPrintInvoice({ ...i, advance_received: i.linked_order_id ? paid : i.advance_received })} className="text-stone-400 hover:text-indigo-700 p-1" title="Print">
                        <Receipt size={14} />
                      </button>
                      {!isPaid && (
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
            {shownInvoices.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400">
                  {q ? "No invoice matches your search." : view === "paid" ? "No paid invoices yet." : "No unpaid invoices."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      </>)}
      <p className="text-xs text-stone-400">Paid = payments logged for the order in Finance → Payments, applied to its invoices oldest first. When an invoice is fully covered its status changes to Paid automatically.</p>
      {modal && <InvoiceModal settings={settings} invoices={invoices} inv={modal} orders={orders} onClose={() => setModal(null)} onSave={save} count={invoices.length} />}
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

function InvoiceModal({ settings = {}, inv, invoices = [], orders, onClose, onSave, count }) {
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
    advance_received: inv.advance_received || "",
    include_previous_dispatches: !!inv.include_previous_dispatches,
    gst_type: inv.gst_type || "",
    customer_gstin: inv.customer_gstin || "",
    place_of_supply: inv.place_of_supply || "",
  });
  const [items, setItems] = useState(initialItems.map((it) => ({ hsn_code: "", gst_rate: "", ...it })));
  // pick up the customer's GSTIN from the CRM when it is not filled in
  useEffect(() => {
    const n = (f.customer_name || "").trim();
    if (!n || f.customer_gstin) return;
    let live = true;
    supabase.from("sales_customers").select("gstin").ilike("name", n).maybeSingle().then(({ data }) => {
      if (live && data?.gstin) setF((p) => (p.customer_gstin ? p : { ...p, customer_gstin: data.gstin }));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.customer_name]);
  const [loadingAdvance, setLoadingAdvance] = useState(false);
  const [deliveries, setDeliveries] = useState([]);
  const [pays, setPays] = useState([]);
  const [pick, setPick] = useState({});
  const order = orders.find((o) => o.id === f.linked_order_id);
  const blankLine = { description: "", quantity: 1, price: "", hsn_code: "", gst_rate: "" };
  const invNo = (id) => invoices.find((x) => x.id === id)?.invoice_number || "another invoice";

  // invoice lines for the chosen dispatch batches — ONLY what was dispatched, never the whole order
  const buildLines = (chosen, current, orderId) => {
    const byItem = {};
    chosen.forEach((d) => { byItem[d.item_description] = (byItem[d.item_description] || 0) + Number(d.quantity || 0); });
    const prior = invoices.filter((x) => x.linked_order_id === orderId && x.id !== f.id).flatMap((x) => x.items || []);
    const ord = orders.find((o) => o.id === orderId);
    const find = (desc, key) =>
      current.find((it) => it.description === desc && it[key])?.[key] ?? prior.find((it) => it.description === desc && it[key])?.[key] ?? ord?.items?.find((it) => it.description === desc && it[key])?.[key] ?? "";
    return Object.entries(byItem).map(([description, quantity]) => ({ description, quantity, price: find(description, "price"), hsn_code: find(description, "hsn_code"), gst_rate: find(description, "gst_rate") }));
  };

  // dispatches + payments of the linked order. New invoice: every not-yet-billed batch is ticked and becomes the lines.
  const loadOrderInfo = async (orderId, opts = {}) => {
    if (!orderId) { setDeliveries([]); setPays([]); setPick({}); return; }
    const [{ data: d }, { data: p }] = await Promise.all([
      supabase.from("order_deliveries").select("id, date, item_description, quantity, invoice_id").eq("order_id", orderId).order("date").order("created_at"),
      supabase.from("order_payments").select("id, amount, payment_date, mode").eq("order_id", orderId).order("payment_date"),
    ]);
    const list = d || [];
    setDeliveries(list); setPays(p || []);
    const chosen = list.filter((x) => (f.id ? x.invoice_id === f.id : !x.invoice_id));
    const pk = {}; chosen.forEach((x) => { pk[x.id] = true; });
    setPick(pk);
    if (opts.fillLines) setItems(chosen.length ? buildLines(chosen, [], orderId) : [{ ...blankLine }]);
    return p || [];
  };
  useEffect(() => { if (f.linked_order_id) loadOrderInfo(f.linked_order_id, { fillLines: !inv.id && !(inv.items && inv.items.length) }); /* eslint-disable-next-line */ }, []);

  // payments already counted against the order's other invoices are not counted again
  const otherInvoicesTotal = (orderId) =>
    invoices.filter((x) => x.linked_order_id === orderId && x.id !== f.id).reduce((t, x) => t + (x.items?.length ? invoiceTotal(x) : Number(x.amount) || 0), 0);

  const togglePick = (id, on) => {
    const next = { ...pick, [id]: on };
    setPick(next);
    const chosen = deliveries.filter((d) => next[d.id]);
    setItems(chosen.length ? buildLines(chosen, items, f.linked_order_id) : [{ ...blankLine }]);
  };

  const billWholeOrder = () => {
    if (!order?.items?.length) return;
    setPick({});
    setItems(order.items.map((it) => ({ description: it.description, quantity: it.quantity || 1, price: it.price || "", hsn_code: "", gst_rate: "" })));
  };

  const applyOrder = async (orderId) => {
    const o = orders.find((x) => x.id === orderId);
    setF((prev) => ({ ...prev, linked_order_id: orderId || null, customer_name: o ? o.customer_name : prev.customer_name }));
    if (orderId) {
      setLoadingAdvance(true);
      const data = await loadOrderInfo(orderId, { fillLines: true });
      const advanceTotal = (data || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      setLoadingAdvance(false);
      // payments already used by the order's other invoices (earlier batches) are not counted again
      setF((prev) => ({ ...prev, advance_received: Math.max(0, advanceTotal - otherInvoicesTotal(orderId)) || "" }));
    } else loadOrderInfo(null);
  };

  const [scanMsg, setScanMsg] = useState(null);
  // scanning an order-item barcode adds that dress to the bill (one per scan) and, on save, counts it as sold
  const onScanItem = async (code) => {
    const { data } = await supabase.rpc("scan_code", { p_code: code });
    if (data?.kind !== "order_item") return setScanMsg({ bad: true, text: `Barcode ${code} is not an order-item barcode.` });
    const it = data.item;
    if (f.linked_order_id && f.linked_order_id !== it.order_id) return setScanMsg({ bad: true, text: `That item is on ${it.order_number}, not the order linked to this invoice.` });
    const left = Number(it.balance) || 0;
    setItems((prev) => {
      const i = prev.findIndex((x) => x.fg_order_id === it.order_id && x.fg_item === it.item_description);
      if (i >= 0) return prev.map((x, k) => (k === i ? { ...x, quantity: (Number(x.quantity) || 0) + 1 } : x));
      const blank = prev.length === 1 && !prev[0].description && !prev[0].price;
      const line = { description: it.item_description, quantity: 1, price: it.unit_price || "", hsn_code: "", gst_rate: "", fg_order_id: it.order_id, fg_item: it.item_description };
      return blank ? [line] : [...prev, line];
    });
    setF((prev) => ({ ...prev, linked_order_id: prev.linked_order_id || it.order_id, customer_name: prev.customer_name || it.customer_name || "" }));
    setScanMsg({ bad: false, text: `Added ${it.item_description} (${it.order_number}) — ${Math.max(0, left - 1)} left in store after this` });
  };
  const addItem = () => setItems([...items, { description: "", quantity: 1, price: "", hsn_code: items[items.length - 1]?.hsn_code || "", gst_rate: items[items.length - 1]?.gst_rate || "" }]);
  const removeItem = (idx) => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  const updateItem = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const gb = gstBreakup(items, f.gst_type);
  const total = gb.total;
  const advance = Number(f.advance_received) || 0;
  const balanceDue = total - advance;

  return (
    <Modal title={inv.id ? "Edit invoice" : "New invoice"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.customer_name) return;
          const cleanItems = items
            .filter((it) => it.description || it.quantity || it.price)
            .map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0, hsn_code: (it.hsn_code || "").trim(), gst_rate: Number(it.gst_rate) || 0, ...(it.fg_order_id ? { fg_order_id: it.fg_order_id, fg_item: it.fg_item } : {}) }));
          const b = gstBreakup(cleanItems, f.gst_type);
          onSave({
            ...f, items: cleanItems, amount: b.total, taxable_value: b.taxable, gst_amount: b.gst,
            gst_type: f.gst_type || null, customer_gstin: f.customer_gstin ? f.customer_gstin.toUpperCase().trim() : null,
            place_of_supply: f.place_of_supply || null, advance_received: Number(f.advance_received) || 0,
            deliveryIds: f.linked_order_id ? Object.keys(pick).filter((k) => pick[k]) : [],
          });
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="GST">
            <select className={inputCls} value={f.gst_type} onChange={(e) => setF({ ...f, gst_type: e.target.value })}>
              <option value="">No GST (prices final)</option>
              <option value="intra">CGST + SGST (same state)</option>
              <option value="inter">IGST (other state)</option>
            </select>
          </Field>
          <Field label="Customer GSTIN"><input className={inputCls} maxLength={15} value={f.customer_gstin} onChange={(e) => setF({ ...f, customer_gstin: e.target.value })} /></Field>
        </div>
        {f.gst_type && (
          <p className="text-xs text-stone-500 -mt-2 mb-3">
            Enter prices <b>before GST</b>; set the GST % on each line. {f.customer_gstin && settings.gstin ? (f.customer_gstin.slice(0, 2) === settings.gstin.slice(0, 2) ? "Customer is in your state — CGST+SGST fits." : "Customer is in another state — IGST fits.") : ""}
          </p>
        )}

        {f.linked_order_id && (
          <div className="border border-stone-200 rounded-lg p-3 mb-3 bg-stone-50 text-xs" data-dispatch-picker>
            <div className="font-semibold text-stone-700 mb-1">Dispatches of this order — tick the batch(es) this invoice bills</div>
            {deliveries.length === 0 && (
              <p className="text-stone-500">Nothing has been dispatched for this order yet. Record the dispatch first, or bill the whole order below.</p>
            )}
            {deliveries.map((d, k) => {
              const other = d.invoice_id && d.invoice_id !== f.id;
              return (
                <label key={d.id} className={`flex items-center gap-2 py-0.5 ${other ? "opacity-60" : ""}`}>
                  <input type="checkbox" disabled={other} checked={!!pick[d.id]} onChange={(e) => togglePick(d.id, e.target.checked)} />
                  <span className="text-stone-500">Dispatch {k + 1} · {d.date}</span><span className="flex-1">{d.item_description}</span><span className="font-mono">{d.quantity} pcs</span>
                  {other && <span className="text-emerald-700 font-medium">billed in {invNo(d.invoice_id)}</span>}
                </label>
              );
            })}
            {deliveries.length > 0 && deliveries.every((d) => d.invoice_id && d.invoice_id !== f.id) && (
              <p className="text-emerald-700 mt-1">Every dispatch so far has already been invoiced. A new invoice can be made after the next dispatch.</p>
            )}
            {order?.items?.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-stone-500"><tr><th className="text-left font-medium">Item</th><th className="text-right font-medium">Ordered</th><th className="text-right font-medium">Dispatched</th><th className="text-right font-medium">Billed before</th><th className="text-right font-medium">This invoice</th><th className="text-right font-medium">Still to bill</th></tr></thead>
                  <tbody>
                    {order.items.map((it) => {
                      const sum = (fn) => deliveries.filter(fn).filter((d) => d.item_description === it.description).reduce((t, d) => t + Number(d.quantity || 0), 0);
                      const dispatched = sum(() => true), before = sum((d) => d.invoice_id && d.invoice_id !== f.id), mine = sum((d) => pick[d.id]);
                      return <tr key={it.description} className="border-t border-stone-200"><td>{it.description}</td><td className="text-right font-mono">{it.quantity}</td><td className="text-right font-mono">{dispatched}</td><td className="text-right font-mono">{before}</td><td className="text-right font-mono font-semibold">{mine}</td><td className="text-right font-mono">{Math.max(0, dispatched - before - mine)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {deliveries.length > 0 && (
              <label className="flex items-start gap-2 mt-2 pt-2 border-t border-stone-200 cursor-pointer" data-include-previous>
                <input type="checkbox" className="mt-0.5" checked={!!f.include_previous_dispatches} onChange={(e) => setF({ ...f, include_previous_dispatches: e.target.checked })} />
                <span>
                  <span className="font-semibold text-stone-700">Include previous dispatch details on this invoice</span>
                  <span className="block text-stone-500">Checked: the printed invoice lists the earlier dispatches of this order too ({deliveries.filter((d) => !pick[d.id]).length} other dispatch{deliveries.filter((d) => !pick[d.id]).length === 1 ? "" : "es"}), marking which invoice billed each. Unchecked: no dispatch details are printed — only the items on this invoice.</span>
                </span>
              </label>
            )}
            <button type="button" onClick={billWholeOrder} className="mt-2 font-medium text-indigo-700 hover:text-indigo-900">Bill the whole order instead (no dispatch)</button>
            {pays.length > 0 && (
              <div className="mt-3 pt-2 border-t border-stone-200">
                <div className="font-semibold text-stone-700 mb-1">Payments received on this order</div>
                {pays.map((p, k) => (
                  <div key={p.id} className="flex justify-between py-0.5"><span className="text-stone-500">{k === 0 ? "Advance" : `Payment ${k + 1}`} · {p.payment_date} · {p.mode}</span><span className="font-mono">{fmtMoney(p.amount)}</span></div>
                ))}
                <div className="flex justify-between font-semibold pt-1"><span>Total received</span><span className="font-mono">{fmtMoney(pays.reduce((t, p) => t + Number(p.amount || 0), 0))}</span></div>
              </div>
            )}
          </div>
        )}

        <div className="border border-dashed border-stone-300 rounded-lg p-2.5 mb-3 bg-stone-50">
          <div className="text-xs font-medium text-stone-600 mb-1">Scan a dress barcode to add it to the bill</div>
          <ScanBox onScan={onScanItem} placeholder="Scan the barcode label…" />
          {scanMsg && <p className={`text-xs mt-1 ${scanMsg.bad ? "text-rose-700" : "text-emerald-700"}`} role="status">{scanMsg.text}</p>}
        </div>
        <span className="block text-xs font-medium text-stone-600 mb-1">Items</span>
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-2">
          <div className="grid grid-cols-[1fr_72px_46px_58px_74px_26px] gap-1 bg-stone-50 px-2 py-1.5 text-[11px] font-medium text-stone-500 uppercase">
            <span>Description</span>
            <span>HSN</span>
            <span className="text-right">GST%</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price ₹</span>
            <span></span>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_72px_46px_58px_74px_26px] gap-1 px-2 py-1.5 border-t border-stone-100 items-center">
              <input
                className="border border-stone-300 rounded px-2 py-1 text-sm"
                placeholder="e.g. Cotton kurta"
                value={it.description}
                onChange={(e) => updateItem(idx, { description: e.target.value })}
              />
              <input
                className="border border-stone-300 rounded px-1.5 py-1 text-sm"
                placeholder="HSN"
                value={it.hsn_code || ""}
                onChange={(e) => updateItem(idx, { hsn_code: e.target.value })}
              />
              <input
                type="number"
                min="0"
                max="100"
                className="border border-stone-300 rounded px-1 py-1 text-sm text-right"
                value={it.gst_rate ?? ""}
                disabled={!f.gst_type}
                onChange={(e) => updateItem(idx, { gst_rate: e.target.value })}
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

        <div className="text-right text-sm mb-1">
          {f.gst_type ? "Taxable value" : "Subtotal"}: <span className="font-mono">{fmtMoney(gb.taxable)}</span>
        </div>
        {f.gst_type && gb.byRate.map((x) => (
          f.gst_type === "intra" ? (
            <div key={x.rate} className="text-right text-xs text-stone-600">CGST {x.rate / 2}%: <span className="font-mono">{fmtMoney(x.gst / 2)}</span> · SGST {x.rate / 2}%: <span className="font-mono">{fmtMoney(x.gst / 2)}</span></div>
          ) : (
            <div key={x.rate} className="text-right text-xs text-stone-600">IGST {x.rate}%: <span className="font-mono">{fmtMoney(x.gst)}</span></div>
          )
        ))}
        {f.gst_type && <div className="text-right text-sm mb-1 font-semibold">Invoice total: <span className="font-mono">{fmtMoney(total)}</span></div>}

        <Field label="Advance already received (₹)">
          <input
            type="number"
            min="0"
            className={inputCls}
            value={f.advance_received}
            placeholder={loadingAdvance ? "Loading from order…" : "0"}
            onChange={(e) => setF({ ...f, advance_received: e.target.value })}
          />
        </Field>
        <p className="text-xs text-stone-400 -mt-2 mb-3">
          {f.linked_order_id
            ? "Auto-filled from payments logged against this order — edit if needed."
            : "Enter manually if an advance was collected outside the Orders tab."}
        </p>

        <div className="text-right text-base font-bold mb-3 border-t border-stone-200 pt-2">
          {balanceDue < 0 ? "Excess received" : "Balance Due"}: <span className={`font-mono ${balanceDue < 0 ? "text-amber-700" : ""}`}>{fmtMoney(balanceDue)}</span>
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


// One card per order: what was ordered / dispatched / billed, every invoice raised for it, and a button to bill the batches not yet invoiced.
function ByOrder({ orders, invoices, deliveries, amountOf, paidById, partOf, q, setQ, onNew, onEdit, onPrint }) {
  const [open, setOpen] = useState({});
  const rows = orders
    .map((o) => {
      const dl = deliveries.filter((d) => d.order_id === o.id);
      const inv = invoices.filter((i) => i.linked_order_id === o.id).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
      const ordered = (o.items || []).reduce((t, it) => t + (Number(it.quantity) || 0), 0);
      const dispatched = dl.reduce((t, d) => t + Number(d.quantity || 0), 0);
      const unbilled = dl.filter((d) => !d.invoice_id);
      const unbilledQty = unbilled.reduce((t, d) => t + Number(d.quantity || 0), 0);
      const total = inv.reduce((t, i) => t + amountOf(i), 0);
      const paid = inv.reduce((t, i) => t + (paidById[i.id] || 0), 0);
      return { o, dl, inv, ordered, dispatched, unbilled, unbilledQty, total, paid };
    })
    .filter((r) => (r.dl.length || r.inv.length) && matchQ(q, r.o.order_number, r.o.customer_name, r.inv.map((i) => i.invoice_number)))
    .sort((a, b) => b.unbilled.length - a.unbilled.length || (b.o.order_number || "").localeCompare(a.o.order_number || ""));
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search order no., customer, invoice no…" className="max-w-xl" />
      <p className="text-xs text-stone-500">Each dispatch (part delivery) is billed on its own invoice, and every invoice of an order is grouped here. Once all dispatches are billed the order shows as <b>Fully delivered &amp; invoiced</b>.</p>
      {rows.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No orders with dispatches or invoices yet.</Card>}
      {rows.map(({ o, dl, inv, ordered, dispatched, unbilled, unbilledQty, total, paid }) => {
        const done = ordered > 0 && dispatched >= ordered && unbilled.length === 0 && inv.length > 0;
        const badge = done ? ["Fully delivered & invoiced", "bg-emerald-100 text-emerald-800"] : unbilled.length ? [`${unbilled.length} dispatch${unbilled.length > 1 ? "es" : ""} (${unbilledQty} pcs) not billed`, "bg-amber-100 text-amber-800"] : dispatched < ordered ? ["Part delivered — all dispatched pieces billed", "bg-sky-100 text-sky-800"] : ["Delivered", "bg-stone-100 text-stone-600"];
        return (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">{o.order_number} — {o.customer_name}</div>
                <div className="text-xs text-stone-500">Ordered {ordered} · Dispatched {dispatched} · {inv.length} invoice{inv.length === 1 ? "" : "s"} · Invoiced {fmtMoney(total)} · Received {fmtMoney(paid)} · Balance {fmtMoney(total - paid)}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge[1]}`}>{badge[0]}</span>
                {unbilled.length > 0 && <Btn onClick={() => onNew(o)}><Plus size={14} /> Invoice pending dispatches</Btn>}
              </div>
            </div>
            <button className="text-xs text-indigo-700 mt-2" onClick={() => setOpen({ ...open, [o.id]: !open[o.id] })}>{open[o.id] ? "Hide" : "Show"} invoices &amp; dispatches</button>
            {open[o.id] && (
              <div className="mt-2 space-y-2">
                {inv.map((i) => {
                  const mine = dl.filter((d) => d.invoice_id === i.id);
                  return (
                    <div key={i.id} className="rounded-lg border border-stone-200 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium">{i.invoice_number} <span className="text-xs text-stone-400">· {partOf[i.id]?.of > 1 ? `part ${partOf[i.id]?.n} of ${partOf[i.id]?.of}` : "full order"} · {i.issue_date}</span></span>
                        <span className="flex items-center gap-2"><span className="font-mono">{fmtMoney(amountOf(i))}</span>
                          <button className="text-stone-400 hover:text-indigo-700 p-1" title="Print" onClick={() => onPrint(i)}><Receipt size={14} /></button>
                          <button className="text-stone-400 hover:text-indigo-700 p-1" title="Edit" onClick={() => onEdit(i)}><Pencil size={14} /></button></span>
                      </div>
                      <div className="text-xs text-stone-500">{(i.items || []).map((it) => `${it.description} × ${it.quantity}`).join(", ")}{mine.length ? ` — dispatch of ${mine.map((d) => d.date).join(", ")}` : ""}</div>
                    </div>
                  );
                })}
                {unbilled.map((d) => <div key={d.id} className="text-xs text-amber-700 px-1">Not billed yet: {d.date} · {d.item_description} × {d.quantity}</div>)}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
