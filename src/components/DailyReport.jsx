import { useEffect, useState } from "react";
import { Users, Package, Gauge, AlertTriangle } from "lucide-react";
import { supabase, fetchAll } from "../lib/fetchAll";
import { Card, StatCard, inputCls } from "./ui";
import ChartCanvas from "./ChartCanvas";
import ExportBar from "./ExportBar";
import { todayStr } from "../lib/helpers";
import { dailySummary } from "../lib/analytics";

const STATUS_STYLE = {
  Present: "bg-emerald-100 text-emerald-800",
  "Half Day": "bg-amber-100 text-amber-800",
  Leave: "bg-sky-100 text-sky-800",
  Absent: "bg-rose-100 text-rose-800",
  Unmarked: "bg-stone-100 text-stone-500",
};

export default function DailyReport() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [employees, attendance, progress, orders, ops] = await Promise.all([
        fetchAll(() => supabase.from("employees").select("id, name, role").order("name")),
        fetchAll(() => supabase.from("attendance").select("employee_id, status, check_in, check_out").eq("date", date).order("id")),
        fetchAll(() => supabase.from("order_progress").select("order_id, hour_slot, item_description, quantity").eq("date", date).order("id")),
        fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, status, daily_target").order("id")),
        supabase.from("operation_output").select("operation, quantity").eq("work_date", date).then((r) => r.data || []),
      ]);
      setData(dailySummary({ date, employees, attendance, progress, orders, ops }));
      setError("");
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  useEffect(() => {
    setData(null);
    load();
    const ch = supabase
      .channel("daily-report")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (error) return <p className="text-sm text-rose-600">Couldn't load the report: {error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const d = data;
  const hitTarget = d.target > 0 ? Math.round((d.total / d.target) * 100) : null;
  const present = d.counts.Present + d.counts["Half Day"];
  const hourChart = { type: "bar", title: "Output by hour (pcs)", labels: d.hours.map((h) => h.label.replace(" AM", "").replace(" PM", "")), series: [{ name: "Output", values: d.hours.map((h) => h.qty) }] };
  const itemChart = { type: "hbar", title: "Output by order / item (pcs)", labels: d.items.slice(0, 10).map((i) => `${i.order} ${i.item}`), series: [{ name: "Output", values: d.items.slice(0, 10).map((i) => i.qty) }] };

  const buildReport = () => ({
    title: "Daily production report",
    subtitle: `${date} - T&P Textiles`,
    filename: `daily-report-${date}`,
    sections: [
      {
        heading: "Summary",
        kpis: [
          { label: "Total output", value: `${d.total} pcs` },
          { label: "Daily target", value: d.target ? `${d.target} pcs (${hitTarget}%)` : "Not set" },
          { label: "People present", value: `${d.counts.Present} (+${d.counts["Half Day"]} half day)` },
          { label: "Output per person", value: `${Math.round(d.perPerson * 10) / 10} pcs` },
          { label: "On leave", value: String(d.counts.Leave) },
          { label: "Absent", value: String(d.counts.Absent) },
          { label: "Attendance not marked", value: String(d.counts.Unmarked) },
          { label: "Late arrivals", value: String(d.late) },
        ],
      },
      { heading: "Output charts", charts: [hourChart, itemChart] },
      {
        heading: "Output by order and item",
        table: { columns: [{ label: "Order" }, { label: "Customer" }, { label: "Item" }, { label: "Pieces", type: "int" }], rows: d.items.map((i) => [i.order, i.customer, i.item, i.qty]) },
      },
      {
        heading: "Attendance",
        table: {
          columns: [{ label: "Employee" }, { label: "Role" }, { label: "Status" }, { label: "In" }, { label: "Out" }],
          rows: d.people.map((p) => [p.name, p.role, p.status, p.checkIn, p.checkOut]),
        },
      },
    ],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
        <ExportBar buildReport={buildReport} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Output" value={`${d.total}`} icon={Package} sub={hitTarget !== null ? `${hitTarget}% of ${d.target} target` : "No daily target set"} tone={hitTarget !== null && hitTarget < 80 ? "bad" : "slate"} />
        <StatCard label="People present" value={`${d.counts.Present}`} icon={Users} sub={`+${d.counts["Half Day"]} half day · ${d.late} late`} tone="good" />
        <StatCard label="Output / person" value={`${Math.round(d.perPerson * 10) / 10}`} icon={Gauge} sub={present ? `${present} people clocked in` : "Nobody marked present"} />
        <StatCard label="Not working" value={`${d.counts.Leave + d.counts.Absent}`} icon={AlertTriangle} sub={`${d.counts.Leave} leave · ${d.counts.Absent} absent · ${d.counts.Unmarked} unmarked`} tone={d.counts.Leave + d.counts.Absent > 0 ? "warn" : "slate"} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <ChartCanvas spec={hourChart} />
        <ChartCanvas spec={itemChart} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">In</th><th className="text-left px-4 py-2.5">Out</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.people.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.name}<div className="text-xs text-stone-400">{p.role}</div></td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{p.checkIn || "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.checkOut || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
