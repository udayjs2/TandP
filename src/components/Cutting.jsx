import { useEffect, useState } from "react";
import { Check, X, AlertTriangle, CheckCircle2, Scissors } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";

const LETTER_SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL"];
// T-shirt numeric sizes 20-44 and pant / nicker sizes 18-44 (even numbers, as sold)
const range = (a, b) => Array.from({ length: (b - a) / 2 + 1 }, (_, i) => String(a + i * 2));
export const TSHIRT_SIZES = range(20, 44);
export const PANT_SIZES = range(18, 44);
const SIZE_GROUPS = [
  { key: "letter", label: "Letter sizes", sizes: LETTER_SIZES },
  { key: "tshirt", label: "T-shirt sizes (20–44)", sizes: TSHIRT_SIZES },
  { key: "pant", label: "Pant / Nicker sizes (18–44)", sizes: PANT_SIZES },
];
// Numeric sizes can appear in both T-shirt and pant groups, so keys are prefixed in the form
// and stored as e.g. "T-24" / "P-24" to keep the two apart.
const SIZES = LETTER_SIZES;
const STATUS_COLORS = {
  Submitted: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

// "T-24" -> "T-shirt 24", "P-24" -> "Pant 24", letter sizes unchanged
export const sizeLabel = (k) => (k.startsWith("T-") ? `T ${k.slice(2)}` : k.startsWith("P-") ? `Pant ${k.slice(2)}` : k);

export default function Cutting({ profile }) {
  const isCuttingMaster = profile?.role === "cutting_master";
  const canApprove = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const [orders, setOrders] = useState([]);
  const [entries, setEntries] = useState([]);
  const [modal, setModal] = useState(null);
  const [reviewEntry, setReviewEntry] = useState(null);
  const [completeEntry, setCompleteEntry] = useState(null);

  const load = async () => {
    const [{ data: ord }, { data: ent }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, items").not("status", "in", "(Completed,Shipped)"),
      supabase.from("cutting_entries").select("*").order("cut_date", { ascending: false }),
    ]);
    setOrders(ord || []);
    setEntries(ent || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("cutting-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "cutting_entries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const orderLabel = (id) => {
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : "—";
  };

  const setStatus = async (entry, status) => {
    const { error } = await supabase
      .from("cutting_entries")
      .update({ status, reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() })
      .eq("id", entry.id);
    if (error) alert(`Couldn't update:\n${error.message}`);
    setReviewEntry(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Cutting</h2>
        {isCuttingMaster && (
          <Btn onClick={() => setModal({})}>
            <Scissors size={15} /> Log cutting count
          </Btn>
        )}
      </div>

      <div className="grid gap-3">
        {entries.map((entry) => {
          const sizes = entry.sizes || {};
          const completed = entry.completed_sizes || {};
          const sizeKeys = Object.keys(sizes).length ? Object.keys(sizes) : SIZES.filter((s) => sizes[s] != null);
          return (
            <Card key={entry.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{orderLabel(entry.order_id)}</div>
                  <div className="text-xs text-stone-500">{entry.item_description} · Cut on {entry.cut_date}{entry.submitted_by ? ` · by ${entry.submitted_by}` : ""}</div>
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

              <div className="flex gap-2 flex-wrap">
                {entry.status === "Submitted" && canApprove && (
                  <>
                    <Btn variant="ghost" onClick={() => setStatus(entry, "Rejected")}>
                      <X size={13} /> Reject
                    </Btn>
                    <Btn onClick={() => setStatus(entry, "Approved")}>
                      <Check size={13} /> Approve
                    </Btn>
                  </>
                )}
                {entry.status === "Approved" && canApprove && (
                  <Btn variant="ghost" onClick={() => setCompleteEntry(entry)}>
                    Log stitching completed
                  </Btn>
                )}
              </div>
            </Card>
          );
        })}
        {entries.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No cutting entries logged yet.</Card>}
      </div>

      {modal && <CuttingModal orders={orders} profile={profile} onClose={() => setModal(null)} onSaved={load} />}
      {completeEntry && <CompleteSizesModal entry={completeEntry} onClose={() => setCompleteEntry(null)} onSaved={load} />}
    </div>
  );
}

function CuttingModal({ orders, profile, onClose, onSaved }) {
  const [orderId, setOrderId] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [cutDate, setCutDate] = useState(todayStr());
  const [sizes, setSizes] = useState({});
  const [saving, setSaving] = useState(false);

  const order = orders.find((o) => o.id === orderId);
  const items = order?.items || [];

  const save = async (e) => {
    e.preventDefault();
    if (!orderId || !itemDesc) return;
    setSaving(true);
    const cleanSizes = Object.fromEntries(Object.entries(sizes).filter(([, v]) => v !== "" && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const { error } = await supabase.from("cutting_entries").insert({
      order_id: orderId,
      item_description: itemDesc,
      cut_date: cutDate,
      sizes: cleanSizes,
      submitted_by: profile?.name || null,
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
    <Modal title="Log cutting count" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Order">
          <select required className={inputCls} value={orderId} onChange={(e) => { setOrderId(e.target.value); setItemDesc(""); }}>
            <option value="">— select order —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Item">
          <select required className={inputCls} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} disabled={!orderId}>
            <option value="">— select item —</option>
            {items.map((it) => (
              <option key={it.description} value={it.description}>{it.description}</option>
            ))}
          </select>
        </Field>
        <Field label="Cutting date">
          <input type="date" className={inputCls} value={cutDate} onChange={(e) => setCutDate(e.target.value)} />
        </Field>
        <span className="block text-xs font-medium text-stone-600 mb-1">Cut quantity per size</span>
        {SIZE_GROUPS.map((g) => (
          <div key={g.key} className="mb-3">
            <span className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wide mb-1">{g.label}</span>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
              {g.sizes.map((sz) => {
                const key = g.key === "letter" ? sz : `${g.key === "tshirt" ? "T" : "P"}-${sz}`;
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
          </div>
        ))}
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Submit for approval"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function CompleteSizesModal({ entry, onClose, onSaved }) {
  const sizes = entry.sizes || {};
  const [completed, setCompleted] = useState(
    Object.fromEntries(Object.keys(sizes).map((s) => [s, entry.completed_sizes?.[s] ?? ""]))
  );
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const cleanCompleted = Object.fromEntries(Object.entries(completed).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v) || 0]));
    const { error } = await supabase.from("cutting_entries").update({ completed_sizes: cleanCompleted }).eq("id", entry.id);
    setSaving(false);
    if (error) {
      alert(`Couldn't save:\n${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal title="Log stitching completed (per size)" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">Shown green when it matches the cut count for that size, red when it doesn't.</p>
      <form onSubmit={save}>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {Object.entries(sizes).map(([s, cutQty]) => (
            <div key={s}>
              <span className="block text-[11px] text-stone-500 mb-0.5">{sizeLabel(s)} (cut {cutQty})</span>
              <input
                type="number"
                min="0"
                className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
                value={completed[s]}
                onChange={(e) => setCompleted({ ...completed, [s]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
