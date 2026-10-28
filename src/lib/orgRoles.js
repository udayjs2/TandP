// Departments and roles used in HR & Workforce → Employees, and to build the team chart on the dashboard.
export const EMP_DEPARTMENTS = ["Production", "Ironing & Packing", "Cutting", "Sales", "Management", "Staff", "Information Technology", "Finance", "HR"];
export const EMP_ROLES = [
  "General Manager", "Production Manager", "Team Lead", "Operator", "Cutting Master", "Cutter", "Sales Manager", "Sales Executive",
  "HR Manager", "HR Executive", "Accountant", "Digital Marketing Manager", "Digital Marketing Executive",
  "Quality Manager", "Quality Executive", "Ironing",
];
// department suggested when a role is chosen
export const DEFAULT_DEPT = {
  "General Manager": "Management", "Production Manager": "Management", "Team Lead": "Production", Operator: "Production",
  "Cutting Master": "Cutting", Cutter: "Cutting", "Sales Manager": "Sales", "Sales Executive": "Sales",
  "HR Manager": "HR", "HR Executive": "HR", Accountant: "Finance",
  "Quality Manager": "Production", "Quality Executive": "Production", Ironing: "Ironing & Packing",
};
// older employee records used Production / Sales / Ironing / Manager / Admin
export const SALES_PERSON_ROLES = ["Sales Executive", "Sales"];
export const isSalesPerson = (role) => SALES_PERSON_ROLES.includes(role);
export const isSalesSide = (role) => ["Sales Executive", "Sales Manager", "Sales"].includes(role);
// anyone who can be named as the salesperson on an order: role Sales Manager / Sales Executive, or department Sales
export const isSalesStaff = (e) => !!e && (isSalesSide(e.role) || e.department === "Sales");
export const FLOOR_DEPTS = ["Production", "Ironing & Packing", "Cutting"];

// People who hold an organisation role. The employee's own Role is the source of the name; the login role is
// only a fallback for a seat that no employee has been given yet.
export function peopleOf({ employees = [], profiles = [] }, empRoles, loginRoles = []) {
  const byRole = employees.filter((e) => e.status !== "Inactive" && empRoles.includes(e.role));
  if (byRole.length) return byRole.map((e) => ({ id: e.id, empId: e.id, name: e.name, empRole: e.role }));
  const out = [];
  profiles.filter((p) => loginRoles.includes(p.role)).forEach((p) => {
    const e = p.employee_id ? employees.find((x) => x.id === p.employee_id && x.status !== "Inactive") : null;
    if (p.employee_id && !e) return;
    out.push({ id: e?.id || p.id, empId: e?.id || null, name: e?.name || p.name || "—", empRole: e?.role });
  });
  return out;
}
