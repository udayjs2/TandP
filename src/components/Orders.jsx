import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, ClipboardList, Truck, Link as LinkIcon, Copy, Check, Users, FileText, Send, Star, AlertTriangle, Calculator } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, HOUR_SLOTS, orderItemsRequired, ORDER_STATUSES, ORDER_STATUS_COLORS, buildItemBreakdown, computeLaborCost, fmtMoney, DELAY_CAUSES, FEEDBACK_ITEMS, isOrderOverdue, daysBetween } from "../lib/helpers";
import { AgreementModal } from "./OrderAgreement";
import ActualCostModal from "./ActualCost";
import { isSalesStaff } from "../lib/orgRoles";
import { LotCard, RequestLotModal, lotRemaining } from "./DispatchLots";
import { loadGarmentNames, SIZE_MODES, LETTER_ORDER, itemSizes, itemSizeText } from "../lib/garments";

// Why an order cannot move to this status yet (empty string = allowed).
// Shipped needs quality approval and then dispatch approval (PM, then GM); Completed = delivered, only after Shipped.
// Rejected by Customer sits between Shipped and Completed; only the Admin, PM and GM can set it.
export const statusBlock = (o, s, role) => {
  if (o.status === s) return "";
  if (s === "Rejected by Customer") {
    if (o.status !== "Shipped") return "only after Shipped";
    if (role && !["admin", "gm", "pm"].includes(role)) return "Admin / PM / GM only";
    return "";
  }
  if (s === "Shipped") {
    if (o.quality_status !== "Approved") return "needs QC approval";
    if (o.dispatch_status !== "Approved") return "needs dispatch approval";
  }
  if (s === "Completed" && !["Shipped", "Rejected by Customer"].includes(o.status)) return "ship it first";
  return "";
};

export default function Orders({ profile }) {
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(null);
  const [progressOrder, setProgressOrder] = useState(null);
  const [deliveryOrder, setDeliveryOrder] = useState(null);
  const [trackOrder, setTrackOrder] = useState(null);
  const [laborOrder, setLaborOrder] = useState(null);
  const [agreementOrder, setAgreementOrder] = useState(null);
  const [rcaOrder, setRcaOrder] = useState(null); // { order, nextStatus }
  const [view, setView] = useState("active"); // active | completed | master
  const [rejectOrder, setRejectOrder] = useState(null);
  const [q, setQ] = useState("");
  const [monthF, setMonthF] = useState(""); // "" = all months, else YYYY-MM (by order date)
  const [sortDir, setSortDir] = useState("desc"); // newest first by default
  const [costOrder, setCostOrder] = useState(null);
  const [sendAgreementOrder, setSendAgreementOrder] = useState(null);
  const [feedbackOrder, setFeedbackOrder] = useState(null);
  const [rcaByOrder, setRcaByOrder] = useState({});
  const [feedbackByOrder, setFeedbackByOrder] = useState({});
  const [settings, setSettings] = useState({});
  const [todayTotals, setTodayTotals] = useState({});
  const [progressByOrder, setProgressByOrder] = useState({});
  const [deliveriesByOrder, setDeliveriesByOrder] = useState({});
  const [lotsByOrder, setLotsByOrder] = useState({});

  const load = async () => {
    const { data, error } = await supabase.from("orders").select("*").order("order_date", { ascending: false });
    if (error) console.error("Failed to load orders:", error.message);
    setOrders(data || []);

    const today = todayStr();
    const [{ data: todayProg }, { data: allProg }, { data: allDeliv }, { data: set }, { data: rcas }, { data: fbs }, { data: lotRows }] = await Promise.all([
      supabase.from("order_progress").select("order_id, quantity").eq("date", today),
      supabase.from("order_progress").select("order_id, item_description, quantity"),
      supabase.from("order_deliveries").select("order_id, item_description, quantity, customer_status, accepted_qty, rejected_qty"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.from("order_delay_rca").select("*"),
      supabase.from("order_feedback").select("*"),
      supabase.from("dispatch_lots").select("order_id, status"),
    ]);
    const lb = {};
    (lotRows || []).forEach((l) => { (lb[l.order_id] = lb[l.order_id] || []).push(l); });
    setLotsByOrder(lb);
    setSettings(set || {});
    setRcaByOrder(Object.fromEntries((rcas || []).map((r) => [r.order_id, r])));
    setFeedbackByOrder(Object.fromEntries((fbs || []).map((r) => [r.order_id, r])));

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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_delay_rca" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_feedback" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_lots" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (order) => {
    const { salesLink, ...orderRow } = order;
    let orderId = orderRow.id;
    if (orderRow.id) {
      const { id, ...rest } = orderRow;
      const { error } = await supabase.from("orders").update(rest).eq("id", id);
      if (error) { alert(`Couldn't save this order:\n${error.message}`); return; }
    } else {
      const { id, ...rest } = orderRow;
      const { data, error } = await supabase.from("orders").insert(rest).select("id").single();
      if (error) { alert(`Couldn't save this order:\n${error.message}`); return; }
      orderId = data?.id;
    }
    if (salesLink && orderId) {
      const { data, error } = await supabase.rpc("set_order_sales", { p_order: orderId, p_salesperson: salesLink.salesperson || null, p_value: Number(salesLink.value) || 0, p_lead: null });
      if (error || !data?.ok) alert(`The order was saved, but linking it to the salesperson failed:\n${error?.message || data?.error} (run migration_40.sql if needed)`);
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this order? This also removes its progress and delivery history.")) return;
    await supabase.from("orders").delete().eq("id", id);
    load();
  };

  const needsRca = (o) => !!o.due_date && o.due_date < todayStr() && !rcaByOrder[o.id];
  const setStatus = async (id, status) => {
    const ord = orders.find((x) => x.id === id);
    if (status === "Rejected by Customer" && ord?.status === "Shipped") { setRejectOrder(ord); return; }
    if (ord?.status === "Rejected by Customer" && (status === "Shipped" || status === "Completed")) {
      const { data, error: rerr } = await supabase.rpc("resolve_customer_rejection", { p_order_id: id, p_to: status });
      if (rerr || data?.ok === false) alert(rerr?.message || data?.error);
      load();
      return;
    }
    if (ord && (status === "Completed" || status === "Shipped") && !["Completed", "Shipped", "Rejected by Customer"].includes(ord.status) && needsRca(ord)) {
      setRcaOrder({ order: ord, nextStatus: status }); // RCA first, then the status change
      return;
    }
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) alert(error.message);
    load();
  };

  // Shipped orders stay in Active (in transit) until the customer has received them -> Completed
  const isDone = (o) => o.status === "Completed";
  const activeOrders = orders.filter((o) => !isDone(o));
  const doneOrders = orders.filter(isDone);
  const needle = q.trim().toLowerCase();
  const matches = (o) =>
    (!needle || [o.order_number, o.customer_name, o.status, ...(o.items || []).map((i) => i.description)].some((v) => String(v || "").toLowerCase().includes(needle))) &&
    (!monthF || (o.order_date || "").startsWith(monthF));
  const shownOrders = (view === "active" ? activeOrders : doneOrders)
    .filter(matches)
    .sort((a, b) => {
      const c = String(a.order_date || "").localeCompare(String(b.order_date || "")) || String(a.order_number || "").localeCompare(String(b.order_number || ""));
      return sortDir === "asc" ? c : -c;
    });
  const monthOptions = [...new Set(orders.map((o) => (o.order_date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const monthLabel = (mk) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mk.slice(5, 7)) - 1] + " " + mk.slice(0, 4);

  return (
    <div className="space-y-4">
      <div className="subtab-bar">
        {[["active", `Active (${activeOrders.length})`], ["completed", `Completed (${doneOrders.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`subtab ${view === id ? "subtab-active" : ""}`}>{label}</button>
        ))}
      </div>
      {(<>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{view === "active" ? `Orders (${shownOrders.length}${shownOrders.length !== activeOrders.length ? ` of ${activeOrders.length}` : ""})` : `Completed orders (${shownOrders.length})`}</h2>
        {view === "completed" ? null : (
          <Btn onClick={() => setModal({})}>
            <Plus size={15} /> New order
          </Btn>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={inputCls + " flex-1 min-w-[200px]"} placeholder="Search by order name / number, customer or item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputCls + " w-auto"} value={monthF} onChange={(e) => setMonthF(e.target.value)}>
          <option value="">All months</option>
          {monthOptions.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
        </select>
        <select className={inputCls + " w-auto"} value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
          <option value="desc">Date: newest first</option>
          <option value="asc">Date: oldest first</option>
        </select>
        {(q || monthF) && <button onClick={() => { setQ(""); setMonthF(""); }} className="text-xs text-indigo-700 hover:underline">Clear</button>}
      </div>
      <div className="grid gap-3">
        {shownOrders.map((o) => {
          const breakdown = buildItemBreakdown(o.items, progressByOrder[o.id] || [], deliveriesByOrder[o.id] || []);
          const totalRequired = orderItemsRequired(o.items);
          const totalDelivered = breakdown.reduce((s, b) => s + b.delivered, 0);
          const totalPending = breakdown.reduce((s, b) => s + b.pending, 0);
          const todayDone = todayTotals[o.id] || 0;
          const overdue = isOrderOverdue(o, todayStr());
          const daysLate = overdue ? daysBetween(o.due_date, todayStr()) : 0;
          const rca = rcaByOrder[o.id];
          const fb = feedbackByOrder[o.id];
          const fbAvg = fb ? (() => { const v = Object.values(fb.ratings || {}).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; })() : 0;
          const agr = o.agreement_status || "Not sent";
          return (
            <Card key={o.id} className={`p-4 ${overdue ? "border-rose-400 bg-rose-50/60 ring-1 ring-rose-200" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    <span className={overdue ? "text-rose-700" : ""}>{o.order_number} — {o.customer_name}</span>
                    {overdue && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-rose-600 text-white flex items-center gap-1"><AlertTriangle size={11} /> {daysLate} day{daysLate === 1 ? "" : "s"} overdue</span>}
                    {(overdue || rca) && (
                      <button onClick={() => setRcaOrder({ order: o, nextStatus: null })} className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${rca ? "bg-stone-100 text-stone-600" : "bg-rose-100 text-rose-800"}`}>
                        {rca ? "RCA done" : "RCA needed"}
                      </button>
                    )}
                    <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${agr === "Agreed" ? "bg-emerald-100 text-emerald-800" : agr === "Disagreed" ? "bg-rose-600 text-white" : agr === "Sent" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-500"}`}>
                      {agr === "Agreed" ? "Customer agreed" : agr === "Disagreed" ? "Customer disagreed" : agr === "Sent" ? "Agreement sent" : "Agreement not sent"}
                    </span>
                    {fb && <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">Feedback {fbAvg.toFixed(1)}★</span>}
                  </div>
                  <div className="text-sm text-stone-500">
                    {(o.items || []).length === 0 ? "No items" : (o.items || []).map((it, i) => (
                      <span key={i}>{i > 0 ? ", " : ""}{it.description} × {it.quantity}
                        {it.added_by && <span className="ml-1 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800" data-testid="added-by" title={`Item added from the Cutting module${it.added_at ? ` on ${String(it.added_at).slice(0, 10)}` : ""}`}>added by {it.added_by_role === "cutting_master" ? "Cutting Master" : it.added_by_role === "cutting" ? "Cutter" : "Cutting"} {it.added_by}</span>}
                        {!it.added_by && it.size_added_by && <span className="ml-1 text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800" data-testid="added-by" title="Size range added from the Cutting module">sizes added by {it.size_added_by}</span>}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-stone-400 mt-1 flex flex-wrap gap-x-3">
                    <span>Ordered {o.order_date}</span>
                    <span>Planned {o.planned_start_date || "—"} → {o.planned_end_date || "—"}</span>
                    <span className={overdue ? "text-rose-700 font-semibold" : ""}>Due {o.due_date || "—"}</span>
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
                    {ORDER_STATUSES.map((s) => {
                      const why = statusBlock(o, s, profile?.role);
                      return <option key={s} value={s} disabled={!!why}>{s}{why ? ` (${why})` : ""}</option>;
                    })}
                  </select>
                  <span
                    className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${o.quality_status === "Approved" ? "bg-emerald-100 text-emerald-800" : o.quality_status === "Rejected" ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-500"}`}
                    title="Set by the Quality Manager in the Quality tab"
                  >
                    {o.quality_status === "Approved" ? "QC approved" : o.quality_status === "Rejected" ? "QC rejected" : "QC pending"}
                  </span>
                  {o.quality_status === "Approved" && o.status !== "Completed" && (
                    <span
                      className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${o.dispatch_status === "Approved" ? "bg-emerald-100 text-emerald-800" : o.dispatch_status === "Rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}
                      title="Dispatch approval: Production Manager, then General Manager (Quality tab)"
                    >
                      {o.dispatch_status === "Approved" ? "Dispatch approved" : o.dispatch_status === "Pending GM" ? "Dispatch: awaiting GM" : o.dispatch_status === "Rejected" ? "Dispatch rejected" : "Dispatch: awaiting PM"}
                    </span>
                  )}
                  {o.status === "Shipped" && (
                    <button
                      onClick={() => { if (window.confirm(`Mark ${o.order_number} as delivered to the customer? It will move to Completed.`)) setStatus(o.id, "Completed"); }}
                      className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Mark delivered
                    </button>
                  )}
                  {o.status === "Shipped" && ["admin", "gm", "pm"].includes(profile?.role) && (
                    <button onClick={() => setRejectOrder(o)} className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-rose-600 text-white hover:bg-rose-700" title="The customer rejected the goods">
                      Customer rejected
                    </button>
                  )}
                  <button onClick={() => setTrackOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Customer tracking link">
                    <LinkIcon size={14} />
                  </button>
                  {profile?.role === "admin" && (
                    <button onClick={() => setCostOrder({ order: o, made: breakdown.reduce((sum, b) => sum + b.completed, 0) })} className="text-stone-400 hover:text-emerald-700 p-1" title="Actual cost of this order">
                      <Calculator size={14} />
                    </button>
                  )}
                  <button onClick={() => setSendAgreementOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Send agreement to customer (agree / disagree link)">
                    <Send size={14} />
                  </button>
                  <button onClick={() => setFeedbackOrder(o)} className="text-stone-400 hover:text-amber-600 p-1" title="Customer feedback link">
                    <Star size={14} />
                  </button>
                  <button onClick={() => setAgreementOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Generate order agreement">
                    <FileText size={14} />
                  </button>
                  <button onClick={() => setDeliveryOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Deliveries">
                    <Truck size={14} />
                  </button>
                  <button onClick={() => setLaborOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Manpower / labor cost">
                    <Users size={14} />
                  </button>
                  <button onClick={() => setProgressOrder(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Track progress">
                    <ClipboardList size={14} />
                  </button>
                  <button onClick={() => setModal(o)} className="text-stone-400 hover:text-indigo-700 p-1" title="Edit order">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(o.id)} className="text-stone-400 hover:text-rose-700 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {o.status === "Rejected by Customer" && (
                <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm">
                  <div className="font-semibold text-rose-800 flex items-center gap-1.5"><AlertTriangle size={14} /> Rejected by the customer</div>
                  <div className="text-rose-900 mt-0.5">{o.customer_reject_reason || "No reason recorded."}</div>
                  <div className="text-[11px] text-rose-700 mt-0.5">{o.customer_rejected_by ? `Recorded by ${o.customer_rejected_by}` : ""}{o.customer_rejected_at ? ` on ${String(o.customer_rejected_at).slice(0, 10)}` : ""}</div>
                  {["admin", "gm", "pm"].includes(profile?.role) && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button onClick={() => setStatus(o.id, "Shipped")} className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-indigo-700 text-white hover:bg-indigo-800">Goods sent again (back to Shipped)</button>
                      <button onClick={() => { if (window.confirm(`The customer finally accepted ${o.order_number}? It will move to Completed.`)) setStatus(o.id, "Completed"); }} className="text-[11px] font-medium rounded-full px-2.5 py-1 bg-emerald-600 text-white hover:bg-emerald-700">Customer accepted (Completed)</button>
                    </div>
                  )}
                </div>
              )}
              {(() => {
                const ls = lotsByOrder[o.id] || [];
                const live = ls.filter((l) => l.status !== "Rejected");
                if (!live.length) return null;
                const waiting = live.filter((l) => l.status !== "Approved").length;
                const ready = live.filter((l) => l.status === "Approved").length;
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-800">Partial dispatches: {live.length}</span>
                    {waiting > 0 && <span className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">{waiting} awaiting approval</span>}
                    {ready > 0 && <span className="rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-800">{ready} approved for dispatch</span>}
                  </div>
                );
              })()}
              {(() => {
                const ds = deliveriesByOrder[o.id] || [];
                if (!ds.length) return null;
                const acc = ds.reduce((t, d) => t + (Number(d.accepted_qty) || 0), 0);
                const rej = ds.reduce((t, d) => t + (Number(d.rejected_qty) || 0), 0);
                const wait = ds.filter((d) => (d.customer_status || "Pending") === "Pending").reduce((t, d) => t + (Number(d.quantity) || 0), 0);
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-800">Customer accepted {acc}</span>
                    {rej > 0 && <span className="rounded-full px-2 py-0.5 bg-rose-100 text-rose-800 font-semibold">Customer rejected {rej}</span>}
                    {wait > 0 && <span className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">{wait} awaiting customer reply</span>}
                  </div>
                );
              })()}
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
        {shownOrders.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">{(q || monthF) ? "No orders match your search or month filter." : view === "completed" ? "No completed orders yet. Orders move here once they are Shipped and then marked Completed after the customer receives them." : "No active orders. Add a new order."}</Card>}
      </div>
      </>)}
      {modal && <OrderModal order={modal} rcaBlocked={!!modal.id && needsRca(modal)} onClose={() => setModal(null)} onSave={save} count={orders.length} canLinkSales={["admin", "gm", "pm"].includes(profile?.role)} />}
      {progressOrder && <ProgressModal order={progressOrder} onClose={() => setProgressOrder(null)} profile={profile} />}
      {deliveryOrder && <DeliveryModal order={deliveryOrder} onClose={() => setDeliveryOrder(null)} profile={profile} />}
      {rejectOrder && <CustomerRejectModal order={rejectOrder} onClose={() => setRejectOrder(null)} onDone={() => { setRejectOrder(null); load(); }} />}
      {trackOrder && <TrackingLinkModal order={trackOrder} onClose={() => setTrackOrder(null)} />}
      {laborOrder && <LaborModal order={laborOrder} onClose={() => setLaborOrder(null)} />}
      {costOrder && <ActualCostModal order={costOrder.order} piecesMade={costOrder.made} onClose={() => setCostOrder(null)} />}
      {rcaOrder && <RcaModal order={rcaOrder.order} existing={rcaByOrder[rcaOrder.order.id]} nextStatus={rcaOrder.nextStatus} profile={profile} onClose={() => setRcaOrder(null)} onDone={() => { setRcaOrder(null); load(); }} />}
      {sendAgreementOrder && <SendAgreementModal order={orders.find((x) => x.id === sendAgreementOrder.id) || sendAgreementOrder} onClose={() => setSendAgreementOrder(null)} onChanged={load} />}
      {feedbackOrder && <FeedbackLinkModal order={feedbackOrder} feedback={feedbackByOrder[feedbackOrder.id]} onClose={() => setFeedbackOrder(null)} onChanged={load} />}
      {agreementOrder && <AgreementModal order={agreementOrder} settings={settings} onClose={() => setAgreementOrder(null)} />}
    </div>
  );
}

function OrderModal({ order, onClose, onSave, count, rcaBlocked, canLinkSales }) {
  const [salespeople, setSalespeople] = useState([]);
  const [sales, setSales] = useState({ salesperson: "", value: "", dirty: false });
  useEffect(() => {
    if (!canLinkSales) return;
    supabase.from("employees").select("id, name, role, department, status").order("name").then(({ data }) => setSalespeople((data || []).filter((e) => e.status !== "Inactive" && isSalesStaff(e))));
    if (order.id) supabase.from("order_sales").select("salesperson_id, order_value").eq("order_id", order.id).maybeSingle().then(({ data }) => {
      if (data) setSales({ salesperson: data.salesperson_id || "", value: data.order_value || "", dirty: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [garments, setGarments] = useState([]);
  useEffect(() => {
    supabase.from("garment_types").select("id, name, models, size_prefix").eq("active", true).order("sort_no").order("name").then(({ data }) => setGarments(data || []));
  }, []);
  const autoDesc = (g, model) => (g ? (model ? `${g.name} — ${model}` : g.name) : "");
  // choosing a garment / model fills the description when it is empty or still the auto-filled text
  const pickGarment = (idx, gid, model) => {
    const it = items[idx];
    const prevG = garments.find((x) => x.id === it.garment_type_id);
    const g = garments.find((x) => x.id === gid);
    const wasAuto = !it.description || it.description === autoDesc(prevG, it.model);
    updateItem(idx, { garment_type_id: gid || null, model: model || "", ...(wasAuto ? { description: autoDesc(g, model) } : {}) });
  };

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
            .map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0, ...(it.garment_type_id ? { garment_type_id: it.garment_type_id } : {}), ...(it.model ? { model: it.model } : {}), ...(it.added_by ? { added_by: it.added_by, added_by_role: it.added_by_role, added_at: it.added_at } : {}), ...(it.size_added_by ? { size_added_by: it.size_added_by, size_added_by_role: it.size_added_by_role, size_added_at: it.size_added_at } : {}), ...(it.size_mode && itemSizes(it).length ? { size_mode: it.size_mode, size_from: it.size_from ?? "", size_to: it.size_to ?? "", size_custom: it.size_custom || "" } : {}) }));
          onSave({ ...f, items: cleanItems, daily_target: Number(f.daily_target) || 0, salesLink: canLinkSales && sales.dirty ? { salesperson: sales.salesperson, value: sales.value } : null });
        }}
      >
        <Field label="Order number">
          <input className={inputCls} value={f.order_number} onChange={(e) => setF({ ...f, order_number: e.target.value })} />
        </Field>
        <Field label="Customer / buyer">
          <input required className={inputCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} />
        </Field>
        {canLinkSales && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Salesperson (for commission)">
              <select className={inputCls} value={sales.salesperson} onChange={(e) => setSales({ ...sales, salesperson: e.target.value, dirty: true })}>
                <option value="">— none —</option>
                {salespeople.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role ? ` — ${p.role}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Order value (₹)">
              <input type="number" min="0" className={inputCls} value={sales.value} onChange={(e) => setSales({ ...sales, value: e.target.value, dirty: true })} />
            </Field>
          </div>
        )}

        <span className="block text-xs font-medium text-stone-600 mb-1">Items</span>
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-2">
          <div className="grid grid-cols-[1fr_80px_28px] gap-1 bg-stone-50 px-2 py-1.5 text-[11px] font-medium text-stone-500 uppercase">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span></span>
          </div>
          {items.map((it, idx) => (
            <div key={idx} className="border-t border-stone-100 px-2 py-1.5">
            <div className="grid grid-cols-[1fr_80px_28px] gap-1 items-center">
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
            <div className="grid grid-cols-2 gap-1 mt-1">
              <select className="border border-stone-300 rounded px-1.5 py-1 text-xs text-stone-600" value={it.garment_type_id || ""} onChange={(e) => pickGarment(idx, e.target.value, "")}>
                <option value="">Garment type (optional)</option>
                {garments.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <select className="border border-stone-300 rounded px-1.5 py-1 text-xs text-stone-600" value={it.model || ""} disabled={!it.garment_type_id} onChange={(e) => pickGarment(idx, it.garment_type_id, e.target.value)}>
                <option value="">Model (optional)</option>
                {(garments.find((g) => g.id === it.garment_type_id)?.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <select className="border border-stone-300 rounded px-1.5 py-1 text-xs text-stone-600" value={it.size_mode || ""} aria-label="Size range type"
                onChange={(e) => { const m = e.target.value; updateItem(idx, m === "num" ? { size_mode: m, size_from: "10", size_to: "46" } : m === "let" ? { size_mode: m, size_from: "XS", size_to: "5XL" } : { size_mode: m }); }}>
                {SIZE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {it.size_mode === "num" && (<>
                <input type="number" min="1" max="60" aria-label="Size from" className="w-14 border border-stone-300 rounded px-1.5 py-1 text-xs text-right" value={it.size_from ?? ""} onChange={(e) => updateItem(idx, { size_from: e.target.value })} />
                <span>to</span>
                <input type="number" min="1" max="60" aria-label="Size to" className="w-14 border border-stone-300 rounded px-1.5 py-1 text-xs text-right" value={it.size_to ?? ""} onChange={(e) => updateItem(idx, { size_to: e.target.value })} />
              </>)}
              {it.size_mode === "let" && (<>
                <select aria-label="Size from" className="border border-stone-300 rounded px-1.5 py-1 text-xs" value={it.size_from || "XS"} onChange={(e) => updateItem(idx, { size_from: e.target.value })}>{LETTER_ORDER.map((x) => <option key={x}>{x}</option>)}</select>
                <span>to</span>
                <select aria-label="Size to" className="border border-stone-300 rounded px-1.5 py-1 text-xs" value={it.size_to || "5XL"} onChange={(e) => updateItem(idx, { size_to: e.target.value })}>{LETTER_ORDER.map((x) => <option key={x}>{x}</option>)}</select>
              </>)}
              {it.size_mode === "custom" && (
                <input aria-label="Custom sizes" className="flex-1 min-w-[10rem] border border-stone-300 rounded px-1.5 py-1 text-xs" placeholder="e.g. 10-16, 20, 22, Free (ranges list even sizes only)" value={it.size_custom || ""} onChange={(e) => updateItem(idx, { size_custom: e.target.value })} />
              )}
              {it.size_mode && (itemSizes(it).length
                ? <span className="text-stone-500">{itemSizes(it).length} sizes: {itemSizeText(it)}</span>
                : <span className="text-rose-600">Check the size range</span>)}
            </div>
            {(it.added_by || it.size_added_by) && <div className="text-[11px] text-amber-700 mt-1">{it.added_by ? `Item added from the Cutting module by ${it.added_by}` : `Size range added from the Cutting module by ${it.size_added_by}`}</div>}
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
              <option key={s} value={s} disabled={!!statusBlock(order, s) || (rcaBlocked && s === "Shipped" && order.status !== s)}>{s}{statusBlock(order, s) ? ` (${statusBlock(order, s)})` : ""}{rcaBlocked && s === "Shipped" && order.status !== s && !statusBlock(order, s) ? " (submit RCA first)" : ""}</option>
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
  const [crew, setCrew] = useState(null); // people allocated to this order on the chosen date (null = loading)
  const [allocOpen, setAllocOpen] = useState(false);
  const items = order.items || [];
  const required = orderItemsRequired(items);

  const loadCrew = async () => {
    const { data } = await supabase.from("order_labor").select("id, employee_id").eq("order_id", order.id).eq("work_date", date);
    setCrew(data || []);
    return data || [];
  };
  // Hourly progress can only be entered once resources are allocated for that day.
  useEffect(() => {
    setCrew(null);
    loadCrew().then((d) => { if (d.length === 0) setAllocOpen(true); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, date]);
  const blocked = crew !== null && crew.length === 0;

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
    if (blocked) { setAllocOpen(true); return; }
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

          {blocked ? (
            <div className="flex items-center justify-between gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-sm text-amber-900">
              <span>No people are allocated to {order.order_number} on {date}, so progress can't be updated yet.</span>
              <Btn onClick={() => setAllocOpen(true)}>Allocate resources</Btn>
            </div>
          ) : crew !== null ? (
            <div className="flex items-center justify-between text-xs text-stone-500 mb-3">
              <span>{crew.length} {crew.length === 1 ? "person" : "people"} allocated on {date}</span>
              <button onClick={() => setAllocOpen(true)} className="text-indigo-700 hover:underline">Change</button>
            </div>
          ) : null}

          <div className={`border border-stone-200 rounded-lg overflow-x-auto mb-4 ${blocked ? "opacity-40 pointer-events-none select-none" : ""}`}>
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
      {allocOpen && <AllocateResourcesModal order={order} date={date} onClose={() => setAllocOpen(false)} onSaved={() => { setAllocOpen(false); loadCrew(); }} />}
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
  const [copied, setCopied] = useState(false);
  const [lots, setLots] = useState([]);
  const [progress, setProgress] = useState([]);
  const [against, setAgainst] = useState(""); // lot id; "" = the whole-order approval
  const [lotModal, setLotModal] = useState(false);
  const items = order.items || [];
  const canReset = ["admin", "gm", "pm"].includes(profile?.role);
  const canRequestLot = ["admin", "hr", "gm", "pm", "tl"].includes(profile?.role) && !["Shipped", "Completed", "Rejected by Customer"].includes(order.status);
  const orderApproved = order.quality_status === "Approved" && order.dispatch_status === "Approved";
  const url = `${window.location.origin}/?delivery=1&order=${encodeURIComponent(order.order_number)}&code=${encodeURIComponent(order.tracking_code)}`;

  const load = async () => {
    const [{ data }, { data: lt }, { data: pr }] = await Promise.all([
      supabase.from("order_deliveries").select("*").eq("order_id", order.id).order("date", { ascending: false }),
      supabase.from("dispatch_lots").select("*").eq("order_id", order.id).order("lot_no"),
      supabase.from("order_progress").select("item_description, quantity").eq("order_id", order.id),
    ]);
    setDeliveries(data || []);
    setLots(lt || []);
    setProgress(pr || []);
  };
  const resetResponse = async (d) => {
    if (!window.confirm("Clear the customer's answer for this dispatch so they can answer again?")) return;
    const { data, error } = await supabase.rpc("reset_delivery_response", { p_id: d.id });
    if (error || data?.ok === false) alert(error?.message || data?.error);
    load();
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const breakdown = buildItemBreakdown(items, [], deliveries);
  const dispatchable = lots.filter((l) => l.status === "Approved" && lotRemaining(l, deliveries).some((r) => r.left > 0));
  const effAgainst = against || (orderApproved ? "" : dispatchable[0]?.id || "");
  const lot = lots.find((l) => l.id === effAgainst) || null;
  const lotLeft = lot ? lotRemaining(lot, deliveries).filter((r) => r.left > 0) : [];
  const itemChoices = lot ? lotLeft.map((r) => r.description) : items.map((it) => it.description);
  const canLog = orderApproved || dispatchable.length > 0;
  const accepted = deliveries.reduce((t, d) => t + (Number(d.accepted_qty) || 0), 0);
  const rejected = deliveries.reduce((t, d) => t + (Number(d.rejected_qty) || 0), 0);
  const awaitingRows = deliveries.filter((d) => (d.customer_status || "Pending") === "Pending");
  const awaiting = awaitingRows.reduce((t, d) => t + (Number(d.quantity) || 0), 0);
  const dispatchedText = Object.entries(awaitingRows.reduce((m, d) => ({ ...m, [d.item_description]: (m[d.item_description] || 0) + Number(d.quantity || 0) }), {})).map(([k, v]) => `${k}: ${v} pcs`).join(", ");
  const waText = `Dear ${order.customer_name}, your goods for order ${order.order_number} have been dispatched${dispatchedText ? ` (${dispatchedText})` : ""}. Please check the count and quality and confirm here — accept, or tell us what is wrong: ${url}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* link is shown for manual copy */ }
  };

  const addDelivery = async (e) => {
    e.preventDefault();
    const itemNow = itemChoices.includes(itemDesc) ? itemDesc : itemChoices[0];
    if (!itemNow || !quantity) return;
    if (lot) {
      const left = lotLeft.find((r) => r.description === itemNow)?.left || 0;
      if (Number(quantity) > left) return alert(`Only ${left} more pieces of ${itemNow} are approved in partial dispatch ${lot.lot_no}.`);
    }
    const { error: delErr } = await supabase.from("order_deliveries").insert({
      lot_id: lot ? lot.id : null,
      order_id: order.id,
      date,
      item_description: itemNow,
      quantity: Number(quantity) || 0,
      delivered_to: deliveredTo || null,
      notes: notes || null,
      updated_by: profile?.name || null,
    });
    if (delErr) {
      alert(delErr.message);
      return;
    }
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

          <div className="mb-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-xs font-semibold text-stone-700 uppercase">Partial dispatches ({lots.filter((l) => l.status !== "Rejected").length})</div>
              {canRequestLot && <Btn variant="ghost" onClick={() => setLotModal(true)}><Truck size={13} /> Request partial dispatch</Btn>}
            </div>
            {lots.length === 0 ? (
              <p className="text-[11px] text-stone-400">Send part of the order before it is finished: request a lot, get QC approval, then Production Manager and General Manager approval.</p>
            ) : (
              <div className="space-y-2">
                {lots.map((l) => <LotCard key={l.id} lot={l} deliveries={deliveries} profile={profile} onChanged={load} />)}
              </div>
            )}
          </div>
          {deliveries.length > 0 && (
            <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-3 mb-3">
              <div className="text-xs font-semibold text-stone-700 mb-1">Send the dispatch count to the customer</div>
              <p className="text-[11px] text-stone-500 mb-2">The customer opens this link, sees the dispatched counts and delivery history, and accepts or rejects each dispatch (with a reason). Payments received are shown there too.</p>
              <div className="bg-white border border-stone-200 rounded p-2 text-[11px] break-all font-mono mb-2">{url}</div>
              <div className="flex gap-2 flex-wrap">
                <Btn variant="ghost" onClick={copyLink}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</Btn>
                <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"><Send size={14} /> Send on WhatsApp</a>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] mt-2">
                <span className="rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-800">Accepted {accepted}</span>
                <span className={`rounded-full px-2 py-0.5 ${rejected ? "bg-rose-100 text-rose-800 font-semibold" : "bg-stone-100 text-stone-500"}`}>Rejected {rejected}</span>
                <span className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">Awaiting reply {awaiting}</span>
              </div>
            </div>
          )}
          {!canLog && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Deliveries can't be logged yet. Either the whole order passes quality inspection and dispatch approval, or a <b>partial dispatch</b> is approved (QC, then Production Manager, then General Manager).
            </div>
          )}
          {canLog && (
          <form onSubmit={addDelivery} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
            <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Log a delivery</div>
            {(orderApproved || dispatchable.length > 0) && (
              <select className={inputCls} value={effAgainst} onChange={(e) => { setAgainst(e.target.value); setItemDesc(""); setQuantity(""); }}>
                {orderApproved && <option value="">Whole order — fully approved</option>}
                {dispatchable.map((l) => <option key={l.id} value={l.id}>Partial dispatch {l.lot_no} — {lotRemaining(l, deliveries).filter((r) => r.left > 0).map((r) => `${r.description} ${r.left}`).join(", ")} left</option>)}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <select className={inputCls} value={itemChoices.includes(itemDesc) ? itemDesc : itemChoices[0] || ""} onChange={(e) => setItemDesc(e.target.value)}>
                {itemChoices.map((d) => (
                  <option key={d} value={d}>{d}</option>
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
          )}

          <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History</div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
                <div>
                  <span className="font-medium">{d.item_description}</span> × {d.quantity}
                  {d.lot_id && <span className="ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 bg-indigo-50 text-indigo-800">Partial dispatch {lots.find((l) => l.id === d.lot_id)?.lot_no ?? ""}</span>}
                  <div className="text-xs text-stone-400">{d.date}{d.delivered_to ? ` · ${d.delivered_to}` : ""}</div>
                  <div className="text-[11px] mt-0.5">
                    {(d.customer_status || "Pending") === "Pending"
                      ? <span className="text-amber-700">Customer has not replied yet</span>
                      : <span className={d.customer_status === "Accepted" ? "text-emerald-700" : "text-rose-700"}>
                          Customer {String(d.customer_status).toLowerCase()}: {d.accepted_qty} accepted{Number(d.rejected_qty) > 0 ? `, ${d.rejected_qty} rejected` : ""}
                          {d.customer_responder ? ` · ${d.customer_responder}` : ""}{d.customer_reason ? ` — "${d.customer_reason}"` : ""}
                        </span>}
                  </div>
                </div>
                <div className="flex items-center">
                  {canReset && (d.customer_status || "Pending") !== "Pending" && (
                    <button onClick={() => resetResponse(d)} className="text-[11px] text-indigo-700 underline mr-2">Reset reply</button>
                  )}
                  <button onClick={() => removeDelivery(d.id)} className="text-stone-400 hover:text-rose-700 p-1">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {deliveries.length === 0 && <p className="text-xs text-stone-400">No deliveries logged yet.</p>}
          </div>
        </>
      )}
      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
      {lotModal && <RequestLotModal order={order} progress={progress} lots={lots} onClose={() => setLotModal(false)} onDone={() => { setLotModal(false); load(); }} />}
    </Modal>
  );
}

function CustomerRejectModal({ order, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("set_customer_rejection", { p_order_id: order.id, p_reason: reason });
    setSaving(false);
    if (error || data?.ok === false) return alert(`Couldn't save:\n${error?.message || data?.error}`);
    onDone();
  };
  return (
    <Modal title={`Rejected by customer — ${order.order_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">The order moves from Shipped to <b>Rejected by Customer</b>. When the goods are sent again, or the customer finally accepts, change the status from the order card.</p>
        <Field label="Reason the customer gave">
          <textarea required autoFocus rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 20 shirts have loose stitching, count is 10 short" />
        </Field>
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || reason.trim().length < 3}>{saving ? "Saving…" : "Mark Rejected by Customer"}</Btn>
        </div>
      </form>
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

function LaborModal({ order, onClose }) {
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [{ data: emp }, { data: assign }] = await Promise.all([
      supabase.from("employees").select("id, name, department, base_salary, status").order("name", { ascending: true }),
      supabase.from("order_labor").select("*").eq("order_id", order.id).order("work_date", { ascending: false }),
    ]);
    setEmployees(emp || []);
    setAssignments(assign || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const employeesById = {};
  employees.forEach((e) => (employeesById[e.id] = e));
  const { manpowerCount, manDays, laborCost } = computeLaborCost(assignments, employeesById);

  const toggleSelected = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const assign = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    const rows = selected.map((employee_id) => ({ order_id: order.id, employee_id, work_date: date }));
    await supabase.from("order_labor").upsert(rows, { onConflict: "order_id,employee_id,work_date", ignoreDuplicates: true });
    setSelected([]);
    setSaving(false);
    load();
  };

  const removeAssignment = async (id) => {
    await supabase.from("order_labor").delete().eq("id", id);
    load();
  };

  // group assignments by date for a readable history list
  const byDate = {};
  assignments.forEach((a) => {
    byDate[a.work_date] = byDate[a.work_date] || [];
    byDate[a.work_date].push(a);
  });

  return (
    <Modal title={`Manpower — ${order.order_number}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-stone-50 rounded-lg p-2.5">
          <div className="text-lg font-mono font-semibold">{manpowerCount}</div>
          <div className="text-[11px] text-stone-500">Employees</div>
        </div>
        <div className="bg-stone-50 rounded-lg p-2.5">
          <div className="text-lg font-mono font-semibold">{manDays}</div>
          <div className="text-[11px] text-stone-500">Man-days</div>
        </div>
        <div className="bg-stone-50 rounded-lg p-2.5">
          <div className="text-lg font-mono font-semibold">{fmtMoney(laborCost)}</div>
          <div className="text-[11px] text-stone-500">Est. labor cost</div>
        </div>
      </div>
      <p className="text-xs text-stone-400 mb-3">
        This estimate feeds automatically into Finance → Order Profitability once at least one assignment is logged.
      </p>

      <div className="border border-stone-200 rounded-lg p-3 mb-4">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-2">Assign staff for a date</div>
        <input type="date" className={inputCls + " mb-2"} value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="max-h-40 overflow-y-auto border border-stone-100 rounded mb-2 divide-y divide-stone-100">
          {employees.filter((e) => e.status !== "Inactive").map((e) => (
            <label key={e.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-stone-50">
              <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggleSelected(e.id)} />
              <span>{e.name}</span>
              {e.department && <span className="text-xs text-stone-400">· {e.department}</span>}
            </label>
          ))}
          {employees.length === 0 && <p className="text-xs text-stone-400 px-2 py-2">Add employees first.</p>}
        </div>
        <Btn onClick={assign} disabled={saving || selected.length === 0} className="w-full justify-center">
          {saving ? "Assigning…" : `Assign ${selected.length || ""} for ${date}`}
        </Btn>
      </div>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History</div>
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {Object.entries(byDate).map(([d, rows]) => (
          <div key={d} className="text-sm">
            <div className="text-xs text-stone-400 mb-1">{d}</div>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 bg-stone-100 rounded-full pl-2 pr-1 py-0.5 text-xs">
                  {employeesById[r.employee_id]?.name || "—"}
                  <button onClick={() => removeAssignment(r.id)} className="text-stone-400 hover:text-rose-700"><X size={11} /></button>
                </span>
              ))}
            </div>
          </div>
        ))}
        {assignments.length === 0 && <p className="text-xs text-stone-400">No assignments logged yet.</p>}
      </div>

      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}


// ===================== Delay RCA + lessons learned =====================
function RcaModal({ order, existing, nextStatus, profile, onClose, onDone }) {
  const late = order.due_date ? Math.max(0, daysBetween(order.due_date, todayStr())) : 0;
  const [causes, setCauses] = useState(() => {
    const m = {};
    (existing?.causes || []).forEach((c) => (m[c.cause] = { days: c.days ?? "", notes: c.notes || "" }));
    return m;
  });
  const [rootCause, setRootCause] = useState(existing?.root_cause || "");
  const [lessons, setLessons] = useState(existing?.lessons_learned || "");
  const [action, setAction] = useState(existing?.corrective_action || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = (c) => {
    const next = { ...causes };
    if (next[c]) delete next[c]; else next[c] = { days: "", notes: "" };
    setCauses(next);
  };
  const setCause = (c, patch) => setCauses({ ...causes, [c]: { ...causes[c], ...patch } });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const list = Object.entries(causes).map(([cause, v]) => ({ cause, days: v.days === "" ? null : Number(v.days), notes: v.notes || "" }));
    if (list.length === 0) return setError("Select at least one reason for the delay.");
    if (rootCause.trim().length < 5) return setError("Describe the root cause.");
    if (lessons.trim().length < 5) return setError("Write the lessons learned.");
    setSaving(true);
    const row = { order_id: order.id, causes: list, root_cause: rootCause.trim(), lessons_learned: lessons.trim(), corrective_action: action.trim() || null, days_late: late, submitted_by: profile?.id || null, submitted_by_name: profile?.name || null, submitted_at: new Date().toISOString() };
    const { error: err } = await supabase.from("order_delay_rca").upsert(row, { onConflict: "order_id" });
    if (err) { setSaving(false); return setError(err.message + " (run migration_38.sql if the table is missing)"); }
    if (nextStatus) {
      const { error: stErr } = await supabase.from("orders").update({ status: nextStatus }).eq("id", order.id);
      if (stErr) { setSaving(false); return setError("RCA saved, but the status change failed: " + stErr.message); }
    }
    setSaving(false);
    onDone();
  };

  return (
    <Modal title={`Delay RCA — ${order.order_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">
          Due {order.due_date}{late > 0 ? <> — <b className="text-rose-700">{late} day{late === 1 ? "" : "s"} late</b></> : null}.{" "}
          {nextStatus ? <>Submit the RCA to mark this order <b>{nextStatus}</b>.</> : "Late orders need an RCA before they can be completed."}
        </p>
        <div className="mb-3">
          <span className="block text-xs font-medium text-stone-600 mb-1">Why was it delayed? (select all that apply)</span>
          <div className="space-y-2">
            {DELAY_CAUSES.map((c) => (
              <div key={c} className={`border rounded-lg p-2.5 ${causes[c] ? "border-indigo-300 bg-indigo-50/40" : "border-stone-200"}`}>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!!causes[c]} onChange={() => toggle(c)} /> {c}
                </label>
                {causes[c] && (
                  <div className="grid grid-cols-[6rem_1fr] gap-2 mt-2">
                    <input type="number" min="0" className={inputCls} placeholder="Days lost" value={causes[c].days} onChange={(e) => setCause(c, { days: e.target.value })} />
                    <input className={inputCls} placeholder="What happened?" value={causes[c].notes} onChange={(e) => setCause(c, { notes: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <Field label="Root cause (why did it really happen?)"><textarea rows={3} className={inputCls} value={rootCause} onChange={(e) => setRootCause(e.target.value)} /></Field>
        <Field label="Lessons learned"><textarea rows={3} className={inputCls} value={lessons} onChange={(e) => setLessons(e.target.value)} placeholder="What will we do differently on the next order?" /></Field>
        <Field label="Corrective action / owner (optional)"><input className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} /></Field>
        {existing?.submitted_by_name && <p className="text-xs text-stone-400 mb-2">Last saved by {existing.submitted_by_name}</p>}
        {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : nextStatus ? `Save RCA and mark ${nextStatus}` : "Save RCA"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ===================== Customer agreement link =====================
function ShareBox({ url, text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* link stays visible */ }
  };
  return (
    <>
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 text-xs break-all font-mono mb-3">{url}</div>
      <div className="flex gap-2">
        <Btn onClick={copy} className="flex-1 justify-center">{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}</Btn>
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium px-3 py-2 bg-emerald-600 text-white hover:bg-emerald-700">WhatsApp</a>
      </div>
    </>
  );
}

export function SendAgreementModal({ order, onClose, onChanged }) {
  const url = `${window.location.origin}/?agree=1&order=${encodeURIComponent(order.order_number)}&code=${encodeURIComponent(order.tracking_code)}`;
  const st = order.agreement_status || "Not sent";
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("send_order_agreement", { p_order: order.id });
    setBusy(false);
    if (error || data?.ok === false) return alert((error?.message || data?.error) + "\n(run migration_42.sql if this function is missing)");
    onChanged();
  };
  return (
    <Modal title={`Customer agreement — ${order.order_number}`} onClose={onClose}>
      <p className="text-sm text-stone-600 mb-3">The customer sees the items, quantities, rates and payment terms (generate the agreement first so rates and terms are included), then taps <b>I agree</b> or <b>I disagree</b>. Their answer appears on this order.</p>
      <div className="flex items-center gap-2 mb-3 text-sm">
        Status:
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st === "Agreed" ? "bg-emerald-100 text-emerald-800" : st === "Disagreed" ? "bg-rose-600 text-white" : st === "Sent" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{st}</span>
      </div>
      {(st === "Agreed" || st === "Disagreed") && (
        <div className="text-sm bg-stone-50 border border-stone-200 rounded-lg p-3 mb-3">
          <div><b>{order.agreement_responder || "Customer"}</b> {st === "Agreed" ? "agreed" : "disagreed"} on {order.agreement_responded_at ? new Date(order.agreement_responded_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</div>
          {order.agreement_comment && <div className="text-stone-600 mt-1">“{order.agreement_comment}”</div>}
        </div>
      )}
      {st === "Not sent" ? (
        <Btn onClick={open} disabled={busy} className="w-full justify-center"><Send size={14} /> Open for customer confirmation</Btn>
      ) : (
        <>
          <ShareBox url={url} text={`Please review and confirm order ${order.order_number}:`} />
          {st !== "Sent" && <Btn variant="ghost" onClick={open} disabled={busy} className="w-full justify-center mt-2">Reopen / send again (clears the answer)</Btn>}
        </>
      )}
    </Modal>
  );
}

// ===================== Customer feedback link =====================
function FeedbackLinkModal({ order, feedback, onClose }) {
  const url = `${window.location.origin}/?feedback=1&order=${encodeURIComponent(order.order_number)}&code=${encodeURIComponent(order.tracking_code)}`;
  const ready = ["Completed", "Shipped", "Rejected by Customer"].includes(order.status);
  const [sentAt, setSentAt] = useState(order.feedback_sent_at);
  const markSent = async () => {
    const now = new Date().toISOString();
    await supabase.from("orders").update({ feedback_sent_at: now }).eq("id", order.id);
    setSentAt(now);
  };
  return (
    <Modal title={`Customer feedback — ${order.order_number}`} onClose={onClose}>
      {feedback ? (
        <div>
          <p className="text-sm text-stone-600 mb-2">Received {new Date(feedback.submitted_at).toLocaleDateString("en-IN")}{feedback.respondent_name ? ` from ${feedback.respondent_name}` : ""}.</p>
          <div className="space-y-1 mb-3">
            {FEEDBACK_ITEMS.filter(([k]) => feedback.ratings?.[k]).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between text-sm"><span>{label}</span><span className="text-amber-600 font-mono">{"★".repeat(feedback.ratings[k])}<span className="text-stone-300">{"★".repeat(5 - feedback.ratings[k])}</span></span></div>
            ))}
          </div>
          <div className="text-sm space-y-1">
            {feedback.delivery_timing && <div>Delivery: <b>{feedback.delivery_timing}</b></div>}
            {feedback.would_reorder && <div>Would reorder: <b>{feedback.would_reorder}</b></div>}
            {feedback.issues && <div className="bg-rose-50 border border-rose-200 rounded-lg p-2 mt-2"><b>Problems:</b> {feedback.issues}</div>}
            {feedback.comments && <div className="text-stone-600 mt-1">“{feedback.comments}”</div>}
          </div>
        </div>
      ) : !ready ? (
        <p className="text-sm text-stone-600">Feedback can be requested once the order is <b>Completed</b> or <b>Shipped</b>. Current status: {order.status}.</p>
      ) : (
        <>
          <p className="text-sm text-stone-600 mb-3">Send this link after completion or shipping. The customer rates fabric, stitching, size, durability, pricing, design and colour matching, packing and delivery timing.</p>
          <ShareBox url={url} text={`Thank you for your order ${order.order_number}. We would love your feedback:`} />
          <div className="flex items-center justify-between mt-3 text-xs text-stone-500">
            <span>{sentAt ? `Marked sent ${new Date(sentAt).toLocaleDateString("en-IN")}` : "Not marked as sent"}</span>
            {!sentAt && <button onClick={markSent} className="text-indigo-700 hover:underline">Mark as sent</button>}
          </div>
          <p className="text-xs text-stone-400 mt-2">Waiting for the customer to respond.</p>
        </>
      )}
    </Modal>
  );
}


// ===================== Allocate resources popup (required before hourly progress) =====================
function AllocateResourcesModal({ order, date, onClose, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [existing, setExisting] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: emp }, { data: att }, { data: cur }] = await Promise.all([
        supabase.from("employees").select("id, name, department, status").neq("status", "Inactive").order("name"),
        supabase.from("attendance").select("employee_id, status").eq("date", date),
        supabase.from("order_labor").select("id, employee_id").eq("order_id", order.id).eq("work_date", date),
      ]);
      setEmployees(emp || []);
      setAttendance(Object.fromEntries((att || []).map((a) => [a.employee_id, a.status])));
      setExisting(cur || []);
      setSelected((cur || []).map((c) => c.employee_id));
    })();
  }, [order.id, date]);

  const toggle = (id) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const save = async () => {
    setError("");
    if (selected.length === 0) return setError("Select at least one person to continue.");
    setSaving(true);
    const keep = new Set(selected);
    const removeIds = existing.filter((e) => !keep.has(e.employee_id)).map((e) => e.id);
    if (removeIds.length) await supabase.from("order_labor").delete().in("id", removeIds);
    const have = new Set(existing.map((e) => e.employee_id));
    const rows = selected.filter((id) => !have.has(id)).map((employee_id) => ({ order_id: order.id, employee_id, work_date: date }));
    if (rows.length) {
      const { error: err } = await supabase.from("order_labor").insert(rows);
      if (err) { setSaving(false); return setError(err.message); }
    }
    setSaving(false);
    onSaved();
  };
  const BADGE = { Present: "bg-emerald-100 text-emerald-800", "Half Day": "bg-amber-100 text-amber-800", Leave: "bg-sky-100 text-sky-800", Absent: "bg-rose-100 text-rose-800" };

  return (
    <Modal title="Allocate resources first" onClose={onClose}>
      <p className="text-sm text-stone-600 mb-3">
        Choose who is working on <b>{order.order_number}</b> on <b>{date}</b>. Hourly progress can be updated once at least one person is allocated.
      </p>
      <div className="max-h-64 overflow-y-auto border border-stone-100 rounded-lg divide-y divide-stone-100 mb-3">
        {employees.map((e) => (
          <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-stone-50">
            <input type="checkbox" checked={selected.includes(e.id)} onChange={() => toggle(e.id)} />
            <span className="flex-1">{e.name}{e.department && <span className="text-xs text-stone-400"> · {e.department}</span>}</span>
            {attendance[e.id] && <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${BADGE[attendance[e.id]] || "bg-stone-100"}`}>{attendance[e.id]}</span>}
          </label>
        ))}
        {employees.length === 0 && <p className="text-xs text-stone-400 px-3 py-3">No active employees found.</p>}
      </div>
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Not now</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : `Allocate ${selected.length || ""} and continue`}</Btn>
      </div>
    </Modal>
  );
}
