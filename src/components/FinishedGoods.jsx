import { useEffect, useMemo, useState } from "react";
import { Printer, Plus, Minus, PackageCheck, Download } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls, Btn } from "./ui";
import BarcodeView from "./BarcodeView";
import ScanBox from "./ScanBox";
import LabelPrintModal from "./LabelPrintModal";

const n0 = (v) => Math.round(Number(v) || 0);

// Dresses made per order, what has gone out, and the balance still in store. Scans move the count by 1 each.
export default function FinishedGoods() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("in"); // scan mode: in (made) | out (dispatched)
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [labelLines, setLabelLines] = useState(null);

  const load = async () => {
    const { data, error: err } = await supabase.rpc("fg_items", { p_order: null });
    if (err) setError(err.message + " (run migration_64.sql)"); else setError("");
    setItems(Array.isArray(data) ? data : []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("fg-changes").on("postgres_changes", { event: "*", schema: "public", table: "finished_goods_log" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const orders = useMemo(() => {
    const m = new Map();
    (items || []).forEach((it) => {
      if (!m.has(it.order_id)) m.set(it.order_id, { id: it.order_id, number: it.order_number, customer: it.customer_name, status: it.status, items: [] });
      m.get(it.order_id).items.push(it);
    });
    return [...m.values()].map((o) => ({
      ...o,
      ordered: o.items.reduce((s, i) => s + Number(i.ordered), 0), made: o.items.reduce((s, i) => s + Number(i.made), 0),
      stitched: o.items.reduce((s, i) => s + Number(i.stitched), 0),
      dispatched: o.items.reduce((s, i) => s + Number(i.dispatched), 0), balance: o.items.reduce((s, i) => s + Number(i.balance), 0),
    }));
  }, [items]);

  const shown = orders.filter((o) => (!onlyOpen || o.balance > 0 || o.made < o.ordered || o.dispatched < o.ordered) && (!q.trim() || `${o.number} ${o.customer}`.toLowerCase().includes(q.trim().toLowerCase())));

  const handleScan = async (code) => {
    const { data, error: err } = await supabase.rpc("scan_code", { p_code: code });
    if (err) return setMsg({ bad: true, text: err.message });
    if (data?.kind !== "order_item") return setMsg({ bad: true, text: `Unknown barcode ${code}. Print the barcode from this page first.` });
    const it = data.item;
    const { data: r, error: e2 } = await supabase.rpc("fg_add", { p_order: it.order_id, p_item: it.item_description, p_kind: mode, p_qty: 1, p_note: null, p_source: "scan" });
    if (e2 || !r?.ok) return setMsg({ bad: true, text: e2?.message || r?.error });
    setMsg({ bad: false, text: `${it.order_number} · ${it.item_description}: ${mode === "in" ? "+1 made" : "−1 dispatched"} → balance ${n0(r.item.balance)}` });
    setLog((l) => [{ t: new Date().toLocaleTimeString(), code, mode, text: `${it.order_number} ${it.item_description}` }, ...l].slice(0, 8));
    load();
  };

  const adjust = async (it, kind) => {
    const s = prompt(kind === "in" ? `How many "${it.item_description}" were made / added to store?` : `How many "${it.item_description}" are going out (dispatch)?`);
    const qty = Number(s);
    if (!s || !(qty > 0)) return;
    const { data, error: err } = await supabase.rpc("fg_add", { p_order: it.order_id, p_item: it.item_description, p_kind: kind, p_qty: qty, p_note: null, p_source: "manual" });
    if (err || !data?.ok) return alert(err?.message || data?.error);
    load();
  };
  const makeLabels = async (o) => {
    const { data } = await supabase.rpc("ensure_order_barcodes", { p_order: o.id });
    const list = Array.isArray(data) ? data : [];
    const qtyOf = (b) => Math.max(1, Math.round(o.items.find((i) => i.item_description === b.item_description)?.ordered || 1));
    setLabelLines(list.map((b) => ({ code: b.code, title: `${o.number} · ${b.item_description}`, sub: o.customer, copies: qtyOf(b) })));
    load();
  };
  const showCode = async (o) => { await supabase.rpc("ensure_order_barcodes", { p_order: o.id }); load(); };

  if (!items) return <p className="text-sm text-stone-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Finished goods by order</h2>
        <p className="text-xs text-stone-500">Dresses stitched count as made automatically. Dispatched dresses come off the balance; each barcode scan counts one dress (IN = extra made, OUT = dispatched).</p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Card className="p-3.5">
        <div className="flex gap-2 mb-2 flex-wrap items-center">
          {[["in", "Scan IN — extra dress made"], ["out", "Scan OUT — dispatch"]].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className={`text-sm px-3 py-1.5 rounded-lg border ${mode === k ? (k === "in" ? "bg-emerald-700 text-white border-emerald-700" : "bg-amber-600 text-white border-amber-600") : "bg-white text-stone-600 border-stone-200"}`}>{label}</button>
          ))}
        </div>
        <ScanBox onScan={handleScan} />
        {msg && <p className={`text-sm mt-2 ${msg.bad ? "text-rose-700" : "text-emerald-700"}`} role="status">{msg.text}</p>}
        {log.length > 0 && <div className="mt-2 text-[11px] text-stone-400 space-y-0.5">{log.map((l, i) => <div key={i}>{l.t} · {l.mode === "in" ? "IN" : "OUT"} · {l.code} · {l.text}</div>)}</div>}
      </Card>
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inputCls + " w-56"} placeholder="Search order or customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only orders with work or stock left</label>
      </div>
      <div className="space-y-3">
        {shown.map((o) => (
          <Card key={o.id} className="p-3.5">
            <div className="flex justify-between gap-2 flex-wrap items-start">
              <div>
                <div className="font-semibold text-sm">{o.number} — {o.customer}</div>
                <div className="text-xs text-stone-500">{o.status} · ordered {n0(o.ordered)} · made {n0(o.made)} · dispatched {n0(o.dispatched)} · <b className="text-stone-800">balance in store {n0(o.balance)}</b></div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                                <Btn variant="ghost" onClick={() => makeLabels(o)}><Printer size={13} /> Print barcodes</Btn>
                {o.items.some((i) => !i.barcode) && <Btn variant="ghost" onClick={() => showCode(o)}>Generate barcodes</Btn>}
              </div>
            </div>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase text-stone-500 border-b border-stone-200"><th className="py-1">Item</th><th className="text-right">Ordered</th><th className="text-right">Stitched</th><th className="text-right">Made</th><th className="text-right">Dispatched</th><th className="text-right">Balance</th><th className="pl-3">Barcode</th><th></th></tr></thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.item_index} className="border-b border-stone-100">
                      <td className="py-1.5">{i.item_description}</td>
                      <td className="text-right font-mono">{n0(i.ordered)}</td><td className="text-right font-mono text-stone-500">{n0(i.stitched)}</td>
                      <td className="text-right font-mono">{n0(i.made)}</td><td className="text-right font-mono">{n0(i.dispatched)}</td>
                      <td className={`text-right font-mono font-semibold ${Number(i.balance) > 0 ? "text-emerald-700" : ""}`}>{n0(i.balance)}</td>
                      <td className="pl-3 text-[11px] font-mono text-stone-500">{i.barcode || "—"}</td>
                      <td className="text-right whitespace-nowrap">
                        <button onClick={() => adjust(i, "in")} title="Add made" className="p-1 text-stone-400 hover:text-emerald-700"><Plus size={14} /></button>
                        <button onClick={() => adjust(i, "out")} title="Dispatch out" className="p-1 text-stone-400 hover:text-amber-700"><Minus size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        {shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm"><PackageCheck className="mx-auto mb-1" size={20} />No orders to show.</Card>}
      </div>
      {labelLines && <LabelPrintModal lines={labelLines} onClose={() => setLabelLines(null)} />}
    </div>
  );
}
