import { useEffect, useMemo, useState } from "react";
import { History, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls } from "./ui";
import { fmtMoney } from "../lib/helpers";

const dFmt = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const n2 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toString();

// Fabric whose stock has reached zero: when it was bought, from which vendor, how much, and which orders used it.
export default function FabricHistory() {
  const [fabrics, setFabrics] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [usage, setUsage] = useState([]);
  const [orders, setOrders] = useState({});
  const [q, setQ] = useState("");
  const [open, setOpen] = useState({});
  const [error, setError] = useState("");

  const load = async () => {
    const [f, r, u, o] = await Promise.all([
      supabase.from("inventory_fabric").select("*").not("exhausted_at", "is", null).order("exhausted_at", { ascending: false }),
      supabase.from("fabric_receipts").select("*").order("received_on", { ascending: true }),
      supabase.from("fabric_usage").select("*").order("created_at", { ascending: true }),
      supabase.from("orders").select("id, order_number, customer_name"),
    ]);
    if (f.error) setError(f.error.message + " (run migration_67.sql)"); else setError("");
    setFabrics((f.data || []).filter((x) => x.exhausted_at));
    setReceipts(r.data || []);
    setUsage((u.data || []).filter((x) => !x.restored));
    const m = {};
    (o.data || []).forEach((x) => { m[x.id] = `${x.order_number} — ${x.customer_name}`; });
    setOrders(m);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("fabric-history")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_fabric" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "fabric_receipts" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "fabric_usage" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const cards = useMemo(() => (fabrics || []).map((f) => {
    const rc = receipts.filter((r) => r.fabric_id === f.id);
    const us = usage.filter((u) => u.fabric_id === f.id);
    const byOrder = {};
    us.forEach((u) => {
      const k = u.order_id || "none";
      const o = (byOrder[k] = byOrder[k] || { order: u.order_id ? orders[u.order_id] || "Order removed" : "Not tied to an order", kg: 0, m: 0, entries: 0, last: u.created_at });
      o.kg += Number(u.kg_used) || 0; o.m += Number(u.meters_used) || 0; o.entries += 1; o.last = u.created_at;
    });
    return {
      f, rc, byOrder: Object.values(byOrder),
      boughtKg: rc.reduce((t, r) => t + Number(r.kg), 0), boughtM: rc.reduce((t, r) => t + Number(r.meters), 0),
      usedKg: us.reduce((t, u) => t + (Number(u.kg_used) || 0), 0), usedM: us.reduce((t, u) => t + (Number(u.meters_used) || 0), 0),
      vendors: [...new Set([f.supplier, ...rc.map((r) => r.vendor)].filter(Boolean))],
    };
  }), [fabrics, receipts, usage, orders]);

  const needle = q.trim().toLowerCase();
  const shown = cards.filter((c) => !needle || `${c.f.fabric_type} ${c.f.color || ""} ${c.vendors.join(" ")} ${c.byOrder.map((o) => o.order).join(" ")}`.toLowerCase().includes(needle));

  if (!fabrics) return <p className="text-sm text-stone-500">Loading…</p>;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><History size={18} /> Fabric history log</h2>
        <p className="text-xs text-stone-500">Fabric moves here automatically when its stock reaches zero. If more is bought or returned to stock, it goes back to Inventory.</p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <input className={inputCls + " max-w-sm"} placeholder="Search fabric, colour, vendor, order" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
      {shown.map((c) => {
        const isOpen = open[c.f.id] !== false; // open by default
        return (
          <Card key={c.f.id} className="p-3.5">
            <button className="w-full flex items-start justify-between gap-2 text-left" onClick={() => setOpen({ ...open, [c.f.id]: !isOpen })}>
              <div>
                <div className="font-semibold text-sm flex items-center gap-1.5">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{c.f.fabric_type}{c.f.color ? ` · ${c.f.color}` : ""}{c.f.weight_gsm ? ` · ${c.f.weight_gsm} GSM` : ""}</div>
                <div className="text-xs text-stone-500 ml-5">Used up {dFmt(c.f.exhausted_at)} · {c.vendors.length ? `Vendor: ${c.vendors.join(", ")}` : "Vendor not recorded"}</div>
              </div>
              <div className="text-xs text-stone-600 text-right whitespace-nowrap">
                Bought {n2(c.boughtKg)} kg{c.boughtM ? ` / ${n2(c.boughtM)} m` : ""}<br />Used {n2(c.usedKg)} kg{c.usedM ? ` / ${n2(c.usedM)} m` : ""}
              </div>
            </button>
            {isOpen && (
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="text-[11px] uppercase font-medium text-stone-500 mb-1">Purchased</div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-stone-400 border-b border-stone-200"><th className="py-1">Date</th><th>Vendor</th><th className="text-right">kg</th><th className="text-right">m</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {c.rc.map((r) => (
                        <tr key={r.id} className="border-b border-stone-100">
                          <td className="py-1">{dFmt(r.received_on)}</td><td>{r.vendor || "—"}</td>
                          <td className="text-right font-mono">{n2(r.kg)}</td><td className="text-right font-mono">{n2(r.meters)}</td>
                          <td className="text-right font-mono">{r.amount != null ? fmtMoney(r.amount) : "—"}</td>
                        </tr>
                      ))}
                      {c.rc.length === 0 && <tr><td colSpan={5} className="py-2 text-xs text-stone-400">No purchase record (stock was added by hand{c.f.supplier ? `; supplier ${c.f.supplier}` : ""}).</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="text-[11px] uppercase font-medium text-stone-500 mb-1">Used for orders</div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-stone-400 border-b border-stone-200"><th className="py-1">Order</th><th className="text-right">kg</th><th className="text-right">m</th><th className="text-right">Last used</th></tr></thead>
                    <tbody>
                      {c.byOrder.map((o) => (
                        <tr key={o.order} className="border-b border-stone-100"><td className="py-1">{o.order}</td><td className="text-right font-mono">{n2(o.kg)}</td><td className="text-right font-mono">{n2(o.m)}</td><td className="text-right text-xs text-stone-500">{dFmt(o.last)}</td></tr>
                      ))}
                      {c.byOrder.length === 0 && <tr><td colSpan={4} className="py-2 text-xs text-stone-400">No cutting usage recorded.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">{fabrics.length === 0 ? "No fabric has been fully used yet." : "Nothing matches."}</Card>}
    </div>
  );
}
