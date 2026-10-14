import { useEffect, useState } from "react";
import { AlertTriangle, Info, TrendingDown, TrendingUp, Lightbulb } from "lucide-react";
import { supabase, fetchAll } from "../lib/fetchAll";
import { Card, StatCard, inputCls } from "./ui";
import ChartCanvas from "./ChartCanvas";
import ExportBar from "./ExportBar";
import DailyReport from "./DailyReport";
import OperationLog from "./OperationLog";
import { analyse, periodRange, PERIODS, shortDate } from "../lib/analytics";

const SUBS = [
  { id: "daily", label: "Daily report" },
  { id: "why", label: "Why did output change?" },
  { id: "ops", label: "Operation log" },
];

export default function Insights({ profile }) {
  const [sub, setSub] = useState("daily");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Insights</h2>
        <p className="text-xs text-stone-500 mt-0.5">Daily output and attendance, and a plain-language explanation of why production went up or down.</p>
      </div>
      <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
        {SUBS.map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${sub === t.id ? "border-indigo-600 text-indigo-700 font-medium" : "border-transparent text-stone-500 hover:text-stone-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === "daily" && <DailyReport />}
      {sub === "why" && <WhyChanged />}
      {sub === "ops" && <OperationLog profile={profile} />}
    </div>
  );
}

const SEV = {
  high: { cls: "border-l-rose-500", icon: AlertTriangle, tone: "text-rose-600" },
  medium: { cls: "border-l-amber-500", icon: AlertTriangle, tone: "text-amber-600" },
  info: { cls: "border-l-sky-400", icon: Info, tone: "text-sky-600" },
};

function WhyChanged() {
  const [periodId, setPeriodId] = useState("last_week");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const range = periodRange(periodId);

  const load = async () => {
    setResult(null);
    try {
      const { from, to, prevFrom } = range;
      const sumSizes = (s) => Object.values(s || {}).reduce((a, v) => a + (Number(v) || 0), 0);
      const [employees, attendance, progress, cuts, ops, orders, fabricReqs, fabrics, cutProfiles, allCuts, allProgress] = await Promise.all([
        fetchAll(() => supabase.from("employees").select("id, name, role").order("id")),
        fetchAll(() => supabase.from("attendance").select("employee_id, date, status").gte("date", prevFrom).lte("date", to).order("id")),
        fetchAll(() => supabase.from("order_progress").select("order_id, date, hour_slot, item_description, quantity").gte("date", prevFrom).lte("date", to).order("id")),
        fetchAll(() => supabase.from("cutting_entries").select("order_id, cut_date, sizes, status").gte("cut_date", prevFrom).lte("cut_date", to).neq("status", "Rejected").order("id")),
        fetchAll(() => supabase.from("operation_output").select("*").gte("work_date", prevFrom).lte("work_date", to).order("id")),
        fetchAll(() => supabase.from("orders").select("id, order_number, status, daily_target").order("id")),
        fetchAll(() => supabase.from("purchase_requests").select("item, order_id, status, category, expected_arrival, received_at").eq("category", "Fabric").order("id")),
        fetchAll(() => supabase.from("inventory_fabric").select("fabric_type, color, stock_kg, stock_meters").order("id")),
        supabase.from("profiles").select("employee_id").eq("role", "cutting_master").then((r) => r.data || []),
        fetchAll(() => supabase.from("cutting_entries").select("order_id, sizes").eq("status", "Approved").order("id")),
        fetchAll(() => supabase.from("order_progress").select("order_id, quantity").order("id")),
      ]);
      const cuttingEmpIds = new Set(cutProfiles.map((p) => p.employee_id).filter(Boolean));
      employees.filter((e) => /cutting/i.test(e.role || "")).forEach((e) => cuttingEmpIds.add(e.id));
      const orderTotals = {};
      allCuts.forEach((c) => {
        orderTotals[c.order_id] = orderTotals[c.order_id] || { cut: 0, stitched: 0 };
        orderTotals[c.order_id].cut += sumSizes(c.sizes);
      });
      allProgress.forEach((p) => {
        orderTotals[p.order_id] = orderTotals[p.order_id] || { cut: 0, stitched: 0 };
        orderTotals[p.order_id].stitched += Number(p.quantity) || 0;
      });
      setResult(analyse({ ...range, employees, attendance, progress, cuts, ops, orders, fabricReqs, fabrics, orderTotals, cuttingEmpIds }));
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  if (error) return <p className="text-sm text-rose-600">Couldn't build the analysis: {error}</p>;

  const periodLabel = `${shortDate(range.from)} – ${shortDate(range.to)} vs ${shortDate(range.prevFrom)} – ${shortDate(range.prevTo)}`;

  const header = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <select className={inputCls + " w-auto"} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <span className="text-xs text-stone-500">{periodLabel}</span>
      </div>
    </div>
  );
  if (!result) return <div className="space-y-4">{header}<p className="text-sm text-stone-500">Analysing…</p></div>;

  const r = result;
  const dropped = r.delta < 0;
  const outputChart = {
    type: "bar", title: "Output per day (pcs)", labels: r.daily.map((d) => d.label),
    series: [{ name: "Previous period", values: r.daily.map((d) => d.prevOutput), color: "#a8a29e" }, { name: "This period", values: r.daily.map((d) => d.output), color: "#4338ca" }],
  };
  const peopleChart = {
    type: "line", title: "People present per day", labels: r.daily.map((d) => d.label),
    series: [{ name: "Previous period", values: r.daily.map((d) => d.prevPresent), color: "#a8a29e" }, { name: "This period", values: r.daily.map((d) => d.present), color: "#059669" }],
  };
  const cutChart = {
    type: "bar", title: "Pieces cut per day", labels: r.daily.map((d) => d.label),
    series: [{ name: "Cut", values: r.daily.map((d) => d.cut), color: "#d97706" }],
  };
  const hourChart = { type: "bar", title: "Output by hour of day (pcs)", labels: r.hourVals.map((h) => h.label.replace(" AM", "").replace(" PM", "")), series: [{ name: "Output", values: r.hourVals.map((h) => h.qty), color: "#0284c7" }] };
  const opChart = { type: "hbar", title: "Pieces completed per operation", labels: r.opTable.map((o) => o.operation), series: [{ name: "Pieces", values: r.opTable.map((o) => o.pieces), color: "#7c3aed" }] };
  const charts = [outputChart, peopleChart, cutChart, hourChart, ...(r.opTable.length ? [opChart] : [])];

  const buildReport = () => ({
    title: "Why did production change?",
    subtitle: `${periodLabel} - T&P Textiles`,
    filename: `production-insights-${range.from}_to_${range.to}`,
    sections: [
      {
        heading: "Summary",
        kpis: [
          { label: "Output", value: `${Math.round(r.cur.totalOutput)} pcs` },
          { label: "Previous period", value: `${Math.round(r.prev.totalOutput)} pcs` },
          { label: "Change", value: r.change === null ? "n/a" : `${r.change > 0 ? "+" : ""}${Math.round(r.change * 10) / 10}%` },
          { label: "Avg people present", value: `${Math.round(r.cur.avgPresent * 10) / 10}` },
          { label: "Output per person-day", value: `${Math.round(r.cur.perPerson * 10) / 10}` },
          { label: "Leave days taken", value: String(r.cur.leaveDays) },
          { label: "Pieces cut", value: String(Math.round(r.cur.totalCut)) },
          { label: "Working days", value: String(r.cur.workingDays.length) },
        ],
      },
      { heading: "What the data says", bullets: r.findings.map((f) => `${f.title}. ${f.detail} Suggested action: ${f.action}`) },
      { heading: "Charts", charts },
      {
        heading: "Daily numbers",
        table: {
          columns: [{ label: "Day" }, { label: "Output", type: "int" }, { label: "Previous", type: "int" }, { label: "People", type: "num" }, { label: "Cut", type: "int" }],
          rows: r.daily.map((d) => [d.label, d.output, d.prevOutput, d.present, d.cut]),
        },
      },
      ...(r.leaveRows.length ? [{ heading: "Leave taken", table: { columns: [{ label: "Employee" }, { label: "Leave days", type: "int" }], rows: r.leaveRows.map((l) => [l.name, l.days]) } }] : []),
      ...(r.opTable.length ? [{ heading: "Operations", table: { columns: [{ label: "Operation" }, { label: "Pieces", type: "int" }, { label: "Pieces per person-day", type: "num" }, { label: "vs busiest operation", type: "pct" }], rows: r.opTable.map((o) => [o.operation, o.pieces, o.perPersonDay, o.completion]) } }] : []),
      ...(r.workloadTable.length ? [{ heading: "Workload by person", table: { columns: [{ label: "Employee" }, { label: "Pieces", type: "int" }, { label: "Days", type: "int" }, { label: "Pieces per day", type: "num" }, { label: "vs average", type: "pct" }], rows: r.workloadTable.map((w) => [w.name, w.pieces, w.days, w.perDay, w.vsAverage]) } }] : []),
    ],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {header}
        <ExportBar buildReport={buildReport} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Output" value={`${Math.round(r.cur.totalOutput)}`} icon={dropped ? TrendingDown : TrendingUp} tone={dropped ? "bad" : "good"} sub={r.change === null ? "No earlier data" : `${r.change > 0 ? "+" : ""}${Math.round(r.change * 10) / 10}% vs ${Math.round(r.prev.totalOutput)} before`} />
        <StatCard label="Avg people present" value={`${Math.round(r.cur.avgPresent * 10) / 10}`} sub={`${Math.round(r.prev.avgPresent * 10) / 10} before`} />
        <StatCard label="Output / person-day" value={`${Math.round(r.cur.perPerson * 10) / 10}`} sub={`${Math.round(r.prev.perPerson * 10) / 10} before`} />
        <StatCard label="Leave days" value={`${r.cur.leaveDays}`} tone={r.cur.leaveDays > r.prev.leaveDays ? "warn" : "slate"} sub={`${r.prev.leaveDays} before`} />
      </div>

      <div className="space-y-2.5">
        <h3 className="font-semibold text-sm">What the data says</h3>
        {r.findings.map((f, i) => {
          const S = SEV[f.severity];
          const Icon = S.icon;
          return (
            <Card key={i} className={`p-3.5 border-l-4 ${S.cls}`}>
              <div className="flex items-start gap-2">
                <Icon size={16} className={`${S.tone} mt-0.5 shrink-0`} />
                <div className="min-w-0">
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-stone-600 mt-0.5">{f.detail}</div>
                  <div className="text-xs text-indigo-800 mt-1.5 flex gap-1.5"><Lightbulb size={12} className="mt-0.5 shrink-0" /> {f.action}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {charts.map((c) => <ChartCanvas key={c.title} spec={c} />)}
      </div>

      {r.opTable.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-2.5">Operation</th><th className="text-right px-4 py-2.5">Pieces</th><th className="text-right px-4 py-2.5">Per person-day</th><th className="text-right px-4 py-2.5">vs busiest operation</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.opTable.map((o) => (
                <tr key={o.operation}>
                  <td className="px-4 py-2">{o.operation}</td>
                  <td className="px-4 py-2 text-right font-mono">{o.pieces}</td>
                  <td className="px-4 py-2 text-right font-mono">{Math.round(o.perPersonDay * 10) / 10}</td>
                  <td className={`px-4 py-2 text-right font-mono ${o.completion !== null && o.completion < 80 ? "text-rose-600 font-semibold" : ""}`}>{o.completion === null ? "—" : `${Math.round(o.completion)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {r.workloadTable.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-2.5">Person</th><th className="text-right px-4 py-2.5">Pieces</th><th className="text-right px-4 py-2.5">Days</th><th className="text-right px-4 py-2.5">Per day</th><th className="text-right px-4 py-2.5">vs team average</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.workloadTable.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-2">{w.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{w.pieces}</td>
                  <td className="px-4 py-2 text-right font-mono">{w.days}</td>
                  <td className="px-4 py-2 text-right font-mono">{Math.round(w.perDay * 10) / 10}</td>
                  <td className={`px-4 py-2 text-right font-mono ${w.vsAverage >= 130 || w.vsAverage <= 70 ? "text-amber-700 font-semibold" : ""}`}>{Math.round(w.vsAverage)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
