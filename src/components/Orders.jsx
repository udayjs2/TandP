import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, ClipboardList } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, HOUR_SLOTS, orderItemsRequired } from "../lib/helpers";

const ORDER_STATUSES = ["Pending", "Cutting", "Stitching", "Finishing", "Completed", "Shipped"];
const ORDER_COLORS = {
  Pending: "bg-stone-200 text-stone-700",
  Cutting: "bg-amber-100 text-amber-800",
  Stitching: "bg-sky-100 text-sky-800",
  Finishing: "bg-violet-100 text-violet-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Shipped: "bg-indigo-100 text-indigo-800",
};

export default function Orders({ profile }) {
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(null);
  const [progressOrder, setProgressOrder] = useState(null);
  const [todayTotals, setTodayTotals] = useState({});

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("order_date", { ascending: false });
    setOrders(data || []);
    const today = todayStr();
    const { data: prog } = await supabase.from("order_progress").select("order_id, quantity").eq("date", today);
    const totals = {};
    (prog || []).forEach((p) => (totals[p.order_id] = (totals[p.order_id] || 0) + Number(p.quantity || 0)));
    setTodayTotals(totals);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
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
    if (!confirm("Delete this order? This also removes its hourly progress log.")) return;
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
          const required = orderItemsRequired(o.items);
          const todayDone = todayTotals[o.id] || 0;
          return (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">{o.order_number} — {o.customer_name}</div>
                  <div className="text-sm text-stone-500">
                    {(o.items || []).map((it) => `${it.description} × ${it.quantity}`).join(", ") || "No items"}
                  </div>
                  <div className="text-xs text-stone-400 mt-1">Ordered {o.order_date} · Due {o.due_date || "—"}</div>
                  {o.daily_target > 0 && (
                    <div className="text-xs text-stone-500 mt-1">
                      Today: {todayDone}/{o.daily_target} items · target/day {o.daily_target}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={o.status}
                    onChange={(e) => setStatus(o.id, e.target.value)}
                    className={`text-xs font-medium rounded-full px-2 py-1 border-0 ${ORDER_COLORS[o.status]}`}
                  >
                    {ORDER_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
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
              {required > 0 && (
                <div className="mt-2 text-xs text-stone-400">Total required: {required} items</div>
              )}
            </Card>
          );
        })}
        {orders.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders yet.</Card>}
      </div>
      {modal && <OrderModal order={modal} onClose={() => setModal(null)} onSave={save} count={orders.length} />}
      {progressOrder && (
        <ProgressModal order={progressOrder} onClose={() => setProgressOrder(null)} profile={profile} />
      )}
    </div>
  );
}

function OrderModal({ order, onClose, onSave, count }) {
  const [f, setF] = useState({
    id: order.id || null,
    order_number: order.order_number || `ORD-${String(count + 1).padStart(4, "0")}`,
    customer_name: order.customer_name || "",
    order_date: order.order_date || todayStr(),
    due_date: order.due_date || "",
    status: order.status || "Pending",
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
                placeholder="e.g. T-shirts, Pants"
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
        <Field label="Status">
          <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {ORDER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ProgressModal({ order, onClose, profile }) {
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState({}); // { "hourKey|itemDesc": quantity }
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
    allProgress
      .filter((p) => p.date === date)
      .forEach((p) => (r[`${p.hour_slot}|${p.item_description}`] = p.quantity));
    setRows(r);
  }, [allProgress, date]);

  const saveCell = async (hourKey, itemDesc, value) => {
    const quantity = Number(value) || 0;
    await supabase.from("order_progress").upsert(
      {
        order_id: order.id,
        date,
        hour_slot: hourKey,
        item_description: itemDesc,
        quantity,
        updated_by: profile?.name || null,
      },
      { onConflict: "order_id,date,hour_slot,item_description" }
    );
    load();
  };

  // cumulative totals per item across all dates
  const cumulativeByItem = {};
  allProgress.forEach((p) => {
    cumulativeByItem[p.item_description] = (cumulativeByItem[p.item_description] || 0) + Number(p.quantity || 0);
  });
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
            {order.daily_target > 0 && (
              <span className="text-xs text-stone-500 font-mono">
                {todayTotal} / {order.daily_target} today
              </span>
            )}
          </div>

          <div className="border border-stone-200 rounded-lg overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-2 py-1.5">Hour</th>
                  {items.map((it) => (
                    <th key={it.description} className="text-right px-2 py-1.5">
                      {it.description}
                    </th>
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
            {required > 0 && (
              <div className="text-xs text-stone-400 pt-1">Total completed: {cumulativeTotal} / {required} items</div>
            )}
          </div>
        </>
      )}
      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Modal>
  );
}
