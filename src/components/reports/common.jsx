import { useEffect, useState } from "react";
import { supabase, fetchAll } from "../../lib/fetchAll";
import { inputCls } from "../ui";
import { todayStr } from "../../lib/helpers";
import { addDays, periodRangeFor, currentQuarter } from "../../lib/analytics";

export { supabase, fetchAll };

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (mk) => `${MONTHS[Number(mk.slice(5, 7)) - 1]} ${mk.slice(2, 4)}`;
export const sum = (rows, f = (x) => x.amount) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);
export const pct = (a, b) => (b ? (a / b) * 100 : null);
export const round1 = (n) => Math.round(n * 10) / 10;
export const inRange = (d, r) => !!d && d >= r.from && d <= r.to;
export const sumSizes = (sizes) => Object.values(sizes || {}).reduce((s, v) => s + (Number(v) || 0), 0);
export const groupBy = (rows, f) => {
  const out = {};
  rows.forEach((r) => (out[f(r)] = out[f(r)] || []).push(r));
  return out;
};
export const itemsQty = (items) => (items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);

export const monthsBetween = (from, to) => {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};
const lastDay = (ym) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

export const PRESETS = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_30", label: "Last 30 days" },
  { id: "last_6m", label: "Last 6 months" },
  { id: "last_12m", label: "Last 12 months" },
  { id: "this_quarter", label: "This quarter" },
  { id: "last_quarter", label: "Last quarter" },
  { id: "this_fy", label: "This financial year" },
  { id: "last_fy", label: "Last financial year" },
  { id: "custom", label: "Custom dates" },
];

export const presetRange = (id, today = todayStr()) => {
  const ym = today.slice(0, 7);
  const { fy, q } = currentQuarter(today);
  if (id === "last_month") {
    const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
    const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return { from: `${pm}-01`, to: lastDay(pm), label: monthLabel(pm) };
  }
  if (id === "last_6m" || id === "last_12m") {
    const back = id === "last_6m" ? 5 : 11;
    let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - back;
    while (m < 1) { m += 12; y -= 1; }
    const start = `${y}-${String(m).padStart(2, "0")}`;
    return { from: `${start}-01`, to: lastDay(ym), label: id === "last_6m" ? "Last 6 months" : "Last 12 months" };
  }
  if (id === "last_30") return { from: addDays(today, -29), to: today, label: "Last 30 days" };
  if (id === "this_quarter") { const r = periodRangeFor("quarter", fy, q); return { from: r.from, to: r.to, label: r.label }; }
  if (id === "last_quarter") { const r = periodRangeFor("quarter", q === 1 ? fy - 1 : fy, q === 1 ? 4 : q - 1); return { from: r.from, to: r.to, label: r.label }; }
  if (id === "this_fy") { const r = periodRangeFor("year", fy); return { from: r.from, to: r.to, label: r.label }; }
  if (id === "last_fy") { const r = periodRangeFor("year", fy - 1); return { from: r.from, to: r.to, label: r.label }; }
  return { from: `${ym}-01`, to: lastDay(ym), label: monthLabel(ym) };
};

// date range chooser: returns the range and the controls to draw
export function useRange(defaultId = "this_month") {
  const [id, setId] = useState(defaultId);
  const [custom, setCustom] = useState({ from: addDays(todayStr(), -29), to: todayStr() });
  const range = id === "custom" ? { ...custom, label: `${custom.from} to ${custom.to}` } : presetRange(id);
  const controls = (
    <>
      <select className={inputCls + " w-auto"} value={id} onChange={(e) => setId(e.target.value)}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {id === "custom" && (
        <>
          <input type="date" className={inputCls + " w-auto"} value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className="text-xs text-stone-400">to</span>
          <input type="date" className={inputCls + " w-auto"} value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </>
      )}
    </>
  );
  return { range, controls };
}

// run an async loader whenever `key` changes
export function useData(loader, key) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let off = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    loader()
      .then((data) => !off && setState({ loading: false, data, error: "" }))
      .catch((e) => !off && setState({ loading: false, data: null, error: e?.message || String(e) }));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

// like fetchAll but a table the role cannot read just gives no rows
export const safeAll = async (build) => {
  try { return await fetchAll(build); } catch { return []; }
};

export function ReportShell({ state, children, controls }) {
  if (state.error) return <div className="space-y-3"><div className="flex gap-2 flex-wrap">{controls}</div><p className="text-sm text-rose-600">Couldn't build the report: {state.error}</p></div>;
  if (!state.data) return <div className="space-y-3"><div className="flex gap-2 flex-wrap">{controls}</div><p className="text-sm text-stone-500">Building report…</p></div>;
  return <div className={state.loading ? "opacity-60 transition-opacity" : ""}>{children(state.data)}</div>;
}
