import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, BellRing, MessageSquare, PhoneCall, Mail, Users, FileText, StickyNote, Footprints, ShoppingBag, CircleX, ChevronRight, Send } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import {
  fmtMoney, todayStr, LEAD_TYPES, LEAD_STATUSES, LEAD_STATUS_COLORS, LEAD_SOURCES, ACTIVITY_KINDS, LEAD_NEXT_STAGE,
} from "../lib/helpers";
import { SendAgreementModal } from "./Orders";
import { isSalesPerson } from "../lib/orgRoles";

const KIND_ICONS = { Visit: Footprints, Call: PhoneCall, WhatsApp: MessageSquare, Email: Mail, Meeting: Users, Quotation: FileText, Note: StickyNote };
const isOpen = (l) => !["Won", "Lost"].includes(l.status);
const canConvertStatus = (st) => ["Interested", "Quotation Sent", "Won"].includes(st);
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");

// Lead management + visit / follow-up log + conversion of a won lead into a customer and sales order.
export default function Leads({ profile }) {
  const manager = ["admin", "hr", "gm", "pm", "sales_manager"].includes(profile?.role);
  const myEmpId = profile?.employee_id || null;
  const today = todayStr();
  const [leads, setLeads] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [status, setStatus] = useState("All");
  const [spFilter, setSpFilter] = useState("All");
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [modal, setModal] = useState(null); // lead being created / edited
  const [detailId, setDetailId] = useState(null);
  const [orders, setOrders] = useState([]); // orders created from leads (for the agreement status)
  const [convertLead, setConvertLead] = useState(null);
  const [agreementId, setAgreementId] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    const [{ data, error: e1 }, { data: emps }, { data: ords }] = await Promise.all([
      supabase.from("sales_leads").select("*").order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name, role, status").order("name"),
      supabase.from("orders").select("*").not("lead_id", "is", null),
    ]);
    setOrders(ords || []);
    if (e1) setError(e1.message + " (run migration_40.sql if the table is missing)");
    else setError("");
    setLeads(data || []);
    setSalespeople((emps || []).filter((e) => isSalesPerson(e.role) && e.status !== "Inactive"));
  };
  useEffect(() => {
    load();
    const ch = supabase
      .channel("leads-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id) => salespeople.find((s) => s.id === id)?.name || "—";
  const overdue = leads.filter((l) => isOpen(l) && l.next_followup_date && l.next_followup_date < today);
  const dueToday = leads.filter((l) => isOpen(l) && l.next_followup_date === today);
  const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, leads.filter((l) => l.status === s).length]));

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      leads.filter(
        (l) =>
          (status === "All" || l.status === status) &&
          (spFilter === "All" || l.salesperson_id === spFilter) &&
          (!onlyDue || (isOpen(l) && l.next_followup_date && l.next_followup_date <= today)) &&
          (!needle || [l.lead_number, l.company_name, l.contact_person, l.phone, l.address].some((v) => String(v || "").toLowerCase().includes(needle)))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, status, spFilter, onlyDue, needle]
  );
  const pipelineValue = shown.filter(isOpen).reduce((s, l) => s + Number(l.quotation_value || l.estimated_value || 0), 0);

  const saveLead = async (lead) => {
    const { id, ...rest } = lead;
    const payload = { ...rest, estimated_value: Number(rest.estimated_value) || 0 };
    for (const k of ["first_visit_date", "expected_order_date", "salesperson_id"]) if (!payload[k]) payload[k] = null;
    const res = id
      ? await supabase.from("sales_leads").update(payload).eq("id", id)
      : await supabase.from("sales_leads").insert({ ...payload, created_by: profile?.id });
    if (res.error) return alert(`Couldn't save the lead:\n${res.error.message}`);
    setModal(null);
    load();
  };

  const advance = async (l) => {
    const next = LEAD_NEXT_STAGE[l.status];
    if (!next) return;
    const { error: err } = await supabase.from("sales_leads").update({ status: next }).eq("id", l.id);
    if (err) return alert(err.message);
    load();
  };
  const pendingOrders = (l) => orders.filter((o) => o.lead_id === l.id && o.agreement_status !== "Agreed");

  const removeLead = async (l) => {
    if (!confirm(`Delete lead ${l.lead_number} (${l.company_name}) and its activity log?`)) return;
    const { error: err } = await supabase.from("sales_leads").delete().eq("id", l.id);
    if (err) alert(err.message);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Leads ({shown.length})</h2>
          <p className="text-xs text-stone-500">Open pipeline in view: {fmtMoney(pipelineValue)}</p>
        </div>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> New lead
        </Btn>
      </div>

      {(overdue.length > 0 || dueToday.length > 0) && (
        <button
          onClick={() => { setOnlyDue(!onlyDue); setStatus("All"); }}
          className={`w-full text-left flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${overdue.length ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-amber-50 border-amber-200 text-amber-900"}`}
        >
          <BellRing size={16} />
          <span>
            {overdue.length > 0 && <b>{overdue.length} overdue follow-up{overdue.length === 1 ? "" : "s"}</b>}
            {overdue.length > 0 && dueToday.length > 0 && " · "}
            {dueToday.length > 0 && <b>{dueToday.length} due today</b>}
            {" — "}{onlyDue ? "click to show all leads" : "click to show only these"}
          </span>
        </button>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setStatus("All")} className={`text-xs px-2.5 py-1 rounded-full border ${status === "All" ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"}`}>All ({leads.length})</button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`text-xs px-2.5 py-1 rounded-full border ${status === s ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"}`}>
            {s} ({counts[s]})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input className={inputCls + " flex-1 min-w-[200px]"} placeholder="Search lead no., company, contact person, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        {manager && (
          <select className={inputCls + " w-auto"} value={spFilter} onChange={(e) => setSpFilter(e.target.value)}>
            <option value="All">All salespeople</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              {["Date", "Organisation", "Contact person", "Designation", "Contact number", "Sales person", "Address", "Status", "Next step"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((l) => {
              const late = isOpen(l) && l.next_followup_date && l.next_followup_date < today;
              const next = LEAD_NEXT_STAGE[l.status];
              const pend = pendingOrders(l);
              const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
              return (
                <tr key={l.id} onClick={() => setDetailId(l.id)} className={`cursor-pointer hover:bg-stone-50 align-top ${late ? "bg-rose-50/40" : ""}`}>
                  <td className="px-3 py-2.5 whitespace-nowrap text-stone-600">{shortDate(l.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{l.company_name}</div>
                    <div className="text-[11px] text-stone-400"><span className="font-mono">{l.lead_number}</span> · {l.lead_type}</div>
                  </td>
                  <td className="px-3 py-2.5">{l.contact_person || "—"}</td>
                  <td className="px-3 py-2.5 text-stone-600">{l.designation || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs">{l.phone || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{nameOf(l.salesperson_id)}</td>
                  <td className="px-3 py-2.5 text-stone-600 max-w-[200px]">{l.address || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[l.status]}`}>{l.status}</span>
                    {isOpen(l) && l.next_followup_date && (
                      <div className={`text-[11px] mt-1 ${late ? "text-rose-700 font-semibold" : "text-stone-500"}`}>{late ? "Overdue · " : "Follow up "}{l.next_followup_date}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      {next && (
                        <button onClick={stop(() => advance(l))} className="inline-flex items-center gap-1 text-xs font-medium border border-indigo-300 text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg px-2.5 py-1 whitespace-nowrap">
                          Move to {next} <ChevronRight size={13} />
                        </button>
                      )}
                      {["New", "Contacted", "Interested", "Quotation Sent"].includes(l.status) && (
                        <button
                          disabled={!canConvertStatus(l.status)}
                          onClick={stop(() => setConvertLead(l))}
                          title={canConvertStatus(l.status) ? "Create the order in Orders" : "Available once the lead is Interested"}
                          className="inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2.5 py-1 whitespace-nowrap bg-indigo-900 text-white hover:bg-indigo-800 disabled:bg-stone-100 disabled:text-stone-400 disabled:cursor-not-allowed"
                        >
                          <ShoppingBag size={13} /> Convert to order
                        </button>
                      )}
                      {l.status === "Order Created" && pend.map((o) => (
                        <button key={o.id} onClick={stop(() => setAgreementId(o.id))} className="inline-flex items-center gap-1 text-xs font-medium border border-violet-300 text-violet-800 bg-violet-50 hover:bg-violet-100 rounded-lg px-2.5 py-1 whitespace-nowrap" title="Send the agreement to the customer">
                          <Send size={12} /> {o.order_number}: {o.agreement_status === "Not sent" ? "Send agreement" : o.agreement_status === "Sent" ? "Awaiting customer" : "Customer disagreed"}
                        </button>
                      ))}
                      {l.status === "Won" && <span className="text-xs text-emerald-700 font-medium">Order won</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-right">
                    <button onClick={stop(() => setModal(l))} className="text-stone-400 hover:text-indigo-700 p-1" title="Edit"><Pencil size={14} /></button>
                    {manager && <button onClick={stop(() => removeLead(l))} className="text-stone-400 hover:text-rose-700 p-1" title="Delete"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-400 text-sm">{leads.length ? "No leads match these filters." : "No leads yet. Record a new school, hospital, company or retailer with “New lead”."}</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {convertLead && <ConvertModal lead={convertLead} onClose={() => setConvertLead(null)} onDone={() => { setConvertLead(null); load(); }} />}
      {agreementId && orders.find((o) => o.id === agreementId) && (
        <SendAgreementModal order={orders.find((o) => o.id === agreementId)} onClose={() => setAgreementId(null)} onChanged={load} />
      )}
      {modal && <LeadModal lead={modal} salespeople={salespeople} manager={manager} myEmpId={myEmpId} onClose={() => setModal(null)} onSave={saveLead} />}
      {detailId && (
        <LeadDetail
          lead={leads.find((l) => l.id === detailId)}
          salespeople={salespeople}
          profile={profile}
          manager={manager}
          onClose={() => setDetailId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function LeadModal({ lead, salespeople, manager, myEmpId, onClose, onSave }) {
  const [f, setF] = useState({
    id: lead.id,
    company_name: lead.company_name || "",
    lead_type: lead.lead_type || "School",
    contact_person: lead.contact_person || "",
    designation: lead.designation || "",
    phone: lead.phone || "",
    email: lead.email || "",
    address: lead.address || "",
    salesperson_id: lead.salesperson_id || (!manager ? myEmpId : "") || "",
    lead_source: lead.lead_source || "Marketing visit",
    first_visit_date: lead.first_visit_date || todayStr(),
    estimated_value: lead.estimated_value || "",
    status: lead.status || "New",
    notes: lead.notes || "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    if (!f.company_name.trim()) return;
    if (!f.salesperson_id) return alert("Choose the salesperson who owns this lead.");
    onSave({ ...f, status: lead.id ? f.status : "New" });
  };
  return (
    <Modal title={lead.id ? `Edit lead ${lead.lead_number}` : "New lead"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Customer / company name"><input required className={inputCls} value={f.company_name} onChange={set("company_name")} placeholder="e.g. St. Mary's School" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className={inputCls} value={f.lead_type} onChange={set("lead_type")}>{LEAD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Lead source"><select className={inputCls} value={f.lead_source} onChange={set("lead_source")}>{LEAD_SOURCES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Contact person"><input className={inputCls} value={f.contact_person} onChange={set("contact_person")} /></Field>
          <Field label="Designation"><input className={inputCls} value={f.designation} onChange={set("designation")} placeholder="Principal, Owner…" /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={set("email")} /></Field>
        </div>
        <Field label="Address / location"><input className={inputCls} value={f.address} onChange={set("address")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assigned salesperson">
            <select className={inputCls} value={f.salesperson_id} onChange={set("salesperson_id")} disabled={!manager}>
              <option value="">— choose —</option>
              {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="First visit date"><input type="date" className={inputCls} value={f.first_visit_date} onChange={set("first_visit_date")} /></Field>
          <Field label="Estimated order value (₹)"><input type="number" min="0" className={inputCls} value={f.estimated_value} onChange={set("estimated_value")} /></Field>
          {lead.id && !["Won", "Order Created"].includes(lead.status) && (
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={set("status")}>
                {LEAD_STATUSES.filter((s) => !["Won", "Order Created"].includes(s)).map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} /></Field>
        {salespeople.length === 0 && manager && <p className="text-xs text-amber-700 mb-2">No employee has the role “Sales Executive” yet. Add one in HR &amp; Workforce → Employees.</p>}
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save lead</Btn>
        </div>
      </form>
    </Modal>
  );
}

function LeadDetail({ lead, salespeople, profile, manager, onClose, onChanged }) {
  const [activities, setActivities] = useState([]);
  const [orders, setOrders] = useState([]);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [agreementFor, setAgreementFor] = useState(null);

  const load = async () => {
    if (!lead) return;
    const [{ data: acts }, { data: os }, { data: linked }] = await Promise.all([
      supabase.from("lead_activities").select("*").eq("lead_id", lead.id).order("activity_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("order_sales").select("order_id, order_value").eq("lead_id", lead.id),
      supabase.from("orders").select("*").eq("lead_id", lead.id),
    ]);
    setActivities(acts || []);
    // orders created from this lead (waiting for / past the customer's agreement) plus orders linked the older way
    const val = Object.fromEntries((os || []).map((o) => [o.order_id, o.order_value]));
    const extraIds = (os || []).map((o) => o.order_id).filter((id) => !(linked || []).some((o) => o.id === id));
    let extra = [];
    if (extraIds.length) ({ data: extra } = await supabase.from("orders").select("*").in("id", extraIds));
    setOrders([...(linked || []), ...(extra || [])].map((o) => ({ ...o, order_value: val[o.id] ?? o.sales_order_value, inSales: o.id in val })));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.last_activity_at, lead?.status]);

  if (!lead) return null;
  const sp = salespeople.find((s) => s.id === lead.salesperson_id)?.name || "—";
  const refresh = () => { load(); onChanged(); };

  const markLost = async (reason) => {
    const { error } = await supabase.from("sales_leads").update({ status: "Lost", lost_reason: reason || null, next_followup_date: null }).eq("id", lead.id);
    if (error) return alert(error.message);
    setLostOpen(false);
    refresh();
  };
  const reopen = async () => {
    await supabase.from("sales_leads").update({ status: lead.customer_id ? "Won" : "Contacted", lost_reason: null }).eq("id", lead.id);
    refresh();
  };
  const setStatus = async (s) => {
    if (s === "Lost") return setLostOpen(true);
    await supabase.from("sales_leads").update({ status: s }).eq("id", lead.id);
    refresh();
  };

  return (
    <Modal title={`${lead.lead_number} · ${lead.company_name}`} onClose={onClose}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>{lead.status}</span>
        <span className="text-xs text-stone-500">{lead.lead_type} · Salesperson {sp}</span>
      </div>
      <div className="text-sm space-y-0.5 mb-3">
        {lead.contact_person && <div>{lead.contact_person}{lead.designation ? `, ${lead.designation}` : ""}</div>}
        {lead.phone && <div className="text-stone-600">📞 {lead.phone}{lead.email ? ` · ${lead.email}` : ""}</div>}
        {lead.address && <div className="text-stone-600">📍 {lead.address}</div>}
        <div className="text-stone-500 text-xs pt-1">
          Estimated {fmtMoney(lead.estimated_value)}{Number(lead.quotation_value) > 0 ? ` · Quoted ${fmtMoney(lead.quotation_value)}` : ""}
          {lead.expected_order_date ? ` · Expected order ${lead.expected_order_date}` : ""}
          {lead.next_followup_date ? ` · Next follow-up ${lead.next_followup_date}` : ""}
        </div>
        {lead.status === "Lost" && lead.lost_reason && <div className="text-xs text-rose-700">Lost: {lead.lost_reason}</div>}
        {lead.notes && <div className="text-xs text-stone-500 italic pt-1">{lead.notes}</div>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {["New", "Contacted", "Interested", "Quotation Sent", "Won"].includes(lead.status) && (
          <Btn onClick={() => setConverting(true)} disabled={!canConvertStatus(lead.status)}>
            <ShoppingBag size={14} /> {lead.status === "Won" ? "Add another order" : "Convert to order"}
          </Btn>
        )}
        {["New", "Contacted"].includes(lead.status) && <span className="text-xs text-stone-400 self-center">Convert is available once the lead is Interested.</span>}
        <Btn variant="ghost" onClick={() => setAdding(true)}><Plus size={14} /> Log visit / follow-up</Btn>
        {!["Won", "Lost", "Order Created"].includes(lead.status) && (
          <select className={inputCls + " w-auto"} value={lead.status} onChange={(e) => setStatus(e.target.value)}>
            {LEAD_STATUSES.filter((s) => !["Won", "Order Created"].includes(s)).map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {lead.status === "Lost" && <Btn variant="ghost" onClick={reopen}>Re-open lead</Btn>}
      </div>

      {lostOpen && <LostForm onCancel={() => setLostOpen(false)} onConfirm={markLost} />}

      {orders.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase text-stone-500 mb-1.5">Orders from this lead ({orders.length})</div>
          <div className="space-y-1">
            {orders.map((o) => {
              const agr = o.agreement_status || "Not sent";
              return (
                <div key={o.id} className="flex justify-between items-center gap-2 text-sm border border-stone-200 rounded-lg px-3 py-1.5 flex-wrap">
                  <span className="font-medium">{o.order_number} <span className="text-xs text-stone-400 font-normal">{o.status}{o.due_date ? ` · due ${o.due_date}` : ""}</span></span>
                  <span className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${agr === "Agreed" ? "bg-emerald-100 text-emerald-800" : agr === "Disagreed" ? "bg-rose-600 text-white" : agr === "Sent" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>
                      {o.inSales || agr === "Agreed" ? "Agreed · in Sales Orders" : `Agreement: ${agr}`}
                    </span>
                    {agr !== "Agreed" && <button onClick={() => setAgreementFor(o)} className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1"><Send size={11} />{agr === "Not sent" ? "Send agreement" : "Share link"}</button>}
                    <span className="font-mono">{fmtMoney(o.order_value)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-xs font-semibold uppercase text-stone-500 mb-1.5">Visits &amp; follow-ups</div>
      <div className="space-y-2">
        {activities.map((a) => {
          const Icon = KIND_ICONS[a.kind] || StickyNote;
          return (
            <div key={a.id} className="border border-stone-200 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium inline-flex items-center gap-1.5"><Icon size={13} className="text-indigo-700" />{a.kind}{a.location ? ` · ${a.location}` : ""}</span>
                <span className="text-xs text-stone-400">{a.activity_date}</span>
              </div>
              {a.contact_person && <div className="text-xs text-stone-500">Met: {a.contact_person}</div>}
              {a.requirements && <div className="text-xs mt-1"><b className="text-stone-500">Requirements:</b> {a.requirements}</div>}
              {a.notes && <div className="text-xs mt-0.5"><b className="text-stone-500">Discussion:</b> {a.notes}</div>}
              {Number(a.quotation_value) > 0 && <div className="text-xs mt-0.5"><b className="text-stone-500">Quotation:</b> {fmtMoney(a.quotation_value)}</div>}
              {a.customer_response && <div className="text-xs mt-0.5"><b className="text-stone-500">Customer response:</b> {a.customer_response}</div>}
              {(a.expected_order_date || a.next_followup_date) && (
                <div className="text-xs text-stone-500 mt-0.5">
                  {a.expected_order_date ? `Expected order ${a.expected_order_date}` : ""}{a.expected_order_date && a.next_followup_date ? " · " : ""}{a.next_followup_date ? `Next follow-up ${a.next_followup_date}` : ""}
                </div>
              )}
              {a.logged_by && <div className="text-[10px] text-stone-400 mt-0.5">by {a.logged_by}</div>}
            </div>
          );
        })}
        {activities.length === 0 && <p className="text-xs text-stone-400">Nothing logged yet. Record the first marketing visit.</p>}
      </div>

      {agreementFor && <SendAgreementModal order={orders.find((x) => x.id === agreementFor.id) || agreementFor} onClose={() => setAgreementFor(null)} onChanged={refresh} />}
      {adding && <ActivityModal lead={lead} profile={profile} onClose={() => setAdding(false)} onSaved={refresh} />}
      {converting && <ConvertModal lead={lead} onClose={() => setConverting(false)} onDone={() => { setConverting(false); refresh(); }} />}
    </Modal>
  );
}

function LostForm({ onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mb-4 border border-rose-200 bg-rose-50 rounded-lg p-3">
      <Field label="Why was this lead lost?">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price too high, went with another supplier" />
      </Field>
      <div className="flex gap-2 justify-end">
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => onConfirm(reason)}><CircleX size={14} /> Mark lost</Btn>
      </div>
    </div>
  );
}

function ActivityModal({ lead, profile, onClose, onSaved }) {
  const [f, setF] = useState({
    kind: "Visit", activity_date: todayStr(), location: "", contact_person: lead.contact_person || "",
    requirements: "", notes: "", quotation_value: "", customer_response: "", expected_order_date: "", next_followup_date: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const showVisit = ["Visit", "Meeting"].includes(f.kind);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      lead_id: lead.id, kind: f.kind, activity_date: f.activity_date,
      location: f.location || null, contact_person: f.contact_person || null, requirements: f.requirements || null,
      notes: f.notes || null, customer_response: f.customer_response || null,
      quotation_value: f.kind === "Quotation" || f.quotation_value ? Number(f.quotation_value) || null : null,
      expected_order_date: f.expected_order_date || null, next_followup_date: f.next_followup_date || null,
      logged_by: profile?.name || null,
    };
    const { error } = await supabase.from("lead_activities").insert(payload);
    setSaving(false);
    if (error) return alert(error.message);
    onSaved();
    onClose();
  };
  return (
    <Modal title="Log visit / follow-up" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Activity"><select className={inputCls} value={f.kind} onChange={set("kind")}>{ACTIVITY_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Date"><input type="date" className={inputCls} value={f.activity_date} onChange={set("activity_date")} /></Field>
        </div>
        {showVisit && <Field label="Visit location"><input className={inputCls} value={f.location} onChange={set("location")} placeholder="Place visited" /></Field>}
        {showVisit && <Field label="Contact person met"><input className={inputCls} value={f.contact_person} onChange={set("contact_person")} /></Field>}
        {showVisit && <Field label="Customer requirements"><textarea rows={2} className={inputCls} value={f.requirements} onChange={set("requirements")} placeholder="What do they need — items, quantities, sizes, timeline" /></Field>}
        <Field label={f.kind === "Note" ? "Note" : "Discussion / meeting notes"}><textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} /></Field>
        {f.kind === "Quotation" && (
          <Field label="Quotation value (₹)"><input type="number" min="0" required className={inputCls} value={f.quotation_value} onChange={set("quotation_value")} /></Field>
        )}
        {f.kind !== "Note" && (
          <>
            <Field label="Customer response"><input className={inputCls} value={f.customer_response} onChange={set("customer_response")} placeholder="Interested, wants a lower price, will confirm next week…" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expected order date"><input type="date" className={inputCls} value={f.expected_order_date} onChange={set("expected_order_date")} /></Field>
              <Field label="Next follow-up date"><input type="date" className={inputCls} value={f.next_followup_date} onChange={set("next_followup_date")} /></Field>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// Lead -> customer + sales order, linked back to the lead and its salesperson.
function ConvertModal({ lead, onClose, onDone }) {
  const [items, setItems] = useState([{ description: "", quantity: "" }]);
  const [value, setValue] = useState(lead.quotation_value || lead.estimated_value || "");
  const [due, setDue] = useState("");
  const [orderNo, setOrderNo] = useState("");
  useEffect(() => { supabase.rpc("next_order_number").then(({ data }) => data && setOrderNo(data)); }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (i, patch) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const clean = items.filter((it) => it.description.trim()).map((it) => ({ description: it.description.trim(), quantity: Number(it.quantity) || 0 }));
    if (!clean.length) return setError("Add at least one item.");
    setSaving(true);
    const { data, error: err } = await supabase.rpc("convert_lead_to_order", {
      p_lead: lead.id, p_items: clean, p_order_value: Number(value) || 0, p_due_date: due || null, p_order_number: null,
    });
    setSaving(false);
    if (err || !data?.ok) return setError(err?.message || data?.error || "Couldn't create the order.");
    alert(`Order ${data.order_number} created in Production Management → Orders.\nSend the agreement to the customer; when they agree, the lead becomes Won and the order appears in Sales Orders.`);
    onDone();
  };
  return (
    <Modal title={lead.status === "Won" ? "Add another order" : "Convert to order"} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-xs text-stone-500 mb-3">
          The order is created in Production Management → Orders, linked to this lead and its salesperson. It reaches Sales Orders (and counts towards commission) once the customer agrees to it.
        </p>
        <div className="text-xs font-medium text-stone-600 mb-1">Items</div>
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input className={inputCls} placeholder="Description (e.g. School shirt)" value={it.description} onChange={(e) => update(i, { description: e.target.value })} />
            <input type="number" min="0" className={inputCls + " w-28"} placeholder="Qty" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
            {items.length > 1 && <button type="button" onClick={() => setItems(items.filter((_, idx) => idx !== i))} className="text-stone-400 hover:text-rose-600"><Trash2 size={15} /></button>}
          </div>
        ))}
        <button type="button" onClick={() => setItems([...items, { description: "", quantity: "" }])} className="text-xs text-indigo-700 hover:underline mb-3">+ Add item</button>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Order value (₹)"><input type="number" min="1" required className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Due date"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Order number (next in the Orders sequence)"><input className={inputCls + " bg-stone-50 font-mono"} value={orderNo} readOnly /></Field>
        {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create order"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
