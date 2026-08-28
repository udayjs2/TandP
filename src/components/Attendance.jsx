import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Card, inputCls, Btn } from "./ui";
import { daysInMonth, todayStr } from "../lib/helpers";

const ATT_STATUSES = ["Present", "Absent", "Half Day", "Leave"];
const ATT_COLORS = {
  Present: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Absent: "bg-rose-100 text-rose-800 border-rose-300",
  "Half Day": "bg-amber-100 text-amber-800 border-amber-300",
  Leave: "bg-stone-200 text-stone-700 border-stone-300",
};

export default function Attendance({ profile }) {
  const [employees, setEmployees] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [dayRecord, setDayRecord] = useState({});
  const [monthCounts, setMonthCounts] = useState({});

  const mk = date.slice(0, 7);
  const totalDays = daysInMonth(mk);

  const loadEmployees = async () => {
    const { data } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
    setEmployees(data || []);
  };

  const loadDay = async () => {
    const { data } = await supabase.from("attendance").select("employee_id, status").eq("date", date);
    const rec = {};
    (data || []).forEach((r) => (rec[r.employee_id] = r.status));
    setDayRecord(rec);
  };

  const loadMonth = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const { data } = await supabase.from("attendance").select("employee_id, status").gte("date", start).lte("date", end);
    const counts = {};
    (data || []).forEach((r) => {
      const add = r.status === "Present" ? 1 : r.status === "Half Day" ? 0.5 : 0;
      counts[r.employee_id] = (counts[r.employee_id] || 0) + add;
    });
    setMonthCounts(counts);
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadDay();
    loadMonth();
    const ch = supabase
      .channel("attendance-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => {
        loadDay();
        loadMonth();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const setStatus = async (empId, status) => {
    await supabase.from("attendance").upsert({ employee_id: empId, date, status }, { onConflict: "employee_id,date" });
    loadDay();
    loadMonth();
  };

  const markAll = async (status) => {
    const rows = employees.map((e) => ({ employee_id: e.id, date, status }));
    await supabase.from("attendance").upsert(rows, { onConflict: "employee_id,date" });
    loadDay();
    loadMonth();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Attendance</h2>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
          <Btn variant="ghost" onClick={() => markAll("Present")}>
            Mark all present
          </Btn>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th>
              <th className="text-left px-4 py-2.5">Department</th>
              <th className="text-left px-4 py-2.5">Status ({date})</th>
              <th className="text-right px-4 py-2.5">Present days this month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {employees.map((e) => (
              <tr key={e.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium">{e.name}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.department || "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {ATT_STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(e.id, s)}
                        className={`text-xs px-2 py-1 rounded-full border font-medium ${
                          dayRecord[e.id] === s ? ATT_COLORS[s] : "bg-white text-stone-400 border-stone-200 hover:border-stone-300"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {monthCounts[e.id] || 0} / {totalDays}
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                  Add employees first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {profile?.name && <p className="text-xs text-stone-400">Marking as {profile.name}</p>}
    </div>
  );
}
