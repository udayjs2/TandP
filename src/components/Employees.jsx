import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { fmtMoney, todayStr } from "../lib/helpers";

const ROLES = ["Production", "Sales", "Manager", "Admin"];

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const { data, error } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
    if (!error) setEmployees(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("employees-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const save = async (emp) => {
    if (emp.id) {
      await supabase.from("employees").update(emp).eq("id", emp.id);
    } else {
      const { id, ...rest } = emp;
      await supabase.from("employees").insert(rest);
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Remove this employee? This also removes their attendance/payroll history.")) return;
    await supabase.from("employees").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Employees ({employees.length})</h2>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add employee
        </Btn>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Emp #</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">Department</th>
              <th className="text-left px-4 py-2.5">Phone</th>
              <th className="text-left px-4 py-2.5">Joined</th>
              <th className="text-right px-4 py-2.5">Base salary</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {employees.map((e) => (
              <tr key={e.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 text-stone-500 font-mono">{e.employee_number || "—"}</td>
                <td className="px-4 py-2.5 font-medium">{e.name}</td>
                <td className="px-4 py-2.5">{e.role}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.department || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.phone || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.join_date || "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(e.base_salary)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModal(e)} className="text-stone-400 hover:text-indigo-700 p-1">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(e.id)} className="text-stone-400 hover:text-rose-700 p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && employees.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-stone-400">
                  No employees yet. Add your first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {modal && (
        <EmployeeModal emp={modal} onClose={() => setModal(null)} onSave={save} count={employees.length} />
      )}
    </div>
  );
}

function EmployeeModal({ emp, onClose, onSave, count }) {
  const [f, setF] = useState({
    id: emp.id || null,
    employee_number: emp.employee_number || `EMP-${String(count + 1).padStart(3, "0")}`,
    name: emp.name || "",
    role: emp.role || "Production",
    department: emp.department || "",
    phone: emp.phone || "",
    join_date: emp.join_date || todayStr(),
    base_salary: emp.base_salary || "",
  });
  return (
    <Modal title={emp.id ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name) return;
          onSave({ ...f, base_salary: Number(f.base_salary) || 0 });
        }}
      >
        <Field label="Employee number">
          <input className={inputCls} value={f.employee_number} onChange={(e) => setF({ ...f, employee_number: e.target.value })} />
        </Field>
        <Field label="Full name">
          <input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <input className={inputCls} placeholder="e.g. Stitching, Cutting" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Joining date">
          <input type="date" className={inputCls} value={f.join_date} onChange={(e) => setF({ ...f, join_date: e.target.value })} />
        </Field>
        <Field label="Monthly base salary (₹)">
          <input type="number" min="0" className={inputCls} value={f.base_salary} onChange={(e) => setF({ ...f, base_salary: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}
