export const fmtMoney = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const daysInMonth = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

export const itemsTotal = (items = []) =>
  items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.price) || 0), 0);

export const HOUR_SLOTS = [
  { key: "09-10", label: "9–10 AM" },
  { key: "10-11", label: "10–11 AM" },
  { key: "11-12", label: "11–12 PM" },
  { key: "12-13", label: "12–1 PM" },
  { key: "13-14", label: "1–2 PM" },
  { key: "14-15", label: "2–3 PM" },
  { key: "15-16", label: "3–4 PM" },
  { key: "16-17", label: "4–5 PM" },
  { key: "17-18", label: "5–6 PM" },
];

// total items required across all line items of an order
export const orderItemsRequired = (items = []) =>
  items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

export const EXPENSE_CATEGORIES = ["Food", "Petrol", "Transport", "Other"];
export const TRANSPORT_MODES = ["Bus", "Auto", "Own Vehicle", "Train", "Other"];
export const EXPENSE_STATUS_COLORS = {
  Submitted: "bg-amber-100 text-amber-800",
  Approved: "bg-sky-100 text-sky-800",
  Rejected: "bg-rose-100 text-rose-800",
  Reimbursed: "bg-emerald-100 text-emerald-800",
};

export const ORDER_STATUSES = ["Not Started", "Cutting", "Stitching", "Finishing", "Ironing", "Completed", "Shipped"];
export const ORDER_STATUS_COLORS = {
  "Not Started": "bg-stone-200 text-stone-700",
  Cutting: "bg-amber-100 text-amber-800",
  Stitching: "bg-sky-100 text-sky-800",
  Finishing: "bg-violet-100 text-violet-800",
  Ironing: "bg-fuchsia-100 text-fuchsia-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Shipped: "bg-indigo-100 text-indigo-800",
};

export const EXPENDITURE_CATEGORIES = ["Raw Material", "Machinery", "Utilities", "Rent", "Maintenance", "Other"];
export const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque", "Card", "Other"];

// Standard shift rules: 9 AM to 6 PM, must be present at least 9 hours to
// count as a full day. Used to auto-flag late arrivals and overtime from
// check-in/check-out times (entered manually, or imported from a biometric
// device's exported log).
export const SHIFT_START_MIN = 9 * 60; // 9:00 AM in minutes-from-midnight
export const SHIFT_END_MIN = 18 * 60; // 6:00 PM
export const MIN_FULL_DAY_HOURS = 9;
export const LATE_GRACE_MIN = 10; // small grace window before flagging "late"

const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

// Given "HH:MM" check-in/check-out strings, compute hours worked, whether
// the person was late, and any overtime beyond the 9-hour shift.
export const computeShiftStats = (checkIn, checkOut) => {
  const inMin = timeToMinutes(checkIn);
  const outMin = timeToMinutes(checkOut);
  if (inMin === null || outMin === null) return { hoursWorked: null, isLate: false, overtimeHours: 0, meetsFullDay: false };
  const hoursWorked = Math.max(0, (outMin - inMin) / 60);
  const isLate = inMin > SHIFT_START_MIN + LATE_GRACE_MIN;
  const overtimeHours = outMin > SHIFT_END_MIN ? (outMin - SHIFT_END_MIN) / 60 : 0;
  const meetsFullDay = hoursWorked >= MIN_FULL_DAY_HOURS;
  return { hoursWorked, isLate, overtimeHours, meetsFullDay };
};

// Suggest a status from computed hours (still manually overridable)
export const suggestStatusFromHours = (hoursWorked) => {
  if (hoursWorked === null) return null;
  if (hoursWorked >= MIN_FULL_DAY_HOURS) return "Present";
  if (hoursWorked >= MIN_FULL_DAY_HOURS / 2) return "Half Day";
  return "Absent";
};

export const ROLE_LABELS = { admin: "Admin", hr: "HR", user: "Staff" };

// Given order_labor rows (order_id, employee_id, work_date) and a lookup of
// employees by id (must include base_salary), compute manpower count,
// total man-days, and total labor cost using each employee's daily wage
// (monthly base salary ÷ days in that assignment's month).
export const computeLaborCost = (laborRows = [], employeesById = {}) => {
  const employeeSet = new Set();
  let manDays = 0;
  let laborCost = 0;
  laborRows.forEach((row) => {
    employeeSet.add(row.employee_id);
    manDays += 1;
    const emp = employeesById[row.employee_id];
    if (emp) {
      const mk = row.work_date.slice(0, 7);
      const dailyWage = (Number(emp.base_salary) || 0) / daysInMonth(mk);
      laborCost += dailyWage;
    }
  });
  return { manpowerCount: employeeSet.size, manDays, laborCost };
};

// combine an order's item list with cumulative completed/delivered totals
// (from order_progress and order_deliveries rows) into a per-item breakdown
export const buildItemBreakdown = (items = [], progressRows = [], deliveryRows = []) => {
  const completedByItem = {};
  progressRows.forEach((p) => (completedByItem[p.item_description] = (completedByItem[p.item_description] || 0) + Number(p.quantity || 0)));
  const deliveredByItem = {};
  deliveryRows.forEach((d) => (deliveredByItem[d.item_description] = (deliveredByItem[d.item_description] || 0) + Number(d.quantity || 0)));
  return items.map((it) => {
    const required = Number(it.quantity) || 0;
    const completed = completedByItem[it.description] || 0;
    const delivered = deliveredByItem[it.description] || 0;
    return { description: it.description, required, completed, delivered, pending: Math.max(0, required - delivered) };
  });
};
