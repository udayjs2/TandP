import { useEffect, useMemo, useRef, useState } from "react";
import { Ruler, Upload, Camera, Download, Search, Plus, Pencil, Trash2, X, FileSpreadsheet, GraduationCap } from "lucide-react";
import { supabase } from "../supabaseClient";
import { fetchAll } from "../lib/fetchAll";
import { Card, StatCard, Field, inputCls, Btn } from "./ui";
import { readTableFromFile, autoMap, buildEntries, sizeCounts, sortSizes, normSize, normClass, cleanText, TEMPLATE_HEADERS } from "../lib/measurements";

// Reading photographed sheets uses the Anthropic API, which is paid. It stays hidden until you switch it on:
// set VITE_MEASUREMENT_SCAN=on (and ANTHROPIC_API_KEY) in Vercel and redeploy.
const SCAN_ENABLED = import.meta.env?.VITE_MEASUREMENT_SCAN === "on";
const MANAGE_ROLES = ["admin", "hr", "gm", "pm", "cutting_master", "sales_manager"];
const NATURAL = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const dupKey = (s) => `${cleanText(s.student_name ?? s.name).toLowerCase()}|${String(s.class_name ?? "").toLowerCase()}|${String(s.section ?? "").toLowerCase()}`;

function WideModal({ title, onClose, children, wide = "max-w-4xl" }) {
  return (
    <div className="fixed inset-0 bg-stone-900/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 sticky top-0 bg-white rounded-t-xl z-10">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function workbook() {
  const mod = await import("exceljs/dist/exceljs.min.js");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "T&P Textiles ERP";
  return wb;
}
const styleHeader = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; };

export default function Measurements({ profile }) {
  const canManage = MANAGE_ROLES.includes(profile?.role);
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [orderId, setOrderId] = useState("");
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("students");
  const [f, setF] = useState({ q: "", cls: "", sec: "", item: "", size: "" });
  const [limit, setLimit] = useState(100);
  const [modal, setModal] = useState(null); // student | import | scan | items
  const [err, setErr] = useState("");

  const loadBase = async () => {
    const [{ data: sc, error: e1 }, { data: it, error: e2 }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status, order_date").order("order_date", { ascending: false }),
      supabase.from("measurement_items").select("*").order("sort_no").order("name"),
    ]);
    if (e1 || e2) setErr(`${(e1 || e2).message} (run migration_56.sql and migration_57.sql if the tables are missing)`);
    setOrders(sc || []);
    setItems(it || []);
    return sc || [];
  };
  const loadSchool = async (id) => {
    if (!id) { setStudents([]); setRecords([]); return; }
    setLoading(true);
    try {
      const st = await fetchAll(() => supabase.from("measurement_students").select("*").eq("order_id", id).order("class_name").order("section").order("student_name"));
      const ids = new Set(st.map((s) => s.id));
      const rc = st.length ? (await fetchAll(() => supabase.from("measurement_records").select("*").order("id"))).filter((r) => ids.has(r.student_id)) : [];
      setStudents(st); setRecords(rc);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { loadBase().then((sc) => { if (sc.length && !orderId) setOrderId(sc[0].id); }); /* eslint-disable-next-line */ }, []);
  useEffect(() => { setF({ q: "", cls: "", sec: "", item: "", size: "" }); setLimit(100); loadSchool(orderId); /* eslint-disable-next-line */ }, [orderId]);
  const reload = () => loadSchool(orderId);

  const ord = orders.find((o) => o.id === orderId);
  // the order the measurements belong to (customer / school name)
  const school = ord ? { id: ord.id, name: `${ord.order_number} — ${ord.customer_name}` } : null;
  const recBy = useMemo(() => { const m = {}; records.forEach((r) => { (m[r.student_id] = m[r.student_id] || {})[r.item] = r; }); return m; }, [records]);
  const classes = useMemo(() => [...new Set(students.map((s) => s.class_name || ""))].filter(Boolean).sort(NATURAL), [students]);
  const sections = useMemo(() => [...new Set(students.filter((s) => !f.cls || s.class_name === f.cls).map((s) => s.section || ""))].filter(Boolean).sort(NATURAL), [students, f.cls]);

  // students shown: class / section / name, then (item + size)
  const base = students.filter((s) => (!f.cls || s.class_name === f.cls) && (!f.sec || s.section === f.sec)
    && (!f.q || `${s.student_name} ${s.roll_no || ""}`.toLowerCase().includes(f.q.toLowerCase())));
  const baseIds = new Set(base.map((s) => s.id));
  const counts = f.item ? sizeCounts(records, f.item, baseIds) : {};
  const shown = base.filter((s) => {
    if (!f.item || !f.size) return true;
    const r = recBy[s.id]?.[f.item];
    return f.size === "__none" ? !r?.size : r?.size === f.size;
  });
  const withAny = new Set(records.filter((r) => r.size).map((r) => r.student_id)).size;

  const answer = f.item && f.size
    ? (f.size === "__none" ? `${shown.length} student${shown.length === 1 ? " has" : "s have"} no ${f.item} size yet` : `${shown.length} student${shown.length === 1 ? " needs" : "s need"} ${f.item} size ${f.size}`)
    : null;

  const exportExcel = async () => {
    const wb = await workbook();
    const ws = wb.addWorksheet("Students");
    const headers = TEMPLATE_HEADERS(items);
    ws.addRow(headers); styleHeader(ws);
    shown.forEach((s) => ws.addRow([s.student_name, s.class_name || "", s.section || "", s.roll_no || "", ...items.flatMap((it) => { const r = recBy[s.id]?.[it.name]; return [r?.size || "", ...(it.fields || []).map((x) => r?.m?.[x] || "")]; })]));
    ws.columns.forEach((c) => (c.width = 14)); ws.getColumn(1).width = 28;
    const sm = wb.addWorksheet("Size count");
    sm.addRow(["Garment", "Size", "Students"]); styleHeader(sm);
    items.forEach((it) => { const c = sizeCounts(records, it.name, new Set(shown.map((s) => s.id))); sortSizes(Object.keys(c)).forEach((z) => sm.addRow([it.name, z, c[z]])); });
    sm.columns.forEach((c) => (c.width = 16));
    download(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${(school?.name || "order").replace(/[^\w]+/g, "_")}_measurements.xlsx`);
  };
  const downloadTemplate = async () => {
    const wb = await workbook();
    const ws = wb.addWorksheet("Students");
    ws.addRow(TEMPLATE_HEADERS(items)); styleHeader(ws); ws.columns.forEach((c) => (c.width = 15)); ws.getColumn(1).width = 28;
    download(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "measurement_template.xlsx");
  };

  const removeStudent = async (s) => {
    if (!window.confirm(`Delete ${s.student_name} and their measurements?`)) return;
    const { error } = await supabase.from("measurement_students").delete().eq("id", s.id);
    if (error) alert(`Couldn't delete:\n${error.message}`);
    reload();
  };
  return (
    <div className="space-y-4" data-testid="measurements">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Ruler size={20} className="text-indigo-700" /> Measurements</h1>
          <p className="text-xs text-stone-500">Choose the order (the school's uniform order), then record each student's garment sizes and measurements. Filter by class, section or size to plan the cutting.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={() => setModal({ kind: "items" })}>Garments &amp; measurements</Btn>
        </div>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}

      {orders.length === 0 ? (
        <Card className="p-8 text-center text-stone-500 text-sm">No orders yet. Create the order in Production Management → Orders first; it then appears here so you can add the students' measurements to it.</Card>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <GraduationCap size={16} className="text-stone-500" />
            <span className="text-sm text-stone-600">Order</span>
            <select className={`${inputCls} w-auto min-w-[18rem]`} value={orderId} onChange={(e) => setOrderId(e.target.value)} aria-label="Order">
              {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}{o.status ? ` (${o.status})` : ""}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Students" value={students.length} />
            <StatCard label="Classes" value={classes.length} />
            <StatCard label="With sizes" value={withAny} tone="good" />
            <StatCard label="Still to measure" value={Math.max(0, students.length - withAny)} tone={students.length - withAny > 0 ? "warn" : "good"} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Btn onClick={() => setModal({ kind: "student" })}><Plus size={15} /> Add student</Btn>
            <Btn variant="ghost" onClick={() => setModal({ kind: "import" })}><Upload size={14} /> Import Excel / CSV</Btn>
            {SCAN_ENABLED && <Btn variant="ghost" onClick={() => setModal({ kind: "scan" })}><Camera size={14} /> Scan paper sheets</Btn>}
            <Btn variant="ghost" onClick={exportExcel}><Download size={14} /> Export Excel</Btn>
            <Btn variant="ghost" onClick={downloadTemplate}><FileSpreadsheet size={14} /> Blank template</Btn>
          </div>

          <div className="subtab-bar">
            {[["students", "Students"], ["summary", "Size count"]].map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} className={`subtab ${tab === id ? "subtab-active" : ""}`}>{l}</button>
            ))}
          </div>

          {tab === "students" && (
            <>
              <Card className="p-3">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                  <label className="col-span-2 text-[11px] text-stone-500">Search
                    <div className="relative"><Search size={13} className="absolute left-2 top-2.5 text-stone-400" />
                      <input className={`${inputCls} pl-7`} placeholder="Student name or roll no" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search student" /></div>
                  </label>
                  <label className="text-[11px] text-stone-500">Class
                    <select className={inputCls} value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value, sec: "" })} aria-label="Class filter"><option value="">All</option>{classes.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <label className="text-[11px] text-stone-500">Section
                    <select className={inputCls} value={f.sec} onChange={(e) => setF({ ...f, sec: e.target.value })} aria-label="Section filter"><option value="">All</option>{sections.map((c) => <option key={c}>{c}</option>)}</select></label>
                  <label className="text-[11px] text-stone-500">Garment
                    <select className={inputCls} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value, size: "" })} aria-label="Garment filter"><option value="">Any</option>{items.map((it) => <option key={it.name}>{it.name}</option>)}</select></label>
                  <label className="text-[11px] text-stone-500">Size
                    <select className={inputCls} disabled={!f.item} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} aria-label="Size filter">
                      <option value="">All sizes</option>
                      {sortSizes(Object.keys(counts)).map((z) => <option key={z} value={z}>{z} ({counts[z]})</option>)}
                      {f.item && <option value="__none">No size recorded</option>}
                    </select></label>
                </div>
                {(f.q || f.cls || f.sec || f.item) && <button className="text-xs text-indigo-700 mt-2" onClick={() => setF({ q: "", cls: "", sec: "", item: "", size: "" })}>Clear filters</button>}
              </Card>
              {answer && <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-4 py-3 text-lg font-semibold" data-testid="size-answer">{answer}{f.cls ? ` in class ${f.cls}${f.sec ? `-${f.sec}` : ""}` : ""}</div>}
              <Card className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="students-table">
                  <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Student</th><th className="text-left px-3 py-2">Class</th><th className="text-left px-3 py-2">Sec</th>
                      {items.map((it) => <th key={it.name} className="text-left px-3 py-2 whitespace-nowrap">{it.name}</th>)}
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {shown.slice(0, limit).map((s) => (
                      <tr key={s.id} className="hover:bg-stone-50" data-student={s.student_name}>
                        <td className="px-3 py-1.5 font-medium">{s.student_name}{s.roll_no ? <span className="text-xs text-stone-400"> #{s.roll_no}</span> : null}</td>
                        <td className="px-3 py-1.5">{s.class_name || "—"}</td>
                        <td className="px-3 py-1.5">{s.section || "—"}</td>
                        {items.map((it) => {
                          const r = recBy[s.id]?.[it.name];
                          const detail = r ? (it.fields || []).filter((x) => r.m?.[x]).map((x) => `${x} ${r.m[x]}`).join(", ") : "";
                          return <td key={it.name} className="px-3 py-1.5 font-mono" title={detail}>{r?.size || <span className="text-stone-300">—</span>}</td>;
                        })}
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <button onClick={() => setModal({ kind: "student", student: s })} className="text-stone-400 hover:text-indigo-700 p-1" title="Edit"><Pencil size={13} /></button>
                          {canManage && <button onClick={() => removeStudent(s)} className="text-stone-400 hover:text-rose-700 p-1" title="Delete"><Trash2 size={13} /></button>}
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && <tr><td colSpan={4 + items.length} className="px-3 py-8 text-center text-stone-400">{loading ? "Loading…" : students.length === 0 ? "No students yet." : "No students match these filters."}</td></tr>}
                  </tbody>
                </table>
              </Card>
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span>Showing {Math.min(limit, shown.length)} of {shown.length}</span>
                {shown.length > limit && <Btn variant="ghost" onClick={() => setLimit(limit + 200)}>Show more</Btn>}
              </div>
            </>
          )}

          {tab === "summary" && <SizeSummary items={items} students={students} records={records} onPick={(item, size) => { setF({ q: "", cls: "", sec: "", item, size }); setTab("students"); }} />}
        </>
      )}

      {modal?.kind === "items" && <ItemsModal items={items} profile={profile} canManage={canManage} onClose={() => setModal(null)} onSaved={loadBase} />}
      {modal?.kind === "student" && school && <StudentModal school={school} student={modal.student} record={modal.student ? recBy[modal.student.id] || {} : {}} items={items} existing={students} profile={profile} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "import" && school && <ImportModal school={school} items={items} existing={students} profile={profile} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === "scan" && school && <ScanModal school={school} items={items} existing={students} profile={profile} onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- size count (how many of each size)
function SizeSummary({ items, students, records, onPick }) {
  const withData = items.filter((it) => records.some((r) => r.item === it.name && r.size));
  const [item, setItem] = useState("");
  const cur = item || withData[0]?.name || items[0]?.name || "";
  const counts = sizeCounts(records, cur);
  const sizes = sortSizes(Object.keys(counts));
  const total = sizes.reduce((t, z) => t + counts[z], 0);
  const max = Math.max(1, ...sizes.map((z) => counts[z]));
  const byStudent = Object.fromEntries(students.map((s) => [s.id, s]));
  const classes = [...new Set(records.filter((r) => r.item === cur && r.size).map((r) => byStudent[r.student_id]?.class_name || "—"))].sort(NATURAL);
  const cell = (c, z) => records.filter((r) => r.item === cur && r.size === z && (byStudent[r.student_id]?.class_name || "—") === c).length;
  return (
    <div className="space-y-3" data-testid="size-summary">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-stone-600">Garment</span>
        <select className={`${inputCls} w-auto`} value={cur} onChange={(e) => setItem(e.target.value)} aria-label="Summary garment">{items.map((it) => <option key={it.name}>{it.name}</option>)}</select>
        <span className="text-sm text-stone-500">{total} student{total === 1 ? "" : "s"} measured</span>
      </div>
      {sizes.length === 0 ? <Card className="p-6 text-center text-stone-400 text-sm">No {cur} sizes recorded yet.</Card> : (
        <>
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase text-stone-500 mb-2">{cur}: students per size</div>
            <div className="space-y-1">
              {sizes.map((z) => (
                <button key={z} onClick={() => onPick(cur, z)} className="w-full flex items-center gap-3 text-sm hover:bg-stone-50 rounded px-1" title="Show these students" data-size={z}>
                  <span className="w-14 text-right font-mono font-semibold">{z}</span>
                  <span className="flex-1 bg-stone-100 rounded h-5 overflow-hidden"><span className="block h-5 bg-indigo-600/80" style={{ width: `${(counts[z] / max) * 100}%` }} /></span>
                  <span className="w-12 text-right font-mono">{counts[z]}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-stone-50 text-stone-500 uppercase"><tr><th className="text-left px-3 py-2">Class</th>{sizes.map((z) => <th key={z} className="text-right px-2 py-2">{z}</th>)}<th className="text-right px-3 py-2">Total</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {classes.map((c) => { const row = sizes.map((z) => cell(c, z)); return (
                  <tr key={c}><td className="px-3 py-1.5 font-medium">{c}</td>{row.map((n, i) => <td key={i} className="px-2 py-1.5 text-right font-mono">{n || <span className="text-stone-300">·</span>}</td>)}<td className="px-3 py-1.5 text-right font-mono font-semibold">{row.reduce((a, b) => a + b, 0)}</td></tr>); })}
                <tr className="bg-stone-50 font-semibold"><td className="px-3 py-1.5">All classes</td>{sizes.map((z) => <td key={z} className="px-2 py-1.5 text-right font-mono">{counts[z]}</td>)}<td className="px-3 py-1.5 text-right font-mono">{total}</td></tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- garments & measurement fields
function ItemsModal({ items, profile, canManage, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [fields, setFields] = useState("");
  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (items.some((it) => it.name.toLowerCase() === n.toLowerCase())) return alert("That garment already exists.");
    const fl = [...new Set(fields.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];
    const { error } = await supabase.from("measurement_items").insert({ name: n, fields: fl, sort_no: 100 + items.length, created_by: profile?.name || null });
    if (error) return alert(`Couldn't add:\n${error.message}`);
    setName(""); setFields(""); onSaved();
  };
  const saveFields = async (it, text) => {
    const fl = [...new Set(text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];
    const { error } = await supabase.from("measurement_items").update({ fields: fl }).eq("name", it.name);
    if (error) alert(`Couldn't save:\n${error.message}`);
    onSaved();
  };
  return (
    <WideModal title="Garments & measurements" onClose={onClose} wide="max-w-xl">
      <p className="text-xs text-stone-500 mb-3">Each garment has a <b>size</b> (what you filter and count by) and the measurements taken for it. Add any garment you stitch, with the measurements you write on the paper sheet.</p>
      <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 mb-4">
        {items.map((it) => (
          <div key={it.name} className="px-3 py-2 grid grid-cols-[8rem_1fr] gap-2 items-center text-sm">
            <span className="font-medium">{it.name}</span>
            <input key={`${it.name}-${(it.fields || []).join(",")}`} className={inputCls} defaultValue={(it.fields || []).join(", ")} aria-label={`${it.name} measurements`} onBlur={(e) => e.target.value !== (it.fields || []).join(", ") && saveFields(it, e.target.value)} />
          </div>
        ))}
      </div>
      <form onSubmit={add} className="grid grid-cols-[8rem_1fr_auto] gap-2 items-end">
        <Field label="New garment"><input className={inputCls} placeholder="e.g. Blazer" value={name} onChange={(e) => setName(e.target.value)} aria-label="New garment name" /></Field>
        <Field label="Measurements (comma separated)"><input className={inputCls} placeholder="Length, Shoulder, Chest, Sleeve" value={fields} onChange={(e) => setFields(e.target.value)} aria-label="New garment measurements" /></Field>
        <div className="mb-3"><Btn type="submit"><Plus size={14} /> Add</Btn></div>
      </form>
      <div className="flex justify-end"><Btn variant="ghost" onClick={onClose}>Close</Btn></div>
    </WideModal>
  );
}

// ---------------------------------------------------------------- one student
async function saveRecords(studentId, items, values, existingRecs, who) {
  for (const it of items) {
    const v = values[it.name] || {};
    const size = normSize(v.size);
    const m = Object.fromEntries((it.fields || []).map((x) => [x, cleanText(v[x])]).filter(([, y]) => y));
    const had = existingRecs?.[it.name];
    if (!size && !Object.keys(m).length) {
      if (had) await supabase.from("measurement_records").delete().eq("id", had.id);
      continue;
    }
    const { error } = await supabase.from("measurement_records").upsert({ student_id: studentId, item: it.name, size: size || null, m, created_by: who || null, updated_at: new Date().toISOString() }, { onConflict: "student_id,item" });
    if (error) throw error;
  }
}

function StudentModal({ school, student, record, items, existing, profile, onClose, onSaved }) {
  const [f, setF] = useState({ student_name: student?.student_name || "", class_name: student?.class_name || "", section: student?.section || "", roll_no: student?.roll_no || "", gender: student?.gender || "" });
  const [vals, setVals] = useState(() => Object.fromEntries(items.map((it) => [it.name, { size: record[it.name]?.size || "", ...(record[it.name]?.m || {}) }])));
  const [saving, setSaving] = useState(false);
  const setV = (item, k, v) => setVals({ ...vals, [item]: { ...vals[item], [k]: v } });
  const save = async (again) => {
    if (!f.student_name.trim()) return alert("Enter the student's name.");
    const row = { order_id: school.id, student_name: cleanText(f.student_name), class_name: normClass(f.class_name) || null, section: cleanText(f.section).toUpperCase() || null, roll_no: cleanText(f.roll_no) || null, gender: cleanText(f.gender) || null };
    if (!student && existing.some((s) => dupKey(s) === dupKey(row)) && !window.confirm(`${row.student_name} (class ${row.class_name || "—"} ${row.section || ""}) is already in this school. Add again?`)) return;
    setSaving(true);
    try {
      let id = student?.id;
      if (student) { const { error } = await supabase.from("measurement_students").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await supabase.from("measurement_students").insert({ ...row, created_by: profile?.name || null }).select("id").single(); if (error) throw error; id = data.id; }
      await saveRecords(id, items, vals, record, profile?.name);
      await onSaved();
      if (again) { setF({ ...f, student_name: "", roll_no: "" }); setVals(Object.fromEntries(items.map((it) => [it.name, { size: "" }]))); } else onClose();
    } catch (e) { alert(`Couldn't save:\n${e.message}`); }
    setSaving(false);
  };
  return (
    <WideModal title={student ? `Edit ${student.student_name}` : "Add student"} onClose={onClose}>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="col-span-2"><Field label="Student name"><input autoFocus className={inputCls} value={f.student_name} onChange={(e) => setF({ ...f, student_name: e.target.value })} aria-label="Student name" /></Field></div>
        <Field label="Class"><input className={inputCls} value={f.class_name} onChange={(e) => setF({ ...f, class_name: e.target.value })} aria-label="Class" /></Field>
        <Field label="Section"><input className={inputCls} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} aria-label="Section" /></Field>
        <Field label="Roll no"><input className={inputCls} value={f.roll_no} onChange={(e) => setF({ ...f, roll_no: e.target.value })} /></Field>
      </div>
      <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 mb-3">
        {items.map((it) => (
          <div key={it.name} className="px-3 py-2 flex items-end gap-2 flex-wrap" data-item={it.name}>
            <div className="w-20 text-sm font-medium pb-2">{it.name}</div>
            <label className="text-[11px] text-stone-500 w-20">Size<input className={`${inputCls} font-mono`} aria-label={`${it.name} size`} value={vals[it.name]?.size || ""} onChange={(e) => setV(it.name, "size", e.target.value)} /></label>
            {(it.fields || []).map((x) => (
              <label key={x} className="text-[11px] text-stone-500 w-24">{x}<input className={`${inputCls} font-mono`} aria-label={`${it.name} ${x}`} value={vals[it.name]?.[x] || ""} onChange={(e) => setV(it.name, x, e.target.value)} /></label>
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        {!student && <Btn variant="ghost" onClick={() => save(true)} disabled={saving}>Save &amp; add next</Btn>}
        <Btn onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
      </div>
    </WideModal>
  );
}

// ---------------------------------------------------------------- shared: write many students + their records
async function importEntries(school, entries, existing, profile, items, { updateExisting = true, onProgress } = {}) {
  const have = new Map(existing.map((s) => [dupKey(s), s.id]));
  const seen = new Set();
  const fresh = [], again = [];
  entries.forEach((e) => {
    const k = dupKey(e.student);
    if (seen.has(k)) return;
    if (have.has(k)) { seen.add(k); if (updateExisting) again.push({ id: have.get(k), e }); return; }
    seen.add(k); fresh.push(e);
  });
  const skipped = entries.length - fresh.length - again.length;
  let done = 0; const total = fresh.length + again.length;
  const known = new Set(items.map((i) => i.name));
  const recRow = (sid, r) => ({ student_id: sid, item: r.item, size: r.size || null, m: r.m || {}, created_by: profile?.name || null, updated_at: new Date().toISOString() });
  for (let i = 0; i < fresh.length; i += 200) {
    const batch = fresh.slice(i, i + 200);
    const { data, error } = await supabase.from("measurement_students").insert(batch.map((e) => ({ order_id: school.id, student_name: e.student.name, class_name: e.student.class_name || null, section: e.student.section || null, roll_no: e.student.roll_no || null, gender: e.student.gender || null, created_by: profile?.name || null }))).select("id");
    if (error) throw error;
    const rows = [];
    batch.forEach((e, j) => e.records.filter((r) => known.has(r.item)).forEach((r) => rows.push(recRow(data[j].id, r))));
    for (let k = 0; k < rows.length; k += 500) { const { error: e2 } = await supabase.from("measurement_records").upsert(rows.slice(k, k + 500), { onConflict: "student_id,item" }); if (e2) throw e2; }
    done += batch.length; onProgress?.(done, total);
  }
  for (let i = 0; i < again.length; i += 200) {
    const rows = [];
    again.slice(i, i + 200).forEach(({ id, e }) => e.records.filter((r) => known.has(r.item) && (r.size || Object.keys(r.m || {}).length)).forEach((r) => rows.push(recRow(id, r))));
    for (let k = 0; k < rows.length; k += 500) { const { error } = await supabase.from("measurement_records").upsert(rows.slice(k, k + 500), { onConflict: "student_id,item" }); if (error) throw error; }
    done += Math.min(200, again.length - i); onProgress?.(done, total);
  }
  return { added: fresh.length, updated: again.length, skipped };
}

// ---------------------------------------------------------------- Excel / CSV import
function ImportModal({ school, items, existing, profile, onClose, onDone }) {
  const [table, setTable] = useState(null);
  const [map, setMap] = useState([]);
  const [fileName, setFileName] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [defaults, setDefaults] = useState({ class_name: "", section: "" });

  const pick = async (file) => {
    setErr(""); setResult(null);
    if (!file) return;
    try {
      const t = await readTableFromFile(file);
      if (!t.headers.length) return setErr("The file looks empty.");
      setFileName(file.name); setTable(t); setMap(autoMap(t.headers, items));
    } catch (e) { setErr(`Couldn't read this file: ${e.message}. Use an .xlsx or .csv file.`); }
  };
  const entries = useMemo(() => {
    if (!table) return [];
    return buildEntries(table.rows, map).map((e) => ({ ...e, student: { ...e.student, class_name: e.student.class_name || normClass(defaults.class_name), section: e.student.section || cleanText(defaults.section).toUpperCase() } }));
  }, [table, map, defaults]);
  const hasName = map.some((m) => m.kind === "name");
  const setKind = (i, v) => {
    const [kind, item, field] = v.split("|");
    setMap(map.map((m, j) => (j === i ? { kind, ...(item ? { item } : {}), ...(field ? { field } : {}) } : m)));
  };
  const valueOf = (m) => (m.kind === "size" ? `size|${m.item}` : m.kind === "field" ? `field|${m.item}|${m.field}` : m.kind);
  const run = async () => {
    setBusy("Importing…"); setErr("");
    try {
      const r = await importEntries(school, entries, existing, profile, items, { updateExisting, onProgress: (d, t) => setBusy(`Importing… ${d} of ${t}`) });
      setResult(r); await onDone();
    } catch (e) { setErr(`Import stopped: ${e.message}. Students saved before this point are kept; importing the same file again will not duplicate them.`); }
    setBusy("");
  };

  return (
    <WideModal title={`Import students — ${school.name}`} onClose={onClose} wide="max-w-5xl">
      {result ? (
        <div className="space-y-3" data-testid="import-result">
          <p className="text-sm">Imported <b>{result.added}</b> new student{result.added === 1 ? "" : "s"}{result.updated ? <>, updated sizes for <b>{result.updated}</b> existing</> : null}{result.skipped ? <>, skipped <b>{result.skipped}</b> duplicate{result.skipped === 1 ? "" : "s"}</> : null}.</p>
          <div className="flex justify-end"><Btn onClick={onClose}>Done</Btn></div>
        </div>
      ) : (
        <>
          <p className="text-xs text-stone-500 mb-3">Choose an Excel (.xlsx) or CSV file with one row per student. The first row must be the column headings. Use “Blank template” for the layout, or your own sheet: the columns are matched by their headings and you can correct the match below.</p>
          <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose file" className="text-sm mb-3" />
          {err && <p className="text-sm text-rose-600 mb-2">{err}</p>}
          {table && (
            <>
              <div className="text-xs text-stone-500 mb-1">{fileName} — {table.rows.length} rows. Check what each column is:</div>
              <div className="overflow-x-auto border border-stone-200 rounded-lg mb-3">
                <table className="text-xs" data-testid="import-map">
                  <thead className="bg-stone-50"><tr>{table.headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 text-left align-top min-w-[8rem]">
                      <div className="text-stone-700 font-semibold mb-1 truncate" title={h}>{h}</div>
                      <select className="border border-stone-300 rounded px-1 py-0.5 w-full text-xs font-normal" value={valueOf(map[i] || { kind: "ignore" })} onChange={(e) => setKind(i, e.target.value)} aria-label={`Column ${h}`}>
                        <option value="ignore">Ignore</option><option value="name">Student name</option><option value="class">Class</option><option value="section">Section</option><option value="roll">Roll no</option><option value="gender">Gender</option>
                        {items.map((it) => <optgroup key={it.name} label={it.name}><option value={`size|${it.name}`}>{it.name} — size</option>{(it.fields || []).map((x) => <option key={x} value={`field|${it.name}|${x}`}>{it.name} — {x}</option>)}</optgroup>)}
                      </select>
                    </th>))}</tr></thead>
                  <tbody className="divide-y divide-stone-100">{table.rows.slice(0, 5).map((r, i) => <tr key={i}>{table.headers.map((_, j) => <td key={j} className="px-2 py-1 whitespace-nowrap text-stone-600">{String(r[j] ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {!hasName && <p className="text-sm text-rose-600 mb-2">Choose which column is the student's name.</p>}
              <div className="flex flex-wrap items-end gap-3 mb-3">
                <label className="text-[11px] text-stone-500">Class for rows without one<input className={`${inputCls} w-28`} value={defaults.class_name} onChange={(e) => setDefaults({ ...defaults, class_name: e.target.value })} aria-label="Default class" /></label>
                <label className="text-[11px] text-stone-500">Section<input className={`${inputCls} w-20`} value={defaults.section} onChange={(e) => setDefaults({ ...defaults, section: e.target.value })} aria-label="Default section" /></label>
                <label className="text-xs text-stone-600 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} /> If a student is already in this school, update their sizes</label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-stone-600" data-testid="import-count">{entries.length} student{entries.length === 1 ? "" : "s"} ready to import{table.rows.length - entries.length > 0 ? ` (${table.rows.length - entries.length} blank row${table.rows.length - entries.length === 1 ? "" : "s"} skipped)` : ""}</span>
                <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={run} disabled={!hasName || !entries.length || !!busy}>{busy || `Import ${entries.length} students`}</Btn></div>
              </div>
            </>
          )}
        </>
      )}
    </WideModal>
  );
}

// ---------------------------------------------------------------- photos of the paper sheets
async function shrinkImage(file, max = 1800) {
  const bmp = await new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("not an image")); img.src = URL.createObjectURL(file); });
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function ScanModal({ school, items, existing, profile, onClose, onDone }) {
  const [rows, setRows] = useState([]); // reviewed rows: { name, class_name, section, roll_no, vals: { item: {size, Field...} }, from }
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [defaults, setDefaults] = useState({ class_name: "", section: "" });
  const ref = useRef(null);

  const scan = async (files) => {
    setErr("");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBusy(`Reading photo ${i + 1} of ${files.length}…`);
      try {
        const image = await shrinkImage(file);
        const res = await fetch("/api/measurement-scan", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ image, media_type: "image/jpeg", items: items.map((it) => ({ name: it.name, fields: it.fields })) }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Server error ${res.status}`);
        if (j.notes) setNotes((n) => [...n, `${file.name}: ${j.notes}`]);
        setRows((cur) => [...cur, ...(j.students || []).map((s) => ({ name: s.name, class_name: s.class || "", section: s.section || "", roll_no: s.roll || "", vals: s.items || {}, from: file.name }))]);
      } catch (e) { setErr(`${file.name}: ${e.message}`); }
    }
    setBusy("");
  };
  const edit = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const editSize = (i, item, v) => setRows(rows.map((r, j) => (j === i ? { ...r, vals: { ...r.vals, [item]: { ...(r.vals[item] || {}), size: v } } } : r)));
  const entries = rows.filter((r) => cleanText(r.name)).map((r) => ({
    student: { name: cleanText(r.name), class_name: normClass(r.class_name) || normClass(defaults.class_name), section: cleanText(r.section).toUpperCase() || cleanText(defaults.section).toUpperCase(), roll_no: cleanText(r.roll_no), gender: "" },
    records: items.map((it) => { const v = r.vals[it.name] || {}; return { item: it.name, size: normSize(v.size), m: Object.fromEntries((it.fields || []).map((x) => [x, cleanText(v[x])]).filter(([, y]) => y)) }; }).filter((x) => x.size || Object.keys(x.m).length),
  }));
  const run = async () => {
    setBusy("Saving…");
    try { setResult(await importEntries(school, entries, existing, profile, items, { updateExisting: true })); await onDone(); }
    catch (e) { setErr(`Couldn't save: ${e.message}`); }
    setBusy("");
  };
  const shownItems = items.filter((it) => rows.some((r) => r.vals[it.name]));

  return (
    <WideModal title={`Scan paper sheets — ${school.name}`} onClose={onClose} wide="max-w-6xl">
      {result ? (
        <div className="space-y-3"><p className="text-sm">Saved <b>{result.added}</b> new student{result.added === 1 ? "" : "s"}{result.updated ? <>, updated <b>{result.updated}</b> existing</> : null}{result.skipped ? <>, skipped {result.skipped} duplicate{result.skipped === 1 ? "" : "s"}</> : null}.</p><div className="flex justify-end"><Btn onClick={onClose}>Done</Btn></div></div>
      ) : (
        <>
          <p className="text-xs text-stone-500 mb-3">Take a clear, straight-on photo of each paper sheet (or choose photos from the gallery). The names, classes and sizes are read from the photo and shown below as a <b>draft</b>: check them against the paper and correct anything wrong before saving. Handwriting is not always read correctly, so always check.</p>
          <input ref={ref} type="file" accept="image/*" multiple onChange={(e) => { const fl = [...(e.target.files || [])]; e.target.value = ""; if (fl.length) scan(fl); }} aria-label="Choose photos" className="text-sm mb-3" disabled={!!busy} />
          {busy && <p className="text-sm text-indigo-700 mb-2">{busy}</p>}
          {err && <p className="text-sm text-rose-600 mb-2" data-testid="scan-error">{err}</p>}
          {notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-end gap-3 my-3">
                <label className="text-[11px] text-stone-500">Class for rows without one<input className={`${inputCls} w-28`} value={defaults.class_name} onChange={(e) => setDefaults({ ...defaults, class_name: e.target.value })} /></label>
                <label className="text-[11px] text-stone-500">Section<input className={`${inputCls} w-20`} value={defaults.section} onChange={(e) => setDefaults({ ...defaults, section: e.target.value })} /></label>
              </div>
              <div className="overflow-x-auto border border-stone-200 rounded-lg mb-3">
                <table className="w-full text-xs" data-testid="scan-table">
                  <thead className="bg-stone-50 text-stone-500 uppercase"><tr><th className="px-2 py-1.5 text-left">Name</th><th className="px-2 py-1.5 text-left">Class</th><th className="px-2 py-1.5 text-left">Sec</th>{shownItems.map((it) => <th key={it.name} className="px-2 py-1.5 text-left">{it.name} size</th>)}<th></th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-1 py-1"><input className={`${inputCls} min-w-[10rem]`} value={r.name} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Scanned name" /></td>
                        <td className="px-1 py-1"><input className={`${inputCls} w-16`} value={r.class_name} onChange={(e) => edit(i, { class_name: e.target.value })} /></td>
                        <td className="px-1 py-1"><input className={`${inputCls} w-14`} value={r.section} onChange={(e) => edit(i, { section: e.target.value })} /></td>
                        {shownItems.map((it) => <td key={it.name} className="px-1 py-1"><input className={`${inputCls} w-16 font-mono`} value={r.vals[it.name]?.size || ""} onChange={(e) => editSize(i, it.name, e.target.value)} aria-label={`${it.name} size`} /></td>)}
                        <td className="px-1 py-1"><button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-stone-400 hover:text-rose-700" title="Remove this row"><Trash2 size={13} /></button></td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-stone-600">{entries.length} student{entries.length === 1 ? "" : "s"} to save</span>
                <div className="flex gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={run} disabled={!entries.length || !!busy}>Save {entries.length} students</Btn></div>
              </div>
            </>
          )}
        </>
      )}
    </WideModal>
  );
}
