import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Card, inputCls } from "./ui";
import { daysInMonth, fmtMoney, monthKey } from "../lib/helpers";

export default function Payroll() {
  const [mk, setMk] = useState(monthKey());
  const [employees, setEmployees] = useState([]);
  const [attCounts, setAttCounts] = useState({});
  const [payrollRows, setPayrollRows] = useState({});
  const totalDays = daysInMonth(mk);

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const [{ data: emp }, { data: att }, { data: pay }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: true }),
      supabase.from("attendance").select("employee_id, status").gte("date", start).lte("date", end),
      supabase.from("payroll").select("*").eq("month", mk),
    ]);
    setEmployees(emp || []);
    const counts = {};
    (att || []).forEach((r) => {
      const add = r.status === "Present" ? 1 : r.status === "Half Day" ? 0.5 : 0;
      counts[r.employee_id] = (counts[r.employee_id] || 0) + add;
    });
    setAttCounts(counts);
    const rows = {};
    (pay || []).forEach((r) => (rows[r.employee_id] = r));
    setPayrollRows(rows);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("payroll-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "payroll" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  const updateEntry = async (empId, patch) => {
    const existing = payrollRows[empId] || { bonus: 0, deductions: 0, status: "Pending" };
    const next = { ...existing, ...patch, employee_id: empId, month: mk };
    delete next.id;
    await supabase.from("payroll").upsert(next, { onConflict: "employee_id,month" });
    load();
  };

  const rows = employees.map((e) => {
    const present = attCounts[e.id] || 0;
    const daily = (Number(e.base_salary) || 0) / totalDays;
    const entry = payrollRows[e.id] || { bonus: 0, deductions: 0, status: "Pending" };
    const net = daily * present + Number(entry.bonus || 0) - Number(entry.deductions || 0);
    return { emp: e, present, entry, net };
  });
  const totalPayout = rows.reduce((s, r) => s + r.net, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Payroll</h2>
        <div className="flex items-center gap-2">
          <input type="month" value={mk} onChange={(e) => setMk(e.target.value)} className={inputCls + " w-auto"} />
          <span className="text-sm text-stone-500 font-mono">Total: {fmtMoney(totalPayout)}</span>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th>
              <th className="text-right px-4 py-2.5">Present days</th>
              <th className="text-right px-4 py-2.5">Bonus (₹)</th>
              <th className="text-right px-4 py-2.5">Deductions (₹)</th>
              <th className="text-right px-4 py-2.5">Net pay</th>
              <th className="text-left px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ emp, present, entry, net }) => (
              <tr key={emp.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium">{emp.name}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {present}/{totalDays}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number"
                    min="0"
                    className="w-24 border border-stone-300 rounded px-2 py-1 text-right font-mono text-sm"
                    defaultValue={entry.bonus}
                    key={`bonus-${emp.id}-${mk}`}
                    onBlur={(e) => updateEntry(emp.id, { bonus: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number"
                    min="0"
                    className="w-24 border border-stone-300 rounded px-2 py-1 text-right font-mono text-sm"
                    defaultValue={entry.deductions}
                    key={`ded-${emp.id}-${mk}`}
                    onBlur={(e) => updateEntry(emp.id, { deductions: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtMoney(net)}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => updateEntry(emp.id, { status: entry.status === "Paid" ? "Pending" : "Paid" })}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      entry.status === "Paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {entry.status === "Paid" ? "Paid" : "Mark paid"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Add employees first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-stone-400">Net pay = (base salary ÷ days in month) × present days + bonus − deductions. Bonus/deduction fields save when you click away from the box.</p>
    </div>
  );
}
