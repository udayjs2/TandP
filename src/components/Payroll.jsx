import { useEffect, useState } from "react";
import { Receipt, CalendarDays } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls, Btn, Modal, SearchBox, matchQ } from "./ui";
import AttendanceCalendar from "./AttendanceCalendar";
import { attendanceBonusFor, bonusQuarterFor, todayStr, daysInMonth, fmtMoney, monthKey, paidDaysFromAttendance, salaryAfterDeductions, perDaySalary, workingDaysInMonth } from "../lib/helpers";
import PrintPayslip from "./PrintPayslip";

export default function Payroll({ profile }) {
  if (profile?.role === "admin" || profile?.role === "hr") return <AdminPayroll />;
  return <MyPayroll profile={profile} />;
}

// ---------- Admin: full team payroll ----------
function AdminPayroll() {
  const [mk, setMk] = useState(monthKey());
  const [q, setQ] = useState("");
  const [employees, setEmployees] = useState([]);
  const [attByEmp, setAttByEmp] = useState({}); // { empId: { present, leave, absent } }
  const [payrollRows, setPayrollRows] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [settings, setSettings] = useState({});
  const [payslip, setPayslip] = useState(null);
  const [attBonus, setAttBonus] = useState({}); // { empId: { amount, label } } — attendance bonus paid in the first month of a quarter
  const [calFor, setCalFor] = useState(null); // { employee } shown in the attendance calendar
  const [rawAtt, setRawAtt] = useState({}); // { empId: [{date,status}] }
  const [investors, setInvestors] = useState([]);
  const [defaultInvestor, setDefaultInvestor] = useState(""); // used when "Mark paid" is clicked on a row with no investor
  const totalDays = daysInMonth(mk);
  const workingDays = workingDaysInMonth(mk);

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const [{ data: empAll }, { data: att }, { data: pay }, { data: profs }, { data: set }, { data: inv }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: true }),
      supabase.from("attendance").select("employee_id, date, status").gte("date", start).lte("date", end),
      supabase.from("payroll").select("*").eq("month", mk),
      supabase.from("profiles").select("*"),
      supabase.from("settings").select("*").eq("id", 1).single(),
      supabase.rpc("investor_names"),
    ]);
    setInvestors(inv || []);
    // inactive employees drop off the list unless they already have payroll for this month
    const emp = (empAll || []).filter((e) => e.status !== "Inactive" || (pay || []).some((p) => p.employee_id === e.id));
    setEmployees(emp || []);
    setProfiles(profs || []);
    setSettings(set || {});
    const grouped = {};
    (att || []).forEach((r) => (grouped[r.employee_id] = grouped[r.employee_id] || []).push(r));
    const byEmp = {};
    (emp || []).forEach((e) => {
      byEmp[e.id] = paidDaysFromAttendance(grouped[e.id] || [], mk, { joined: e.join_date || "" });
    });
    setRawAtt(grouped);
    // attendance bonus: first month of a quarter pays last quarter's 4 earned-leave days to anyone with a perfect quarter
    const qMonths = bonusQuarterFor(mk);
    const bonuses = {};
    if (qMonths) {
      const qStart = `${qMonths[0]}-01`;
      const qEnd = `${qMonths[2]}-${String(daysInMonth(qMonths[2])).padStart(2, "0")}`;
      const { data: qAtt } = await supabase.from("attendance").select("employee_id, date, status").gte("date", qStart).lte("date", qEnd);
      const byQ = {};
      (qAtt || []).forEach((r) => (byQ[r.employee_id] = byQ[r.employee_id] || []).push(r));
      (emp || []).forEach((e) => { const b = attendanceBonusFor(e.base_salary, byQ[e.id] || [], qMonths, e.join_date || "", todayStr()); if (b) bonuses[e.id] = b; });
    }
    setAttBonus(bonuses);
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
    // The net amount is stored with the row so a Paid salary posts to Finance -> Expenditures
    // (category "Salary") with the exact figure shown here. Re-saved on any bonus/deduction edit.
    const emp = employees.find((x) => x.id === empId);
    const att = attByEmp[empId] || { deductDays: 0 };
    next.net_pay = Math.max(0, Math.round((salaryAfterDeductions(emp?.base_salary, att.deductDays) + (attBonus[empId]?.amount || 0) + Number(next.bonus || 0) - Number(next.deductions || 0)) * 100) / 100);
    delete next.paid_at;
    if (next.status === "Paid" && !next.investor_id && defaultInvestor) next.investor_id = defaultInvestor;
    if (!next.investor_id) next.investor_id = null;
    if (next.status === "Paid" && next.net_pay <= 0) { alert("Net pay is 0, so there is nothing to record as paid."); return; }
    if (next.status === "Paid" && existing.status !== "Paid" && !confirm(`Mark ${emp?.name || "employee"} as paid ${fmtMoney(next.net_pay)}? This is recorded in Finance as a Salary expenditure${next.investor_id ? `, funded by ${investors.find((i) => i.id === next.investor_id)?.name || "the selected investor"}` : " (no investor selected)"}.`)) return;
    if (existing.status === "Paid" && next.status !== "Paid" && !confirm("Mark as Pending? The salary entry will be removed from Finance expenditures.")) return;
    const { error } = await supabase.from("payroll").upsert(next, { onConflict: "employee_id,month" });
    if (error) alert("Couldn't save payroll: " + error.message + "\n(If it mentions net_pay, run migration_34.sql.)");
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
    const att = attByEmp[e.id] || { present: 0, leave: 0, absent: 0, paid: 30, deductDays: 0 };
    const entry = payrollRows[e.id] || { bonus: 0, deductions: 0, status: "Pending" };
    const net = salaryAfterDeductions(e.base_salary, att.deductDays) + (attBonus[e.id]?.amount || 0) + Number(entry.bonus || 0) - Number(entry.deductions || 0);
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
          <select className={inputCls + " w-auto"} value={defaultInvestor} onChange={(e) => setDefaultInvestor(e.target.value)} title="Used when you click Mark paid on a row that has no investor chosen">
            <option value="">Funded by: choose per row</option>
            {investors.map((i) => <option key={i.id} value={i.id}>Fund salaries from {i.name}</option>)}
          </select>
          <span className="text-sm text-stone-500 font-mono">Total: {fmtMoney(totalPayout)}</span>
        </div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Search employee, role, status…" className="max-w-xl mb-3" />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th>
              <th className="text-right px-4 py-2.5">Present days</th>
              <th className="text-right px-4 py-2.5" title="Leave + absent + days with no attendance marked">Leave / absent days</th>
              <th className="text-right px-4 py-2.5">Bonus (₹)</th>
              <th className="text-right px-4 py-2.5">Deductions (₹)</th>
              <th className="text-right px-4 py-2.5">Net pay</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Funded by</th>
              <th className="text-left px-4 py-2.5">Login account</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.filter(({ emp, entry, linkedProfile }) => matchQ(q, emp.name, emp.role, emp.designation, entry.status, linkedProfile?.full_name, linkedProfile?.email)).map(({ emp, att, entry, net, linkedProfile }) => (
              <tr key={emp.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium">{emp.name}{attBonus[emp.id] && <div className="text-[11px] font-normal text-emerald-700" data-testid={`attbonus-${emp.id}`}>+ {fmtMoney(attBonus[emp.id].amount)} attendance bonus ({attBonus[emp.id].label})</div>}</td>
                <td className="px-4 py-2.5 text-right font-mono">{att.present}/{workingDays}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <button onClick={() => setCalFor(emp)} className={`inline-flex items-center gap-1 hover:underline ${att.off ? "text-amber-700 font-semibold" : ""}`} title="View attendance calendar" data-testid={`leaves-${emp.id}`}>
                    <CalendarDays size={13} /> {att.off}
                  </button>
                </td>
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
                  <select className={inputCls + " w-auto min-w-[8rem] text-xs"} value={entry.investor_id || ""} onChange={(e) => updateEntry(emp.id, { investor_id: e.target.value || null })}>
                    <option value="">{defaultInvestor ? "Default investor" : "— none —"}</option>
                    {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
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
        Salary is monthly ÷ 30 per day, in every month (28, 29, 30 or 31 days). Net pay = base salary − (base ÷ 30 × unpaid days) + bonus − deductions. Unpaid days are absent days, days with no attendance marked, half a day for each half-day and leave without pay; leave taken from the available balance and Sundays are not deducted. Link a login account so staff
        can see their own payroll and leave count under their own Payroll tab.
      </p>
      {calFor && (
        <Modal title={`${calFor.name} — attendance ${mk}`} onClose={() => setCalFor(null)}>
          <AttendanceCalendar rows={rawAtt[calFor.id] || []} mk={mk} joined={calFor.join_date || ""} />
        </Modal>
      )}
      {payslip && (
        <PrintPayslip
          employee={payslip.employee}
          month={mk}
          present={payslip.att.present}
          leaves={payslip.att.leave + payslip.att.lop}
          absent={payslip.att.absent + payslip.att.unmarked}
          paid={payslip.att.paid}
          deductDays={payslip.att.deductDays}
          perDay={perDaySalary(payslip.employee.base_salary)}
          totalDays={workingDays}
          entry={payrollRows[payslip.employee.id] || { bonus: 0, deductions: 0 }}
          attBonus={attBonus[payslip.employee.id]}
          net={
            salaryAfterDeductions(payslip.employee.base_salary, payslip.att.deductDays) + (attBonus[payslip.employee.id]?.amount || 0) +
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
  const [att, setAtt] = useState({ present: 0, leave: 0, absent: 0, paid: 0 });
  const [myRows, setMyRows] = useState([]);
  const [myBonus, setMyBonus] = useState(null);
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
      supabase.from("attendance").select("date, status").eq("employee_id", profile.employee_id).gte("date", start).lte("date", end),
      supabase.from("payroll").select("*").eq("employee_id", profile.employee_id).eq("month", mk).maybeSingle(),
      supabase.from("settings").select("*").eq("id", 1).single(),
    ]);
    setEmployee(emp || null);
    const counts = paidDaysFromAttendance(attRows || [], mk, { joined: emp?.join_date || "" });
    setAtt(counts);
    setMyRows(attRows || []);
    const qMonths = bonusQuarterFor(mk);
    if (qMonths && emp) {
      const { data: qAtt } = await supabase.from("attendance").select("date, status").eq("employee_id", profile.employee_id).gte("date", `${qMonths[0]}-01`).lte("date", `${qMonths[2]}-${String(daysInMonth(qMonths[2])).padStart(2, "0")}`);
      setMyBonus(attendanceBonusFor(emp.base_salary, qAtt || [], qMonths, emp.join_date || "", todayStr()));
    } else setMyBonus(null);
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

  const workingDays = workingDaysInMonth(mk);
  const net = salaryAfterDeductions(employee?.base_salary, att.deductDays) + (myBonus?.amount || 0) + Number(entry.bonus || 0) - Number(entry.deductions || 0);

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
          <span className="text-right font-mono">{att.present} / {workingDays}</span>
          <span className="text-stone-500">Leave / absent days</span>
          <span className="text-right font-mono">{att.off}</span>
          {myBonus && <><span className="text-stone-500">Attendance bonus ({myBonus.label})</span>
          <span className="text-right font-mono text-emerald-700" data-testid="my-att-bonus">+{fmtMoney(myBonus.amount)}</span></>}
          <span className="text-stone-500">Bonus</span>
          <span className="text-right font-mono">{fmtMoney(entry.bonus)}</span>
          <span className="text-stone-500">Deductions</span>
          <span className="text-right font-mono">−{fmtMoney(entry.deductions)}</span>
        </div>
        <div className="mb-4"><AttendanceCalendar rows={myRows} mk={mk} joined={employee?.join_date || ""} /></div>
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
          leaves={att.leave + att.lop}
          absent={att.absent + (att.unmarked || 0)}
          paid={att.paid}
          deductDays={att.deductDays}
          perDay={perDaySalary(employee?.base_salary)}
          totalDays={workingDays}
          entry={entry}
          net={net}
          attBonus={myBonus}
          settings={settings}
          onClose={() => setShowPayslip(false)}
        />
      )}
    </div>
  );
}
