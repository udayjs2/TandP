import { useState } from "react";
import { CheckCircle2, X, Trash2, Truck, ClipboardCheck } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Field, inputCls, Btn } from "./ui";

// Partial dispatches: a lot of already-made pieces is quality approved (QC), then approved for dispatch by the
// Production Manager and the General Manager. Deliveries can then be logged against the approved lot.

export const LOT_STATUS = {
  "Pending QC": { label: "Awaiting QC approval", cls: "bg-amber-100 text-amber-800" },
  "Pending PM": { label: "QC approved · awaiting Production Manager", cls: "bg-sky-100 text-sky-800" },
  "Pending GM": { label: "PM approved · awaiting General Manager", cls: "bg-indigo-100 text-indigo-800" },
  Approved: { label: "Approved for dispatch", cls: "bg-emerald-100 text-emerald-800" },
  Rejected: { label: "Rejected", cls: "bg-rose-100 text-rose-800" },
};
export const lotTotal = (lot) => (lot.items || []).reduce((t, i) => t + (Number(i.quantity) || 0), 0);
// pieces already dispatched against this lot, per item
export const lotDelivered = (lot, deliveries) => {
  const m = {};
  (deliveries || []).filter((d) => d.lot_id === lot.id).forEach((d) => { m[d.item_description] = (m[d.item_description] || 0) + (Number(d.quantity) || 0); });
  return m;
};
export const lotRemaining = (lot, deliveries) => {
  const done = lotDelivered(lot, deliveries);
  return (lot.items || []).map((i) => ({ description: i.description, approved: Number(i.quantity), done: done[i.description] || 0, left: Math.max(0, Number(i.quantity) - (done[i.description] || 0)) }));
};
// per item: how many pieces can still be put into a new lot
export const lotAvailability = (order, progress, lots) =>
  (order.items || []).map((it) => {
    const made = (progress || []).filter((p) => p.item_description === it.description).reduce((t, p) => t + (Number(p.quantity) || 0), 0);
    const lotted = (lots || []).filter((l) => l.status !== "Rejected").reduce((t, l) => t + (l.items || []).filter((x) => x.description === it.description).reduce((s, x) => s + Number(x.quantity || 0), 0), 0);
    const ordered = Number(it.quantity) || 0;
    return { description: it.description, ordered, made, lotted, available: Math.max(0, Math.min(made, ordered) - lotted) };
  });

export function RequestLotModal({ order, progress, lots, onClose, onDone }) {
  const rows = lotAvailability(order, progress, lots);
  const [qty, setQty] = useState({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const total = Object.values(qty).reduce((t, v) => t + (Number(v) || 0), 0);
  const submit = async (e) => {
    e.preventDefault();
    const items = rows.filter((r) => Number(qty[r.description]) > 0).map((r) => ({ description: r.description, quantity: Number(qty[r.description]) }));
    if (!items.length) return alert("Enter the pieces to dispatch for at least one item.");
    setSaving(true);
    const { data, error } = await supabase.rpc("request_dispatch_lot", { p_order_id: order.id, p_items: items, p_note: note || null });
    setSaving(false);
    if (error || data?.ok === false) return alert(`Couldn't request:\n${error?.message || data?.error}`);
    onDone();
  };
  return (
    <Modal title={`Request partial dispatch — ${order.order_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-xs text-stone-500 mb-3">Choose the pieces that are ready to go. The lot is then checked by QC and approved for dispatch by the Production Manager and the General Manager. Only pieces already stitched can be put in a lot.</p>
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-3">
          <div className="grid grid-cols-[1fr_52px_52px_62px_80px] gap-1 bg-stone-50 px-2 py-1.5 text-[10px] font-medium text-stone-500 uppercase">
            <span>Item</span><span className="text-right">Ordered</span><span className="text-right">Made</span><span className="text-right">In lots</span><span className="text-right">This lot</span>
          </div>
          {rows.map((r) => (
            <div key={r.description} className="grid grid-cols-[1fr_52px_52px_62px_80px] gap-1 px-2 py-1.5 border-t border-stone-100 items-center text-sm">
              <span>{r.description}<span className="block text-[10px] text-stone-400">{r.available} available</span></span>
              <span className="text-right font-mono text-stone-500">{r.ordered}</span>
              <span className="text-right font-mono text-stone-500">{r.made}</span>
              <span className="text-right font-mono text-stone-500">{r.lotted}</span>
              <input type="number" min="0" max={r.available} disabled={r.available === 0} placeholder="0" className="border border-stone-300 rounded px-1.5 py-1 text-sm text-right disabled:bg-stone-100"
                value={qty[r.description] ?? ""} onChange={(e) => setQty({ ...qty, [r.description]: e.target.value })} />
            </div>
          ))}
        </div>
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. first truck, sizes 24–30" /></Field>
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-stone-500">{total} pieces in this lot</span>
          <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving || total === 0}>{saving ? "Sending…" : "Send for QC approval"}</Btn></div>
        </div>
      </form>
    </Modal>
  );
}

function QcModal({ lot, onClose, onDone }) {
  const total = lotTotal(lot);
  const [decision, setDecision] = useState("Approved");
  const [inspected, setInspected] = useState(String(total));
  const [defective, setDefective] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc("qc_dispatch_lot", { p_lot: lot.id, p_decision: decision, p_inspected: Number(inspected) || 0, p_defective: Number(defective) || 0, p_note: note });
    setSaving(false);
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onDone();
  };
  return (
    <Modal title={`Quality check — partial dispatch ${lot.lot_no}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">{(lot.items || []).map((i) => `${i.description} × ${i.quantity}`).join(", ")} ({total} pieces)</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pieces inspected"><input type="number" min="1" max={total} className={inputCls} value={inspected} onChange={(e) => setInspected(e.target.value)} /></Field>
          <Field label="Defective pieces found"><input type="number" min="0" className={inputCls} value={defective} onChange={(e) => setDefective(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2 mb-3">
          {["Approved", "Rejected"].map((d) => (
            <button type="button" key={d} onClick={() => setDecision(d)} className={`flex-1 py-2 rounded-lg text-sm font-medium border ${decision === d ? (d === "Approved" ? "bg-emerald-600 text-white border-emerald-600" : "bg-rose-600 text-white border-rose-600") : "bg-white text-stone-600 border-stone-300"}`}>{d === "Approved" ? "Approve for dispatch" : "Reject"}</button>
          ))}
        </div>
        {Number(defective) > 0 && decision === "Approved" && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">Lots with defective pieces cannot be approved. Reject it, or remove the defective pieces and request a corrected lot.</p>}
        <Field label={decision === "Rejected" ? "Reason for rejecting (required)" : "Notes (optional)"}><textarea rows={2} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-3"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save QC decision"}</Btn></div>
      </form>
    </Modal>
  );
}

function RejectModal({ lot, onClose, onDone }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc("approve_lot_dispatch", { p_lot: lot.id, p_decision: "Rejected", p_note: note });
    setSaving(false);
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onDone();
  };
  return (
    <Modal title={`Reject partial dispatch ${lot.lot_no}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">The pieces go back to being available, so a new lot can be requested.</p>
        <Field label="Reason"><textarea required autoFocus rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-3"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving || note.trim().length < 3}>{saving ? "Saving…" : "Reject"}</Btn></div>
      </form>
    </Modal>
  );
}

// One partial dispatch with its approval trail and the actions this person may take.
export function LotCard({ lot, orderLabel, deliveries, profile, onChanged }) {
  const role = profile?.role;
  const [qc, setQc] = useState(false);
  const [reject, setReject] = useState(false);
  const st = LOT_STATUS[lot.status] || LOT_STATUS["Pending QC"];
  const canQc = lot.status === "Pending QC" && ["quality_manager", "qc", "pm", "admin", "hr"].includes(role);
  const canDispatchApprove = (lot.status === "Pending PM" && ["pm", "admin"].includes(role)) || (lot.status === "Pending GM" && ["gm", "admin"].includes(role));
  const rem = lotRemaining(lot, deliveries);
  const delivered = rem.reduce((t, r) => t + r.done, 0);
  const total = lotTotal(lot);
  const canDelete = ["admin", "gm", "pm"].includes(role) && delivered === 0;

  const approve = async () => {
    const { data, error } = await supabase.rpc("approve_lot_dispatch", { p_lot: lot.id, p_decision: "Approved", p_note: null });
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`Remove partial dispatch ${lot.lot_no}? Its pieces become available for a new lot.`)) return;
    const { data, error } = await supabase.rpc("delete_dispatch_lot", { p_lot: lot.id });
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onChanged();
  };
  const step = (done, label, who) => <span className={done ? "text-emerald-700" : "text-stone-400"}>{done ? "✓" : "○"} {label}{done && who ? ` (${who})` : ""}</span>;

  return (
    <div className="border border-stone-200 rounded-lg p-3 text-sm bg-white">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="font-semibold">{orderLabel ? `${orderLabel} · ` : ""}Partial dispatch {lot.lot_no} <span className="font-normal text-stone-500">· {total} pcs</span></div>
          <div className="text-xs text-stone-600">{(lot.items || []).map((i) => `${i.description} × ${i.quantity}`).join(", ")}</div>
          <div className="text-[11px] text-stone-400">Requested{lot.requested_by ? ` by ${lot.requested_by}` : ""}{lot.requested_at ? ` on ${String(lot.requested_at).slice(0, 10)}` : ""}{lot.note ? ` · ${lot.note}` : ""}</div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{lot.status === "Rejected" ? `Rejected at ${lot.reject_stage || "approval"}` : st.label}</span>
      </div>
      {lot.status !== "Rejected" && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
          {step(!!lot.qc_by, "QC", lot.qc_by ? `${lot.qc_by}, ${lot.qc_inspected} checked` : "")}
          {step(!!lot.pm_by, "Production Manager", lot.pm_by)}
          {step(!!lot.gm_by, "General Manager", lot.gm_by)}
        </div>
      )}
      {lot.status === "Rejected" && <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">{lot.reject_reason}</div>}
      {lot.status === "Approved" && (
        <div className="mt-2 text-xs">
          <span className={delivered >= total ? "text-emerald-700 font-medium" : "text-stone-600"}>
            {delivered >= total ? <><CheckCircle2 size={12} className="inline mr-1" />Fully dispatched ({total} pcs)</> : `${delivered} of ${total} pcs dispatched · ${total - delivered} left to dispatch`}
          </span>
        </div>
      )}
      <div className="flex gap-2 mt-2 flex-wrap">
        {canQc && <Btn onClick={() => setQc(true)}><ClipboardCheck size={13} /> QC decision</Btn>}
        {canDispatchApprove && (<><Btn onClick={approve}><Truck size={13} /> Approve for dispatch</Btn><Btn variant="ghost" onClick={() => setReject(true)}><X size={13} /> Reject</Btn></>)}
        {canDelete && <Btn variant="ghost" onClick={remove}><Trash2 size={13} /> Remove</Btn>}
      </div>
      {qc && <QcModal lot={lot} onClose={() => setQc(false)} onDone={() => { setQc(false); onChanged(); }} />}
      {reject && <RejectModal lot={lot} onClose={() => setReject(false)} onDone={() => { setReject(false); onChanged(); }} />}
    </div>
  );
}
