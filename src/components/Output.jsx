import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, SearchBox, matchQ } from "./ui";
import { sizeLabel } from "./Cutting";

const COLORS = { ordered: "#a8a29e", cut: "#4338ca", stitched: "#059669", short: "#e11d48", dispatched: "#d97706" };

// One horizontal bar group per item: ordered / cut / stitched / dispatched, drawn to the same scale.
function ItemBars({ items }) {
  const max = Math.max(1, ...items.flatMap((i) => [i.ordered, i.cut, i.stitched, i.dispatched]));
  const rowH = 14, gap = 3, groupGap = 14, labelW = 130, W = 560, barW = W - labelW - 60;
  const groupH = rowH * 4 + gap * 3;
  const H = items.length * (groupH + groupGap) + 4;
  const rows = [["ordered", "Ordered"], ["cut", "Cut"], ["stitched", "Stitched"], ["dispatched", "Dispatched"]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ordered, cut, stitched and dispatched pieces per item" data-order-chart>
      {items.map((it, gi) => {
        const y0 = gi * (groupH + groupGap) + 2;
        return (
          <g key={it.item}>
            <text x={0} y={y0 + groupH / 2 + 4} fontSize="11" fill="#44403c">{it.item.length > 20 ? it.item.slice(0, 19) + "…" : it.item}</text>
            {rows.map(([k], ri) => {
              const v = it[k];
              const color = k === "stitched" && it.stitched !== it.cut ? COLORS.short : COLORS[k];
              return (
                <g key={k}>
                  <rect x={labelW} y={y0 + ri * (rowH + gap)} width={Math.max(v > 0 ? 2 : 0, (v / max) * barW)} height={rowH} rx="2" fill={color} />
                  <text x={labelW + (v / max) * barW + 5} y={y0 + ri * (rowH + gap) + 11} fontSize="10" fill="#57534e">{v}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-stone-500">
      {[["ordered", "Ordered"], ["cut", "Cut (approved)"], ["stitched", "Stitched"], ["short", "Stitched ≠ cut"], ["dispatched", "Dispatched"]].map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[k] }} />{l}</span>
      ))}
    </div>
  );
}

// Overview: cut vs stitched for every order, side by side.
function OrdersOverview({ orders }) {
  const list = orders.slice(0, 14);
  const max = Math.max(1, ...list.flatMap((o) => [o.cut, o.stitched]));
  const rowH = 11, gap = 2, groupGap = 9, labelW = 150, W = 640, barW = W - labelW - 50;
  const H = list.length * (rowH * 2 + gap + groupGap) + 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cut versus stitched pieces for each order" data-overview-chart>
      {list.map((o, i) => {
        const y = i * (rowH * 2 + gap + groupGap) + 2;
        return (
          <g key={o.id}>
            <text x={0} y={y + rowH + 3} fontSize="11" fill="#44403c">{o.order_number}</text>
            <rect x={labelW} y={y} width={Math.max(o.cut > 0 ? 2 : 0, (o.cut / max) * barW)} height={rowH} rx="2" fill={COLORS.cut} />
            <text x={labelW + (o.cut / max) * barW + 4} y={y + 9} fontSize="10" fill="#57534e">{o.cut}</text>
            <rect x={labelW} y={y + rowH + gap} width={Math.max(o.stitched > 0 ? 2 : 0, (o.stitched / max) * barW)} height={rowH} rx="2" fill={o.stitched === o.cut ? COLORS.stitched : COLORS.short} />
            <text x={labelW + (o.stitched / max) * barW + 4} y={y + rowH + gap + 9} fontSize="10" fill="#57534e">{o.stitched}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Consolidates approved cutting (every entry of an order, per item) against pieces stitched
// (order progress) and dispatched (order deliveries) — one card + one chart per ORDER.
export default function Output() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState({});

  const load = async () => {
    const [{ data: ords }, { data: cuts }, { data: prog }, { data: dels }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, items, status"),
      supabase.from("cutting_entries").select("id, order_id, item_description, cut_date, sizes").eq("status", "Approved"),
      supabase.from("order_progress").select("order_id, item_description, quantity"),
      supabase.from("order_deliveries").select("order_id, item_description, quantity"),
    ]);
    const byId = {};
    (ords || []).forEach((o) => { byId[o.id] = { ...o, itemMap: {}, entries: [], cut: 0, stitched: 0, dispatched: 0, ordered: 0 }; });
    const item = (o, name) => (o.itemMap[name] ||= { item: name, ordered: 0, cut: 0, stitched: 0, dispatched: 0, sizes: {} });
    (cuts || []).forEach((c) => {
      const o = byId[c.order_id]; if (!o) return;
      const it = item(o, c.item_description);
      let n = 0;
      Object.entries(c.sizes || {}).forEach(([sz, v]) => { it.sizes[sz] = (it.sizes[sz] || 0) + Number(v || 0); n += Number(v || 0); });
      it.cut += n; o.entries.push({ id: c.id, date: c.cut_date, item: c.item_description, qty: n });
    });
    // only orders that have approved cutting; stitched/dispatched counted for the items that exist
    Object.values(byId).forEach((o) => {
      if (!o.entries.length) { delete byId[o.id]; return; }
      (o.items || []).forEach((i) => { const it = item(o, i.description); it.ordered = Number(i.quantity) || 0; });
    });
    (prog || []).forEach((p) => { const o = byId[p.order_id]; if (o?.itemMap[p.item_description]) o.itemMap[p.item_description].stitched += Number(p.quantity || 0); });
    (dels || []).forEach((d) => { const o = byId[d.order_id]; if (o?.itemMap[d.item_description]) o.itemMap[d.item_description].dispatched += Number(d.quantity || 0); });
    const list = Object.values(byId).map((o) => {
      const items = Object.values(o.itemMap).filter((i) => i.cut > 0 || i.stitched > 0 || i.ordered > 0);
      const sum = (k) => items.reduce((t, i) => t + i[k], 0);
      return { ...o, items, ordered: sum("ordered"), cut: sum("cut"), stitched: sum("stitched"), dispatched: sum("dispatched"), entries: o.entries.sort((a, b) => (b.date || "").localeCompare(a.date || "")) };
    });
    list.sort((a, b) => (b.order_number || "").localeCompare(a.order_number || ""));
    setOrders(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("output-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "cutting_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_deliveries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const state = (o) => (o.items.every((i) => i.cut === i.stitched) ? "match" : o.stitched < o.cut ? "short" : "extra");
  const shown = useMemo(
    () => orders.filter((o) => (filter === "all" || (filter === "match" ? state(o) === "match" : state(o) !== "match")) && matchQ(q, o.order_number, o.customer_name, o.items.map((i) => i.item), o.status)),
    [orders, q, filter]
  );
  const totals = useMemo(() => ({
    cut: shown.reduce((t, o) => t + o.cut, 0), stitched: shown.reduce((t, o) => t + o.stitched, 0), dispatched: shown.reduce((t, o) => t + o.dispatched, 0),
    open: shown.filter((o) => state(o) !== "match").length,
  }), [shown]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Output</h2>
        <p className="text-xs text-stone-500 mt-0.5">One card per order — all its approved cutting entries added together and compared with pieces stitched (order progress) and dispatched.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search order no., customer, item…" className="w-full max-w-md" />
        <div className="subtab-bar">
          {[["all", `All (${orders.length})`], ["open", "Needs attention"], ["match", "Matched"]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`subtab ${filter === id ? "subtab-active" : ""}`}>{label}</button>
          ))}
        </div>
      </div>

      {shown.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Orders", shown.length], ["Cut", totals.cut], ["Stitched", totals.stitched], ["Orders to reconcile", totals.open]].map(([l, v]) => (
              <Card key={l} className="p-3"><div className="text-[11px] uppercase text-stone-400">{l}</div><div className="text-xl font-semibold font-mono">{v}</div></Card>
            ))}
          </div>
          <Card className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-sm font-semibold">Cut vs stitched — by order {shown.length > 14 && <span className="text-xs font-normal text-stone-400">(latest 14 shown)</span>}</div>
              <div className="flex gap-3 text-[11px] text-stone-500">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.cut }} />Cut</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.stitched }} />Stitched</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.short }} />Stitched ≠ cut</span>
              </div>
            </div>
            <OrdersOverview orders={shown} />
          </Card>
        </>
      )}

      <div className="grid gap-3">
        {shown.map((o) => {
          const st = state(o), diff = o.stitched - o.cut;
          const pct = o.cut ? Math.min(100, Math.round((o.stitched / o.cut) * 100)) : 0;
          const isOpen = !!open[o.id];
          return (
            <Card key={o.id} className={`p-4 border-l-4 ${st === "match" ? "border-l-emerald-500" : "border-l-rose-500"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{o.order_number} — {o.customer_name}</div>
                  <div className="text-xs text-stone-500">{o.items.length} item{o.items.length === 1 ? "" : "s"} · {o.entries.length} cutting entr{o.entries.length === 1 ? "y" : "ies"}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {[["Ordered", o.ordered, ""], ["Cut", o.cut, ""], ["Stitched", o.stitched, st === "match" ? "text-emerald-700" : "text-rose-700"], ["Dispatched", o.dispatched, ""]].map(([l, v, c]) => (
                    <div key={l} className="text-right"><div className="text-[11px] text-stone-400 uppercase">{l}</div><div className={`font-mono font-semibold ${c}`}>{v}</div></div>
                  ))}
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${st === "match" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                    {st === "match" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {st === "match" ? "Matched" : diff < 0 ? `${-diff} pcs short` : `${diff} pcs extra`}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden" title={`${pct}% of cut pieces stitched`}>
                <div className="h-full" style={{ width: `${pct}%`, background: st === "match" ? COLORS.stitched : COLORS.short }} />
              </div>
              <div className="mt-3"><ItemBars items={o.items} /></div>
              <Legend />
              <button className="mt-2 text-xs text-indigo-700 inline-flex items-center gap-1" onClick={() => setOpen({ ...open, [o.id]: !isOpen })}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Size-wise cutting &amp; entries
              </button>
              {isOpen && (
                <div className="mt-2 space-y-3 text-xs">
                  {o.items.filter((i) => i.cut > 0).map((i) => (
                    <div key={i.item}>
                      <div className="font-medium text-stone-700 mb-1">{i.item} — cut {i.cut} · stitched {i.stitched}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(i.sizes).map(([sz, n]) => (
                          <span key={sz} className="bg-stone-100 text-stone-700 rounded px-2 py-0.5">{sizeLabel(sz)}: <span className="font-mono">{n}</span></span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <div className="font-medium text-stone-700 mb-1">Cutting entries (added together above)</div>
                    {o.entries.map((e) => <div key={e.id} className="text-stone-500">{e.date} · {e.item} · {e.qty} pcs</div>)}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {!loading && orders.length === 0 && (
          <Card className="p-8 text-center text-stone-400 text-sm">No approved cutting entries yet. Output appears once cutting is approved.</Card>
        )}
        {!loading && orders.length > 0 && shown.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No order matches.</Card>}
      </div>
    </div>
  );
}
