import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { registerGarmentNames, LETTER_ORDER, lettersBetween, numbersBetween, KID_SIZES } from "../lib/garments";

const CATEGORIES = ["Dress types", "Medical & hospital", "Aprons & laboratory", "Industrial & safety", "Professional uniforms"];
const GENDERS = ["", "Men's", "Women's", "Unisex", "Children's"];
const splitList = (t) => [...new Set(String(t || "").split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];
const autoPrefix = (name) => String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

// Garment Design & Size Master: every garment type with its models and size range, the common size chart
// and the suggested size systems. Admin, HR, GM and PM can edit; everyone else reads.
export default function GarmentMaster({ profile }) {
  const canEdit = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const [tab, setTab] = useState("garments");
  const [rows, setRows] = useState([]);
  const [chart, setChart] = useState([]);
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState({});
  const [modal, setModal] = useState(null); // garment row or {} for new
  const [chartModal, setChartModal] = useState(null);
  const [sysModal, setSysModal] = useState(null);

  const load = async () => {
    const [{ data: g }, { data: c }, { data: s }] = await Promise.all([
      supabase.from("garment_types").select("*").order("sort_no").order("name"),
      supabase.from("size_chart_ref").select("*").order("sort_no"),
      supabase.from("size_systems").select("*").order("sort_no"),
    ]);
    setRows(g || []);
    setChart(c || []);
    setSystems(s || []);
    registerGarmentNames(g);
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("garment-master").on("postgres_changes", { event: "*", schema: "public", table: "garment_types" }, load).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const categories = useMemo(() => [...new Set([...CATEGORIES, ...rows.map((r) => r.category)])], [rows]);
  const shown = rows.filter((r) => {
    if (!showInactive && !r.active) return false;
    if (cat && r.category !== cat) return false;
    if (q) {
      const s = `${r.name} ${r.category} ${(r.models || []).join(" ")} ${r.sku || ""}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const remove = async (g) => {
    if (!window.confirm(`Delete "${g.name}" from the master? Orders and cutting entries already made keep their sizes. (Use Edit → Active off to just hide it.)`)) return;
    const { error } = await supabase.from("garment_types").delete().eq("id", g.id);
    if (error) alert(error.message);
    load();
  };
  const toggleActive = async (g) => {
    const { error } = await supabase.from("garment_types").update({ active: !g.active, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) alert(error.message);
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Garment Design &amp; Size Master</h2>
        <p className="text-xs text-stone-500 mt-0.5">
          Garment types, their models and size ranges. Pick the garment on each order item and the cutting size chart shows only the garments in that order.
          {!canEdit && " You can view the master; the Admin, General Manager and Production Manager edit it."}
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {[["garments", `Garments (${rows.length})`], ["chart", "Common size chart"], ["systems", "Size systems"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-full text-sm border ${tab === id ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"}`}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center text-stone-500 text-sm"><Loader2 className="animate-spin mr-2" size={16} /> Loading…</div>
      ) : tab === "garments" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className={inputCls + " flex-1 min-w-[180px]"} placeholder="Search garment, model or code…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={inputCls + " w-auto"} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="text-xs text-stone-500 flex items-center gap-1"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show hidden</label>
            {canEdit && <Btn onClick={() => setModal({})}><Plus size={15} /> Add garment</Btn>}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>
                  <th className="w-8" /><th className="text-left px-3 py-2.5">No.</th><th className="text-left px-3 py-2.5">Garment</th>
                  <th className="text-left px-3 py-2.5">Models</th><th className="text-left px-3 py-2.5">Starting size</th><th className="text-left px-3 py-2.5">Ending size</th>
                  <th className="text-right px-3 py-2.5">Sizes</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-400">No garments match.</td></tr>}
                {shown.map((g, i) => {
                  const isOpen = !!open[g.id];
                  return (
                    <Fragment key={g.id}>
                      <tr className={`cursor-pointer hover:bg-stone-50 ${g.active ? "" : "opacity-50"}`} onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}>
                        <td className="pl-3 text-stone-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="px-3 py-2 text-stone-400">{i + 1}</td>
                        <td className="px-3 py-2"><div className="font-medium">{g.name}{!g.active && <span className="ml-2 text-[10px] text-stone-400">(hidden)</span>}</div><div className="text-[11px] text-stone-400">{g.category}</div></td>
                        <td className="px-3 py-2 text-stone-600 max-w-[260px]">{(g.models || []).join(", ") || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{g.start_size || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{g.end_size || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{(g.sizes || []).length}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          {canEdit && (
                            <>
                              <button className="text-stone-400 hover:text-indigo-700 p-1" title="Edit" onClick={() => setModal(g)}><Pencil size={14} /></button>
                              <button className="text-stone-400 hover:text-rose-700 p-1" title="Delete" onClick={() => remove(g)}><Trash2 size={14} /></button>
                            </>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-stone-50">
                          <td />
                          <td colSpan={7} className="px-3 py-3 text-xs text-stone-600 space-y-2">
                            <div className="flex flex-wrap gap-1.5">{(g.sizes || []).map((s) => <span key={s} className="bg-white border border-stone-200 rounded px-1.5 py-0.5">{s}</span>)}</div>
                            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
                              <span>Size code: <b className="font-mono">{g.size_prefix}</b> (cutting counts are saved as {g.size_prefix}-size)</span>
                              {g.gender && <span>For: {g.gender}</span>}
                              {g.typical_length && <span>Typical length: {g.typical_length}</span>}
                              {g.sleeve_type && <span>Sleeve: {g.sleeve_type}</span>}
                              {g.collar_type && <span>Collar: {g.collar_type}</span>}
                              {g.pocket_config && <span>Pockets: {g.pocket_config}</span>}
                              {g.fabric_type && <span>Fabric: {g.fabric_type}</span>}
                              {g.colour && <span>Colour: {g.colour}</span>}
                              {g.measurements && <span>Measurements: {g.measurements}</span>}
                              {g.sku && <span>Item code / SKU: {g.sku}</span>}
                              {g.purchase_price != null && <span>Purchase price: ₹{g.purchase_price}</span>}
                              {g.selling_price != null && <span>Selling price: ₹{g.selling_price}</span>}
                            </div>
                            {g.compliance_note && <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{g.compliance_note}</div>}
                            {canEdit && <button className="text-indigo-700 underline" onClick={() => toggleActive(g)}>{g.active ? "Hide from order and cutting lists" : "Show in lists again"}</button>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="text-[11px] text-stone-400">These are suggested catalogue ranges, not fixed standards. Confirm body measurements, garment ease and finished measurements before manufacturing.</p>
        </>
      ) : tab === "chart" ? (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-stone-500">Approximate adult sizes; actual measurements vary by garment type and brand.</p>
            {canEdit && <Btn onClick={() => setChartModal({})}><Plus size={15} /> Add size</Btn>}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase"><tr><th className="text-left px-3 py-2.5">Letter size</th><th className="text-left px-3 py-2.5">Chest (inches)</th><th className="text-left px-3 py-2.5">Waist (inches)</th><th /></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {chart.map((c) => (
                  <tr key={c.letter_size}>
                    <td className="px-3 py-2 font-medium">{c.letter_size}</td><td className="px-3 py-2">{c.chest || "—"}</td><td className="px-3 py-2">{c.waist || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button className="text-stone-400 hover:text-indigo-700 p-1" onClick={() => setChartModal(c)}><Pencil size={14} /></button>
                          <button className="text-stone-400 hover:text-rose-700 p-1" onClick={async () => { if (window.confirm(`Remove ${c.letter_size} from the chart?`)) { await supabase.from("size_chart_ref").delete().eq("letter_size", c.letter_size); load(); } }}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-stone-500">Suggested master size system — use a separate size system for each type of garment.</p>
            {canEdit && <Btn onClick={() => setSysModal({})}><Plus size={15} /> Add size system</Btn>}
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase"><tr><th className="text-left px-3 py-2.5">Size category</th><th className="text-left px-3 py-2.5">Starting size</th><th className="text-left px-3 py-2.5">Ending size</th><th /></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {systems.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 font-medium">{s.name}</td><td className="px-3 py-2">{s.start_size || "—"}</td><td className="px-3 py-2">{s.end_size || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button className="text-stone-400 hover:text-indigo-700 p-1" onClick={() => setSysModal(s)}><Pencil size={14} /></button>
                          <button className="text-stone-400 hover:text-rose-700 p-1" onClick={async () => { if (window.confirm(`Remove "${s.name}"?`)) { await supabase.from("size_systems").delete().eq("id", s.id); load(); } }}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {modal && <GarmentModal garment={modal} all={rows} categories={categories} profile={profile} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {chartModal && (
        <SimpleModal title={chartModal.letter_size ? `Edit ${chartModal.letter_size}` : "Add a size to the chart"} onClose={() => setChartModal(null)}
          fields={[["letter_size", "Letter size", !!chartModal.letter_size], ["chest", "Chest (inches)"], ["waist", "Waist (inches)"]]} initial={chartModal}
          onSave={async (v) => {
            if (!v.letter_size?.trim()) return "Enter the size name.";
            const payload = { letter_size: v.letter_size.trim(), chest: v.chest || null, waist: v.waist || null, sort_no: chartModal.sort_no ?? (chart.length ? Math.max(...chart.map((c) => c.sort_no)) + 1 : 1) };
            const { error } = await supabase.from("size_chart_ref").upsert(payload);
            if (error) return error.message;
            setChartModal(null); load();
          }} />
      )}
      {sysModal && (
        <SimpleModal title={sysModal.id ? "Edit size system" : "Add a size system"} onClose={() => setSysModal(null)}
          fields={[["name", "Size category"], ["start_size", "Starting size"], ["end_size", "Ending size"]]} initial={sysModal}
          onSave={async (v) => {
            if (!v.name?.trim()) return "Enter the size category.";
            const payload = { name: v.name.trim(), start_size: v.start_size || null, end_size: v.end_size || null };
            const { error } = sysModal.id
              ? await supabase.from("size_systems").update(payload).eq("id", sysModal.id)
              : await supabase.from("size_systems").insert({ ...payload, sort_no: systems.length + 1 });
            if (error) return error.message;
            setSysModal(null); load();
          }} />
      )}
    </div>
  );
}

function SimpleModal({ title, fields, initial, onSave, onClose }) {
  const [v, setV] = useState(initial || {});
  const [err, setErr] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErr((await onSave(v)) || ""); }}>
        {fields.map(([k, label, locked]) => (
          <Field key={k} label={label}><input className={inputCls} disabled={!!locked} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
        ))}
        {err && <p className="text-xs text-rose-600 mb-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Save</Btn></div>
      </form>
    </Modal>
  );
}

function GarmentModal({ garment, all, categories, profile, onClose, onSaved }) {
  const isNew = !garment.id;
  const [f, setF] = useState({
    category: garment.category || "Dress types", name: garment.name || "", gender: garment.gender || "",
    size_prefix: garment.size_prefix || "", start_size: garment.start_size || "", end_size: garment.end_size || "",
    typical_length: garment.typical_length || "", sleeve_type: garment.sleeve_type || "", collar_type: garment.collar_type || "",
    pocket_config: garment.pocket_config || "", fabric_type: garment.fabric_type || "", colour: garment.colour || "",
    measurements: garment.measurements || "", compliance_note: garment.compliance_note || "", sku: garment.sku || "",
    purchase_price: garment.purchase_price ?? "", selling_price: garment.selling_price ?? "", active: garment.active ?? true,
  });
  const [modelsText, setModelsText] = useState((garment.models || []).join(", "));
  const [sizes, setSizes] = useState(garment.sizes || []);
  const [custom, setCustom] = useState("");
  const [nf, setNf] = useState({ from: "", to: "", step: "1" });
  const [lf, setLf] = useState({ from: "XS", to: "5XL" });
  const [more, setMore] = useState(!!(garment.typical_length || garment.sleeve_type || garment.sku || garment.compliance_note));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const addSizes = (list) => setSizes((cur) => [...cur, ...list.filter((x) => !cur.includes(x))]);
  const prefix = isNew ? (f.size_prefix || autoPrefix(f.name)) : f.size_prefix;

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    const name = f.name.trim();
    if (!name) return setErr("Enter the garment name.");
    if (!/^[A-Z0-9]{1,14}$/.test(prefix)) return setErr("The size code must be 1–14 capital letters or numbers.");
    if (all.some((g) => g.id !== garment.id && g.name.toLowerCase() === name.toLowerCase())) return setErr("A garment with this name already exists.");
    if (all.some((g) => g.id !== garment.id && g.size_prefix === prefix)) return setErr(`The size code ${prefix} is already used by another garment. Change it.`);
    if (sizes.length === 0) return setErr("Add at least one size (a range or custom names).");
    setSaving(true);
    const payload = {
      category: f.category.trim() || "Dress types", name, models: splitList(modelsText), gender: f.gender || null, size_prefix: prefix, sizes,
      start_size: f.start_size.trim() || sizes[0], end_size: f.end_size.trim() || sizes[sizes.length - 1],
      typical_length: f.typical_length || null, sleeve_type: f.sleeve_type || null, collar_type: f.collar_type || null, pocket_config: f.pocket_config || null,
      fabric_type: f.fabric_type || null, colour: f.colour || null, measurements: f.measurements || null, compliance_note: f.compliance_note || null, sku: f.sku || null,
      purchase_price: f.purchase_price === "" ? null : Number(f.purchase_price), selling_price: f.selling_price === "" ? null : Number(f.selling_price),
      active: !!f.active, updated_at: new Date().toISOString(),
    };
    const { error } = isNew
      ? await supabase.from("garment_types").insert({ ...payload, sort_no: all.length + 1, created_by: profile?.name || null })
      : await supabase.from("garment_types").update(payload).eq("id", garment.id);
    setSaving(false);
    if (error) return setErr(error.message);
    onSaved();
  };

  const num = "border border-stone-300 rounded px-2 py-1 text-sm w-20";
  return (
    <Modal title={isNew ? "Add a garment" : `Edit ${garment.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input list="gm-cats" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
            <datalist id="gm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Garment name"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Kurti" /></Field>
        </div>
        <Field label="Models (separate with commas)">
          <textarea rows={2} className={inputCls} value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="Straight, A-line, Anarkali" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="For">
            <select className={inputCls} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>{GENDERS.map((g) => <option key={g} value={g}>{g || "— not set —"}</option>)}</select>
          </Field>
          <Field label="Size code">
            <input className={inputCls + " font-mono"} disabled={!isNew} value={prefix} onChange={(e) => setF({ ...f, size_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            <span className="text-[10px] text-stone-400">{isNew ? "Cutting counts are saved as CODE-size. It cannot be changed later." : "Fixed, because cutting counts already use it."}</span>
          </Field>
        </div>

        <div className="rounded-lg border border-stone-200 p-3 mb-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Sizes ({sizes.length})</span>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
            {sizes.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-900 border border-indigo-200 rounded px-1.5 py-0.5 text-xs">
                {s}<button type="button" onClick={() => setSizes(sizes.filter((x) => x !== s))} className="text-indigo-400 hover:text-rose-600"><X size={11} /></button>
              </span>
            ))}
            {sizes.length === 0 && <span className="text-xs text-stone-400">No sizes yet — add a range or type your own size names below.</span>}
          </div>
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <span className="text-[11px] text-stone-500 w-full">Number range</span>
            <input type="number" placeholder="from" className={num} value={nf.from} onChange={(e) => setNf({ ...nf, from: e.target.value })} />
            <input type="number" placeholder="to" className={num} value={nf.to} onChange={(e) => setNf({ ...nf, to: e.target.value })} />
            <input type="number" placeholder="step" className={num} value={nf.step} onChange={(e) => setNf({ ...nf, step: e.target.value })} />
            <Btn variant="ghost" onClick={() => { const l = numbersBetween(nf.from, nf.to, nf.step); if (!l.length) return setErr("Check the number range (from, to and step)."); setErr(""); addSizes(l); }}>Add range</Btn>
          </div>
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <span className="text-[11px] text-stone-500 w-full">Letter sizes</span>
            <select className={inputCls + " w-24"} value={lf.from} onChange={(e) => setLf({ ...lf, from: e.target.value })}>{LETTER_ORDER.map((x) => <option key={x}>{x}</option>)}</select>
            <select className={inputCls + " w-24"} value={lf.to} onChange={(e) => setLf({ ...lf, to: e.target.value })}>{LETTER_ORDER.map((x) => <option key={x}>{x}</option>)}</select>
            <Btn variant="ghost" onClick={() => { const l = lettersBetween(lf.from, lf.to); if (!l.length) return setErr("Pick the letter sizes from smaller to larger."); setErr(""); addSizes(l); }}>Add letters</Btn>
            <Btn variant="ghost" onClick={() => addSizes(KID_SIZES)}>Add kids 0–3 M to 16 Y</Btn>
            <Btn variant="ghost" onClick={() => addSizes(["Free size"])}>Free size</Btn>
          </div>
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Custom size names, e.g. 4 Y, Free size, Custom (comma separated)" value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSizes(splitList(custom)); setCustom(""); } }} />
            <Btn variant="ghost" onClick={() => { addSizes(splitList(custom)); setCustom(""); }}>Add</Btn>
            {sizes.length > 0 && <Btn variant="ghost" onClick={() => setSizes([])}>Clear</Btn>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starting size (shown)"><input className={inputCls} value={f.start_size} onChange={(e) => setF({ ...f, start_size: e.target.value })} placeholder={sizes[0] || "first size"} /></Field>
          <Field label="Ending size (shown)"><input className={inputCls} value={f.end_size} onChange={(e) => setF({ ...f, end_size: e.target.value })} placeholder={sizes[sizes.length - 1] || "last size"} /></Field>
        </div>

        <button type="button" className="text-xs text-indigo-700 underline mb-2" onClick={() => setMore(!more)}>{more ? "Hide" : "Show"} more details (length, sleeve, collar, pockets, SKU, prices, notes)</button>
        {more && (
          <div className="grid grid-cols-2 gap-3 mb-2">
            {[["typical_length", "Typical length"], ["measurements", "Length / chest measurements"], ["sleeve_type", "Sleeve type"], ["collar_type", "Collar type"], ["pocket_config", "Pocket configuration"], ["fabric_type", "Fabric type"], ["colour", "Colour"], ["sku", "Item code / SKU"]].map(([k, label]) => (
              <Field key={k} label={label}><input className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
            <Field label="Purchase price (₹)"><input type="number" min="0" className={inputCls} value={f.purchase_price} onChange={(e) => setF({ ...f, purchase_price: e.target.value })} /></Field>
            <Field label="Selling price (₹)"><input type="number" min="0" className={inputCls} value={f.selling_price} onChange={(e) => setF({ ...f, selling_price: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Safety / compliance note"><textarea rows={2} className={inputCls} value={f.compliance_note} onChange={(e) => setF({ ...f, compliance_note: e.target.value })} /></Field></div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Show in order and cutting lists</label>
        {err && <p className="text-xs text-rose-600 mb-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save garment"}</Btn></div>
      </form>
    </Modal>
  );
}
