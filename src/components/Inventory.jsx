import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Wrench } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";

const MODELS = ["JUKI", "ZOJE", "JIN", "JACK", "KANSAI", "OTHER"];
const CONDITIONS = ["Working", "Needs service", "Under repair", "Not working"];
const ITEM_CATEGORIES = ["Thread", "Elastic", "Accessory", "Other"];
const COND_COLORS = {
  Working: "bg-emerald-100 text-emerald-800",
  "Needs service": "bg-amber-100 text-amber-800",
  "Under repair": "bg-orange-100 text-orange-800",
  "Not working": "bg-rose-100 text-rose-800",
};

// Spare-part / purchase tracking opens up when a machine is down
const NEEDS_PARTS = ["Under repair", "Not working"];

const SUBTABS = [
  { id: "machines", label: "Machines", table: "inventory_machines" },
  { id: "fabric", label: "Fabric", table: "inventory_fabric" },
  { id: "items", label: "Threads, Elastic & Accessories", table: "inventory_items" },
];

const fmt = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function Inventory({ profile }) {
  const canEdit = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const [sub, setSub] = useState("machines");
  const [rows, setRows] = useState({ machines: [], fabric: [], items: [] });
  const [usage, setUsage] = useState([]);
  const [parts, setParts] = useState([]);
  const [partsFor, setPartsFor] = useState(null);
  const [orderNames, setOrderNames] = useState({});
  const [modal, setModal] = useState(null); // { kind, row }

  const load = async () => {
    const [m, f, i] = await Promise.all(
      SUBTABS.map((t) => supabase.from(t.table).select("*").order("created_at", { ascending: false }))
    );
    const [{ data: u }, { data: sp }, { data: ord }] = await Promise.all([
      supabase.from("fabric_usage").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("inventory_spare_parts").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("id, order_number"),
    ]);
    setUsage(u || []);
    setParts(sp || []);
    setOrderNames(Object.fromEntries((ord || []).map((o) => [o.id, o.order_number])));
    const err = m.error || f.error || i.error;
    if (err) console.error("Inventory load failed:", err.message);
    setRows({ machines: m.data || [], fabric: f.data || [], items: i.data || [] });
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("inventory-changes");
    [...SUBTABS.map((t) => t.table), "fabric_usage", "inventory_spare_parts"].forEach((tbl) =>
      ch.on("postgres_changes", { event: "*", schema: "public", table: tbl }, load)
    );
    ch.subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const remove = async (tab, id) => {
    if (!window.confirm("Delete this entry?")) return;
    const { error } = await supabase.from(SUBTABS.find((t) => t.id === tab).table).delete().eq("id", id);
    if (error) alert(`Couldn't delete:\n${error.message}`);
    load();
  };

  const totalMachines = rows.machines.reduce((s, m) => s + (Number(m.quantity) || 0), 0);
  const totalKg = rows.fabric.reduce((s, f) => s + (Number(f.stock_kg) || 0), 0);
  const totalM = rows.fabric.reduce((s, f) => s + (Number(f.stock_meters) || 0), 0);

  const actions = (tab, row) =>
    canEdit && (
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={() => setModal({ kind: tab, row })} className="text-stone-400 hover:text-indigo-600 mr-2" title="Edit"><Pencil size={14} /></button>
        <button onClick={() => remove(tab, row.id)} className="text-stone-400 hover:text-rose-600" title="Delete"><Trash2 size={14} /></button>
      </td>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Inventory</h2>
        {canEdit && (
          <Btn onClick={() => setModal({ kind: sub, row: null })}>
            <Plus size={15} /> Add {sub === "machines" ? "machine" : sub === "fabric" ? "fabric" : "item"}
          </Btn>
        )}
      </div>

      <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${sub === t.id ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-stone-500 hover:text-stone-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "machines" && (
        <>
          <p className="text-xs text-stone-500">{totalMachines} machines across {rows.machines.length} entries</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2.5">Model</th>
                  <th className="text-left px-3 py-2.5">Type</th>
                  <th className="text-right px-3 py-2.5">Qty</th>
                  <th className="text-left px-3 py-2.5">Condition</th>
                  <th className="text-left px-3 py-2.5">Purchased</th>
                  <th className="text-left px-3 py-2.5">Last service</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.machines.map((m) => (
                  <tr key={m.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2 font-medium">{m.model === "OTHER" ? m.model_other || "Other" : m.model}</td>
                    <td className="px-3 py-2">{m.machine_type}</td>
                    <td className="px-3 py-2 text-right font-mono">{m.quantity}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COND_COLORS[m.working_condition] || "bg-stone-100"}`}>{m.working_condition}</span>
                      {NEEDS_PARTS.includes(m.working_condition) && (
                        <button onClick={() => setPartsFor(m)} className="ml-2 inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
                          <Wrench size={12} /> Spare parts ({parts.filter((p) => p.machine_id === m.id).length})
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">{fmt(m.purchase_date)}</td>
                    <td className="px-3 py-2">{fmt(m.last_service_date)}</td>
                    {actions("machines", m)}
                  </tr>
                ))}
                {rows.machines.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">No machines added yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {sub === "fabric" && (
        <>
          <p className="text-xs text-stone-500">Total available: {totalKg.toFixed(1)} kg · {totalM.toFixed(1)} m</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2.5">Fabric type</th>
                  <th className="text-left px-3 py-2.5">Color</th>
                  <th className="text-right px-3 py-2.5">Weight (GSM)</th>
                  <th className="text-right px-3 py-2.5">Available (kg)</th>
                  <th className="text-right px-3 py-2.5">Available (m)</th>
                  <th className="text-left px-3 py-2.5">Supplier</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.fabric.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2 font-medium">{f.fabric_type}</td>
                    <td className="px-3 py-2">{f.color || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.weight_gsm ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.stock_kg ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono">{f.stock_meters ?? 0}</td>
                    <td className="px-3 py-2">{f.supplier || "—"}</td>
                    {actions("fabric", f)}
                  </tr>
                ))}
                {rows.fabric.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">No fabric added yet.</td></tr>}
              </tbody>
            </table>
          </Card>
          <div>
            <h3 className="font-semibold text-sm mb-2">Fabric used in cutting</h3>
            <p className="text-xs text-stone-500 mb-2">Logged automatically when the Cutting Master submits cutting. Each entry has already been deducted from the available stock above.</p>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2.5">Date</th>
                    <th className="text-left px-3 py-2.5">Order</th>
                    <th className="text-left px-3 py-2.5">Fabric</th>
                    <th className="text-right px-3 py-2.5">kg</th>
                    <th className="text-right px-3 py-2.5">m</th>
                    <th className="text-left px-3 py-2.5">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {usage.map((u) => {
                    const fab = rows.fabric.find((x) => x.id === u.fabric_id);
                    return (
                      <tr key={u.id} className={u.restored ? "text-stone-400 line-through" : ""}>
                        <td className="px-3 py-2">{new Date(u.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                        <td className="px-3 py-2">{orderNames[u.order_id] || "—"}</td>
                        <td className="px-3 py-2">{fab ? `${fab.fabric_type}${fab.color ? ` · ${fab.color}` : ""}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{u.kg_used}</td>
                        <td className="px-3 py-2 text-right font-mono">{u.meters_used}</td>
                        <td className="px-3 py-2">{u.used_by || "—"}</td>
                      </tr>
                    );
                  })}
                  {usage.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400">No fabric used yet.</td></tr>}
                </tbody>
              </table>
            </Card>
            <p className="text-[11px] text-stone-400 mt-1">Struck-through rows were returned to stock because the cutting entry was rejected.</p>
          </div>
        </>
      )}

      {sub === "items" && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2.5">Category</th>
                <th className="text-left px-3 py-2.5">Item</th>
                <th className="text-right px-3 py-2.5">Quantity</th>
                <th className="text-left px-3 py-2.5">Unit</th>
                <th className="text-left px-3 py-2.5">Notes</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.items.map((i) => (
                <tr key={i.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2">{i.category}</td>
                  <td className="px-3 py-2 font-medium">{i.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{i.quantity}</td>
                  <td className="px-3 py-2">{i.unit}</td>
                  <td className="px-3 py-2 text-stone-500">{i.notes || "—"}</td>
                  {actions("items", i)}
                </tr>
              ))}
              {rows.items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No items added yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}

      {partsFor && <SparePartsModal machine={partsFor} parts={parts.filter((p) => p.machine_id === partsFor.id)} canEdit={canEdit} onClose={() => setPartsFor(null)} onSaved={load} />}
      {modal && <InventoryModal kind={modal.kind} row={modal.row} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}

function InventoryModal({ kind, row, onClose, onSaved }) {
  const table = SUBTABS.find((t) => t.id === kind).table;
  const defaults = {
    machines: { model: "JUKI", model_other: "", machine_type: "", quantity: 1, working_condition: "Working", purchase_date: "", last_service_date: "", notes: "" },
    fabric: { fabric_type: "", color: "", weight_gsm: "", stock_kg: "", stock_meters: "", supplier: "", notes: "" },
    items: { category: "Thread", name: "", quantity: "", unit: "pcs", notes: "" },
  }[kind];
  const [f, setF] = useState({ ...defaults, ...(row || {}) });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...f };
    delete payload.id;
    delete payload.created_at;
    // empty strings -> null for date/number/optional columns
    Object.keys(payload).forEach((k) => {
      if (payload[k] === "") payload[k] = null;
    });
    if (kind === "machines") {
      payload.quantity = Number(payload.quantity) || 0;
      if (payload.model !== "OTHER") payload.model_other = null;
    }
    if (kind === "fabric") {
      ["weight_gsm", "stock_kg", "stock_meters"].forEach((k) => {
        if (payload[k] !== null) payload[k] = Number(payload[k]);
      });
    }
    if (kind === "items") payload.quantity = Number(payload.quantity) || 0;

    const { error } = row
      ? await supabase.from(table).update(payload).eq("id", row.id)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (error) {
      alert(`Couldn't save:\n${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  const title = `${row ? "Edit" : "Add"} ${kind === "machines" ? "machine" : kind === "fabric" ? "fabric" : "item"}`;

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={save}>
        {kind === "machines" && (
          <>
            <Field label="Model">
              <select className={inputCls} value={f.model} onChange={set("model")}>
                {MODELS.map((m) => <option key={m} value={m}>{m === "OTHER" ? "Other" : m}</option>)}
              </select>
            </Field>
            {f.model === "OTHER" && (
              <Field label="Model name">
                <input required className={inputCls} value={f.model_other || ""} onChange={set("model_other")} />
              </Field>
            )}
            <Field label="Type">
              <input required className={inputCls} placeholder="e.g. Single needle lockstitch, Overlock, Flatlock" value={f.machine_type} onChange={set("machine_type")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input type="number" min="0" required className={inputCls} value={f.quantity} onChange={set("quantity")} />
              </Field>
              <Field label="Working condition">
                <select className={inputCls} value={f.working_condition} onChange={set("working_condition")}>
                  {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Date of purchase">
                <input type="date" className={inputCls} value={f.purchase_date || ""} onChange={set("purchase_date")} />
              </Field>
              <Field label="Recent service date">
                <input type="date" className={inputCls} value={f.last_service_date || ""} onChange={set("last_service_date")} />
              </Field>
            </div>
          </>
        )}

        {kind === "fabric" && (
          <>
            <Field label="Fabric type">
              <input required className={inputCls} placeholder="e.g. Single jersey, Cotton poplin" value={f.fabric_type} onChange={set("fabric_type")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Color">
                <input className={inputCls} value={f.color || ""} onChange={set("color")} />
              </Field>
              <Field label="Fabric weight (GSM)">
                <input type="number" min="0" step="any" className={inputCls} value={f.weight_gsm ?? ""} onChange={set("weight_gsm")} />
              </Field>
              <Field label="Stock (kg)">
                <input type="number" min="0" step="any" className={inputCls} value={f.stock_kg ?? ""} onChange={set("stock_kg")} />
              </Field>
              <Field label="Stock (meters)">
                <input type="number" min="0" step="any" className={inputCls} value={f.stock_meters ?? ""} onChange={set("stock_meters")} />
              </Field>
            </div>
            <Field label="Supplier">
              <input className={inputCls} value={f.supplier || ""} onChange={set("supplier")} />
            </Field>
          </>
        )}

        {kind === "items" && (
          <>
            <Field label="Category">
              <select className={inputCls} value={f.category} onChange={set("category")}>
                {ITEM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Item name">
              <input required className={inputCls} placeholder="e.g. Polyester thread 40s white, 20mm elastic" value={f.name} onChange={set("name")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input type="number" min="0" step="any" required className={inputCls} value={f.quantity} onChange={set("quantity")} />
              </Field>
              <Field label="Unit">
                <input className={inputCls} value={f.unit || ""} onChange={set("unit")} placeholder="pcs, cones, rolls, m" />
              </Field>
            </div>
          </>
        )}

        <Field label="Notes">
          <input className={inputCls} value={f.notes || ""} onChange={set("notes")} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function SparePartsModal({ machine, parts, canEdit, onClose, onSaved }) {
  const blank = { part_name: "", quantity: 1, status: "Needed", supplier: "", amount: "", purchase_date: "", notes: "" };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const name = machine.model === "OTHER" ? machine.model_other || "Other" : machine.model;

  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("inventory_spare_parts").insert({
      machine_id: machine.id,
      part_name: f.part_name,
      quantity: Number(f.quantity) || 1,
      status: f.status,
      supplier: f.supplier || null,
      amount: f.amount === "" ? null : Number(f.amount),
      purchase_date: f.purchase_date || null,
      notes: f.notes || null,
    });
    setSaving(false);
    if (error) return alert(`Couldn't save:\n${error.message}`);
    setF(blank);
    onSaved();
  };

  const setStatus = async (id, status) => {
    const patch = { status };
    if (status === "Purchased") patch.purchase_date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const { error } = await supabase.from("inventory_spare_parts").update(patch).eq("id", id);
    if (error) alert(error.message);
    onSaved();
  };

  const del = async (id) => {
    if (!window.confirm("Delete this spare part entry?")) return;
    await supabase.from("inventory_spare_parts").delete().eq("id", id);
    onSaved();
  };

  const total = parts.reduce((t, p) => t + (Number(p.amount) || 0), 0);

  return (
    <Modal title={`Spare parts — ${name} ${machine.machine_type} (${machine.working_condition})`} onClose={onClose}>
      <div className="space-y-1.5 mb-3 max-h-64 overflow-y-auto">
        {parts.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 bg-stone-50 rounded-lg px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">{p.part_name} <span className="text-stone-400 font-normal">× {p.quantity}</span></div>
              <div className="text-xs text-stone-500">
                {[p.supplier, p.amount != null ? `₹${p.amount}` : null, p.purchase_date ? fmt(p.purchase_date) : null].filter(Boolean).join(" · ") || "No purchase details yet"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canEdit ? (
                <select className="text-xs border border-stone-300 rounded px-1.5 py-1" value={p.status} onChange={(e) => setStatus(p.id, e.target.value)}>
                  {["Needed", "Ordered", "Purchased"].map((s) => <option key={s}>{s}</option>)}
                </select>
              ) : (
                <span className="text-xs">{p.status}</span>
              )}
              {canEdit && <button onClick={() => del(p.id)} className="text-stone-400 hover:text-rose-600"><Trash2 size={13} /></button>}
            </div>
          </div>
        ))}
        {parts.length === 0 && <p className="text-xs text-stone-400 py-3 text-center">No spare parts recorded for this machine.</p>}
      </div>
      {parts.length > 0 && <p className="text-xs text-stone-500 mb-3">Total spare-part cost: ₹{total.toLocaleString("en-IN")}</p>}

      {canEdit && (
        <form onSubmit={add} className="border-t border-stone-100 pt-3">
          <div className="text-xs font-semibold text-stone-600 uppercase mb-2">Add spare part / purchase</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Part name"><input required className={inputCls} value={f.part_name} onChange={set("part_name")} placeholder="e.g. Motor, Needle bar" /></Field>
            <Field label="Quantity"><input type="number" min="1" className={inputCls} value={f.quantity} onChange={set("quantity")} /></Field>
            <Field label="Status">
              <select className={inputCls} value={f.status} onChange={set("status")}>{["Needed", "Ordered", "Purchased"].map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="Supplier"><input className={inputCls} value={f.supplier} onChange={set("supplier")} /></Field>
            <Field label="Amount (₹)"><input type="number" min="0" className={inputCls} value={f.amount} onChange={set("amount")} /></Field>
            <Field label="Purchase date"><input type="date" className={inputCls} value={f.purchase_date} onChange={set("purchase_date")} /></Field>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Add part"}</Btn>
          </div>
        </form>
      )}
      {!canEdit && <div className="flex justify-end mt-2"><Btn variant="ghost" onClick={onClose}>Close</Btn></div>}
    </Modal>
  );
}
