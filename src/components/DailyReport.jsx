import { useEffect, useState, useRef } from "react";
import { Users, Package, Gauge, AlertTriangle } from "lucide-react";
import { supabase, fetchAll } from "../lib/fetchAll";
import { Card, StatCard, inputCls } from "./ui";
import ChartCanvas from "./ChartCanvas";
import ExportBar from "./ExportBar";
import { todayStr, fmtMoney, daysBetween } from "../lib/helpers";
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
  const [work, setWork] = useState({ rows: [], rcas: {}, error: "" }); // who worked on which order + RCA state
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All"); // All | Present | Half Day | Leave | Absent | Unmarked | Not working
  const [showNames, setShowNames] = useState(false);
  const tableRef = useRef(null);

  const load = async () => {
    try {
      const [employees, attendance, progress, orders, ops] = await Promise.all([
        fetchAll(() => supabase.from("employees").select("id, name, role, status").order("name")),
        fetchAll(() => supabase.from("attendance").select("employee_id, status, check_in, check_out").eq("date", date).order("id")),
        fetchAll(() => supabase.from("order_progress").select("order_id, hour_slot, item_description, quantity").eq("date", date).order("id")),
        fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, status, daily_target, due_date").order("id")),
        supabase.from("operation_output").select("operation, quantity").eq("work_date", date).then((r) => r.data || []),
      ]);
      const activeEmployees = employees.filter((e) => e.status !== "Inactive" || attendance.some((a) => a.employee_id === e.id));
      setData({ ...dailySummary({ date, employees: activeEmployees, attendance, progress, orders, ops }), orders });
      // who worked on which order (Manpower assignments + Operation log); wages only come back for Admin/HR
      const [wf, rca] = await Promise.all([
        supabase.rpc("daily_order_workforce", { p_date: date }),
        supabase.from("order_delay_rca").select("order_id"),
      ]);
      setWork({
        rows: wf.data || [],
        rcas: Object.fromEntries((rca.data || []).map((r) => [r.order_id, true])),
        error: wf.error ? wf.error.message + " (run migration_38.sql)" : "",
      });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_labor" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "operation_output" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (error) return <p className="text-sm text-rose-600">Couldn't load the report: {error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const d = data;
  const NOT_WORKING = ["Leave", "Absent", "Unmarked"];
  const shown = d.people.filter((p) => filter === "All" || (filter === "Not working" ? NOT_WORKING.includes(p.status) : p.status === filter));
  const FILTERS = ["All", "Present", "Half Day", "Leave", "Absent", "Unmarked", "Not working"];
  const countFor = (f) => (f === "All" ? d.people.length : f === "Not working" ? d.people.filter((p) => NOT_WORKING.includes(p.status)).length : d.people.filter((p) => p.status === f).length);
  const hitTarget = d.target > 0 ? Math.round((d.total / d.target) * 100) : null;
  const present = d.counts.Present + d.counts["Half Day"];
  // ----- orders worked today: pieces made + people + labour cost
  const orderById = Object.fromEntries((d.orders || []).map((o) => [o.id, o]));
  const piecesByOrder = {};
  d.items.forEach((i) => { piecesByOrder[i.order] = (piecesByOrder[i.order] || 0) + i.qty; });
  const crew = {};
  work.rows.forEach((r) => { (crew[r.order_id] = crew[r.order_id] || []).push(r); });
  const orderIds = Array.from(new Set([...Object.keys(crew), ...(d.orders || []).filter((o) => piecesByOrder[o.order_number]).map((o) => o.id)]));
  const showCost = work.rows.some((r) => r.wage_share !== null && r.wage_share !== undefined);
  const lateDays = (o) => (o?.due_date && o.due_date < date && !["Completed", "Shipped"].includes(o.status) ? daysBetween(o.due_date, date) : 0);
  const workedOrders = orderIds.map((id) => {
    const o = orderById[id] || {};
    const people = crew[id] || [];
    return {
      id, number: o.order_number || "—", customer: o.customer_name || "", pieces: piecesByOrder[o.order_number] || 0,
      names: people.map((p) => p.employee_name).sort(), count: people.length,
      cost: people.reduce((s, p) => s + Number(p.wage_share || 0), 0), late: lateDays(o),
    };
  }).sort((a, b) => b.late - a.late || b.pieces - a.pieces);
  const dayWorkers = new Set(work.rows.map((r) => r.employee_id)).size;
  const dayCost = work.rows.reduce((s, r) => s + Number(r.wage_share || 0), 0);
  const overdueOrders = (d.orders || []).map((o) => ({ o, late: lateDays(o) })).filter((x) => x.late > 0).sort((a, b) => b.late - a.late);
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
        heading: "Orders worked on today",
        table: {
          columns: [{ label: "Order" }, { label: "Customer" }, { label: "Pieces", type: "int" }, { label: "People", type: "int" }, ...(showCost ? [{ label: "Labour cost" }] : []), { label: "Who worked" }, { label: "Past due" }],
          rows: workedOrders.map((w) => [w.number, w.customer, w.pieces, w.count, ...(showCost ? [fmtMoney(w.cost)] : []), w.names.join(", "), w.late ? `${w.late} days late` : ""]),
        },
      },
      ...(overdueOrders.length ? [{
        heading: "Orders running past the due date",
        table: { columns: [{ label: "Order" }, { label: "Customer" }, { label: "Due" }, { label: "Days late", type: "int" }, { label: "Status" }, { label: "RCA" }], rows: overdueOrders.map(({ o, late }) => [o.order_number, o.customer_name, o.due_date, late, o.status, work.rcas[o.id] ? "Done" : "Pending"]) },
      }] : []),
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
        <button type="button" className="text-left" onClick={() => setShowNames((v) => !v)} title="Click to see who is on leave, absent or not marked">
          <StatCard label="Not working" value={`${d.counts.Leave + d.counts.Absent}`} icon={AlertTriangle} sub={`${d.counts.Leave} leave · ${d.counts.Absent} absent · ${d.counts.Unmarked} unmarked — tap for names`} tone={d.counts.Leave + d.counts.Absent > 0 ? "warn" : "slate"} />
        </button>
      </div>

      {showNames && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">Who isn't working on {date}</h3>
            <button className="text-xs text-stone-400 hover:text-stone-700" onClick={() => setShowNames(false)}>Close</button>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {NOT_WORKING.map((st) => {
              const list = d.people.filter((p) => p.status === st);
              return (
                <div key={st}>
                  <div className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${STATUS_STYLE[st]}`}>{st === "Unmarked" ? "Not marked" : st} · {list.length}</div>
                  {list.length === 0 ? <p className="text-xs text-stone-400">Nobody</p> : (
                    <ul className="text-sm space-y-0.5">
                      {list.map((p) => <li key={p.id}>{p.name} <span className="text-xs text-stone-400">{p.role}</span></li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <ChartCanvas spec={hourChart} />
        <ChartCanvas spec={itemChart} />
      </div>

      {overdueOrders.length > 0 && (
        <Card className="p-4 border-rose-300 bg-rose-50/60">
          <h3 className="font-semibold text-sm text-rose-800 flex items-center gap-1.5 mb-2"><AlertTriangle size={15} /> {overdueOrders.length} order{overdueOrders.length === 1 ? "" : "s"} running past the due date</h3>
          <div className="grid gap-1.5">
            {overdueOrders.map(({ o, late }) => (
              <div key={o.id} className="flex items-center justify-between gap-2 flex-wrap text-sm">
                <span className="font-medium text-rose-800">{o.order_number} <span className="font-normal text-rose-700/80">{o.customer_name} · due {o.due_date} · {o.status}</span></span>
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-rose-600 text-white">{late} day{late === 1 ? "" : "s"} late</span>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${work.rcas[o.id] ? "bg-stone-100 text-stone-600" : "bg-rose-100 text-rose-800"}`}>{work.rcas[o.id] ? "RCA done" : "RCA pending"}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm">Orders worked on {date}</h3>
          <span className="text-xs text-stone-500">{workedOrders.length} order{workedOrders.length === 1 ? "" : "s"} · {dayWorkers} people assigned{showCost ? ` · labour ${fmtMoney(dayCost)}` : ""}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Order</th><th className="text-right px-4 py-2">Pieces</th><th className="text-right px-4 py-2">People</th>
              {showCost && <th className="text-right px-4 py-2">Labour cost</th>}<th className="text-left px-4 py-2">Who worked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {workedOrders.map((w) => (
              <tr key={w.id} className={w.late ? "bg-rose-50 text-rose-900" : ""}>
                <td className="px-4 py-2 font-medium">{w.number}<div className="text-xs font-normal text-stone-400">{w.customer}</div>{w.late > 0 && <span className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-rose-600 text-white">{w.late}d past due</span>}</td>
                <td className="px-4 py-2 text-right font-mono">{w.pieces}</td>
                <td className="px-4 py-2 text-right font-mono">{w.count}</td>
                {showCost && <td className="px-4 py-2 text-right font-mono">{fmtMoney(w.cost)}</td>}
                <td className="px-4 py-2 text-xs text-stone-600">{w.names.join(", ") || <span className="text-stone-300">Nobody assigned</span>}</td>
              </tr>
            ))}
            {workedOrders.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-400">No order activity recorded on this day.</td></tr>}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-stone-400">
          People come from Orders → Manpower assignments and the Operation log. {showCost ? "Labour cost = each person's daily wage (base salary ÷ days in month), shared across the orders they worked on that day." : "Labour cost is visible to Admin and HR only."}
          {work.error ? <span className="text-rose-600"> {work.error}</span> : null}
        </p>
      </Card>

      <div ref={tableRef} className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-full border ${filter === f ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"}`}>
            {f === "Unmarked" ? "Not marked" : f} · {countFor(f)}
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2.5">Employee</th><th className="text-left px-4 py-2.5">Status</th><th className="text-left px-4 py-2.5">In</th><th className="text-left px-4 py-2.5">Out</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">{p.name}<div className="text-xs text-stone-400">{p.role}</div></td>
                <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{p.checkIn || "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.checkOut || "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400">No one with this status on {date}.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
