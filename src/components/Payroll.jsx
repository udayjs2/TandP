import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls, Btn } from "./ui";
import { daysInMonth, fmtMoney, monthKey } from "../lib/helpers";
import PrintPayslip from "./PrintPayslip";

export default function Payroll({ profile }) {
  if (profile?.role === "admin") return <AdminPayroll />;
  return <MyPayroll profile={profile} />;
}

// ---------- Admin: full team payroll ----------
function AdminPayroll() {
  const [mk, setMk] = useState(monthKey());
  const [employees, setEmployees] = useState([]);
  const [attByEmp, setAttByEmp] = useState({}); // { empId: { present, leave, absent } }
  const [payrollRows, setPayrollRows] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [settings, setSettings] = useState({});
  const [payslip, setPayslip] = useState(null);
  const totalDays = daysInMonth(mk);

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const [{ data: emp }, { data: att }, { data: pay }, { data: profs }, { data: set }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: true }),
      supabase.from("attendance").select("employee_id, status").gte("date", start).lte("date", end),
      supabase.from("payroll").select("*").eq("month", mk),
      supabase.from("profiles").select("*"),
      supabase.from("settings").select("*").eq("id", 1).single(),
    ]);
    setEmployees(emp || []);
    setProfiles(profs || []);
    setSettings(set || {});
    const byEmp = {};
    (att || []).forEach((r) => {
      byEmp[r.employee_id] = byEmp[r.employee_id] || { present: 0, leave: 0, absent: 0 };
      if (r.status === "Present") byEmp[r.employee_id].present += 1;
      else if (r.status === "Half Day") byEmp[r.employee_id].present += 0.5;
      else if (r.status === "Leave") byEmp[r.employee_id].leave += 1;
      else if (r.status === "Absent") byEmp[r.employee_id].absent += 1;
    });
    setAttByEmp(byEmp);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, load)
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

  const linkAccount = async (empId, profileId) => {
    // clear any existing profile linked to this employee
    const previouslyLinked = profiles.find((p) => p.employee_id === empId);
    if (previouslyLinked && previouslyLinked.id !== profileId) {
      await supabase.from("profiles").update({ employee_id: null }).eq("id", previouslyLinked.id);
    }
    if (profileId) {
      await supabase.from("profiles").update({ employee_id: empId }).eq("id", profileId);
    }
    load();
  };

  const rows = employees.map((e) => {
    const att = attByEmp[e.id] || { present: 0, leave: 0, absent: 0 };
    const daily = (Number(e.base_salary) || 0) / totalDays;
    const entry = payrollRows[e.id] || { bonus: 0, deductions: 0, status: "Pending" };
    const net = daily * att.present + Number(entry.bonus || 0) - Number(entry.deductions || 0);
    const linkedProfile = profiles.find((p) => p.employee_id === e.id);
    return { emp: e, att, entry, net, linkedProfile };
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
              <th className="text-right px-4 py-2.5">Present</th>
              <th className="text-right px-4 py-2.5">Leaves</th>
              <th className="text-right px-4 py-2.5">Bonus (₹)</th>
              <th className="text-right px-4 py-2.5">Deductions (₹)</th>
              <th className="text-right px-4 py-2.5">Net pay</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Login account</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ emp, att, entry, net, linkedProfile }) => (
              <tr key={emp.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium">{emp.name}</td>
                <td className="px-4 py-2.5 text-right font-mono">{att.present}/{totalDays}</td>
                <td className="px-4 py-2.5 text-right font-mono">{att.leave}</td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number"
                    min="0"
                    className="w-20 border border-stone-300 rounded px-2 py-1 text-right font-mono text-sm"
                    defaultValue={entry.bonus}
                    key={`bonus-${emp.id}-${mk}`}
                    onBlur={(e) => updateEntry(emp.id, { bonus: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number"
                    min="0"
                    className="w-20 border border-stone-300 rounded px-2 py-1 text-right font-mono text-sm"
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
                <td className="px-4 py-2.5">
                  <select
                    className="text-xs border border-stone-300 rounded px-1.5 py-1"
                    value={linkedProfile?.id || ""}
                    onChange={(e) => linkAccount(emp.id, e.target.value || null)}
                  >
                    <option value="">— none —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.role})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => setPayslip({ employee: emp, att })}
                    className="text-stone-400 hover:text-indigo-700 p-1"
                    title="Generate payslip"
                  >
                    <Receipt size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400">
                  Add employees first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-stone-400">
        Net pay = (base salary ÷ days in month) × present days + bonus − deductions. Link a login account so staff
        can see their own payroll and leave count under their own Payroll tab.
      </p>
      {payslip && (
        <PrintPayslip
          employee={payslip.employee}
          month={mk}
          present={payslip.att.present}
          leaves={payslip.att.leave}
          absent={payslip.att.absent}
          totalDays={totalDays}
          entry={payrollRows[payslip.employee.id] || { bonus: 0, deductions: 0 }}
          net={
            (Number(payslip.employee.base_salary) || 0) / totalDays * payslip.att.present +
            Number((payrollRows[payslip.employee.id] || {}).bonus || 0) -
            Number((payrollRows[payslip.employee.id] || {}).deductions || 0)
          }
          settings={settings}
          onClose={() => setPayslip(null)}
        />
      )}
    </div>
  );
}

// ---------- Staff: their own payroll only ----------
function MyPayroll({ profile }) {
  const [mk, setMk] = useState(monthKey());
  const [employee, setEmployee] = useState(null);
  const [att, setAtt] = useState({ present: 0, leave: 0, absent: 0 });
  const [entry, setEntry] = useState({ bonus: 0, deductions: 0, status: "Pending" });
  const [settings, setSettings] = useState({});
  const [showPayslip, setShowPayslip] = useState(false);
  const [loading, setLoading] = useState(true);
  const totalDays = daysInMonth(mk);

  const load = async () => {
    if (!profile?.employee_id) {
      setLoading(false);
      return;
    }
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const [{ data: emp }, { data: attRows }, { data: pay }, { data: set }] = await Promise.all([
      supabase.from("employees").select("*").eq("id", profile.employee_id).single(),
      supabase.from("attendance").select("status").eq("employee_id", profile.employee_id).gte("date", start).lte("date", end),
      supabase.from("payroll").select("*").eq("employee_id", profile.employee_id).eq("month", mk).maybeSingle(),
      supabase.from("settings").select("*").eq("id", 1).single(),
    ]);
    setEmployee(emp || null);
    const counts = { present: 0, leave: 0, absent: 0 };
    (attRows || []).forEach((r) => {
      if (r.status === "Present") counts.present += 1;
      else if (r.status === "Half Day") counts.present += 0.5;
      else if (r.status === "Leave") counts.leave += 1;
      else if (r.status === "Absent") counts.absent += 1;
    });
    setAtt(counts);
    setEntry(pay || { bonus: 0, deductions: 0, status: "Pending" });
    setSettings(set || {});
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk, profile?.employee_id]);

  if (loading) return <p className="text-sm text-stone-500">Loading…</p>;

  if (!profile?.employee_id) {
    return (
      <Card className="p-6 text-sm text-stone-600">
        Your login isn't linked to an employee record yet, so payroll details aren't available here.
        Ask your admin to link your account from the Payroll tab.
      </Card>
    );
  }

  const daily = (Number(employee?.base_salary) || 0) / totalDays;
  const net = daily * att.present + Number(entry.bonus || 0) - Number(entry.deductions || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">My payroll</h2>
        <input type="month" value={mk} onChange={(e) => setMk(e.target.value)} className={inputCls + " w-auto"} />
      </div>
      <Card className="p-5 max-w-md">
        <div className="font-semibold mb-1">{employee?.name}</div>
        <div className="text-xs text-stone-500 mb-4">{employee?.employee_number} · {employee?.department || "—"}</div>
        <div className="grid grid-cols-2 gap-y-2 text-sm mb-4">
          <span className="text-stone-500">Present days</span>
          <span className="text-right font-mono">{att.present} / {totalDays}</span>
          <span className="text-stone-500">Leaves taken</span>
          <span className="text-right font-mono">{att.leave}</span>
          <span className="text-stone-500">Absent days</span>
          <span className="text-right font-mono">{att.absent}</span>
          <span className="text-stone-500">Bonus</span>
          <span className="text-right font-mono">{fmtMoney(entry.bonus)}</span>
          <span className="text-stone-500">Deductions</span>
          <span className="text-right font-mono">−{fmtMoney(entry.deductions)}</span>
        </div>
        <div className="flex justify-between items-center border-t border-stone-200 pt-3 mb-4">
          <span className="font-semibold">Net pay</span>
          <span className="font-mono font-bold text-lg">{fmtMoney(net)}</span>
        </div>
        <Btn onClick={() => setShowPayslip(true)} className="w-full justify-center">
          <Receipt size={15} /> Generate payslip
        </Btn>
      </Card>
      {showPayslip && employee && (
        <PrintPayslip
          employee={employee}
          month={mk}
          present={att.present}
          leaves={att.leave}
          absent={att.absent}
          totalDays={totalDays}
          entry={entry}
          net={net}
          settings={settings}
          onClose={() => setShowPayslip(false)}
        />
      )}
    </div>
  );
}
