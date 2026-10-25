import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, ShieldCheck, ClipboardCheck, Camera, Truck, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { LotCard } from "./DispatchLots";

// The checklist the Quality Manager answers for every order.
export const QC_CHECKS = [
  { key: "count_match", label: "Stitched count matches cut count", hint: "Filled automatically from Cutting and Order progress." },
  { key: "design", label: "Design matches approved sample", hint: "Pattern, style, pockets, trims, overall look." },
  { key: "colour", label: "Colour matches sample", hint: "Compare shade under good light; check for shade variation between pieces." },
  { key: "print", label: "Print / embroidery matches sample", hint: "T-shirt print: position, size, colour, sharpness, no cracking or peeling." },
  { key: "measurements", label: "Measurements match size chart", hint: "Measure a sample of pieces from each size." },
  { key: "stitching", label: "Stitch quality", hint: "Even stitches, no skipped / broken / loose stitches, seams strong and straight." },
  { key: "threads", label: "Thread trimming & cleanliness", hint: "No loose threads; no stains, oil marks or dirt." },
  { key: "fabric", label: "Fabric defects", hint: "No holes, snags, slubs, pilling or colour patches." },
  { key: "labels", label: "Labels & tags correct", hint: "Brand label, size label, care label, price tag as specified." },
  { key: "accessories", label: "Buttons / zips / elastic / collar", hint: "Attached firmly and working; correct colour and size." },
  { key: "pressing", label: "Ironing & finishing", hint: "Properly pressed and folded; no shine or burn marks." },
  { key: "packing", label: "Packing & carton labelling", hint: "Correct pieces per pack and per carton; cartons marked with order and size." },
];

const QC_COLORS = {
  "Not inspected": "bg-stone-100 text-stone-600",
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

export default function Quality({ profile }) {
  const canInspect = ["quality_manager", "qc", "pm", "admin", "hr"].includes(profile?.role);
  const role = profile?.role;
  const [orders, setOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [inspections, setInspections] = useState([]);
  const [filter, setFilter] = useState("Needs inspection");
  const [inspect, setInspect] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [rejectDispatch, setRejectDispatch] = useState(null);
  const [lots, setLots] = useState([]);
  const [lotDeliveries, setLotDeliveries] = useState([]);

  const load = async () => {
    const [{ data: ord }, { data: cuts }, { data: prog }, { data: ins }, { data: lt }, { data: ld }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status, items, quality_status, quality_approved_at, quality_approved_by, dispatch_status, dispatch_pm_by, dispatch_gm_by, dispatch_note").order("order_date", { ascending: false }),
      supabase.from("cutting_entries").select("order_id, sizes").eq("status", "Approved"),
      supabase.from("order_progress").select("order_id, quantity"),
      supabase.from("quality_inspections").select("*").order("created_at", { ascending: false }),
      supabase.from("dispatch_lots").select("*").order("requested_at", { ascending: false }),
      supabase.from("order_deliveries").select("lot_id, item_description, quantity").not("lot_id", "is", null),
    ]);
    setLots(lt || []);
    setLotDeliveries(ld || []);
    const c = {};
    (cuts || []).forEach((e) => {
      c[e.order_id] = c[e.order_id] || { cut: 0, stitched: 0 };
      Object.values(e.sizes || {}).forEach((q) => (c[e.order_id].cut += Number(q) || 0));
    });
    (prog || []).forEach((p) => {
      c[p.order_id] = c[p.order_id] || { cut: 0, stitched: 0 };
      c[p.order_id].stitched += Number(p.quantity) || 0;
    });
    setCounts(c);
    setOrders(ord || []);
    setInspections(ins || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("quality-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "quality_inspections" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_lots" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const inFlight = (o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status);
  const FILTERS = {
    "Needs inspection": (o) => o.quality_status !== "Approved" && inFlight(o),
    Rejected: (o) => o.quality_status === "Rejected",
    Approved: (o) => o.quality_status === "Approved",
    "Dispatch approval": (o) => inFlight(o) && o.quality_status === "Approved" && ["Pending PM", "Pending GM"].includes(o.dispatch_status),
    All: () => true,
  };
  const LOTS = "Partial dispatches";
  const openLots = lots.filter((l) => ["Pending QC", "Pending PM", "Pending GM"].includes(l.status));
  const shown = filter === LOTS ? [] : orders.filter(FILTERS[filter]);
  const countFor = (f) => (f === LOTS ? openLots.length : orders.filter(FILTERS[f]).length);
  const orderLabel = (id) => { const o = orders.find((x) => x.id === id); return o ? `${o.order_number} — ${o.customer_name}` : "Order"; };

  const approveDispatch = async (o) => {
    const { data, error } = await supabase.rpc("approve_dispatch", { p_order_id: o.id, p_decision: "Approved", p_note: null });
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Quality</h2>
        <p className="text-xs text-stone-500 mt-0.5">
          Every order must pass quality inspection, then dispatch approval by the <b>Production Manager</b> and the <b>General Manager</b>, before it can be marked <b>Shipped</b> or have deliveries logged. To send part of an order early, use <b>Partial dispatches</b>.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {["Needs inspection", "Rejected", "Approved", "Dispatch approval", "Partial dispatches", "All"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === f ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-600 border-stone-200"}`}>
            {f}{f !== "All" ? ` (${countFor(f)})` : ""}
          </button>
        ))}
      </div>

      {filter === LOTS && (
        <div className="space-y-3">
          <p className="text-xs text-stone-500">Part of an order can be dispatched before the whole order is finished. Each partial dispatch is checked by QC, then approved by the Production Manager and the General Manager. Showing lots still in approval first, then the rest.</p>
          {[...openLots, ...lots.filter((l) => !openLots.includes(l))].map((l) => (
            <LotCard key={l.id} lot={l} orderLabel={orderLabel(l.order_id)} deliveries={lotDeliveries} profile={profile} onChanged={load} />
          ))}
          {lots.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No partial dispatches yet. Request one from Orders → Deliveries on an order.</Card>}
        </div>
      )}
      <div className="grid gap-3">
        {shown.map((o) => {
          const c = counts[o.id] || { cut: 0, stitched: 0 };
          const hasCut = c.cut > 0;
          const equal = hasCut && c.cut === c.stitched;
          const mine = inspections.filter((i) => i.order_id === o.id);
          const last = mine[0];
          return (
            <Card key={o.id} className={`p-4 border-l-4 ${o.quality_status === "Approved" ? "border-l-emerald-500" : o.quality_status === "Rejected" ? "border-l-rose-500" : "border-l-stone-300"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{o.order_number} — {o.customer_name}</div>
                  <div className="text-xs text-stone-500">{(o.items || []).map((it) => `${it.description} × ${it.quantity}`).join(", ") || "No items"} · Production status: {o.status}</div>
                  <div className="text-xs mt-1">
                    <span className="text-stone-500">Cut {c.cut} · Stitched {c.stitched} </span>
                    {hasCut ? (
                      <span className={`inline-flex items-center gap-1 font-medium ${equal ? "text-emerald-700" : "text-rose-700"}`}>
                        {equal ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {equal ? "counts match" : "counts differ"}
                      </span>
                    ) : (
                      <span className="text-stone-400">(no approved cutting yet)</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QC_COLORS[o.quality_status]}`}>
                    {o.quality_status === "Approved" ? (o.dispatch_status === "Approved" || !inFlight(o) ? "Ready for shipping" : "QC approved · awaiting dispatch approval") : o.quality_status === "Rejected" ? "Quality rejected" : "Awaiting inspection"}
                  </span>
                  {o.quality_status === "Approved" && o.quality_approved_by && <span className="text-[11px] text-stone-400">Approved by {o.quality_approved_by}</span>}
                </div>
              </div>

              {last && last.decision === "Rejected" && o.quality_status === "Rejected" && (
                <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  Rejected{last.inspected_by_name ? ` by ${last.inspected_by_name}` : ""}: {last.notes}
                </div>
              )}

              {o.quality_status === "Approved" && inFlight(o) && (
                <div className="mt-3 border border-stone-200 rounded-lg px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-stone-700"><Truck size={13} /> Ready-for-dispatch approval</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className={o.dispatch_status === "Pending PM" ? "text-amber-700 font-medium" : "text-emerald-700"}>
                      {o.dispatch_status === "Pending PM" ? "1. Production Manager — pending" : `1. Production Manager — approved${o.dispatch_pm_by ? ` (${o.dispatch_pm_by})` : ""}`}
                    </span>
                    <span className={o.dispatch_status === "Pending GM" ? "text-amber-700 font-medium" : o.dispatch_status === "Approved" ? "text-emerald-700" : "text-stone-400"}>
                      {o.dispatch_status === "Approved" ? `2. General Manager — approved${o.dispatch_gm_by ? ` (${o.dispatch_gm_by})` : ""}` : o.dispatch_status === "Pending GM" ? "2. General Manager — pending" : "2. General Manager — waiting"}
                    </span>
                  </div>
                  {o.dispatch_status === "Rejected" && <div className="mt-1 text-rose-700">Dispatch was rejected: {o.dispatch_note}</div>}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {((o.dispatch_status === "Pending PM" && ["pm", "admin"].includes(role)) || (o.dispatch_status === "Pending GM" && ["gm", "admin"].includes(role))) && (
                      <>
                        <Btn onClick={() => approveDispatch(o)}><Truck size={13} /> Approve for dispatch</Btn>
                        <Btn variant="ghost" onClick={() => setRejectDispatch(o)}><X size={13} /> Reject</Btn>
                      </>
                    )}
                    {o.dispatch_status === "Approved" && <span className="text-emerald-700 font-medium">Approved — the order can now be marked Shipped in Orders.</span>}
                  </div>
                </div>
              )}
              {o.dispatch_status === "Rejected" && o.quality_status !== "Approved" && inFlight(o) && (
                <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">Dispatch rejected: {o.dispatch_note} — re-inspect to send it for dispatch approval again.</div>
              )}

              <div className="flex gap-2 mt-3 flex-wrap">
                {canInspect && (
                  <Btn onClick={() => setInspect(o)}>
                    <ClipboardCheck size={13} /> {o.quality_status === "Not inspected" ? "Start inspection" : "Re-inspect"}
                  </Btn>
                )}
                {mine.length > 0 && (
                  <Btn variant="ghost" onClick={() => setHistoryFor(o)}>
                    <ShieldCheck size={13} /> Inspection history ({mine.length})
                  </Btn>
                )}
              </div>
            </Card>
          );
        })}
        {filter !== LOTS && shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders in this list.</Card>}
      </div>

      {inspect && <InspectionModal order={inspect} counts={counts[inspect.id] || { cut: 0, stitched: 0 }} onClose={() => setInspect(null)} onSaved={load} />}
      {rejectDispatch && <RejectDispatchModal order={rejectDispatch} onClose={() => setRejectDispatch(null)} onSaved={load} />}
      {historyFor && <HistoryModal order={historyFor} rows={inspections.filter((i) => i.order_id === historyFor.id)} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function InspectionModal({ order, counts, onClose, onSaved }) {
  const hasCut = counts.cut > 0;
  const countsEqual = counts.cut === counts.stitched;
  const [answers, setAnswers] = useState(() => {
    const a = Object.fromEntries(QC_CHECKS.map((c) => [c.key, { result: "", note: "" }]));
    if (hasCut) a.count_match = { result: countsEqual ? "Pass" : "Fail", note: `Cut ${counts.cut} · Stitched ${counts.stitched}` };
    return a;
  });
  const [inspectedQty, setInspectedQty] = useState("");
  const [defectiveQty, setDefectiveQty] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  const setResult = (key, result) => {
    if (key === "count_match" && hasCut) return; // locked to the real numbers
    setAnswers({ ...answers, [key]: { ...answers[key], result } });
  };
  const setNote = (key, note) => setAnswers({ ...answers, [key]: { ...answers[key], note } });

  const failed = QC_CHECKS.filter((c) => answers[c.key].result === "Fail");
  const unanswered = QC_CHECKS.filter((c) => !answers[c.key].result);
  const canApprove = failed.length === 0 && unanswered.length === 0;
  const defectPct = Number(inspectedQty) > 0 ? ((Number(defectiveQty) || 0) / Number(inspectedQty)) * 100 : null;

  const submit = async (decision) => {
    if (decision === "Rejected" && !notes.trim()) return alert("Write the reason for rejecting in the remarks box.");
    if (decision === "Approved" && !canApprove) return;
    if (decision === "Rejected" && unanswered.length) return alert("Answer every check (Pass / Fail / N/A) before submitting.");
    setSaving(true);
    const photos = [];
    for (const f of files) {
      const path = `quality/${order.id}/${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("bills").upload(path, f);
      if (error) {
        setSaving(false);
        return alert(`Couldn't upload a photo:\n${error.message}`);
      }
      photos.push(path);
    }
    const checks = QC_CHECKS.map((c) => ({ key: c.key, label: c.label, result: answers[c.key].result, note: answers[c.key].note || "" }));
    const { data, error } = await supabase.rpc("submit_quality_inspection", {
      p_order_id: order.id,
      p_decision: decision,
      p_checks: checks,
      p_inspected: inspectedQty === "" ? null : Number(inspectedQty),
      p_defective: defectiveQty === "" ? null : Number(defectiveQty),
      p_notes: notes,
      p_photos: photos,
    });
    setSaving(false);
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onSaved();
    onClose();
  };

  const btn = (key, value, activeCls) => (
    <button
      type="button"
      onClick={() => setResult(key, value)}
      disabled={key === "count_match" && hasCut}
      className={`px-2.5 py-1 text-xs font-medium border rounded-full ${answers[key].result === value ? activeCls : "bg-white text-stone-500 border-stone-200 hover:border-stone-300"} disabled:cursor-not-allowed`}
    >
      {value === "NA" ? "N/A" : value}
    </button>
  );

  return (
    <Modal title={`Quality inspection — ${order.order_number}`} onClose={onClose}>
      <div className={`rounded-lg border px-3 py-2 mb-3 text-sm ${!hasCut ? "border-stone-200 bg-stone-50 text-stone-600" : countsEqual ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
        <div className="font-semibold flex items-center gap-1.5">
          {hasCut ? countsEqual ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} /> : null}
          Cut {counts.cut} pcs · Stitched {counts.stitched} pcs
        </div>
        <div className="text-xs">
          {!hasCut ? "No approved cutting entry for this order, so the count check is manual." : countsEqual ? "Counts match." : "Counts do not match — the order cannot be approved until they do."}
        </div>
      </div>

      <div className="space-y-2.5 mb-3">
        {QC_CHECKS.map((c) => (
          <div key={c.key} className="border border-stone-200 rounded-lg p-2.5">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-[11px] text-stone-400">{c.hint}</div>
              </div>
              <div className="flex gap-1">
                {btn(c.key, "Pass", "bg-emerald-100 text-emerald-800 border-emerald-300")}
                {btn(c.key, "Fail", "bg-rose-100 text-rose-800 border-rose-300")}
                {btn(c.key, "NA", "bg-stone-200 text-stone-700 border-stone-300")}
              </div>
            </div>
            {(answers[c.key].result === "Fail" || answers[c.key].note) && (
              <input
                className="mt-2 w-full border border-stone-300 rounded px-2 py-1 text-xs"
                placeholder={answers[c.key].result === "Fail" ? "What's wrong? (e.g. 12 pcs with shade difference)" : "Note"}
                value={answers[c.key].note}
                onChange={(e) => setNote(c.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pieces inspected (sample)"><input type="number" min="0" className={inputCls} value={inspectedQty} onChange={(e) => setInspectedQty(e.target.value)} /></Field>
        <Field label="Defective pieces found"><input type="number" min="0" className={inputCls} value={defectiveQty} onChange={(e) => setDefectiveQty(e.target.value)} /></Field>
      </div>
      {defectPct !== null && <p className="text-xs text-stone-500 -mt-2 mb-2">Defect rate: {defectPct.toFixed(1)}%</p>}

      <Field label="Photos (sample vs bulk, defects) — optional">
        <label className="flex items-center gap-2 text-xs text-stone-600 cursor-pointer">
          <Camera size={14} />
          <input type="file" accept="image/*" multiple className="text-xs" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        </label>
      </Field>
      <Field label="Remarks (required if rejecting)"><textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      {!canApprove && (
        <p className="text-xs text-amber-700 mb-2">
          {failed.length > 0 ? `${failed.length} check(s) failed — approval is blocked.` : `${unanswered.length} check(s) still need an answer.`}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-3 flex-wrap">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="ghost" onClick={() => submit("Rejected")} disabled={saving}>Reject order</Btn>
        <Btn onClick={() => submit("Approved")} disabled={saving || !canApprove}>{saving ? "Saving…" : "Approve — ready for shipping"}</Btn>
      </div>
    </Modal>
  );
}

function RejectDispatchModal({ order, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("approve_dispatch", { p_order_id: order.id, p_decision: "Rejected", p_note: note });
    setSaving(false);
    if (error || data?.ok === false) return alert(error?.message || data?.error);
    onSaved();
    onClose();
  };
  return (
    <Modal title={`Reject dispatch — ${order.order_number}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-sm text-stone-600 mb-3">The order goes back to quality for re-inspection, and comes back here for approval once it passes.</p>
        <Field label="Reason"><textarea required autoFocus rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || !note.trim()}>{saving ? "Saving…" : "Reject dispatch"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ order, rows, onClose }) {
  const [urls, setUrls] = useState({});
  const openPhoto = async (path) => {
    if (urls[path]) return window.open(urls[path], "_blank");
    const { data, error } = await supabase.storage.from("bills").createSignedUrl(path, 300);
    if (error) return alert(error.message);
    setUrls({ ...urls, [path]: data.signedUrl });
    window.open(data.signedUrl, "_blank");
  };
  return (
    <Modal title={`Inspection history — ${order.order_number}`} onClose={onClose}>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {rows.map((r) => {
          const fails = (r.checks || []).filter((c) => c.result === "Fail");
          return (
            <div key={r.id} className="border border-stone-200 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.decision === "Approved" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{r.decision}</span>
                <span className="text-xs text-stone-400">{r.inspected_by_name || "—"} · {new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
              </div>
              <div className="text-xs text-stone-500 mt-1">
                Cut {r.cut_total} · Stitched {r.stitched_total}
                {r.inspected_qty != null ? ` · Inspected ${r.inspected_qty}, defective ${r.defective_qty ?? 0}` : ""}
              </div>
              {fails.length > 0 && (
                <ul className="mt-1 text-xs text-rose-700 list-disc pl-4">
                  {fails.map((f) => <li key={f.key}>{f.label}{f.note ? ` — ${f.note}` : ""}</li>)}
                </ul>
              )}
              {r.notes && <div className="text-xs text-stone-600 mt-1">{r.notes}</div>}
              {(r.photos || []).length > 0 && (
                <div className="flex gap-2 flex-wrap mt-1">
                  {r.photos.map((p, i) => <button key={p} onClick={() => openPhoto(p)} className="text-xs text-indigo-700 hover:underline">Photo {i + 1}</button>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end mt-3"><Btn variant="ghost" onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}
