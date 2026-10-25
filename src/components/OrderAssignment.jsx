import { useEffect, useMemo, useState } from "react";
import { Plus, CalendarPlus, History, Trash2, Pencil, Check, Play, Flag, X, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";
import { PRIORITIES, PRIORITY_STYLE, TL_STATUS_STYLE, fetchOutputs } from "../lib/assignments";

const OPEN_ORDER = (o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status);
const fmt = (iso) => { const [y, m, d] = String(iso || "").split("-"); return d ? `${d}/${m}/${y}` : "—"; };
const prioRank = { Top: 0, High: 1, Normal: 2, Low: 3 };

// Order assignment: GM / Admin assign priority work to the Production Manager, the Production Manager
// picks the day's orders and hands them to Team Leads, and Team Leads accept and complete them.
export default function OrderAssignment({ profile }) {
  const role = profile?.role;
  const isManager = ["admin", "hr", "gm", "pm"].includes(role);
  const isPm = ["admin", "hr", "pm"].includes(role);
  const isTl = role === "tl";
  const myEmp = profile?.employee_id;

  const [rows, setRows] = useState([]);
  const [orders, setOrders] = useState([]);
  const [outputs, setOutputs] = useState({});
  const [tls, setTls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(isManager ? "today" : "mine");
  const [date, setDate] = useState(todayStr());
  const [modal, setModal] = useState(null); // { kind, row? }
  const [openHistory, setOpenHistory] = useState(null);
  const [events, setEvents] = useState({});
  const [err, setErr] = useState("");
  const today = todayStr();

  const load = async () => {
    const from = new Date(Date.now() - 20 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const to = new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const [a, o, outs, pr, emps] = await Promise.all([
      supabase.from("order_assignments").select("*").order("work_date", { ascending: false }).limit(600),
      supabase.from("orders").select("id, order_number, customer_name, items, status, daily_target"),
      fetchOutputs(supabase, from, to),
      supabase.from("profiles").select("id, name, role, employee_id").eq("role", "tl"),
      supabase.from("employees").select("id, name"),
    ]);
    if (a.error) setErr(a.error.message + " (run migration_49.sql)"); else setErr("");
    setRows(a.data || []);
    setOrders(o.data || []);
    setOutputs(outs || {});
    const nameOf = Object.fromEntries((emps.data || []).map((e) => [e.id, e.name]));
    setTls((pr.data || []).filter((x) => x.employee_id).map((x) => ({ id: x.employee_id, name: nameOf[x.employee_id] || x.name })).sort((x, y) => x.name.localeCompare(y.name)));
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("order-assignments")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_assignments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);
  const tlName = (id) => tls.find((t) => t.id === id)?.name || "—";
  const full = rows.map((r) => ({ ...r, order: orderById[r.order_id], order_number: orderById[r.order_id]?.order_number }));
  const sortFn = (a, b) => (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9) || String(a.order_number).localeCompare(String(b.order_number));

  const call = async (fn, args) => {
    setErr("");
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { setErr(error.message + " (run migration_49.sql)"); return false; }
    if (!data?.ok) { setErr(data?.error || "Could not save"); return false; }
    load();
    return true;
  };

  const mine = full.filter((r) => myEmp && r.tl_employee_id === myEmp);
  const waitingPm = full.filter((r) => r.pm_status === "Pending PM");
  const carried = full.filter((r) => r.work_date < today && r.tl_status !== "Completed");
  const FILTERS = isManager
    ? [["today", "Today's plan", full.filter((r) => r.work_date === date && r.pm_status === "Accepted").length], ["waiting", "Waiting for PM", waitingPm.length],
       ["carried", "Carried over", carried.length], ["upcoming", "Upcoming", full.filter((r) => r.work_date > today).length], ["done", "Completed", full.filter((r) => r.tl_status === "Completed").length], ["all", "All", full.length]]
    : [["mine", "My work", mine.filter((r) => r.tl_status !== "Completed").length], ["mine-done", "Completed", mine.filter((r) => r.tl_status === "Completed").length]];

  let shown = [];
  if (filter === "today") shown = full.filter((r) => r.work_date === date && r.pm_status === "Accepted");
  else if (filter === "waiting") shown = waitingPm;
  else if (filter === "carried") shown = carried;
  else if (filter === "upcoming") shown = full.filter((r) => r.work_date > today);
  else if (filter === "done") shown = full.filter((r) => r.tl_status === "Completed");
  else if (filter === "all") shown = full;
  else if (filter === "mine") shown = mine.filter((r) => r.tl_status !== "Completed");
  else shown = mine.filter((r) => r.tl_status === "Completed");
  shown = [...shown].sort((a, b) => (filter === "all" || filter === "done" ? b.work_date.localeCompare(a.work_date) : 0) || sortFn(a, b));

  const toggleHistory = async (id) => {
    if (openHistory === id) return setOpenHistory(null);
    setOpenHistory(id);
    const { data } = await supabase.from("assignment_events").select("*").eq("assignment_id", id).order("at");
    setEvents((e) => ({ ...e, [id]: data || [] }));
  };

  if (loading) return <p className="text-sm text-stone-500"><Loader2 size={14} className="inline animate-spin mr-1" />Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Order Assignment</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {isManager ? "GM and Admin assign priority orders to the Production Manager; the Production Manager chooses the day's orders and gives them to Team Leads." : "Work assigned to you by the Production Manager. Accept it, and mark it completed when finished."}
          </p>
        </div>
        {isManager && (
          <div className="flex gap-2 flex-wrap">
            {isPm && <Btn onClick={() => setModal({ kind: "plan" })}><CalendarPlus size={14} /> Plan the day</Btn>}
            <Btn variant={isPm ? "ghost" : "primary"} onClick={() => setModal({ kind: "new" })}><Plus size={14} /> {role === "gm" ? "Assign priority order" : "New assignment"}</Btn>
          </div>
        )}
      </div>

      <div className="subtab-bar">
        {FILTERS.map(([id, label, n]) => (
          <button key={id} onClick={() => setFilter(id)} className={`subtab ${filter === id ? "subtab-active" : ""}`}>{label} ({n})</button>
        ))}
      </div>
      {filter === "today" && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-stone-500">Day</span>
          <input type="date" aria-label="Plan date" className={`${inputCls} !w-auto !py-1`} value={date} onChange={(e) => setDate(e.target.value)} />
          {date !== today && <button className="text-xs text-indigo-700 underline" onClick={() => setDate(today)}>Back to today</button>}
        </div>
      )}
      {err && <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {shown.length === 0 && (
        <Card className="p-8 text-center text-stone-400 text-sm">
          {filter === "today" ? "No orders are planned for this day yet." : filter === "waiting" ? "Nothing is waiting for the Production Manager." : "Nothing here."}
          {filter === "today" && isPm && <div className="mt-2"><button className="text-indigo-700 underline" onClick={() => setModal({ kind: "plan" })}>Plan the day</button></div>}
        </Card>
      )}

      <div className="space-y-3">
        {shown.map((r) => {
          const out = outputs[r.id] || 0;
          const overdue = r.work_date < today && r.tl_status !== "Completed";
          const myRow = isTl && myEmp && r.tl_employee_id === myEmp;
          const closed = r.tl_status === "Completed";
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${PRIORITY_STYLE[r.priority]}`}>{r.priority} priority</span>
                    <span className="font-semibold">{r.order_number || "—"}</span>
                    <span className="text-stone-500 text-sm">{r.order?.customer_name}</span>
                  </div>
                  <div className="text-sm mt-1">
                    {r.item_description ? <>Item: <span className="font-medium">{r.item_description}</span></> : <span className="text-stone-500">Whole order</span>}
                    {r.target_qty > 0 && <> · Target <span className="font-mono">{r.target_qty}</span></>}
                    <> · Day <span className="font-medium">{fmt(r.work_date)}</span></>
                    {overdue && <span className="ml-1 text-[11px] rounded-full bg-rose-100 text-rose-700 px-2 py-0.5">Carried over</span>}
                  </div>
                  {r.instructions && <p className="text-xs text-stone-600 mt-1">“{r.instructions}”</p>}
                  <p className="text-[11px] text-stone-400 mt-1">Assigned by {r.assigned_by || "—"}{r.assigned_by_role ? ` (${r.assigned_by_role})` : ""}</p>
                </div>
                <div className="text-right text-xs space-y-1">
                  {r.pm_status === "Pending PM"
                    ? <div className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 inline-block">Waiting for Production Manager</div>
                    : <div className="text-stone-400">Accepted by {r.pm_by || "PM"}</div>}
                  <div><span className={`rounded-full px-2 py-0.5 ${TL_STATUS_STYLE[r.tl_status]}`}>{r.tl_status === "Not assigned" ? "No Team Lead yet" : `${tlName(r.tl_employee_id)} · ${r.tl_status}`}</span></div>
                  {(out > 0 || r.tl_status === "In progress" || closed) && <div className="font-mono text-stone-600">Output {out}{r.target_qty ? ` / ${r.target_qty}` : ""}{closed && r.completed_qty != null ? ` · reported ${r.completed_qty}` : ""}</div>}
                </div>
              </div>
              {r.tl_note && <p className="text-xs text-stone-500 mt-1">TL note: {r.tl_note}</p>}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {isPm && r.pm_status === "Pending PM" && <Btn onClick={() => setModal({ kind: "accept", row: r })}><Check size={14} /> Accept{" "}/ change</Btn>}
                {isManager && !closed && (
                  <select aria-label="Team Lead" className={`${inputCls} !w-auto !py-1.5 !text-xs`} value={r.tl_employee_id || ""}
                    onChange={(e) => call("assign_team_lead", { p_id: r.id, p_tl: e.target.value || null })}>
                    <option value="">Assign Team Lead…</option>
                    {tls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {isManager && !closed && r.tl_employee_id && (
                  <select aria-label="Add another Team Lead" className={`${inputCls} !w-auto !py-1.5 !text-xs`} value=""
                    onChange={(e) => e.target.value && call("create_assignment", { p_order_id: r.order_id, p_item: r.item_description, p_date: r.work_date, p_priority: r.priority, p_target: 0, p_instructions: r.instructions, p_tl: e.target.value })}>
                    <option value="">+ Add another Team Lead…</option>
                    {tls.filter((t) => !full.some((x) => x.order_id === r.order_id && x.item_description === r.item_description && x.work_date === r.work_date && x.tl_employee_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {isManager && !closed && <Btn variant="ghost" onClick={() => setModal({ kind: "edit", row: r })}><Pencil size={14} /> Priority / date</Btn>}
                {isManager && overdue && <Btn variant="ghost" onClick={() => setModal({ kind: "edit", row: r, moveToToday: true })}>Move to today</Btn>}
                {myRow && r.pm_status === "Accepted" && r.tl_status === "Assigned" && (<>
                  <Btn onClick={() => call("tl_update_assignment", { p_id: r.id, p_action: "accept" })}><Check size={14} /> Accept</Btn>
                  <Btn variant="danger" onClick={() => setModal({ kind: "decline", row: r })}><X size={14} /> Decline</Btn>
                </>)}
                {myRow && r.tl_status === "Accepted" && <Btn onClick={() => call("tl_update_assignment", { p_id: r.id, p_action: "start" })}><Play size={14} /> Start</Btn>}
                {myRow && ["Accepted", "In progress"].includes(r.tl_status) && <Btn onClick={() => setModal({ kind: "complete", row: r })}><Flag size={14} /> Mark completed</Btn>}
                {myRow && r.pm_status === "Pending PM" && <span className="text-xs text-stone-400">Waiting for the Production Manager to confirm this plan</span>}
                <button onClick={() => toggleHistory(r.id)} className="text-xs text-stone-500 hover:text-indigo-700 inline-flex items-center gap-1 ml-auto"><History size={13} /> History</button>
                {isManager && !["In progress", "Completed"].includes(r.tl_status) && (
                  <button onClick={() => { if (window.confirm("Remove this assignment?")) call("delete_assignment", { p_id: r.id }); }} className="text-stone-400 hover:text-rose-700 p-1" title="Remove"><Trash2 size={14} /></button>
                )}
              </div>
              {openHistory === r.id && (
                <div className="mt-3 border-t border-stone-100 pt-2 space-y-1">
                  {(events[r.id] || []).length === 0 && <p className="text-xs text-stone-400">No history yet.</p>}
                  {(events[r.id] || []).map((e) => (
                    <div key={e.id} className="text-xs text-stone-600"><span className="text-stone-400">{new Date(e.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> · <span className="font-medium">{e.by_name}</span> · {e.kind}{e.detail ? ` — ${e.detail}` : ""}</div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {modal?.kind === "new" && <AssignModal orders={orders.filter(OPEN_ORDER)} tls={tls} role={role} onClose={() => setModal(null)} onSave={async (list) => { for (const a of list) { if (!(await call("create_assignment", a))) return; } setModal(null); }} />}
      {modal?.kind === "plan" && <PlanModal orders={orders.filter(OPEN_ORDER)} existing={rows} tls={tls} onClose={() => setModal(null)} onSave={async (list) => {
        for (const a of list) { if (!(await call("create_assignment", a))) return; }
        setModal(null); setFilter("today");
      }} />}
      {modal?.kind === "edit" && <EditModal row={modal.row} moveToToday={modal.moveToToday} role={role} onClose={() => setModal(null)} onSave={async (a) => { if (await call("update_assignment", a)) setModal(null); }} />}
      {modal?.kind === "accept" && <AcceptModal row={modal.row} onClose={() => setModal(null)} onSave={async (a) => { if (await call("pm_accept_assignment", a)) setModal(null); }} />}
      {modal?.kind === "decline" && <NoteModal title="Decline this work" label="Reason" onClose={() => setModal(null)} onSave={async (note) => { if (await call("tl_update_assignment", { p_id: modal.row.id, p_action: "decline", p_note: note })) setModal(null); }} />}
      {modal?.kind === "complete" && <CompleteModal row={modal.row} out={outputs[modal.row.id] || 0} onClose={() => setModal(null)} onSave={async (qty, note) => { if (await call("tl_update_assignment", { p_id: modal.row.id, p_action: "complete", p_qty: qty, p_note: note })) setModal(null); }} />}
    </div>
  );
}

// tick one or more Team Leads
function TlPicker({ tls, value, onChange, label = "" }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border border-stone-200 rounded-lg px-3 py-2">
      {tls.length === 0 && <span className="text-xs text-stone-400">No Team Leads yet</span>}
      {tls.map((t) => (
        <label key={t.id} className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" aria-label={`${t.name}${label ? ` for ${label}` : ""}`} checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))} />
          {t.name}
        </label>
      ))}
    </div>
  );
}

function PrioSelect({ value, onChange }) {
  return <select aria-label="Priority" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>;
}

function AssignModal({ orders, tls, role, onClose, onSave }) {
  const [f, setF] = useState({ order: "", item: "", date: todayStr(), priority: "High", target: "", note: "", tls: [] });
  const order = orders.find((o) => o.id === f.order);
  return (
    <Modal title={role === "gm" ? "Assign a priority order to the Production Manager" : "New assignment"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.order) return; const base = { p_order_id: f.order, p_item: f.item || null, p_date: f.date, p_priority: f.priority, p_target: Number(f.target) || 0, p_instructions: f.note || null };
          onSave(f.tls.length ? f.tls.map((t) => ({ ...base, p_tl: t, p_target: Math.floor(base.p_target / f.tls.length) })) : [{ ...base, p_tl: null }]); }}>
        <Field label="Order">
          <select required className={inputCls} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value, item: "" })}>
            <option value="">Choose an order…</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>)}
          </select>
        </Field>
        <Field label="Item">
          <select className={inputCls} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} disabled={!order}>
            <option value="">Whole order</option>
            {(order?.items || []).map((it, i) => <option key={i} value={it.description}>{it.description} ({it.quantity})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work date"><input type="date" required className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Priority"><PrioSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} /></Field>
        </div>
        <Field label="Target pieces (optional — shared equally between Team Leads)"><input type="number" min="0" className={inputCls} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        {role !== "gm" && (
          <Field label="Team Leads (optional — tick more than one to share the order)">
            <TlPicker tls={tls} value={f.tls} onChange={(v) => setF({ ...f, tls: v })} />
          </Field>
        )}
        <Field label="Instructions (optional)"><textarea className={inputCls} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {role === "gm" && <p className="text-xs text-stone-500 mb-3">The Production Manager will accept this and can change the priority or date after discussion.</p>}
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Assign</Btn></div>
      </form>
    </Modal>
  );
}

// The Production Manager picks the orders that will run on a day, with a priority and (optionally) a Team Lead.
function PlanModal({ orders, existing, tls, onClose, onSave }) {
  const [date, setDate] = useState(todayStr());
  const [pick, setPick] = useState({});
  const plannedIds = new Set(existing.filter((a) => a.work_date === date && a.pm_status === "Accepted").map((a) => a.order_id));
  const set = (id, patch) => setPick((p) => ({ ...p, [id]: { priority: "Normal", tls: [], target: "", ...(p[id] || {}), ...patch } }));
  const chosen = Object.entries(pick).filter(([, v]) => v.on);
  return (
    <Modal title="Plan the day — choose the orders to progress" onClose={onClose}>
      <Field label="Day"><input type="date" className={inputCls} value={date} onChange={(e) => { setDate(e.target.value); setPick({}); }} /></Field>
      <p className="text-xs text-stone-500 mb-2">Tick the orders that will be worked on this day. Only these show in Today's production progress on the dashboard.</p>
      <div className="space-y-2 max-h-[45vh] overflow-y-auto mb-3">
        {orders.map((o) => {
          const v = pick[o.id] || {};
          const already = plannedIds.has(o.id);
          return (
            <div key={o.id} className={`border rounded-lg p-2 ${v.on ? "border-indigo-300 bg-indigo-50/40" : "border-stone-200"}`}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={already} checked={!!v.on} onChange={(e) => set(o.id, { on: e.target.checked, target: v.target || (o.daily_target ? String(o.daily_target) : "") })} />
                <span className="font-medium">{o.order_number}</span><span className="text-stone-500">{o.customer_name}</span>
                {already && <span className="text-[11px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 ml-auto">already planned</span>}
              </label>
              {v.on && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <select aria-label={`Priority for ${o.order_number}`} className={`${inputCls} !text-xs`} value={v.priority || "Normal"} onChange={(e) => set(o.id, { priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
                  <input aria-label={`Target for ${o.order_number}`} type="number" min="0" placeholder="Target pcs" className={`${inputCls} !text-xs`} value={v.target ?? ""} onChange={(e) => set(o.id, { target: e.target.value })} />
                  <div className="col-span-3"><TlPicker label={o.order_number} tls={tls} value={v.tls || []} onChange={(x) => set(o.id, { tls: x })} /></div>
                </div>
              )}
            </div>
          );
        })}
        {orders.length === 0 && <p className="text-sm text-stone-400">No open orders.</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!chosen.length} onClick={() => onSave(chosen.flatMap(([id, v]) => {
          const tl = v.tls?.length ? v.tls : [null];
          return tl.map((t) => ({ p_order_id: id, p_item: null, p_date: date, p_priority: v.priority || "Normal", p_target: Math.floor((Number(v.target) || 0) / tl.length), p_instructions: null, p_tl: t }));
        }))}>
          Plan {chosen.length || ""} order{chosen.length === 1 ? "" : "s"}
        </Btn>
      </div>
    </Modal>
  );
}

function EditModal({ row, moveToToday, role, onClose, onSave }) {
  const [f, setF] = useState({ priority: row.priority, date: moveToToday ? todayStr() : row.work_date, target: String(row.target_qty || ""), note: row.instructions || "", reason: "" });
  const changed = f.priority !== row.priority || f.date !== row.work_date;
  return (
    <Modal title={`Change ${row.order_number}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ p_id: row.id, p_priority: f.priority, p_date: f.date, p_target: Number(f.target) || 0, p_instructions: f.note, p_reason: f.reason || null }); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority"><PrioSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} /></Field>
          <Field label="Work date"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Target pieces"><input type="number" min="0" className={inputCls} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Instructions"><textarea className={inputCls} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {changed && row.pm_status === "Accepted" && <Field label="Reason for the change (discussed with…)"><input required className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
        {role === "gm" && changed && row.pm_status === "Accepted" && <p className="text-xs text-amber-700 mb-3">This will go back to the Production Manager to accept again.</p>}
        {changed && row.tl_status === "Accepted" && <p className="text-xs text-stone-500 mb-3">The Team Lead will be asked to accept the new date.</p>}
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Save</Btn></div>
      </form>
    </Modal>
  );
}

function AcceptModal({ row, onClose, onSave }) {
  const [f, setF] = useState({ priority: row.priority, date: row.work_date, reason: "" });
  const changed = f.priority !== row.priority || f.date !== row.work_date;
  return (
    <Modal title={`Accept ${row.order_number}`} onClose={onClose}>
      <p className="text-sm text-stone-600 mb-3">Assigned by {row.assigned_by}. Accept as it is, or change the priority / date after discussion.</p>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ p_id: row.id, p_priority: f.priority, p_date: f.date, p_reason: f.reason || null }); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority"><PrioSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} /></Field>
          <Field label="Work date"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        {changed && <Field label="Reason for the change"><input required className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit"><Check size={14} /> Accept</Btn></div>
      </form>
    </Modal>
  );
}

function NoteModal({ title, label, onClose, onSave }) {
  const [note, setNote] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(note); }}>
        <Field label={label}><textarea required className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Send</Btn></div>
      </form>
    </Modal>
  );
}

function CompleteModal({ row, out, onClose, onSave }) {
  const [qty, setQty] = useState(out ? String(out) : "");
  const [note, setNote] = useState("");
  return (
    <Modal title={`Mark ${row.order_number} completed`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(qty === "" ? null : Number(qty), note); }}>
        <Field label="Pieces completed"><input type="number" min="0" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {out > 0 && <p className="text-xs text-stone-500 -mt-2 mb-3">Hourly progress logged for this day: {out} pcs.</p>}
        <Field label="Note (optional)"><textarea className={inputCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit"><Flag size={14} /> Completed</Btn></div>
      </form>
    </Modal>
  );
}
