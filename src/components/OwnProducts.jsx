import { useEffect, useState } from "react";
import { Plus, Pencil, Printer, PackagePlus, Search } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import ScanBox from "./ScanBox";
import { printLabels } from "../lib/barcode";
import { fmtMoney } from "../lib/helpers";

export const PRODUCT_CATEGORIES = ["Kids wear", "Women wear", "Doctors dress", "Other"];

// Our own products (kids wear, women's wear, doctors' dresses): stock, barcode labels, and scan lookup.
export default function OwnProducts() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [found, setFound] = useState(null);

  const load = async () => {
    const { data, error: err } = await supabase.from("own_products").select("*").order("name");
    if (err) setError(err.message + " (run migration_64.sql)"); else setError("");
    setRows(data || []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("own-products").on("postgres_changes", { event: "*", schema: "public", table: "own_products" }, load).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const shown = (rows || []).filter((p) => (cat === "All" || p.category === cat) && (!q.trim() || [p.name, p.barcode, p.size, p.color].some((v) => String(v || "").toLowerCase().includes(q.trim().toLowerCase()))));
  const value = shown.reduce((s, p) => s + Number(p.stock_qty) * Number(p.price), 0);

  const save = async (f) => {
    const { data, error: err } = await supabase.rpc("save_product", { p: f });
    if (err || !data?.ok) return alert(err?.message || data?.error);
    setModal(null); load();
  };
  const stockIn = async (p) => {
    const s = prompt(`Add stock to "${p.name}" (use a negative number to reduce):`);
    const qty = Number(s);
    if (!s || !qty) return;
    const { data, error: err } = await supabase.rpc("product_adjust", { p_product: p.id, p_qty: qty, p_reason: qty > 0 ? "stock_in" : "adjust", p_note: null });
    if (err || !data?.ok) return alert(err?.message || data?.error);
    load();
  };
  const onScan = async (code) => {
    const { data } = await supabase.rpc("scan_code", { p_code: code });
    setFound(data?.kind === "product" ? { ok: true, p: data.product } : { ok: false, code });
  };

  if (!rows) return <p className="text-sm text-stone-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Own products</h2>
          <p className="text-xs text-stone-500">Kids wear, women's wear and doctors' dresses we make and sell. Scan a label in Invoices to bill and reduce stock.</p>
        </div>
        <Btn onClick={() => setModal({})}><Plus size={15} /> Add product</Btn>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Card className="p-3.5">
        <ScanBox onScan={onScan} placeholder="Scan a product barcode to look it up" autoFocus={false} />
        {found && (found.ok
          ? <p className="text-sm mt-2 text-emerald-700" role="status">{found.p.name}{found.p.size ? ` (${found.p.size})` : ""} — {fmtMoney(found.p.price)} · stock {Math.round(found.p.stock_qty)}</p>
          : <p className="text-sm mt-2 text-rose-700" role="status">No product with barcode {found.code}.</p>)}
      </Card>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-stone-400" /><input className={inputCls + " pl-8 w-56"} placeholder="Search name, size, barcode" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {["All", ...PRODUCT_CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`text-xs px-2.5 py-1 rounded-full border ${cat === c ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"}`}>{c}</button>
        ))}
        <span className="text-xs text-stone-500 ml-auto">{shown.length} products · stock value {fmtMoney(value)}</span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-stone-500 bg-stone-50 border-b border-stone-200"><th className="px-3 py-2">Product</th><th>Category</th><th>Size</th><th>Color</th><th className="text-right">Price</th><th className="text-right">GST</th><th className="text-right">Stock</th><th>Barcode</th><th></th></tr></thead>
          <tbody>
            {shown.map((p) => {
              const low = Number(p.reorder_level) > 0 && Number(p.stock_qty) <= Number(p.reorder_level);
              return (
                <tr key={p.id} className={`border-b border-stone-100 ${p.active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2 font-medium">{p.name}</td><td>{p.category}</td><td>{p.size || "—"}</td><td>{p.color || "—"}</td>
                  <td className="text-right font-mono">{fmtMoney(p.price)}</td><td className="text-right">{Number(p.gst_rate) ? `${p.gst_rate}%` : "—"}</td>
                  <td className={`text-right font-mono font-semibold ${low ? "text-rose-700" : ""}`}>{Math.round(p.stock_qty)}{low ? " ⚠" : ""}</td>
                  <td className="font-mono text-xs text-stone-500">{p.barcode}</td>
                  <td className="text-right whitespace-nowrap pr-2">
                    <button title="Add stock" onClick={() => stockIn(p)} className="p-1 text-stone-400 hover:text-emerald-700"><PackagePlus size={14} /></button>
                    <button title="Print labels" onClick={() => { const c = prompt("How many labels?", String(Math.max(1, Math.round(p.stock_qty)))); if (c) printLabels([{ code: p.barcode, title: p.name, sub: [p.size, p.color, fmtMoney(p.price)].filter(Boolean).join(" · "), copies: Number(c) || 1 }]); }} className="p-1 text-stone-400 hover:text-indigo-700"><Printer size={14} /></button>
                    <button title="Edit" onClick={() => setModal(p)} className="p-1 text-stone-400 hover:text-indigo-700"><Pencil size={14} /></button>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-stone-400">No products yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {modal && <ProductModal product={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function ProductModal({ product, onClose, onSave }) {
  const [f, setF] = useState({ id: product.id || null, name: product.name || "", category: product.category || "Kids wear", size: product.size || "", color: product.color || "", price: product.price ?? "", gst_rate: product.gst_rate ?? "", hsn_code: product.hsn_code || "", reorder_level: product.reorder_level ?? "", opening_stock: "", active: product.active ?? true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={product.id ? "Edit product" : "Add product"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
        <Field label="Product name"><input required className={inputCls} placeholder="e.g. Girls frock" value={f.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category"><select className={inputCls} value={f.category} onChange={set("category")}>{PRODUCT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Size"><input className={inputCls} value={f.size} onChange={set("size")} /></Field>
          <Field label="Color"><input className={inputCls} value={f.color} onChange={set("color")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price ₹ (before GST)"><input type="number" min="0" className={inputCls} value={f.price} onChange={set("price")} /></Field>
          <Field label="GST %"><input type="number" min="0" max="100" className={inputCls} value={f.gst_rate} onChange={set("gst_rate")} /></Field>
          <Field label="HSN code"><input className={inputCls} value={f.hsn_code} onChange={set("hsn_code")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Low-stock alert at"><input type="number" min="0" className={inputCls} value={f.reorder_level} onChange={set("reorder_level")} /></Field>
          {!product.id && <Field label="Opening stock"><input type="number" min="0" className={inputCls} value={f.opening_stock} onChange={set("opening_stock")} /></Field>}
        </div>
        {product.id && <label className="text-sm flex items-center gap-2 mb-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        <p className="text-xs text-stone-500">A barcode is created automatically when you save; print labels from the list.</p>
        <div className="flex justify-end gap-2 mt-3"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit">Save</Btn></div>
      </form>
    </Modal>
  );
}
