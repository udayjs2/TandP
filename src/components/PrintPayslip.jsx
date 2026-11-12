import { X, Receipt } from "lucide-react";
import PrintSheet from "./PrintSheet";
import { Btn } from "./ui";
import { fmtMoney } from "../lib/helpers";

export default function PrintPayslip({ employee, month, present, leaves, absent, paid, deductDays, perDay, attBonus, totalDays, entry, net, settings, onClose }) {
  return (
    <PrintSheet>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}>
          <X size={14} /> Close preview
        </Btn>
        <Btn onClick={() => window.print()}>
          <Receipt size={14} /> Print
        </Btn>
      </div>

      <div id="print-payslip" className="print-page max-w-2xl mx-auto p-8">
        <div className="flex justify-between items-start border-b border-stone-300 pb-4 mb-4">
          <div>
            <h1 className="text-xl font-bold">{settings.business_name || "T&P Textiles"}</h1>
            {settings.address && <p className="text-sm text-stone-600 whitespace-pre-line">{settings.address}</p>}
            {settings.phone && <p className="text-sm text-stone-600">{settings.phone}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-lg font-bold uppercase tracking-wide">Payslip</h2>
            <p className="text-sm">{month}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <p className="text-stone-500 text-xs uppercase mb-0.5">Employee</p>
            <p className="font-medium">{employee.name}</p>
            <p className="text-stone-500">{employee.employee_number}</p>
          </div>
          <div className="text-right">
            <p><span className="text-stone-500">Department: </span>{employee.department || "—"}</p>
            <p><span className="text-stone-500">Role: </span>{employee.role}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-stone-800">
              <th className="text-left py-2">Attendance summary</th>
              <th className="text-right py-2">Days</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-200">
              <td className="py-2">Working days (Mon–Sat; Sundays are paid)</td>
              <td className="text-right py-2">{totalDays}</td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2">Present days</td>
              <td className="text-right py-2">{present}</td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2">Paid days (30 − days deducted)</td>
              <td className="text-right py-2">{paid ?? present}</td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2">Leaves taken</td>
              <td className="text-right py-2">{leaves}</td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2">Absent days</td>
              <td className="text-right py-2">{absent}</td>
            </tr>
          </tbody>
        </table>

        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-stone-800">
              <th className="text-left py-2">Earnings / Deductions</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-200">
              <td className="py-2">Base salary (monthly)</td>
              <td className="text-right py-2">{fmtMoney(employee.base_salary)}</td>
            </tr>
            {deductDays > 0 && (
              <tr className="border-b border-stone-200">
                <td className="py-2">Unpaid days: {deductDays} × {fmtMoney(perDay)} (monthly ÷ 30)</td>
                <td className="text-right py-2">−{fmtMoney(perDay * deductDays)}</td>
              </tr>
            )}
            {attBonus && (
              <tr className="border-b border-stone-200">
                <td className="py-2">Attendance bonus — no leave or absence in {attBonus.label} (4 days)</td>
                <td className="text-right py-2">+{fmtMoney(attBonus.amount)}</td>
              </tr>
            )}
            <tr className="border-b border-stone-200">
              <td className="py-2">Bonus</td>
              <td className="text-right py-2">{fmtMoney(entry.bonus)}</td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2">Deductions</td>
              <td className="text-right py-2">−{fmtMoney(entry.deductions)}</td>
            </tr>
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="w-56 text-sm">
            <div className="flex justify-between py-1 border-t-2 border-stone-800 font-bold text-base">
              <span>Net pay</span>
              <span>{fmtMoney(net)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end mb-6">
          <div className="text-right text-sm font-bold">For {settings.business_name || "T&P Textiles"}</div>
        </div>

        <p className="text-xs text-stone-400 text-center">This is a computer-generated payslip.</p>
      </div>
    </PrintSheet>
  );
}
