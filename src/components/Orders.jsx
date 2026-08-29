import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, ClipboardList, Truck, Link as LinkIcon, Copy, Check } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, HOUR_SLOTS, orderItemsRequired, ORDER_STATUSES, ORDER_STATUS_COLORS, buildItemBreakdown } from "../lib/helpers";

export default function Orders({ profile }) {
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(null);
  const [progressOrder, setProgressOrder] = useState(null);
  const [deliveryOrder, setDeliveryOrder] = useState(null);
  const [trackOrder, setTrackOrder] = useState(null);
  const [todayTotals, setTodayTotals] = useState({});
  const [progressByOrder, setProgressByOrder] = useState({});
  const [deliveriesByOrder, setDeliveriesByOrder] = useState({});

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("order_date", { ascending: false });
    setOrders(data || []);

    const today = todayStr();
    const [{ data: todayProg }, { data: allProg }, { data: allDeliv }] = await Promise.all([
      supabase.from("order_progress").select("order_id, quantity").eq("date", today),
      supabase.from("order_progress").select("order_id, item_description, quantity"),
      supabase.from("order_deliveries").select("order_id, item_description, quantity"),
    ]);

    const totals = {};
    (todayProg || []).forEach((p) => (totals[p.order_id] = (totals[p.order_id] || 0) + Number(p.quantity || 0)));
    setTodayTotals(totals);

    const byOrderProg = {};
    (allProg || []).forEach((p) => {
      byOrderProg[p.order_id] = byOrderProg[p.order_id] || [];
      byOrderProg[p.order_id].push(p);
    });
    setProgressByOrder(byOrderProg);

    const byOrderDeliv = {};
    (allDeliv || []).forEach((d) => {
      byOrderDeliv[d.order_id] = byOrderDeliv[d.order_id] || [];
      byOrderDeliv[d.order_id].push(d);
    });
    setDeliveriesByOrder(byOrderDeliv);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (order) => {
    if (order.id) {
      const { id, ...rest } = order;
      await supabase.from("orders").update(rest).eq("id", id);
    } else {
      const { id, ...rest } = order;
      await supabase.from("orders").insert(rest);
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this order? This also removes its progress and delivery history.")) return;
    await supabase.from("orders").delete().eq("id", id);
    load();
  };

  const setStatus = async (id, status) => {
    await supabase.from("orders").update({ status }).eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Orders ({orders.length})</h2>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> New order
        </Btn>
      </div>
      <div className="grid gap-3">
        {orders.map((o) => {
          const breakdown = buildItemBreakdown(o.items, progressByOrder[o.id] || [], deliveriesByOrder[o.id] || []);
          const totalRequired = orderItemsRequired(o.items);
          const totalDelivered = breakdown.reduce((s, b) => s + b.delivered, 0);
          const totalPending = breakdown.reduce((s, b) => s + b.pending, 0);
          const todayDone = todayTotals[o.id] || 0;
          return (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">{o.order_number} — {o.customer_name}</div>
                  <div className="text-sm text-stone-500">
                    {(o.items || []).map((it) => `${it.description} × ${it.quantity}`).join(", ") || "No items"}
                  </div>
                  <div className="text-xs text-stone-400 mt-1 flex flex-wrap gap-x-3">
                    <span>Ordered {o.order_date}</span>
                    <span>Planned {o.planned_start_date || "—"} → {o.planned_end_date || "—"}</span>
                    <span>Due {o.due_date || "—"}</span>
                  </div>
                  {o.daily_target > 0 && (
                    <div className="text-xs text-stone-500 mt-1">Today: {todayDone}/{o.daily_target} items</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={o.status}
                    onChange={(e) => setStatus(o.id, e.target.value)}
                    className={`text-xs font-medium rounded-full px-2 py-1 border-0 ${ORDER_STATUS_COLORS[o.status]}`}
                  >
                    {ORDER_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <button onClick={() => setTrackOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Customer tracking link">
                    <LinkIcon size={14} />
                  </button>
                  <button onClick={() => setDeliveryOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Deliveries">
                    <Truck size={14} />
                  </button>
                  <button onClick={() => setProgressOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Track progress">
                    <ClipboardList size={14} />
                  </button>
                  <button onClick={() => setModal(o)} className="text-stone-400 hover:text-indigo-700 p-1">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(o.id)} className="text-stone-400 hover:text-rose-700 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {breakdown.length > 0 && (
                <div className="mt-3 border-t border-stone-100 pt-2 grid gap-1">
                  {breakdown.map((b) => (
                    <div key={b.description} className="flex items-center justify-between text-xs text-stone-500">
                      <span className="w-28 truncate">{b.description}</span>
                      <span className="font-mono">
                        {b.completed}/{b.required} made · {b.delivered} delivered · <span className={b.pending > 0 ? "text-amber-700 font-medium" : ""}>{b.pending} pending</span>
                      </span>
                    </div>
                  ))}
                  {totalRequired > 0 && (
                    <div className="text-xs text-stone-400 pt-0.5">
                      Total: {totalDelivered}/{totalRequired} delivered, {totalPending} pending
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {orders.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders yet.</Card>}
      </div>
      {modal && <OrderModal order={modal} onClose={() => setModal(null)} onSave={save} count={orders.length} />}
      {progressOrder && <ProgressModal order={progressOrder} onClose={() => setProgressOrder(null)} profile={profile} />}
      {deliveryOrder && <DeliveryModal order={deliveryOrder} onClose={() => setDeliveryOrder(null)} profile={profile} />}
      {trackOrder && <TrackingLinkModal order={trackOrder} onClose={() => setTrackOrder(null)} />}
    </div>
  );
}

function OrderModal({ order, onClose, onSave, count }) {
  const [f, setF] = useState({
    id: order.id || null,
    order_number: order.order_number || `ORD-${String(count + 1).padStart(4, "0")}`,
    customer_name: order.customer_name || "",
    order_date: order.order_date || todayStr(),
    planned_start_date: order.planned_start_date || "",
    planned_end_date: order.planned_end_date || "",
    due_date: order.due_date || "",
    status: order.status || "Not Started",
    daily_target: order.daily_target || "",
  });
  const [items, setItems] = useState(order.items && order.items.length ? order.items : [{ description: "", quantity: "" }]);

  const addItem = () => setItems([...items, { description: "", quantity: "" }]);
  const removeItem = (idx) => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  const updateItem = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  return (
    <Modal title={order.id ? "Edit order" : "New order"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.customer_name) return;
          const cleanItems = items
            .filter((it) => it.description || it.quantity)
            .map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0 }));
          onSave({ ...f, items: cleanItems, daily_target: Number(f.daily_target) || 0 });
        }}
      >
        <Field label="Order number">
          <input className={inputCls} value={f.order_number} onChange={(e) => setF({ ...f, order_number: e.target.value })} />
        </Field>
        <Field label="Customer / buyer">
          <input required className={inputCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
        </Field>

        <span className="block text-xs font-medium text-stone-600 mb-1">Items</span>
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-2">
          <div className="grid grid-cols-[1fr_80px_28px] gap-1 bg-stone-50 px-2 py-1.5 text-[11px] font-medium text-stone-500 uppercase">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span></span>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_28px] gap-1 px-2 py-1.5 border-t border-stone-100 items-center">
              <input
                className="border border-stone-300 rounded px-2 py-1 text-sm"
                placeholder="e.g. T-shirts, Skirts"
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
              <button type="button" onClick={() => removeItem(idx)} className="text-stone-400 hover:text-rose-700 justify-self-center">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="text-xs font-medium text-indigo-700 hover:text-indigo-900 flex items-center gap-1 mb-3">
          <Plus size={13} /> Add another item
        </button>

        <Field label="Target items per day">
          <input type="number" min="0" className={inputCls} value={f.daily_target} onChange={(e) => setF({ ...f, daily_target: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Order date">
            <input type="date" className={inputCls} value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputCls} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Planned start date">
            <input type="date" className={inputCls} value={f.planned_start_date} onChange={(e) => setF({ ...f, planned_start_date: e.target.value })} />
          </Field>
          <Field label="Planned end date">
            <input type="date" className={inputCls} value={f.planned_end_date} onChange={(e) => setF({ ...f, planned_end_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {ORDER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ProgressModal({ order, onClose, profile }) {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState({});
  const [allProgress, setAllProgress] = useState([]);
  const items = order.items || [];
  const required = orderItemsRequired(items);

  const load = async () => {
    const { data } = await supabase.from("order_progress").select("*").eq("order_id", order.id);
    setAllProgress(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    const r = {};
    allProgress.filter((p) => p.date === date).forEach((p) => (r[`${p.hour_slot}|${p.item_description}`] = p.quantity));
    setRows(r);
  }, [allProgress, date]);

  const saveCell = async (hourKey, itemDesc, value) => {
    const quantity = Number(value) || 0;
    await supabase.from("order_progress").upsert(
      { order_id: order.id, date, hour_slot: hourKey, item_description: itemDesc, quantity, updated_by: profile?.name || null },
      { onConflict: "order_id,date,hour_slot,item_description" }
    );
    load();
  };

  const cumulativeByItem = {};
  allProgress.forEach((p) => (cumulativeByItem[p.item_description] = (cumulativeByItem[p.item_description] || 0) + Number(p.quantity || 0)));
  const cumulativeTotal = Object.values(cumulativeByItem).reduce((s, v) => s + v, 0);
  const todayTotal = Object.entries(rows).reduce((s, [, v]) => s + (Number(v) || 0), 0);

  return (
    <Modal title={`Progress — ${order.order_number}`} onClose={onClose}>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">This order has no items yet. Edit the order to add items first.</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
            {order.daily_target > 0 && <span className="text-xs text-stone-500 font-mono">{todayTotal} / {order.daily_target} today</span>}
          </div>

          <div className="border border-stone-200 rounded-lg overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-2 py-1.5">Hour</th>
                  {items.map((it) => (
                    <th key={it.description} className="text-right px-2 py-1.5">{it.description}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HOUR_SLOTS.map((h) => (
                  <tr key={h.key} className="border-t border-stone-100">
                    <td className="px-2 py-1 text-stone-500 whitespace-nowrap">{h.label}</td>
                    {items.map((it) => (
                      <td key={it.description} className="px-2 py-1">
                        <input
                          type="number"
                          min="0"
                          className="w-16 border border-stone-300 rounded px-1 py-1 text-right text-sm"
                          defaultValue={rows[`${h.key}|${it.description}`] || ""}
                          key={`${date}-${h.key}-${it.description}-${rows[`${h.key}|${it.description}`] || 0}`}
                          onBlur={(e) => saveCell(h.key, it.description, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-stone-600 uppercase">Overall progress</div>
            {items.map((it) => {
              const done = cumulativeByItem[it.description] || 0;
              const need = Number(it.quantity) || 0;
              const pct = need ? Math.min(100, (done / need) * 100) : 0;
              return (
                <div key={it.description}>
                  <div className="flex justify-between text-xs text-stone-500 mb-0.5">
                    <span>{it.description}</span>
                    <span>{done} / {need}</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {required > 0 && <div className="text-xs text-stone-400 pt-1">Total completed: {cumulativeTotal} / {required} items</div>}
          </div>
        </>
      )}
      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function DeliveryModal({ order, onClose, profile }) {
  const [deliveries, setDeliveries] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [itemDesc, setItemDesc] = useState(order.items?.[0]?.description || "");
  const [quantity, setQuantity] = useState("");
  const [deliveredTo, setDeliveredTo] = useState("");
  const [notes, setNotes] = useState("");
  const items = order.items || [];

  const load = async () => {
    const { data } = await supabase.from("order_deliveries").select("*").eq("order_id", order.id).order("date", { ascending: false });
    setDeliveries(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const breakdown = buildItemBreakdown(items, [], deliveries);

  const addDelivery = async (e) => {
    e.preventDefault();
    if (!itemDesc || !quantity) return;
    await supabase.from("order_deliveries").insert({
      order_id: order.id,
      date,
      item_description: itemDesc,
      quantity: Number(quantity) || 0,
      delivered_to: deliveredTo || null,
      notes: notes || null,
      updated_by: profile?.name || null,
    });
    setQuantity("");
    setDeliveredTo("");
    setNotes("");
    load();
  };

  const removeDelivery = async (id) => {
    if (!confirm("Remove this delivery entry?")) return;
    await supabase.from("order_deliveries").delete().eq("id", id);
    load();
  };

  return (
    <Modal title={`Deliveries — ${order.order_number}`} onClose={onClose}>
      {items.length === 0 ? (
        <p className="text-sm text-stone-500">This order has no items yet. Edit the order to add items first.</p>
      ) : (
        <>
          <div className="space-y-1.5 mb-4">
            {breakdown.map((b) => {
              const pct = b.required ? Math.min(100, (b.delivered / b.required) * 100) : 0;
              return (
                <div key={b.description}>
                  <div className="flex justify-between text-xs text-stone-500 mb-0.5">
                    <span>{b.description}</span>
                    <span>{b.delivered} / {b.required} delivered · {b.pending} pending</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={addDelivery} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
            <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Log a delivery</div>
            <div className="grid grid-cols-2 gap-2">
              <select className={inputCls} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)}>
                {items.map((it) => (
                  <option key={it.description} value={it.description}>{it.description}</option>
                ))}
              </select>
              <input type="number" min="0" placeholder="Quantity" className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
              <input placeholder="Delivered to (optional)" className={inputCls} value={deliveredTo} onChange={(e) => setDeliveredTo(e.target.value)} />
            </div>
            <input placeholder="Notes (optional)" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Btn type="submit" className="w-full justify-center">Add delivery</Btn>
          </form>

          <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History</div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
                <div>
                  <span className="font-medium">{d.item_description}</span> × {d.quantity}
                  <div className="text-xs text-stone-400">{d.date}{d.delivered_to ? ` · ${d.delivered_to}` : ""}</div>
                </div>
                <button onClick={() => removeDelivery(d.id)} className="text-stone-400 hover:text-rose-700 p-1">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {deliveries.length === 0 && <p className="text-xs text-stone-400">No deliveries logged yet.</p>}
          </div>
        </>
      )}
      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

function TrackingLinkModal({ order, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/?track=1&order=${encodeURIComponent(order.order_number)}&code=${encodeURIComponent(order.tracking_code)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable — link is still shown for manual copy */
    }
  };

  return (
    <Modal title="Customer tracking link" onClose={onClose}>
      <p className="text-sm text-stone-600 mb-3">
        Share this link with the customer so they can check order status themselves — no login needed.
      </p>
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 text-xs break-all font-mono mb-3">{url}</div>
      <Btn onClick={copy} className="w-full justify-center">
        {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}
      </Btn>
      <p className="text-xs text-stone-400 mt-3">
        Order number: <span className="font-mono">{order.order_number}</span> · Tracking code: <span className="font-mono">{order.tracking_code}</span>
      </p>
    </Modal>
  );
}
