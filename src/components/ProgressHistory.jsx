import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, History } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls } from "./ui";
import { HOUR_SLOTS } from "../lib/helpers";

const fmtDay = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${day}-${mon}-${y}`;
};

// Reads every order_progress row (the table is paged past Supabase's 1000-row default).
async function loadAllProgress() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("order_progress")
      .select("order_id, date, hour_slot, item_description, quantity")
      .order("date", { ascending: false })
      .range(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Production Management → Order Progress History:
// one row per order per day, built from the hourly production progress. A day appears only if pieces were logged.
export default function ProgressHistory() {
  const [orders, setOrders] = useState([]);
  const [prog, setProg] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orderId, setOrderId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});

  const load = async () => {
    const [{ data: o }, p] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, items"),
      loadAllProgress(),
    ]);
    setOrders(o || []);
    setProg(p || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("progress-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const rows = useMemo(() => {
    const ordById = Object.fromEntries(orders.map((o) => [o.id, o]));
    const map = {};
    prog.forEach((p) => {
      const qty = Number(p.quantity) || 0;
      const k = `${p.date}||${p.order_id}`;
      map[k] ||= { key: k, date: p.date, order_id: p.order_id, order: ordById[p.order_id], total: 0, hours: {}, items: {} };
      map[k].total += qty;
      map[k].hours[p.hour_slot] = (map[k].hours[p.hour_slot] || 0) + qty;
      if (qty) map[k].items[p.item_description] = (map[k].items[p.item_description] || 0) + qty;
    });
    return Object.values(map)
      .filter((r) => r.total > 0)
      .sort((a, b) => b.date.localeCompare(a.date) || (a.order?.order_number || "").localeCompare(b.order?.order_number || ""));
  }, [orders, prog]);

  const shown = rows.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (orderId && r.order_id !== orderId) return false;
    if (q) {
      const s = `${r.order?.order_number || ""} ${r.order?.customer_name || ""}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const sum = shown.reduce((s, r) => s + r.total, 0);
  const orderOptions = [...new Map(rows.map((r) => [r.order_id, r.order])).entries()]
    .filter(([, o]) => o)
    .sort((a, b) => (a[1].order_number || "").localeCompare(b[1].order_number || ""));

  const hourLabel = (k) => HOUR_SLOTS.find((h) => h.key === k)?.label || k;
  const hourOrder = (k) => { const i = HOUR_SLOTS.findIndex((h) => h.key === k); return i < 0 ? 99 : i; };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><History size={18} /> Order Progress History</h2>
        <p className="text-xs text-stone-500 mt-0.5">
          Pieces stitched per order, day by day, taken from the hourly production progress in Orders. A day shows here only if pieces were logged for that order. Click a row for the hour-wise detail.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-stone-500">From<input type="date" className={`${inputCls} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-stone-500">To<input type="date" className={`${inputCls} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="text-xs text-stone-500">Order
            <select className={`${inputCls} mt-1`} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">All orders</option>
              {orderOptions.map(([id, o]) => <option key={id} value={id}>{o.order_number} — {o.customer_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-stone-500 flex-1 min-w-[160px]">Search<input className={`${inputCls} mt-1`} placeholder="Order number or name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {(from || to || orderId || q) && (
            <button className="text-xs text-indigo-700 underline pb-2" onClick={() => { setFrom(""); setTo(""); setOrderId(""); setQ(""); }}>Clear</button>
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center text-stone-500 text-sm"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Order number</th>
                <th className="text-left px-3 py-2.5">Order name</th>
                <th className="text-right px-3 py-2.5">Pieces stitched</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-stone-400">No progress logged{rows.length ? " for these filters" : " yet"}.</td></tr>
              )}
              {shown.map((r) => {
                const isOpen = !!open[r.key];
                const hours = Object.entries(r.hours).filter(([, v]) => v > 0).sort((a, b) => hourOrder(a[0]) - hourOrder(b[0]));
                return (
                  <Fragment key={r.key}>
                    <tr className="cursor-pointer hover:bg-stone-50" onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}>
                      <td className="pl-3 text-stone-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDay(r.date)}</td>
                      <td className="px-3 py-2 font-medium">{r.order?.order_number || "—"}</td>
                      <td className="px-3 py-2">{r.order?.customer_name || "Unknown order"}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{r.total}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.key}-d`} className="bg-stone-50">
                        <td />
                        <td colSpan={4} className="px-3 py-3">
                          <div className="flex flex-wrap gap-2 mb-2">
                            {hours.map(([k, v]) => (
                              <span key={k} className="text-xs bg-white border border-stone-200 rounded-md px-2 py-1">{hourLabel(k)}: <b>{v}</b></span>
                            ))}
                          </div>
                          <div className="text-xs text-stone-500">
                            {Object.entries(r.items).map(([it, v]) => `${it}: ${v}`).join(" · ")}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {shown.length > 0 && (
              <tfoot>
                <tr className="bg-stone-50 font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase text-stone-500">Total ({shown.length} {shown.length === 1 ? "entry" : "entries"})</td>
                  <td className="px-3 py-2 text-right font-mono">{sum}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </Card>
      )}
    </div>
  );
}
