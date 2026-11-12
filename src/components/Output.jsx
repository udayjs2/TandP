import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../supabaseClient";
import { fetchAll } from "../lib/fetchAll";
import { todayStr } from "../lib/helpers";
import { Card, SearchBox, matchQ } from "./ui";
import { sizeLabel } from "./Cutting";
import { VIZ_CSS, STAGES, PIPELINE_LEGEND, Legend, PipelineBar, pipelineParts, ColumnChart, DailyTrend, Kpi } from "./OutputCharts";

const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

const lastDays = (n) => {
  const out = []; const base = new Date(`${todayStr()}T12:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000); const iso = d.toISOString().slice(0, 10);
    out.push({ date: iso, label: `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`, cut: 0, stitched: 0, dispatched: 0 });
  }
  return out;
};

const ChartCard = ({ title, subtitle, legend, right, children, table, showTable, setShowTable }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
      <div>
        <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
        {subtitle && <div className="text-xs" style={{ color: "var(--ink2)" }}>{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <button className="text-[11px] px-2 py-1 rounded-md border border-stone-200 hover:bg-stone-50" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>{showTable ? "Chart" : "Table"}</button>
      </div>
    </div>
    {showTable ? table : children}
    {legend && <div className="mt-3">{legend}</div>}
  </Card>
);

// Production Management → Output. One consolidated report per order: every approved cutting entry of the order is added
// together and compared with pieces stitched (order progress) and dispatched (order deliveries).
export default function Output() {
  const [raw, setRaw] = useState({ orders: [], cuts: [], prog: [], dels: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState({});
  const [range, setRange] = useState(30);
  const [mode, setMode] = useState("cumulative");
  const [tblTrend, setTblTrend] = useState(false);
  const [tblRank, setTblRank] = useState(false);
  const [tblOrders, setTblOrders] = useState(false);

  const load = async () => {
    try {
      const [{ data: ords }, cuts, prog, { data: dels }] = await Promise.all([
        supabase.from("orders").select("id, order_number, customer_name, items, status"),
        fetchAll(() => supabase.from("cutting_entries").select("id, order_id, item_description, cut_date, sizes").eq("status", "Approved").order("id")),
        fetchAll(() => supabase.from("order_progress").select("order_id, item_description, date, quantity").order("id")),
        supabase.from("order_deliveries").select("order_id, item_description, date, quantity"),
      ]);
      setRaw({ orders: ords || [], cuts: cuts || [], prog: prog || [], dels: dels || [] });
    } finally { setLoading(false); }
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

  // consolidate per order → per item
  const orders = useMemo(() => {
    const byId = {};
    raw.orders.forEach((o) => { byId[o.id] = { ...o, itemMap: {}, entries: [] }; });
    const item = (o, name) => (o.itemMap[name] ||= { item: name, ordered: 0, cut: 0, stitched: 0, dispatched: 0, sizes: {} });
    raw.cuts.forEach((c) => {
      const o = byId[c.order_id]; if (!o) return;
      const it = item(o, c.item_description); let n = 0;
      Object.entries(c.sizes || {}).forEach(([sz, v]) => { it.sizes[sz] = (it.sizes[sz] || 0) + Number(v || 0); n += Number(v || 0); });
      it.cut += n; o.entries.push({ id: c.id, date: c.cut_date, item: c.item_description, qty: n });
    });
    Object.values(byId).forEach((o) => {
      if (!o.entries.length) { delete byId[o.id]; return; }
      (o.items || []).forEach((i) => { item(o, i.description).ordered = Number(i.quantity) || 0; });
    });
    raw.prog.forEach((p) => { const o = byId[p.order_id]; if (o?.itemMap[p.item_description]) o.itemMap[p.item_description].stitched += Number(p.quantity || 0); });
    raw.dels.forEach((d) => { const o = byId[d.order_id]; if (o?.itemMap[d.item_description]) o.itemMap[d.item_description].dispatched += Number(d.quantity || 0); });
    return Object.values(byId).map((o) => {
      const items = Object.values(o.itemMap).filter((i) => i.cut > 0 || i.stitched > 0 || i.ordered > 0);
      const sum = (k) => items.reduce((t, i) => t + i[k], 0);
      return { ...o, items, ordered: sum("ordered"), cut: sum("cut"), stitched: sum("stitched"), dispatched: sum("dispatched"), entries: o.entries.sort((a, b) => (b.date || "").localeCompare(a.date || "")) };
    }).sort((a, b) => (b.order_number || "").localeCompare(a.order_number || ""));
  }, [raw]);

  const state = (o) => (o.items.every((i) => i.cut === i.stitched) ? "match" : o.stitched < o.cut ? "short" : "extra");
  const shown = useMemo(
    () => orders.filter((o) => (filter === "all" || (filter === "match" ? state(o) === "match" : state(o) !== "match")) && matchQ(q, o.order_number, o.customer_name, o.items.map((i) => i.item), o.status)),
    [orders, q, filter]
  );
  const T = useMemo(() => {
    const s = (k) => shown.reduce((t, o) => t + o[k], 0);
    return { ordered: s("ordered"), cut: s("cut"), stitched: s("stitched"), dispatched: s("dispatched"), open: shown.filter((o) => state(o) !== "match").length };
  }, [shown]);

  // per-day cut / stitched / dispatched for a set of orders (cumulative = running totals incl. everything before the window)
  const buildDays = (ids, n, cum) => {
    const list = lastDays(n); const idx = Object.fromEntries(list.map((d, i) => [d.date, i]));
    const sumSizes = (c) => Object.values(c.sizes || {}).reduce((t, v) => t + Number(v || 0), 0);
    raw.cuts.forEach((c) => { if (ids.has(c.order_id) && idx[c.cut_date] != null) list[idx[c.cut_date]].cut += sumSizes(c); });
    raw.prog.forEach((p) => { if (ids.has(p.order_id) && idx[p.date] != null) list[idx[p.date]].stitched += Number(p.quantity || 0); });
    raw.dels.forEach((d) => { if (ids.has(d.order_id) && idx[d.date] != null) list[idx[d.date]].dispatched += Number(d.quantity || 0); });
    if (cum) {
      const first = list[0].date, base = { cut: 0, stitched: 0, dispatched: 0 };
      raw.cuts.forEach((c) => { if (ids.has(c.order_id) && c.cut_date < first) base.cut += sumSizes(c); });
      raw.prog.forEach((p) => { if (ids.has(p.order_id) && p.date < first) base.stitched += Number(p.quantity || 0); });
      raw.dels.forEach((d) => { if (ids.has(d.order_id) && d.date < first) base.dispatched += Number(d.quantity || 0); });
      list.forEach((d) => { base.cut += d.cut; base.stitched += d.stitched; base.dispatched += d.dispatched; d.dCut = d.cut; d.dStitched = d.stitched; d.dDispatched = d.dispatched; d.cut = base.cut; d.stitched = base.stitched; d.dispatched = base.dispatched; });
    }
    return list;
  };
  const days = useMemo(() => buildDays(new Set(shown.map((o) => o.id)), range, mode === "cumulative"), [shown, raw, range, mode]);
  const periodTotals = days.reduce((a, d) => ({ cut: a.cut + (d.dCut ?? d.cut), stitched: a.stitched + (d.dStitched ?? d.stitched), dispatched: a.dispatched + (d.dDispatched ?? d.dispatched) }), { cut: 0, stitched: 0, dispatched: 0 });

  const chartGroups = useMemo(() => shown.slice(0, 12).reverse().map((o) => ({ key: o.id, label: o.order_number, sub: o.customer_name, title: `${o.order_number} — ${o.customer_name}`, values: { ordered: o.ordered, cut: o.cut, stitched: o.stitched, dispatched: o.dispatched } })), [shown]);
  const pick = (id) => {
    setOpen((p) => ({ ...p, [id]: true }));
    setTimeout(() => document.getElementById(`order-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const th = "text-left text-[11px] uppercase font-medium px-2 py-1.5";
  const td = "px-2 py-1.5 tabular-nums";

  return (
    <div className="space-y-4 viz-root">
      <style>{VIZ_CSS}</style>
      <div>
        <h2 className="text-lg font-semibold">Output</h2>
        <p className="text-xs text-stone-500 mt-0.5">Production report — every approved cutting entry of an order is added together and compared with pieces stitched and dispatched.</p>
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-kpis>
            <Kpi label="Ordered" value={nf(T.ordered)} sub={`${shown.length} order${shown.length === 1 ? "" : "s"}`} />
            <Kpi label="Cut" value={nf(T.cut)} sub={`${pct(T.cut, T.ordered)}% of ordered`} ratio={T.ordered ? T.cut / T.ordered : 0} color={STAGES.cut.color} />
            <Kpi label="Stitched" value={nf(T.stitched)} sub={`${pct(T.stitched, T.cut)}% of cut`} ratio={T.cut ? T.stitched / T.cut : 0} color={STAGES.stitched.color} />
            <Kpi label="Dispatched" value={nf(T.dispatched)} sub={`${pct(T.dispatched, T.stitched)}% of stitched`} ratio={T.stitched ? T.dispatched / T.stitched : 0} color={STAGES.dispatched.color} />
            <Kpi label="Orders to reconcile" value={T.open} sub={T.open ? "stitched ≠ cut" : "all matched"} />
          </div>

          <ChartCard
            title="All orders — ordered vs cut vs stitched vs dispatched"
            subtitle={`${shown.length > 12 ? "Latest 12 orders · " : ""}Click an order's bars to open its detailed graphs below`}
            legend={<Legend items={["ordered", "cut", "stitched", "dispatched"].map((k) => ({ label: STAGES[k].label, color: STAGES[k].color }))} />}
            showTable={tblOrders} setShowTable={setTblOrders}
            table={<div className="max-h-72 overflow-auto"><table className="w-full text-xs"><thead className="text-stone-500"><tr><th className={th}>Order</th><th className={`${th} text-right`}>Ordered</th><th className={`${th} text-right`}>Cut</th><th className={`${th} text-right`}>Stitched</th><th className={`${th} text-right`}>Dispatched</th></tr></thead><tbody>{shown.map((o) => <tr key={o.id} className="border-t border-stone-100 cursor-pointer hover:bg-stone-50" onClick={() => pick(o.id)}><td className={td}>{o.order_number} — {o.customer_name}</td><td className={`${td} text-right`}>{o.ordered}</td><td className={`${td} text-right`}>{o.cut}</td><td className={`${td} text-right`}>{o.stitched}</td><td className={`${td} text-right`}>{o.dispatched}</td></tr>)}</tbody></table></div>}
          >
            <ColumnChart groups={chartGroups} series={["ordered", "cut", "stitched", "dispatched"]} onSelect={pick} labels={chartGroups.length <= 6} ariaLabel="Ordered, cut, stitched and dispatched pieces for each order" />
          </ChartCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard
              title={mode === "cumulative" ? "Output to date" : "Daily output"}
              subtitle={`Last ${range} days${mode === "cumulative" ? " (running totals)" : ""} · cut ${nf(periodTotals.cut)} · stitched ${nf(periodTotals.stitched)} · dispatched ${nf(periodTotals.dispatched)}`}
              legend={<Legend items={["cut", "stitched", "dispatched"].map((k) => ({ label: STAGES[k].label, color: STAGES[k].color }))} />}
              right={<div className="flex gap-1">{[["cumulative", "Total"], ["daily", "Daily"]].map(([m, l]) => <button key={m} onClick={() => setMode(m)} className={`text-[11px] px-2 py-1 rounded-md border ${mode === m ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 hover:bg-stone-50"}`}>{l}</button>)}<span className="w-1" />{[14, 30, 60, 90].map((n) => <button key={n} onClick={() => setRange(n)} className={`text-[11px] px-2 py-1 rounded-md border ${range === n ? "bg-stone-800 text-white border-stone-800" : "border-stone-200 hover:bg-stone-50"}`}>{n}d</button>)}</div>}
              showTable={tblTrend} setShowTable={setTblTrend}
              table={(
                <div className="max-h-64 overflow-auto"><table className="w-full text-xs"><thead className="text-stone-500"><tr><th className={th}>Date</th><th className={`${th} text-right`}>Cut</th><th className={`${th} text-right`}>Stitched</th><th className={`${th} text-right`}>Dispatched</th></tr></thead>
                  <tbody>{days.filter((d) => (d.dCut ?? d.cut) || (d.dStitched ?? d.stitched) || (d.dDispatched ?? d.dispatched)).reverse().map((d) => <tr key={d.date} className="border-t border-stone-100"><td className={td}>{d.date}</td><td className={`${td} text-right`}>{d.cut}</td><td className={`${td} text-right`}>{d.stitched}</td><td className={`${td} text-right`}>{d.dispatched}</td></tr>)}</tbody></table></div>
              )}
            >
              <DailyTrend days={days} />
            </ChartCard>

            <ChartCard
              title="Production pipeline — all shown orders"
              subtitle={`${nf(Math.max(T.ordered, T.cut))} pieces ordered`}
              legend={<Legend items={PIPELINE_LEGEND} />}
              showTable={tblRank} setShowTable={setTblRank}
              table={<table className="w-full text-xs"><tbody>{pipelineParts(T).parts.map((p) => <tr key={p.key} className="border-t border-stone-100"><td className="px-2 py-1.5">{p.label}</td><td className="px-2 py-1.5 text-right tabular-nums">{nf(p.v)}</td><td className="px-2 py-1.5 text-right tabular-nums">{pct(p.v, pipelineParts(T).total)}%</td></tr>)}</tbody></table>}
            >
              <PipelineBar data={T} height={22} name="All orders" />
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-xs">
                {pipelineParts(T).parts.map((p) => (
                  <div key={p.key} className="flex items-center justify-between border-b border-stone-100 pb-1">
                    <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: p.color }} />{p.label}</span>
                    <span className="tabular-nums"><b>{nf(p.v)}</b> <span className="text-stone-400">· {pct(p.v, pipelineParts(T).total)}%</span></span>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>

        </>
      )}

      <div className="grid gap-3">
        {shown.map((o) => {
          const st = state(o), diff = o.stitched - o.cut, isOpen = !!open[o.id];
          const title = `${o.order_number} — ${o.customer_name}`;
          const itemGroups = o.items.map((i) => ({ key: i.item, label: i.item, title: `${title} · ${i.item}`, values: { ordered: i.ordered, cut: i.cut, stitched: i.stitched, dispatched: i.dispatched } }));
          const sizeTotals = {}; o.items.forEach((i) => Object.entries(i.sizes).forEach(([sz, n]) => { sizeTotals[sz] = (sizeTotals[sz] || 0) + n; }));
          const sizeGroups = Object.entries(sizeTotals).sort((a, b) => (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0)).map(([sz, n]) => ({ key: sz, label: sizeLabel(sz), title: `${title} · size ${sizeLabel(sz)}`, values: { cut: n } }));
          const firstDate = [...o.entries.map((e) => e.date), ...raw.prog.filter((p) => p.order_id === o.id).map((p) => p.date)].filter(Boolean).sort()[0];
          const span = firstDate ? Math.min(90, Math.max(14, Math.ceil((new Date(`${todayStr()}T12:00:00Z`) - new Date(`${firstDate}T12:00:00Z`)) / 86400000) + 2)) : 30;
          return (
            <Card key={o.id} className={`p-4 ${isOpen ? "ring-2 ring-indigo-200" : ""}`}>
              <div id={`order-${o.id}`} style={{ scrollMarginTop: 12 }} />
              <button type="button" className="w-full text-left" onClick={() => setOpen({ ...open, [o.id]: !isOpen })} aria-expanded={isOpen} data-order-header>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-stone-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                    <div>
                      <div className="font-semibold">{title}</div>
                      <div className="text-xs text-stone-500">{o.items.length} item{o.items.length === 1 ? "" : "s"} · {o.entries.length} cutting entr{o.entries.length === 1 ? "y" : "ies"} consolidated · {isOpen ? "click to hide graphs" : "click to see graphs"}</div>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${st === "match" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                    {st === "match" ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {st === "match" ? "Matched" : diff < 0 ? `${-diff} pcs left to stitch` : `${diff} pcs extra stitched`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  {[["Ordered", o.ordered, null, ""], ["Cut", o.cut, pct(o.cut, o.ordered), "of ordered"], ["Stitched", o.stitched, pct(o.stitched, o.cut), "of cut"], ["Dispatched", o.dispatched, pct(o.dispatched, o.stitched), "of stitched"]].map(([l, v, p, sub]) => (
                    <div key={l} className="rounded-lg bg-stone-50 py-2">
                      <div className="text-[11px] uppercase text-stone-400">{l}</div>
                      <div className="text-lg font-semibold tabular-nums leading-tight">{nf(v)}</div>
                      <div className="text-[11px] text-stone-500 h-4">{p != null ? `${p}% ${sub}` : ""}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3"><PipelineBar data={o} height={12} name={o.order_number} /></div>
              </button>

              {isOpen && (
                <div className="mt-4 space-y-4 border-t border-stone-100 pt-4" data-order-detail>
                  <div>
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="text-xs text-stone-500 mb-2">Pieces by item — ordered vs cut vs stitched vs dispatched</div>
                    <div style={{ maxWidth: Math.max(440, itemGroups.length * 200) }}><ColumnChart groups={itemGroups} series={["ordered", "cut", "stitched", "dispatched"]} slot={150} minW={440} height={250} ariaLabel={`${title} pieces by item`} /></div>
                    <div className="mt-2"><Legend items={["ordered", "cut", "stitched", "dispatched"].map((k) => ({ label: STAGES[k].label, color: STAGES[k].color }))} /></div>
                  </div>

                  <div className="grid lg:grid-cols-2 gap-4">
                    {sizeGroups.length > 0 && (
                      <div>
                        <div className="text-sm font-semibold">{title}</div>
                        <div className="text-xs text-stone-500 mb-2">Pieces cut by size (all cutting entries added together)</div>
                        <div style={{ maxWidth: Math.max(360, sizeGroups.length * 90) }}><ColumnChart groups={sizeGroups} series={["cut"]} slot={70} height={230} minW={360} ariaLabel={`${title} pieces cut by size`} /></div>
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold">{title}</div>
                      <div className="text-xs text-stone-500 mb-1">Progress over time (running totals)</div>
                      <DailyTrend days={buildDays(new Set([o.id]), span, true)} height={230} />
                      <div className="mt-2"><Legend items={["cut", "stitched", "dispatched"].map((k) => ({ label: STAGES[k].label, color: STAGES[k].color }))} /></div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-stone-400"><tr><th className={th}>Item</th><th className={`${th} text-right`}>Ordered</th><th className={`${th} text-right`}>Cut</th><th className={`${th} text-right`}>Stitched</th><th className={`${th} text-right`}>Dispatched</th><th className={`${th} text-right`}>Stitched %</th><th className={`${th} w-1/4`}>Pipeline</th></tr></thead>
                      <tbody>
                        {o.items.map((i) => (
                          <tr key={i.item} className="border-t border-stone-100">
                            <td className={`${td} font-medium text-stone-700`}>{i.item}</td>
                            <td className={`${td} text-right`}>{nf(i.ordered)}</td>
                            <td className={`${td} text-right`}>{nf(i.cut)}</td>
                            <td className={`${td} text-right font-semibold`} style={i.cut !== i.stitched ? { color: "var(--bad)" } : undefined}>{nf(i.stitched)}</td>
                            <td className={`${td} text-right`}>{nf(i.dispatched)}</td>
                            <td className={`${td} text-right`}>{pct(i.stitched, i.cut)}%</td>
                            <td className={td}><PipelineBar data={i} height={8} name={i.item} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-xs">
                    <div className="font-medium text-stone-700 mb-1">Cutting entries (added together above)</div>
                    {o.entries.map((e) => <div key={e.id} className="text-stone-500">{e.date} · {e.item} · {e.qty} pcs</div>)}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {!loading && orders.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No approved cutting entries yet. Output appears once cutting is approved.</Card>}
        {!loading && orders.length > 0 && shown.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No order matches.</Card>}
      </div>
    </div>
  );
}
