import ReportView from "../ReportView";
import { fmtMoney, computeShiftStats } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, pct, round1, groupBy, safeAll, monthsBetween, monthLabel } from "./common";

const dayCount = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;

// 5. HR, attendance and payroll
export default function HrReport() {
  const { range, controls } = useRange("last_month");
  const state = useData(async () => {
    const mks = monthsBetween(range.from, range.to);
    const [att, emps, leaves, payroll, salaryExp, ops] = await Promise.all([
      fetchAll(() => supabase.from("attendance").select("employee_id, date, status, check_in, check_out").gte("date", range.from).lte("date", range.to).order("employee_id").order("date")),
      fetchAll(() => supabase.from("employees").select("id, name, role, base_salary, status").order("id")),
      safeAll(() => supabase.from("leave_requests").select("employee_id, start_date, end_date, status").lte("start_date", range.to).gte("end_date", range.from).order("start_date")),
      safeAll(() => supabase.from("payroll").select("employee_id, month, status, net_pay").in("month", mks).order("month")),
      safeAll(() => supabase.from("expenditures").select("amount, expense_date").eq("category", "Salary").gte("expense_date", range.from).lte("expense_date", range.to).order("id")),
      safeAll(() => supabase.from("operation_output").select("employee_id, work_date, quantity").gte("work_date", range.from).lte("work_date", range.to).order("employee_id")),
    ]);
    return { att, emps, leaves, payroll, salaryExp, ops, mks };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const emp = Object.fromEntries(d.emps.map((e) => [e.id, e]));
        const by = (s) => d.att.filter((a) => a.status === s).length;
        const present = by("Present"), absent = by("Absent"), half = by("Half Day"), leaveMarked = by("Leave");
        const attPct = pct(present + half * 0.5, d.att.length);
        let overtime = 0, late = 0;
        d.att.forEach((a) => { const s = computeShiftStats((a.check_in || "").slice(0, 5), (a.check_out || "").slice(0, 5)); overtime += s.overtimeHours; if (s.isLate) late += 1; });
        const leaveDays = (l) => dayCount(l.start_date > range.from ? l.start_date : range.from, l.end_date < range.to ? l.end_date : range.to);
        const approvedLeave = d.leaves.filter((l) => l.status === "Approved");
        const leaveTotal = sum(approvedLeave, leaveDays);
        const paidPay = d.payroll.filter((p) => p.status === "Paid");
        const salaryPaid = sum(paidPay, (p) => p.net_pay);
        const salaryPosted = sum(d.salaryExp);
        const activeEmps = d.emps.filter((e) => e.status !== "Inactive");
        const monthlyBase = sum(activeEmps, (e) => e.base_salary);
        const opsBy = groupBy(d.ops, (o) => o.employee_id);
        const attBy = groupBy(d.att, (a) => a.employee_id);
        const rows = Object.entries(attBy).map(([id, as]) => {
          const pres = as.filter((a) => a.status === "Present").length + as.filter((a) => a.status === "Half Day").length * 0.5;
          let ot = 0, lt = 0;
          as.forEach((a) => { const s = computeShiftStats((a.check_in || "").slice(0, 5), (a.check_out || "").slice(0, 5)); ot += s.overtimeHours; if (s.isLate) lt += 1; });
          const out = sum(opsBy[id] || [], (o) => o.quantity);
          return {
            name: emp[id]?.name || "—", role: emp[id]?.role || "", present: as.filter((a) => a.status === "Present").length, half: as.filter((a) => a.status === "Half Day").length,
            absent: as.filter((a) => a.status === "Absent").length, leave: as.filter((a) => a.status === "Leave").length, late: lt, ot, out, perDay: pres ? out / pres : 0,
          };
        }).sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name));
        const months = d.mks;
        const salaryByMonth = months.map((mk) => sum(paidPay.filter((p) => p.month === mk), (p) => p.net_pay));
        const topAbsent = rows.filter((r) => r.absent > 0).slice(0, 10);
        return (
          <ReportView
            title="HR, attendance & payroll report"
            subtitle={`${range.label} (${range.from} to ${range.to}) - T&P Textiles`}
            filename="hr-attendance-payroll-report"
            controls={controls}
            kpis={[
              { label: "Attendance rate", value: attPct === null ? "—" : `${round1(attPct)}%`, tone: attPct !== null && attPct < 85 ? "warn" : "good", sub: `${d.att.length} records` },
              { label: "Absent days", value: String(absent), tone: absent ? "warn" : "good" },
              { label: "Approved leave days", value: String(leaveTotal), sub: `${leaveMarked} marked as Leave` },
              { label: "Overtime hours", value: String(Math.round(overtime * 10) / 10), sub: "after 6:00 PM" },
              { label: "Late arrivals", value: String(late) },
              { label: "Salary paid", value: fmtMoney(salaryPaid), sub: `${paidPay.length} payslip(s) marked Paid` },
              { label: "Salary in expenditures", value: fmtMoney(salaryPosted) },
              { label: "Monthly base payroll", value: fmtMoney(monthlyBase), sub: `${activeEmps.length} active employees` },
            ]}
            charts={[
              { type: "pie", title: "Attendance mix", labels: ["Present", "Half Day", "Absent", "Leave"], series: [{ name: "Days", values: [present, half, absent, leaveMarked], colors: ["#059669", "#d97706", "#e11d48", "#6366f1"] }], format: (n) => String(Math.round(n)) },
              ...(topAbsent.length ? [{ type: "hbar", title: "Most absences", labels: topAbsent.map((r) => r.name), series: [{ name: "Days", values: topAbsent.map((r) => r.absent) }], format: (n) => String(Math.round(n)) }] : []),
              ...(months.length > 1 ? [{ type: "bar", title: "Salary paid by month (₹)", labels: months.map(monthLabel), series: [{ name: "Net pay", values: salaryByMonth }], format: (n) => fmtMoney(n) }] : []),
            ]}
            tables={[{
              heading: "Employee attendance and productivity",
              columns: [{ label: "Employee" }, { label: "Role" }, { label: "Present", type: "int" }, { label: "Half", type: "int" }, { label: "Absent", type: "int" }, { label: "Leave", type: "int" }, { label: "Late", type: "int" }, { label: "Overtime hrs", type: "num" }, { label: "Output (pcs)", type: "int" }, { label: "Pcs / day present", type: "int" }],
              rows: rows.map((r) => [r.name, r.role, r.present, r.half, r.absent, r.leave, r.late, r.ot, r.out, r.perDay]),
            }]}
            footnote="Attendance rate counts Present as 1 and Half Day as 0.5 of the records marked. Overtime is time worked after 6:00 PM. Output comes from the Output module's operation log. Inactive employees with no attendance in the period are not listed."
          />
        );
      }}
    </ReportShell>
  );
}
