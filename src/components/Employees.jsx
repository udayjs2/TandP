import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, FileText } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { fmtMoney, todayStr } from "../lib/helpers";
import { OfferLetterModal } from "./OfferLetter";

import { EMP_ROLES, EMP_DEPARTMENTS, DEFAULT_DEPT } from "../lib/orgRoles";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [offerLetterFor, setOfferLetterFor] = useState(null);
  const [view, setView] = useState("active");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
    if (!error) setEmployees(data || []);
    setLoading(false);
  };

  useEffect(() => {
    // anyone with no attendance marked for 30 days is moved to Inactive (Admin / HR only)
    supabase.rpc("deactivate_stale_employees").then(({ data }) => {
      if (data?.ok && data.count > 0) setNotice(`${data.count} employee${data.count === 1 ? " was" : "s were"} moved to Inactive (no attendance marked for 30 days): ${data.names.join(", ")}.`);
      load();
    });
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

  const setActive = async (e, active) => {
    if (!confirm(active ? `Make ${e.name} active again? They return to attendance, payroll and manpower lists.` : `Make ${e.name} inactive?`)) return;
    const { data, error } = await supabase.rpc("set_employee_active", { p_id: e.id, p_active: active });
    if (error || !data?.ok) alert(error?.message || data?.error || "Couldn't update");
    load();
  };
  const activeList = employees.filter((e) => (e.status || "Active") === "Active");
  const inactiveList = employees.filter((e) => e.status === "Inactive");
  const needle = q.trim().toLowerCase();
  const list = (view === "active" ? activeList : inactiveList).filter(
    (e) => !needle || String(e.name || "").toLowerCase().includes(needle) || String(e.employee_number || "").toLowerCase().includes(needle)
  );

  return (
    <div className="space-y-4">
      <div className="subtab-bar">
        {[["active", `Active (${activeList.length})`], ["inactive", `Inactive (${inactiveList.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`subtab ${view === id ? "subtab-active" : ""}`}>{label}</button>
        ))}
      </div>
      {notice && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">{notice}</div>}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{view === "active" ? `Employees (${activeList.length})` : `Inactive employees (${inactiveList.length})`}</h2>
        {view === "active" && (
          <Btn onClick={() => setModal({})}>
            <Plus size={15} /> Add employee
          </Btn>
        )}
      </div>
      <input className={inputCls} placeholder="Search by employee name or Emp #…" value={q} onChange={(e) => setQ(e.target.value)} />
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
              {view === "inactive" && <th className="text-left px-4 py-2.5">Inactive since</th>}
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {list.map((e) => (
              <tr key={e.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 text-stone-500 font-mono">{e.employee_number || "—"}</td>
                <td className="px-4 py-2.5 font-medium">{e.name}</td>
                <td className="px-4 py-2.5">{e.role}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.department || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.phone || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{e.join_date || "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(e.base_salary)}</td>
                {view === "inactive" && <td className="px-4 py-2.5 text-xs text-stone-500">{e.inactive_since || "—"}<div className="text-stone-400">{e.inactive_reason}</div></td>}
                <td className="px-4 py-2.5">
                  {view === "inactive" ? (
                    <div className="flex justify-end"><Btn onClick={() => setActive(e, true)}>Make active</Btn></div>
                  ) : (
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setOfferLetterFor(e)} className="text-stone-400 hover:text-indigo-700 p-1" title="Generate offer letter">
                      <FileText size={14} />
                    </button>
                    <button onClick={() => setModal(e)} className="text-stone-400 hover:text-indigo-700 p-1">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setActive(e, false)} className="text-xs text-stone-400 hover:text-amber-700 px-1" title="Move to Inactive">Inactive</button>
                    <button onClick={() => remove(e.id)} className="text-stone-400 hover:text-rose-700 p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400">
                  {q ? "No employee matches your search." : view === "inactive" ? "Nobody is inactive." : "No employees yet. Add your first one."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {modal && (
        <EmployeeModal emp={modal} onClose={() => setModal(null)} onSave={save} count={employees.length} allEmployees={employees} />
      )}
      {offerLetterFor && <OfferLetterModal employee={offerLetterFor} onClose={() => setOfferLetterFor(null)} />}
    </div>
  );
}

function EmployeeModal({ emp, onClose, onSave, count, allEmployees }) {
  const [f, setF] = useState({
    id: emp.id || null,
    employee_number: emp.employee_number || `EMP-${String(count + 1).padStart(3, "0")}`,
    name: emp.name || "",
    role: emp.role || "Operator",
    department: emp.department || (emp.id ? "" : DEFAULT_DEPT.Operator),
    phone: emp.phone || "",
    join_date: emp.join_date || todayStr(),
    base_salary: emp.base_salary || "",
    reporting_manager_id: emp.reporting_manager_id || "",
  });
  const possibleManagers = (allEmployees || []).filter((e) => e.id !== emp.id);
  return (
    <Modal title={emp.id ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.name) return;
          onSave({ ...f, base_salary: Number(f.base_salary) || 0, reporting_manager_id: f.reporting_manager_id || null });
        }}
      >
        <Field label="Employee number">
          <input className={inputCls} value={f.employee_number} onChange={(e) => setF({ ...f, employee_number: e.target.value })} />
        </Field>
        <Field label="Full name">
          <input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className={inputCls} value={f.role} onChange={(e) => {
            const role = e.target.value;
            // suggest the usual department for the role, unless one was chosen on purpose
            const prevDefault = DEFAULT_DEPT[f.role];
            setF({ ...f, role, department: !f.department || f.department === prevDefault ? (DEFAULT_DEPT[role] || f.department) : f.department });
          }}>
            {[...(EMP_ROLES.includes(f.role) ? [] : [f.role]), ...EMP_ROLES].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select className={inputCls} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">— choose —</option>
            {[...(!f.department || EMP_DEPARTMENTS.includes(f.department) ? [] : [f.department]), ...EMP_DEPARTMENTS].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
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
        <Field label="Reporting manager (optional)">
          <select className={inputCls} value={f.reporting_manager_id} onChange={(e) => setF({ ...f, reporting_manager_id: e.target.value })}>
            <option value="">— none —</option>
            {possibleManagers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
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
