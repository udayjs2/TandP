import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
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
  const [modal, setModal] = useState(null); // { kind, row }

  const load = async () => {
    const [m, f, i] = await Promise.all(
      SUBTABS.map((t) => supabase.from(t.table).select("*").order("created_at", { ascending: false }))
    );
    const err = m.error || f.error || i.error;
    if (err) console.error("Inventory load failed:", err.message);
    setRows({ machines: m.data || [], fabric: f.data || [], items: i.data || [] });
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("inventory-changes");
    SUBTABS.forEach((t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t.table }, load));
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
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COND_COLORS[m.working_condition] || "bg-stone-100"}`}>{m.working_condition}</span></td>
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
          <p className="text-xs text-stone-500">Total stock: {totalKg.toFixed(1)} kg · {totalM.toFixed(1)} m</p>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2.5">Fabric type</th>
                  <th className="text-left px-3 py-2.5">Color</th>
                  <th className="text-right px-3 py-2.5">Weight (GSM)</th>
                  <th className="text-right px-3 py-2.5">Stock (kg)</th>
                  <th className="text-right px-3 py-2.5">Stock (m)</th>
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
