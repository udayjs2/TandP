import { useRef, useState } from "react";

// Chart building blocks for the Output report. Colour follows the entity, never its rank:
// Cut = blue, Stitched = orange, Dispatched = aqua (validated for colour-blind separation).
// Tokens swap for dark mode; ink for text, hairline grey for grid.
export const VIZ_CSS = `
.viz-root{--surface:#ffffff;--ink:#1c1917;--ink2:#57534e;--muted:#a8a29e;--grid:#ececea;--track:#e7e5e4;--cut:#2a78d6;--stitched:#eb6834;--dispatched:#1baf7a;--ordered:#a8a29e;--bad:#d1242f}
:root[data-theme="dark"] .viz-root{--surface:#1c1917;--ink:#f5f5f4;--ink2:#d6d3d1;--muted:#a8a29e;--grid:#33302d;--track:#3a3633;--cut:#3987e5;--stitched:#d95926;--dispatched:#199e70;--ordered:#78716c;--bad:#ff6b6b}
.viz-root{color:var(--ink)}
.viz-tip{position:absolute;pointer-events:none;z-index:20;background:var(--ink);color:var(--surface);font-size:11px;line-height:1.35;padding:6px 8px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.18);white-space:nowrap;transform:translate(-50%,-100%)}
`;

export const STAGES = {
  ordered: { label: "Ordered", color: "var(--ordered)" },
  cut: { label: "Cut", color: "var(--cut)" },
  stitched: { label: "Stitched", color: "var(--stitched)" },
  dispatched: { label: "Dispatched", color: "var(--dispatched)" },
};

const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// ---- tooltip hook: tracks the pointer inside a relative container
function useTip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top - 10, content });
  };
  return { ref, tip, show, hide: () => setTip(null) };
}
const Tip = ({ tip }) => (tip ? <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.content}</div> : null);

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--ink2)" }}>
      {items.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ background: l.color }} />{l.label}
        </span>
      ))}
    </div>
  );
}

// ---- Pipeline bar: the ordered quantity split into what is dispatched / stitched / cut / not cut yet.
// Exclusive parts (dispatched ⊂ stitched ⊂ cut ⊂ ordered), 2px surface gap between segments.
export function pipelineParts({ ordered, cut, stitched, dispatched }) {
  const total = Math.max(ordered, cut, stitched, dispatched, 1);
  const d = Math.min(dispatched, stitched || dispatched);
  const s = Math.max(0, Math.min(stitched, cut) - d);
  const c = Math.max(0, cut - Math.max(Math.min(stitched, cut), d));
  const n = Math.max(0, total - cut);
  return { total, parts: [
    { key: "dispatched", label: "Dispatched", v: d, color: "var(--dispatched)" },
    { key: "stitched", label: "Stitched, not yet dispatched", v: s, color: "var(--stitched)" },
    { key: "cut", label: "Cut, not yet stitched", v: c, color: "var(--cut)" },
    { key: "none", label: "Not cut yet", v: n, color: "var(--track)" },
  ] };
}
export const PIPELINE_LEGEND = [
  { label: "Dispatched", color: "var(--dispatched)" },
  { label: "Stitched, awaiting dispatch", color: "var(--stitched)" },
  { label: "Cut, awaiting stitching", color: "var(--cut)" },
  { label: "Not cut yet", color: "var(--track)" },
];

export function PipelineBar({ data, height = 14, name }) {
  const { ref, tip, show, hide } = useTip();
  const { total, parts } = pipelineParts(data);
  const vis = parts.filter((p) => p.v > 0);
  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <div className="flex w-full" style={{ gap: 2, height }} role="img" aria-label={`${name || "Pipeline"}: ${parts.map((p) => `${p.label} ${p.v}`).join(", ")}`}>
        {vis.map((p, i) => (
          <div
            key={p.key}
            onMouseMove={(e) => show(e, <><b>{p.label}</b><br />{nf(p.v)} pcs · {pct(p.v, total)}% of {nf(total)}</>)}
            style={{
              width: `${(p.v / total) * 100}%`, background: p.color, minWidth: 3,
              borderRadius: `${i === 0 ? 4 : 0}px ${i === vis.length - 1 ? 4 : 0}px ${i === vis.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
            }}
          />
        ))}
      </div>
      <Tip tip={tip} />
    </div>
  );
}

// ---- Ranked horizontal bars: per order, bar length = cut quantity, filled part = stitched.
export function LeftToStitch({ rows }) {
  const { ref, tip, show, hide } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.cut));
  return (
    <div ref={ref} className="relative space-y-2.5" onMouseLeave={hide}>
      {rows.map((r) => {
        const left = Math.max(0, r.cut - r.stitched), done = Math.min(r.stitched, r.cut), extra = Math.max(0, r.stitched - r.cut);
        return (
          <div key={r.id} className="grid grid-cols-[84px_1fr_auto] items-center gap-3"
            onMouseMove={(e) => show(e, <><b>{r.label}</b><br />Cut {nf(r.cut)} · Stitched {nf(r.stitched)}<br />{left ? `${nf(left)} still to stitch` : extra ? `${nf(extra)} more stitched than cut` : "Fully stitched"}</>)}>
            <div className="text-xs font-medium truncate" style={{ color: "var(--ink2)" }} title={r.label}>{r.short}</div>
            <div style={{ width: `${(r.cut / max) * 100}%`, minWidth: 6 }}>
              <div className="flex" style={{ gap: 2, height: 16 }}>
                {done > 0 && <div style={{ width: `${(done / r.cut) * 100}%`, background: "var(--stitched)", borderRadius: "4px 0 0 4px", minWidth: 3 }} />}
                {left > 0 && <div style={{ flex: 1, background: "var(--cut)", borderRadius: done > 0 ? "0 4px 4px 0" : 4, opacity: 0.9 }} />}
                {left === 0 && done > 0 && <div style={{ width: 0 }} />}
              </div>
            </div>
            <div className="text-xs tabular-nums text-right whitespace-nowrap" style={{ color: "var(--ink2)", minWidth: 96 }}>
              <b style={{ color: "var(--ink)" }}>{pct(done, r.cut)}%</b> · {nf(r.stitched)}/{nf(r.cut)}
              {extra > 0 && <span style={{ color: "var(--bad)" }}> · +{nf(extra)}</span>}
            </div>
          </div>
        );
      })}
      <Tip tip={tip} />
    </div>
  );
}

// ---- Daily trend lines with crosshair tooltip. days: [{label, date, cut, stitched, dispatched}]
export function DailyTrend({ days, height = 250 }) {
  const { ref, tip, show, hide } = useTip();
  const [hover, setHover] = useState(null);
  const W = 640, H = height, L = 38, R = 14, T = 12, B = 26;
  const keys = ["cut", "stitched", "dispatched"];
  const raw = Math.max(1, ...days.flatMap((d) => keys.map((k) => d[k])));
  const step = raw <= 10 ? 2 : raw <= 50 ? 10 : raw <= 100 ? 20 : raw <= 500 ? 100 : 500;
  const top = Math.ceil(raw / step) * step;
  const x = (i) => L + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const every = Math.ceil(days.length / 8);
  const path = (k) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const onMove = (e) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - svg.left) / svg.width) * W;
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - L) / (W - L - R)) * (days.length - 1))));
    setHover(i);
    const d = days[i];
    show(e, <><b>{d.date}</b>{keys.map((k) => <div key={k}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: STAGES[k].color, marginRight: 5 }} />{STAGES[k].label}: {nf(d[k])}</div>)}</>);
  };
  return (
    <div ref={ref} className="relative" onMouseLeave={() => { hide(); setHover(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label="Pieces cut, stitched and dispatched per day" onMouseMove={onMove} data-trend-chart>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">{v}</text>
          </g>
        ))}
        {days.map((d, i) => (i % every === 0 && days.length - 1 - i >= every * 0.6) || i === days.length - 1 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === days.length - 1 ? "end" : "middle"} fontSize="10" fill="var(--muted)">{d.label}</text>
        ) : null)}
        {keys.map((k) => <path key={k} d={path(k)} fill="none" stroke={STAGES[k].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth="1" />
            {keys.map((k) => <circle key={k} cx={x(hover)} cy={y(days[hover][k])} r="4.5" fill={STAGES[k].color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
        {hover == null && days.length > 0 && keys.map((k) => <circle key={k} cx={x(days.length - 1)} cy={y(days[days.length - 1][k])} r="4" fill={STAGES[k].color} stroke="var(--surface)" strokeWidth="2" />)}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// ---- KPI tile with a thin progress track
export function Kpi({ label, value, sub, ratio, color }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3.5" style={{ background: "var(--surface)" }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: "var(--ink2)" }}>{sub}</div>}
      {ratio != null && (
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}


// ---- Vertical grouped columns. groups: [{ key, label, sub?, values: {seriesKey: n} }], series: ["ordered","cut",...]
// Bars <= 24px, 4px rounded tops, 2px gap, hover tooltip, optional value labels, click a group to select it.
export function ColumnChart({ groups, series, height = 260, onSelect, selected, labels = true, slot: slot0 = 84, ariaLabel, minW = 880 }) {
  const { ref, tip, show, hide } = useTip();
  const L = 40, R = 10, T = 22, B = 44;
  const slot = Math.max(slot0, Math.floor((minW - L - R) / Math.max(1, groups.length)));
  const W = L + R + groups.length * slot;
  const H = height;
  const raw = Math.max(1, ...groups.flatMap((g) => series.map((k) => g.values[k] || 0)));
  const step = raw <= 10 ? 2 : raw <= 25 ? 5 : raw <= 50 ? 10 : raw <= 100 ? 20 : raw <= 250 ? 50 : raw <= 500 ? 100 : raw <= 1000 ? 200 : raw <= 2500 ? 500 : raw <= 5000 ? 1000 : 2000;
  const top = Math.ceil(raw / step) * step;
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const bw = Math.min(24, (slot - 18) / series.length - 2);
  const cluster = series.length * bw + (series.length - 1) * 2;
  const trunc = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : t);
  return (
    <div ref={ref} className="relative overflow-x-auto" onMouseLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: W > 700 ? W : undefined }} role="img" aria-label={ariaLabel || "Column chart"} data-column-chart>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">{v >= 1000 ? `${v / 1000}k` : v}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const cx = L + slot * gi + slot / 2, x0 = cx - cluster / 2, sel = selected === g.key;
          return (
            <g key={g.key} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(g.key)} data-group={g.key}
              onMouseMove={(e) => show(e, <><b>{g.title || g.label}</b>{series.map((k) => <div key={k}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: STAGES[k].color, marginRight: 5 }} />{STAGES[k].label}: {nf(g.values[k] || 0)}</div>)}{onSelect && <div style={{ opacity: 0.7, marginTop: 2 }}>Click for details</div>}</>)}>
              <rect x={L + slot * gi + 1} y={T - 6} width={slot - 2} height={H - T - B + 6} rx="6" fill={sel ? "var(--track)" : "transparent"} opacity={sel ? 0.45 : 1} />
              {series.map((k, si) => {
                const v = g.values[k] || 0, bh = Math.max(v > 0 ? 2 : 0, (H - T - B) * (v / top)), bx = x0 + si * (bw + 2), by = H - B - bh;
                return (
                  <g key={k}>
                    {bh > 0 && <path d={`M${bx},${H - B} V${by + 4} Q${bx},${by} ${bx + 4},${by} H${bx + bw - 4} Q${bx + bw},${by} ${bx + bw},${by + 4} V${H - B} Z`} fill={STAGES[k].color} />}
                    {labels && v > 0 && <text x={bx + bw / 2} y={by - 4} textAnchor="middle" fontSize="10" fill="var(--ink2)">{nf(v)}</text>}
                  </g>
                );
              })}
              <text x={cx} y={H - B + 15} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">{trunc(g.label, 11)}</text>
              {g.sub && <text x={cx} y={H - B + 29} textAnchor="middle" fontSize="10" fill="var(--muted)">{trunc(g.sub, 13)}</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--muted)" strokeWidth="1" />
      </svg>
      <Tip tip={tip} />
    </div>
  );
}
