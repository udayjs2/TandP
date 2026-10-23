import { useEffect, useState } from "react";
import { Check, X, AlertTriangle, CheckCircle2, Scissors, Trash2, Send, History } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";

const LETTER_SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL"];
// Numeric sizes are even numbers as sold in the market.
const range = (a, b) => Array.from({ length: (b - a) / 2 + 1 }, (_, i) => String(a + i * 2));
export const TSHIRT_SIZES = range(20, 44);
export const PANT_SIZES = range(18, 44);
const SIZES18_44 = range(18, 44);
// prefix is stored with the number (e.g. "CHUD-24") so the same number in
// different garments stays separate. Letter sizes are stored as-is.
export const SIZE_GROUPS = [
  { key: "letter", prefix: "", label: "Letter sizes (2XS–2XL)", sizes: LETTER_SIZES },
  { key: "tshirt", prefix: "T", label: "T-shirt (20–44)", sizes: TSHIRT_SIZES },
  { key: "pant", prefix: "P", label: "Pant / Nicker (18–44)", sizes: PANT_SIZES },
  { key: "chud", prefix: "CHUD", label: "Chudidhar (18–44)", sizes: SIZES18_44 },
  { key: "short", prefix: "SHORT", label: "Short (18–44)", sizes: SIZES18_44 },
  { key: "shirt", prefix: "SHIRT", label: "Shirt (18–44)", sizes: SIZES18_44 },
  { key: "coat", prefix: "COAT", label: "Coat (18–44)", sizes: SIZES18_44 },
  { key: "skirt", prefix: "SKIRT", label: "Skirt (18–44)", sizes: SIZES18_44 },
  { key: "track", prefix: "TRACK", label: "Track Pant (18–44)", sizes: SIZES18_44 },
  { key: "frock", prefix: "FROCK", label: "Frock (18–44)", sizes: SIZES18_44 },
];
const SIZES = LETTER_SIZES;
const STATUS_COLORS = {
  Submitted: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

// "T-24" -> "T-shirt 24", "CHUD-24" -> "Chudidhar 24"; letter sizes unchanged
export const sizeLabel = (k) => {
  const i = k.indexOf("-");
  if (i < 0) return k;
  const g = SIZE_GROUPS.find((x) => x.prefix === k.slice(0, i));
  return g ? `${g.label.split(" (")[0].replace("Pant / Nicker", "Pant")} ${k.slice(i + 1)}` : k;
};

export default function Cutting({ profile }) {
  const isCuttingMaster = profile?.role === "cutting_master";
  const canApprove = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const canResend = ["cutting_master", "admin", "hr", "gm", "pm"].includes(profile?.role);
  // admin / HR / GM / PM delete any entry; a cutting master only their own entry until it is approved
  const canDelete = (e) => canApprove || (isCuttingMaster && e.status !== "Approved" && e.submitted_by === profile?.name);
  const [orders, setOrders] = useState([]);
  const [entries, setEntries] = useState([]);
  const [modal, setModal] = useState(null);
  const [reviewEntry, setReviewEntry] = useState(null);
  const [completeEntry, setCompleteEntry] = useState(null);
  const [logs, setLogs] = useState([]); // day-by-day stitching rows
  const [openHistory, setOpenHistory] = useState({});
  const [rejectEntry, setRejectEntry] = useState(null);
  const [resendEntry, setResendEntry] = useState(null);
  const [fabrics, setFabrics] = useState([]);
  const [view, setView] = useState("pending"); // pending | approved | rejected

  const load = async () => {
    const [{ data: ord }, { data: ent }, { data: fab }, { data: lg }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, items").not("status", "in", "(Completed,Shipped)"),
      supabase.from("cutting_entries").select("*").order("cut_date", { ascending: false }),
      supabase.from("inventory_fabric").select("id, fabric_type, color, weight_gsm, stock_kg, stock_meters").order("fabric_type"),
      supabase.from("cutting_stitch_log").select("*").order("log_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setLogs(lg || []);
    setFabrics(fab || []);
    setOrders(ord || []);
    setEntries(ent || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("cutting-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "cutting_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_fabric" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "cutting_stitch_log" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const orderLabel = (id) => {
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : "—";
  };

  const fabricLabel = (id) => {
    const f = fabrics.find((x) => x.id === id);
    return f ? `${f.fabric_type}${f.color ? ` (${f.color})` : ""}` : "fabric";
  };

  const approve = async (entry) => {
    const { error } = await supabase
      .from("cutting_entries")
      .update({ status: "Approved", reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() })
      .eq("id", entry.id);
    if (error) alert(`Couldn't update:\n${error.message}`);
    load();
  };

  const removeLog = async (row) => {
    if (!window.confirm(`Remove the stitching logged on ${row.log_date}? The totals are recalculated.`)) return;
    const { data, error } = await supabase.rpc("delete_stitch_log", { p_id: row.id });
    if (error || data?.ok === false) alert(`Couldn't remove:\n${error?.message || data?.error}`);
    load();
  };

  const removeEntry = async (entry) => {
    const msg = entry.status === "Rejected"
      ? "Delete this rejected cutting entry?"
      : "Delete this cutting entry? The fabric deducted for it goes back into inventory.";
    if (!window.confirm(msg)) return;
    const { data, error } = await supabase.rpc("delete_cutting_entry", { p_id: entry.id });
    if (error || data?.ok === false) alert(`Couldn't delete:\n${error?.message || data?.error}`);
    load();
  };

  const pendingEntries = entries.filter((e) => e.status === "Submitted");
  const approvedEntries = entries.filter((e) => e.status === "Approved");
  const rejectedEntries = entries.filter((e) => e.status === "Rejected");
  const shownEntries = view === "pending" ? pendingEntries : view === "approved" ? approvedEntries : rejectedEntries;
  const EMPTY = { pending: "Nothing waiting for review.", approved: "No approved cutting entries yet.", rejected: "No rejected cutting entries." };

  return (
    <div className="space-y-4">
      <div className="subtab-bar">
        {[["pending", `Pending review (${pendingEntries.length})`], ["approved", `Approved (${approvedEntries.length})`], ["rejected", `Rejected (${rejectedEntries.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`subtab ${view === id ? "subtab-active" : ""}`}>{label}</button>
        ))}
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">{view === "pending" ? "Cutting — pending review" : view === "approved" ? "Approved cutting" : "Rejected cutting (sent back to the cutting master)"}</h2>
        {isCuttingMaster && (
          <Btn onClick={() => setModal({})}>
            <Scissors size={15} /> Log cutting count
          </Btn>
        )}
      </div>

      <div className="grid gap-3">
        {shownEntries.map((entry) => {
          const sizes = entry.sizes || {};
          const completed = entry.completed_sizes || {};
          const entryLogs = logs.filter((l) => l.cutting_entry_id === entry.id);
          const totalCut = Object.values(sizes).reduce((t, v) => t + (Number(v) || 0), 0);
          const totalDone = Object.values(completed).reduce((t, v) => t + (Number(v) || 0), 0);
          return (
            <Card key={entry.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{orderLabel(entry.order_id)}</div>
                  <div className="text-xs text-stone-500">{entry.item_description} · Cut on {entry.cut_date}{entry.submitted_by ? ` · by ${entry.submitted_by}` : ""}</div>
                  {(Number(entry.fabric_kg_used) > 0 || Number(entry.fabric_meters_used) > 0) && (
                    <div className="text-xs text-stone-400">
                      Fabric used: {fabricLabel(entry.fabric_id)} — {Number(entry.fabric_kg_used) || 0} kg{Number(entry.fabric_meters_used) > 0 ? ` / ${entry.fabric_meters_used} m` : ""}
                    </div>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[entry.status]}`}>{entry.status}</span>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mb-2">
                {Object.entries(sizes).map(([size, qty]) => {
                  const done = Number(completed[size]) || 0;
                  const match = entry.status === "Approved" && done > 0 ? done === Number(qty) : null;
                  return (
                    <div
                      key={size}
                      className={`rounded-lg border px-1.5 py-1.5 text-center text-xs ${
                        match === null ? "border-stone-200" : match ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
                      }`}
                    >
                      <div className="font-semibold text-stone-600">{sizeLabel(size)}</div>
                      <div className="font-mono">
                        {done}/{qty}
                      </div>
                      {match !== null && (
                        <div className="flex justify-center mt-0.5">
                          {match ? <CheckCircle2 size={10} className="text-emerald-600" /> : <AlertTriangle size={10} className="text-rose-600" />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {entry.status === "Approved" && (
                <div className="mb-2">
                  <button
                    onClick={() => setOpenHistory({ ...openHistory, [entry.id]: !openHistory[entry.id] })}
                    className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1"
                  >
                    <History size={12} /> Stitching history ({entryLogs.length}) · {totalDone}/{totalCut} stitched
                  </button>
                  {openHistory[entry.id] && (
                    <div className="mt-2 border border-stone-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr>
                            <th className="text-left px-3 py-1.5">Date</th>
                            <th className="text-left px-3 py-1.5">Stitched that day</th>
                            <th className="text-right px-3 py-1.5">Pieces</th>
                            <th className="text-left px-3 py-1.5">Logged by</th>
                            {canApprove && <th className="px-3 py-1.5"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {entryLogs.map((row) => (
                            <tr key={row.id}>
                              <td className="px-3 py-1.5 whitespace-nowrap">{row.log_date}</td>
                              <td className="px-3 py-1.5">
                                {Object.entries(row.sizes || {}).map(([k, v]) => `${sizeLabel(k)}: ${v}`).join(", ")}
                                {row.note ? <div className="text-[11px] text-stone-400">{row.note}</div> : null}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">{Object.values(row.sizes || {}).reduce((t, v) => t + (Number(v) || 0), 0)}</td>
                              <td className="px-3 py-1.5 text-stone-500">{row.logged_by || "—"}</td>
                              {canApprove && (
                                <td className="px-3 py-1.5 text-right">
                                  <button onClick={() => removeLog(row)} className="text-stone-400 hover:text-rose-700" title="Remove this day's entry"><Trash2 size={12} /></button>
                                </td>
                              )}
                            </tr>
                          ))}
                          {entryLogs.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-center text-stone-400">Nothing logged yet — use “Add stitching done”.</td></tr>}
                          {entryLogs.length > 0 && (
                            <tr className="font-semibold bg-stone-50">
                              <td className="px-3 py-1.5" colSpan={2}>Total so far</td>
                              <td className="px-3 py-1.5 text-right font-mono">{totalDone}</td>
                              <td className="px-3 py-1.5 text-stone-500" colSpan={canApprove ? 2 : 1}>of {totalCut} cut · {Math.max(0, totalCut - totalDone)} remaining</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {entry.status === "Rejected" && (
                <div className="mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  Rejected{entry.reviewed_by ? ` by ${entry.reviewed_by}` : ""}: {entry.reject_reason || "no reason given"}
                  {entry.resend_count > 0 ? ` · resent ${entry.resend_count}×` : ""}
                </div>
              )}
              {entry.status === "Submitted" && entry.resend_count > 0 && (
                <div className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Resent by the cutting master (resend #{entry.resend_count}). Earlier rejection: {entry.reject_reason || "—"}
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {entry.status === "Submitted" && canApprove && (
                  <>
                    <Btn variant="ghost" onClick={() => setRejectEntry(entry)}>
                      <X size={13} /> Reject & send back
                    </Btn>
                    <Btn onClick={() => approve(entry)}>
                      <Check size={13} /> Approve
                    </Btn>
                  </>
                )}
                {entry.status === "Approved" && canApprove && (
                  <>
                    <Btn variant="ghost" onClick={() => setCompleteEntry(entry)}>
                      Add stitching done
                    </Btn>
                    <Btn variant="ghost" onClick={() => setRejectEntry(entry)}>
                      <X size={13} /> Reject & send back
                    </Btn>
                  </>
                )}
                {entry.status === "Rejected" && canResend && (
                  <Btn onClick={() => setResendEntry(entry)}>
                    <Send size={13} /> Edit & resend
                  </Btn>
                )}
                {canDelete(entry) && (
                  <Btn variant="ghost" onClick={() => removeEntry(entry)}>
                    <Trash2 size={13} /> Delete
                  </Btn>
                )}
              </div>
            </Card>
          );
        })}
        {shownEntries.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">{EMPTY[view]}</Card>}
      </div>

      {modal && <CuttingModal orders={orders} fabrics={fabrics} profile={profile} onClose={() => setModal(null)} onSaved={load} />}
      {resendEntry && <CuttingModal orders={orders} fabrics={fabrics} profile={profile} entry={resendEntry} onClose={() => setResendEntry(null)} onSaved={() => { load(); setView("pending"); }} />}
      {rejectEntry && <RejectModal entry={rejectEntry} orderLabel={orderLabel(rejectEntry.order_id)} onClose={() => setRejectEntry(null)} onSaved={load} />}
      {completeEntry && <CompleteSizesModal entry={completeEntry} onClose={() => setCompleteEntry(null)} onSaved={load} />}
    </div>
  );
}

function CuttingModal({ orders, fabrics, profile, entry, onClose, onSaved }) {
  const resend = !!entry; // editing a rejected entry to send it back for approval
  const [orderId, setOrderId] = useState(entry?.order_id || "");
  const [itemDesc, setItemDesc] = useState(entry?.item_description || "");
  const [cutDate, setCutDate] = useState(entry?.cut_date || todayStr());
  const [sizes, setSizes] = useState(entry?.sizes || {});
  const [groupKey, setGroupKey] = useState("letter");
  const [fabricId, setFabricId] = useState(entry?.fabric_id || "");
  const [kg, setKg] = useState(entry?.fabric_kg_used ? String(entry.fabric_kg_used) : "");
  const [meters, setMeters] = useState(entry?.fabric_meters_used ? String(entry.fabric_meters_used) : "");
  const [saving, setSaving] = useState(false);
  const fabric = fabrics.find((f) => f.id === fabricId);
  const group = SIZE_GROUPS.find((g) => g.key === groupKey);

  const order = orders.find((o) => o.id === orderId);
  const items = order?.items || [];

  const save = async (e) => {
    e.preventDefault();
    if (!orderId || !itemDesc) return;
    setSaving(true);
    const cleanSizes = Object.fromEntries(Object.entries(sizes).filter(([, v]) => v !== "" && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    if (Object.keys(cleanSizes).length === 0) {
      setSaving(false);
      return alert("Enter the cut quantity for at least one size.");
    }
    if (!fabricId) {
      setSaving(false);
      return alert("Select the fabric used from inventory first.");
    }
    if (!(Number(kg) > 0) && !(Number(meters) > 0)) {
      setSaving(false);
      return alert("Enter how much fabric was used (kg or meters).");
    }
    if (resend) {
      const { data, error: rerr } = await supabase.rpc("resubmit_cutting", {
        p_id: entry.id, p_cut_date: cutDate, p_sizes: cleanSizes, p_fabric_id: fabricId, p_kg: Number(kg) || 0, p_meters: Number(meters) || 0,
      });
      setSaving(false);
      if (rerr || data?.ok === false) return alert(`Couldn't resend:\n${rerr?.message || data?.error}`);
      onSaved();
      onClose();
      return;
    }
    // Saves the cutting entry AND deducts the fabric from inventory in one step.
    const { error } = await supabase.rpc("submit_cutting", {
      p_order_id: orderId,
      p_item: itemDesc,
      p_cut_date: cutDate,
      p_sizes: cleanSizes,
      p_fabric_id: fabricId,
      p_kg: Number(kg) || 0,
      p_meters: Number(meters) || 0,
      p_submitted_by: profile?.name || null,
    });
    setSaving(false);
    if (error) {
      alert(`Couldn't save:\n${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal title={resend ? "Correct and resend cutting" : "Log cutting count"} onClose={onClose}>
      {resend && entry.reject_reason && (
        <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">Rejected: {entry.reject_reason}</div>
      )}
      <form onSubmit={save}>
        <Field label="Order">
          <select required disabled={resend} className={inputCls} value={orderId} onChange={(e) => { setOrderId(e.target.value); setItemDesc(""); }}>
            <option value="">— select order —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Item">
          <select required className={inputCls} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} disabled={!orderId || resend}>
            <option value="">— select item —</option>
            {items.map((it) => (
              <option key={it.description} value={it.description}>{it.description}</option>
            ))}
          </select>
        </Field>
        <Field label="Cutting date">
          <input type="date" className={inputCls} value={cutDate} onChange={(e) => setCutDate(e.target.value)} />
        </Field>
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Fabric used (deducted from inventory)</span>
          <Field label="Fabric">
            <select required className={inputCls} value={fabricId} onChange={(e) => setFabricId(e.target.value)}>
              <option value="">— select fabric from inventory —</option>
              {fabrics.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fabric_type}{f.color ? ` · ${f.color}` : ""}{f.weight_gsm ? ` · ${f.weight_gsm} GSM` : ""} — {f.stock_kg ?? 0} kg / {f.stock_meters ?? 0} m available
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Used (kg)">
              <input type="number" min="0" step="any" className={inputCls} value={kg} onChange={(e) => setKg(e.target.value)} />
            </Field>
            <Field label="Used (meters)">
              <input type="number" min="0" step="any" className={inputCls} value={meters} onChange={(e) => setMeters(e.target.value)} />
            </Field>
          </div>
          {fabric && (
            <p className="text-[11px] text-stone-500">
              After this: {Math.max(0, (Number(fabric.stock_kg) || 0) - (Number(kg) || 0)).toFixed(2)} kg /{" "}
              {Math.max(0, (Number(fabric.stock_meters) || 0) - (Number(meters) || 0)).toFixed(2)} m left
            </p>
          )}
          {fabrics.length === 0 && <p className="text-[11px] text-rose-600">No fabric in inventory yet — add it under Inventory → Fabric first.</p>}
        </div>

        <Field label="Garment / size range">
          <select className={inputCls} value={groupKey} onChange={(e) => setGroupKey(e.target.value)}>
            {SIZE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
        </Field>
        <span className="block text-xs font-medium text-stone-600 mb-1">Cut quantity per size</span>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-1">
          {group.sizes.map((sz) => {
            const key = group.prefix ? `${group.prefix}-${sz}` : sz;
            return (
              <div key={key}>
                <span className="block text-[11px] text-stone-500 mb-0.5">{sz}</span>
                <input
                  type="number"
                  min="0"
                  className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
                  value={sizes[key] ?? ""}
                  onChange={(e) => setSizes({ ...sizes, [key]: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-stone-400 mb-3">
          Total entered: {Object.values(sizes).reduce((t, v) => t + (Number(v) || 0), 0)} pcs. Switching the size range keeps what you've already typed.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : resend ? "Resend for approval" : "Submit for approval"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function RejectModal({ entry, orderLabel, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("reject_cutting", { p_id: entry.id, p_reason: reason });
    setSaving(false);
    if (error || data?.ok === false) return alert(`Couldn't reject:\n${error?.message || data?.error}`);
    onSaved();
    onClose();
  };
  return (
    <Modal title="Reject and send back to the cutting master" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">{orderLabel} — {entry.item_description}. The fabric used goes back into inventory; the cutting master can correct the entry and resend it.</p>
        <Field label="What needs to be fixed?">
          <textarea required autoFocus rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Size 24 count looks wrong, fabric used too high" />
        </Field>
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || !reason.trim()}>{saving ? "Sending…" : "Reject and send back"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function CompleteSizesModal({ entry, onClose, onSaved }) {
  const sizes = entry.sizes || {};
  const done = entry.completed_sizes || {};
  const [day, setDay] = useState(todayStr());
  const [today, setToday] = useState({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const sum = (o) => Object.values(o).reduce((t, v) => t + (Number(v) || 0), 0);

  const save = async (e) => {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(today).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    if (!Object.keys(clean).length) return alert("Enter the pieces stitched for at least one size.");
    setSaving(true);
    const { data, error } = await supabase.rpc("log_stitching", { p_entry: entry.id, p_date: day, p_sizes: clean, p_note: note || null });
    setSaving(false);
    if (error || data?.ok === false) return alert(`Couldn't save:\n${error?.message || data?.error}`);
    onSaved();
    onClose();
  };

  return (
    <Modal title="Add stitching done" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">
        Enter only the pieces stitched on the chosen day. They are added to the earlier days, so you can come back tomorrow and add more — the history keeps each day.
      </p>
      <form onSubmit={save}>
        <Field label="Date">
          <input type="date" required max={todayStr()} className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
          {Object.entries(sizes).map(([s, cutQty]) => {
            const so = Number(done[s]) || 0;
            const left = Math.max(0, Number(cutQty) - so);
            return (
              <div key={s}>
                <span className="block text-[11px] text-stone-500 mb-0.5">{sizeLabel(s)}</span>
                <input
                  type="number"
                  min="0"
                  max={left}
                  disabled={left === 0}
                  placeholder="0"
                  className="w-full border border-stone-300 rounded px-2 py-1 text-sm disabled:bg-stone-100"
                  value={today[s] ?? ""}
                  onChange={(e) => setToday({ ...today, [s]: e.target.value })}
                />
                <span className="block text-[10px] text-stone-400 mt-0.5">{so}/{cutQty} done · {left} left</span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-stone-500 mb-3">
          Adding {sum(today)} pcs · total after saving {sum(done) + sum(today)} of {sum(sizes)}.
        </p>
        <Field label="Note (optional)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. night shift" />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save for this day"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
