import { useEffect, useMemo, useState } from "react";
import { Check, X, CalendarDays, Scissors, ShoppingCart, Truck, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Btn } from "./ui";
import { fmtMoney } from "../lib/helpers";

const TYPES = {
  leave: { label: "Leave", icon: CalendarDays, cls: "bg-sky-100 text-sky-800" },
  cutting: { label: "Cutting", icon: Scissors, cls: "bg-amber-100 text-amber-800" },
  purchase: { label: "Purchase", icon: ShoppingCart, cls: "bg-emerald-100 text-emerald-800" },
  dispatch: { label: "Dispatch", icon: Truck, cls: "bg-indigo-100 text-indigo-800" },
};
const dFmt = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : "");
const sizesTotal = (s) => Object.values(s || {}).reduce((t, v) => t + (Number(v) || 0), 0);

// One place for the General Manager / Production Manager (and Admin) to approve everything waiting for them.
export default function Approvals({ profile }) {
  const role = profile?.role;
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(null);

  const load = async () => {
    const [lv, emp, cut, ord, pr, lots] = await Promise.all([
      supabase.from("leave_requests").select("*").eq("status", "Pending").order("created_at", { ascending: true }),
      supabase.from("employees").select("id, name"),
      supabase.from("cutting_entries").select("*").eq("status", "Submitted").order("created_at", { ascending: true }),
      supabase.from("orders").select("id, order_number, customer_name"),
      supabase.from("purchase_requests").select("*").eq("status", "Pending").order("created_at", { ascending: true }),
      supabase.from("dispatch_lots").select("*").in("status", ["Pending PM", "Pending GM"]).order("requested_at", { ascending: true }),
    ]);
    setData({ leave: lv.data || [], emp: emp.data || [], cutting: cut.data || [], orders: ord.data || [], purchase: pr.data || [], lots: lots.data || [] });
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("approvals-changes");
    ["leave_requests", "cutting_entries", "purchase_requests", "dispatch_lots"].forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, load));
    ch.subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const empName = (id) => data.emp.find((e) => e.id === id)?.name || "—";
    const ordLabel = (id) => { const o = data.orders.find((x) => x.id === id); return o ? `${o.order_number} — ${o.customer_name}` : "—"; };
    const out = [];
    data.leave.filter((r) => r.employee_id !== profile?.employee_id).forEach((r) => out.push({
      key: "l" + r.id, type: "leave", when: r.created_at, title: `${empName(r.employee_id)} — ${r.leave_type} leave`,
      detail: `${r.start_date} → ${r.end_date}${r.days != null ? ` · ${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}` : ""}${r.reason ? ` · ${r.reason}` : ""}`,
      approve: () => supabase.from("leave_requests").update({ status: "Approved", reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() }).eq("id", r.id),
      reject: () => supabase.from("leave_requests").update({ status: "Rejected", reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() }).eq("id", r.id),
    }));
    if (["admin", "hr", "gm", "pm"].includes(role)) data.cutting.forEach((c) => out.push({
      key: "c" + c.id, type: "cutting", when: c.created_at, title: `Cutting — ${ordLabel(c.order_id)}`,
      detail: `${c.item_description} · ${sizesTotal(c.sizes)} pieces cut ${c.cut_date || ""} · by ${c.submitted_by || "—"}`,
      approve: () => supabase.from("cutting_entries").update({ status: "Approved", reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() }).eq("id", c.id),
      reject: async () => { const reason = window.prompt("What needs to be fixed? (sent back to the cutting master)"); if (!reason || !reason.trim()) return { cancelled: true }; return supabase.rpc("reject_cutting", { p_id: c.id, p_reason: reason }); },
    }));
    data.purchase.forEach((r) => {
      const mine = (role === "gm" && !r.gm_approved_at) || (["admin", "hr"].includes(role) && r.finance_approved_at && !r.admin_approved_at);
      if (!mine) return;
      out.push({
        key: "p" + r.id, type: "purchase", when: r.created_at, title: `${r.category}: ${r.item}`,
        detail: `${fmtMoney(r.amount)}${r.vendor ? ` · ${r.vendor}` : ""} · requested by ${r.requested_by_name || "—"}${r.notes ? ` · ${r.notes}` : ""}`,
        approve: () => supabase.rpc("approve_purchase_request", { p_id: r.id }),
        reject: async () => { const reason = window.prompt("Reason for rejecting (optional):"); if (reason === null) return { cancelled: true }; return supabase.rpc("reject_purchase_request", { p_id: r.id, p_reason: reason || null }); },
      });
    });
    data.lots.forEach((l) => {
      const mine = (l.status === "Pending PM" && ["pm", "admin"].includes(role)) || (l.status === "Pending GM" && ["gm", "admin"].includes(role));
      if (!mine) return;
      const pcs = (l.items || []).reduce((t, i) => t + (Number(i.quantity) || 0), 0);
      out.push({
        key: "d" + l.id, type: "dispatch", when: l.requested_at, title: `Partial dispatch ${l.lot_no} — ${ordLabel(l.order_id)}`,
        detail: `${pcs} pieces · ${(l.items || []).map((i) => `${i.description} ×${i.quantity}`).join(", ")} · ${l.status === "Pending PM" ? "QC approved, awaiting Production Manager" : "PM approved, awaiting General Manager"}`,
        approve: () => supabase.rpc("approve_lot_dispatch", { p_lot: l.id, p_decision: "Approved", p_note: null }),
        reject: async () => { const note = window.prompt("Reason for rejecting this dispatch:"); if (note === null) return { cancelled: true }; return supabase.rpc("approve_lot_dispatch", { p_lot: l.id, p_decision: "Rejected", p_note: note }); },
      });
    });
    return out.sort((a, b) => String(a.when || "").localeCompare(String(b.when || "")));
  }, [data, role, profile?.employee_id, profile?.name]);

  const run = async (it, kind) => {
    setBusy(it.key + kind);
    const res = await it[kind]();
    setBusy(null);
    if (res?.cancelled) return;
    if (res?.error || res?.data?.ok === false) alert(res.error?.message || res.data?.error || "Couldn't update");
    load();
  };

  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;
  const counts = { all: items.length };
  Object.keys(TYPES).forEach((k) => { counts[k] = items.filter((i) => i.type === k).length; });
  const shown = items.filter((i) => filter === "all" || i.type === filter);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Approvals</h2>
        <p className="text-xs text-stone-500">Everything waiting for your decision, oldest first. Approve or reject right here.</p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {[["all", "All"], ...Object.entries(TYPES).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === k ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-600 border-stone-200"}`}>{label} ({counts[k] || 0})</button>
        ))}
      </div>
      <div className="grid gap-2">
        {shown.map((it) => {
          const T = TYPES[it.type];
          return (
            <div key={it.key} data-approval={it.type}><Card className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 ${T.cls}`}><T.icon size={11} /> {T.label}</span>
                  <span className="font-medium text-sm">{it.title}</span>
                </div>
                <div className="text-xs text-stone-500 mt-0.5">{it.detail}{it.when ? ` · ${dFmt(it.when)}` : ""}</div>
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" disabled={busy === it.key + "reject"} onClick={() => run(it, "reject")}><X size={13} /> Reject</Btn>
                <Btn disabled={busy === it.key + "approve"} onClick={() => run(it, "approve")}><Check size={13} /> Approve</Btn>
              </div>
            </Card></div>
          );
        })}
        {shown.length === 0 && <Card className="p-10 text-center text-stone-400 text-sm"><CheckCircle2 className="mx-auto mb-1 text-emerald-600" size={22} />Nothing waiting for approval.</Card>}
      </div>
    </div>
  );
}
