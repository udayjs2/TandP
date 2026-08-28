import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { fmtMoney, todayStr } from "../lib/helpers";

const ORDER_STATUSES = ["Pending", "Cutting", "Stitching", "Finishing", "Completed", "Shipped"];
const ORDER_COLORS = {
  Pending: "bg-stone-200 text-stone-700",
  Cutting: "bg-amber-100 text-amber-800",
  Stitching: "bg-sky-100 text-sky-800",
  Finishing: "bg-violet-100 text-violet-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Shipped: "bg-indigo-100 text-indigo-800",
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").order("order_date", { ascending: false });
    setOrders(data || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("orders-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (order) => {
    if (order.id) {
      await supabase.from("orders").update(order).eq("id", order.id);
    } else {
      const { id, ...rest } = order;
      await supabase.from("orders").insert(rest);
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this order?")) return;
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
        {orders.map((o) => (
          <Card key={o.id} className="p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">{o.order_number} — {o.customer_name}</div>
                <div className="text-sm text-stone-500">{o.item_description} · qty {o.quantity}</div>
                <div className="text-xs text-stone-400 mt-1">Ordered {o.order_date} · Due {o.due_date || "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{fmtMoney(o.amount)}</span>
                <select
                  value={o.status}
                  onChange={(e) => setStatus(o.id, e.target.value)}
                  className={`text-xs font-medium rounded-full px-2 py-1 border-0 ${ORDER_COLORS[o.status]}`}
                >
                  {ORDER_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button onClick={() => setModal(o)} className="text-stone-400 hover:text-indigo-700 p-1">
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove(o.id)} className="text-stone-400 hover:text-rose-700 p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </Card>
        ))}
        {orders.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders yet.</Card>}
      </div>
      {modal && <OrderModal order={modal} onClose={() => setModal(null)} onSave={save} count={orders.length} />}
    </div>
  );
}

function OrderModal({ order, onClose, onSave, count }) {
  const [f, setF] = useState({
    id: order.id || null,
    order_number: order.order_number || `ORD-${String(count + 1).padStart(4, "0")}`,
    customer_name: order.customer_name || "",
    item_description: order.item_description || "",
    quantity: order.quantity || "",
    order_date: order.order_date || todayStr(),
    due_date: order.due_date || "",
    amount: order.amount || "",
    status: order.status || "Pending",
  });
  return (
    <Modal title={order.id ? "Edit order" : "New order"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.customer_name) return;
          onSave({ ...f, quantity: Number(f.quantity) || 0, amount: Number(f.amount) || 0 });
        }}
      >
        <Field label="Order number">
          <input className={inputCls} value={f.order_number} onChange={(e) => setF({ ...f, order_number: e.target.value })} />
        </Field>
        <Field label="Customer / buyer">
          <input required className={inputCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
        </Field>
        <Field label="Item description">
          <input className={inputCls} placeholder="e.g. Cotton kurtas, size M" value={f.item_description} onChange={(e) => setF({ ...f, item_description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <input type="number" min="0" className={inputCls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          </Field>
          <Field label="Order value (₹)">
            <input type="number" min="0" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        </div>
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
