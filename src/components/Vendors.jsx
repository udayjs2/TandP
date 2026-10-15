import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Phone, Mail, MapPin, Search } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";

export const SUPPLIER_TYPES = ["Fabric", "Machines", "Spare Parts", "Accessories", "Elastic", "Threads", "Buttons & Zips", "Packing", "Printing", "Transport", "Other"];
const DESIGNATIONS = ["Owner", "Partner", "Sales Manager", "Sales Executive", "Accounts", "Manager", "Other"];

export default function Vendors({ profile }) {
  const canDelete = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const [vendors, setVendors] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("All");
  const [modal, setModal] = useState(null); // null | {} (new) | vendor
  const [error, setError] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from("vendors").select("*").order("name");
    if (error) setError(error.message + " (run migration_36.sql if the table is missing)");
    else setError("");
    setVendors(data || []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("vendors-changes").on("postgres_changes", { event: "*", schema: "public", table: "vendors" }, load).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const types = useMemo(() => ["All", ...Array.from(new Set([...SUPPLIER_TYPES, ...vendors.map((v) => v.supplier_type)])).filter((t) => t === "All" || vendors.some((v) => v.supplier_type === t) || SUPPLIER_TYPES.includes(t))], [vendors]);
  const shown = vendors.filter((v) => {
    if (type !== "All" && v.supplier_type !== type) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [v.name, v.contact_person, v.phone, v.address, v.supplier_type].some((x) => (x || "").toLowerCase().includes(s));
  });

  const save = async (f) => {
    const row = {
      name: f.name.trim(), supplier_type: f.supplier_type.trim() || "Other", contact_person: f.contact_person || null,
      designation: f.designation || null, phone: f.phone || null, email: f.email || null, address: f.address || null,
      gstin: f.gstin || null, notes: f.notes || null,
    };
    const res = f.id ? await supabase.from("vendors").update(row).eq("id", f.id) : await supabase.from("vendors").insert({ ...row, created_by: profile?.id });
    if (res.error) { alert("Couldn't save vendor:\n" + res.error.message); return false; }
    load();
    return true;
  };
  const remove = async (v) => {
    if (!confirm(`Delete vendor "${v.name}"?`)) return;
    const { error } = await supabase.from("vendors").delete().eq("id", v.id);
    if (error) alert(error.message);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Vendors</h2>
        <Btn onClick={() => setModal({})}><Plus size={15} /> Add vendor</Btn>
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-stone-400" />
          <input className={inputCls + " pl-8 w-64"} placeholder="Search name, person, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls + " w-auto"} value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => <option key={t} value={t}>{t === "All" ? "All supplier types" : t}</option>)}
        </select>
        <span className="text-xs text-stone-400">{shown.length} of {vendors.length}</span>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {shown.map((v) => (
          <Card key={v.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{v.name}</div>
                <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-800">{v.supplier_type}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setModal(v)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                {canDelete && <button onClick={() => remove(v)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>}
              </div>
            </div>
            <div className="mt-2 text-sm space-y-1">
              {(v.contact_person || v.designation) && <div>{v.contact_person}{v.designation ? <span className="text-stone-500"> · {v.designation}</span> : null}</div>}
              {v.phone && <div className="flex items-center gap-1.5"><Phone size={13} className="text-stone-400" /><a className="text-indigo-700 hover:underline" href={`tel:${v.phone}`}>{v.phone}</a></div>}
              {v.email && <div className="flex items-center gap-1.5"><Mail size={13} className="text-stone-400" /><a className="text-indigo-700 hover:underline" href={`mailto:${v.email}`}>{v.email}</a></div>}
              {v.address && <div className="flex items-start gap-1.5 text-stone-600"><MapPin size={13} className="text-stone-400 mt-0.5 shrink-0" />{v.address}</div>}
              {v.gstin && <div className="text-xs text-stone-500">GSTIN: {v.gstin}</div>}
              {v.notes && <div className="text-xs text-stone-400 italic">{v.notes}</div>}
            </div>
          </Card>
        ))}
        {shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm md:col-span-2">{vendors.length ? "No vendors match." : "No vendors saved yet. Add your first supplier."}</Card>}
      </div>
      {modal && <VendorModal vendor={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function VendorModal({ vendor, onClose, onSave }) {
  const [f, setF] = useState({
    id: vendor.id, name: vendor.name || "", supplier_type: vendor.supplier_type || "Fabric", contact_person: vendor.contact_person || "",
    designation: vendor.designation || "", phone: vendor.phone || "", email: vendor.email || "", address: vendor.address || "",
    gstin: vendor.gstin || "", notes: vendor.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave(f);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <Modal title={vendor.id ? "Edit vendor" : "Add vendor"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Vendor name"><input required className={inputCls} value={f.name} onChange={set("name")} /></Field>
        <Field label="Supplier type">
          <input list="supplier-types" className={inputCls} value={f.supplier_type} onChange={set("supplier_type")} placeholder="Pick or type, e.g. Fabric, Threads" />
          <datalist id="supplier-types">{SUPPLIER_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person"><input className={inputCls} value={f.contact_person} onChange={set("contact_person")} /></Field>
          <Field label="Designation">
            <input list="designations" className={inputCls} value={f.designation} onChange={set("designation")} placeholder="Owner, Sales Manager…" />
            <datalist id="designations">{DESIGNATIONS.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact number"><input type="tel" className={inputCls} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email (optional)"><input type="email" className={inputCls} value={f.email} onChange={set("email")} /></Field>
        </div>
        <Field label="Address"><textarea rows={2} className={inputCls} value={f.address} onChange={set("address")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GSTIN (optional)"><input className={inputCls} value={f.gstin} onChange={set("gstin")} /></Field>
          <Field label="Notes (optional)"><input className={inputCls} value={f.notes} onChange={set("notes")} placeholder="Credit days, what they supply…" /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
