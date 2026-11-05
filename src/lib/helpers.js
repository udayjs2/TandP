export const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

// Always compute "today" in India Standard Time — toISOString() converts
// to UTC first, which silently shows "yesterday" for roughly the first 5.5
// hours of the IST day (e.g. 2 AM IST is still 8:30 PM the previous day in
// UTC). Using an explicit timezone avoids that regardless of the device's
// own clock/locale settings.
export const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const daysInMonth = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

// Number of Sundays in a "YYYY-MM" month. Sundays are paid by default.
export const sundaysInMonth = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  let c = 0;
  for (let d = 1; d <= n; d++) if (new Date(y, m - 1, d).getDay() === 0) c++;
  return c;
};

// Working days = the days of the month that are not Sundays (Mon–Sat). Salary is a fixed amount per month:
// full attendance on every working day pays the full base salary whether the month has 28, 29, 30 or 31 days,
// and Sundays are always paid. Sundays never count towards "present days".
export const workingDaysInMonth = (mk) => daysInMonth(mk) - sundaysInMonth(mk);

// present = days present on working days (half day = 0.5); a Sunday attendance is not counted
// leave   = approved leave days on working days (paid leave: balance is checked when the leave is approved)
// paid    = present + leave, never more than the working days
// Salary is always monthly ÷ 30, whatever the month length. Each day not paid (absent, not marked, half a day for a
// half-day, leave without pay, days before joining) takes one day's salary off. Paid leave and Sundays take nothing off.
export const PAY_DAYS = 30;
export const UNPAID_LEAVE = "Unpaid Leave";

// One entry per calendar day of the month: Sundays are off, days with no record (before today and after the
// join date) count as "unmarked" = absent. state: present | half | leave | absent | unmarked | sunday | future | before
export const monthCalendar = (rows, mk, today = todayStr(), joined = "") => {
  const byDate = {};
  (rows || []).forEach((r) => (byDate[r.date] = r.status));
  const total = daysInMonth(mk);
  const days = [];
  for (let d = 1; d <= total; d++) {
    const date = `${mk}-${String(d).padStart(2, "0")}`;
    const [y, m] = mk.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const st = byDate[date];
    let state;
    if (joined && date < joined) state = "before";
    else if (dow === 0) state = "sunday";
    else if (st === "Present") state = "present";
    else if (st === "Half Day") state = "half";
    else if (st === "Leave") state = "leave";
    else if (st === UNPAID_LEAVE) state = "lop";
    else if (st === "Absent") state = "absent";
    else if (date >= today) state = "future";
    else state = "unmarked";
    days.push({ date, day: d, dow, state, status: st || null });
  }
  return days;
};

export const paidDaysFromAttendance = (rows, mk, opts = {}) => {
  const cal = monthCalendar(rows, mk, opts.today, opts.joined);
  const n = (st) => cal.filter((c) => c.state === st).length;
  const present = n("present") + n("half") * 0.5;
  const leave = n("leave"), lop = n("lop"), absent = n("absent"), unmarked = n("unmarked"), half = n("half"), before = n("before");
  // days away = leave + absent + not marked (+ half of each half-day)
  const off = leave + lop + absent + unmarked + half * 0.5;
  // days that cost salary: everything except paid leave
  const deductDays = Math.min(PAY_DAYS, lop + absent + unmarked + half * 0.5 + before);
  return { present, leave, lop, absent, unmarked, off, deductDays, paid: PAY_DAYS - deductDays, workingDays: workingDaysInMonth(mk), sundays: sundaysInMonth(mk), workedDays: present };
};

// ---- earned leave / attendance bonus (v70) ----
// Earned leave is 4 days a quarter. A quarter with no absent / leave / half-day / unmarked day pays those 4 days
// (4 × monthly ÷ 30) as an attendance bonus with the first month's salary of the next quarter.
export const EARNED_QUARTER_DAYS = 4;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const quarterMonths = (mk) => { // the 3 month keys of the quarter that contains month mk
  const [y, m] = mk.split("-").map(Number);
  const q0 = Math.floor((m - 1) / 3) * 3;
  return [0, 1, 2].map((i) => `${y}-${String(q0 + i + 1).padStart(2, "0")}`);
};
export const quarterLabel = (mk) => { const ms = quarterMonths(mk); const n = (k) => MONTH_NAMES[Number(k.split("-")[1]) - 1]; return `${n(ms[0])}–${n(ms[2])} ${ms[0].slice(0, 4)}`; };
// payroll month -> the previous quarter's month keys when it is the first month of a quarter (Jan, Apr, Jul, Oct), else null
export const bonusQuarterFor = (mk) => {
  const [y, m] = mk.split("-").map(Number);
  if ((m - 1) % 3 !== 0) return null;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 10 : m - 3;
  return quarterMonths(`${py}-${String(pm).padStart(2, "0")}`);
};
// rows: the employee's attendance rows for the whole previous quarter
export const attendanceBonusFor = (base, rows, months, joined, today) => {
  if (!months) return null;
  const perMonth = months.map((mk) => monthCalendar((rows || []).filter((r) => r.date.startsWith(mk)), mk, today, joined));
  const clean = perMonth.every((cal) => cal.every((c) => c.state === "present" || c.state === "sunday"));
  if (!clean) return null;
  return { amount: Math.round(EARNED_QUARTER_DAYS * perDaySalary(base) * 100) / 100, label: quarterLabel(months[0]) };
};

// net salary = monthly salary − (monthly ÷ 30) × days not paid
export const perDaySalary = (base) => (Number(base) || 0) / PAY_DAYS;
export const salaryAfterDeductions = (base, deductDays) => Math.round(((Number(base) || 0) - perDaySalary(base) * (Number(deductDays) || 0)) * 100) / 100;

// monthly pay for the days paid: base × paid ÷ working days (a fixed salary, not ÷ calendar days)
export const salaryForPaidDays = (base, paid, workingDays) =>
  workingDays > 0 ? ((Number(base) || 0) * paid) / workingDays : 0;

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

export const ORDER_STATUSES = ["Not Started", "Cutting", "Stitching", "Finishing", "Ironing", "Shipped", "Rejected by Customer", "Completed"];
export const ORDER_STATUS_COLORS = {
  "Not Started": "bg-stone-200 text-stone-700",
  Cutting: "bg-amber-100 text-amber-800",
  Stitching: "bg-sky-100 text-sky-800",
  Finishing: "bg-violet-100 text-violet-800",
  Ironing: "bg-fuchsia-100 text-fuchsia-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Shipped: "bg-indigo-100 text-indigo-800",
  "Rejected by Customer": "bg-rose-100 text-rose-800",
};
// statuses after production has finished (the order has left the floor)
export const POST_PRODUCTION = ["Shipped", "Rejected by Customer", "Completed"];

export const EXPENDITURE_CATEGORIES = ["Raw Material", "Machinery", "Utilities", "Rent", "Maintenance", "Transport", "Packing", "Salary", "Commission", "Other"];
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
  // If both check-in and check-out are known, the person clearly showed up
  // — never auto-suggest "Absent" here. Absent stays a manual admin/HR
  // choice for days with no attendance logged at all.
  return hoursWorked >= MIN_FULL_DAY_HOURS ? "Present" : "Half Day";
};

// ---------- Operation-based rate estimation (line balancing) ----------
// Standard garment-industry formula: a style with N operations, at an
// assumed average seconds-per-operation and a line efficiency %, yields an
// estimated daily output per operator. This is a STARTING ESTIMATE — real
// observed output (once you have it) is always more accurate and should
// replace it.
export const estimateRateFromOperations = (operations, avgSecondsPerOp, lineEfficiencyPct) => {
  if (!operations || operations <= 0) return 0;
  const workingMinutesPerDay = (SHIFT_END_MIN - SHIFT_START_MIN); // e.g. 540 for a 9hr shift
  const samMinutes = (operations * (avgSecondsPerOp || 30)) / 60;
  const efficiency = (lineEfficiencyPct || 50) / 100;
  if (samMinutes <= 0) return 0;
  return (workingMinutesPerDay * efficiency) / samMinutes;
};

// Standard reference operation counts for common school-uniform / sportswear
// styles, so the Planner can seed sensible starting rates in one click
// instead of the admin typing 14 rows from scratch.
export const STANDARD_GARMENT_OPERATIONS = [
  { garment_type: "T-Shirt", operations: 22 },
  { garment_type: "Polo T-Shirt", operations: 30 },
  { garment_type: "Shirt", operations: 45 },
  { garment_type: "Pant", operations: 35 },
  { garment_type: "Pant with Back Pocket", operations: 45 },
  { garment_type: "Elastic Pant", operations: 30 },
  { garment_type: "Elastic Pant with Back Pocket", operations: 40 },
  { garment_type: "Chudidhar", operations: 30 },
  { garment_type: "Kids Frock", operations: 38 },
  { garment_type: "Sports T-Shirt", operations: 24 },
  { garment_type: "Sports Pant", operations: 30 },
  { garment_type: "Short", operations: 25 },
  { garment_type: "Skirt", operations: 30 },
];

// Match a free-text item description (e.g. "Pant with Back Pocket") against
// the admin-maintained garment_rates list, case/whitespace-insensitive.
export const matchGarmentRate = (description, rates = []) => {
  const norm = (s) => (s || "").trim().toLowerCase();
  const target = norm(description);
  return rates.find((r) => norm(r.garment_type) === target) || null;
};

export const addCalendarDays = (dateStr, days) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + Math.ceil(days));
  return d.toISOString().slice(0, 10);
};

// Given an order (items, planned_resources), its completed-so-far quantities
// (from order_progress), and the admin's garment rate list, project how many
// more days it will take and what date that lands on if work starts today
// (or from a given start date). Items whose garment type has no matching
// rate are flagged rather than silently guessed.
export const computeOrderProjection = (order, completedByItem, rates, startDate) => {
  const resources = Number(order.planned_resources) || 0;
  const items = order.items || [];
  const breakdown = items.map((it) => {
    const required = Number(it.quantity) || 0;
    const completed = completedByItem[it.description] || 0;
    const remaining = Math.max(0, required - completed);
    const rate = matchGarmentRate(it.description, rates);
    const personDaysNeeded = rate && rate.pieces_per_day_per_person > 0 ? remaining / rate.pieces_per_day_per_person : null;
    return { description: it.description, required, completed, remaining, rate, personDaysNeeded };
  });

  const missingRateFor = breakdown.filter((b) => b.remaining > 0 && b.personDaysNeeded === null).map((b) => b.description);
  const totalPersonDays = breakdown.reduce((s, b) => s + (b.personDaysNeeded || 0), 0);
  const daysToComplete = resources > 0 ? totalPersonDays / resources : null;
  const projectedCompletionDate =
    daysToComplete !== null && daysToComplete >= 0 ? addCalendarDays(startDate, daysToComplete) : null;

  let onTime = null;
  if (projectedCompletionDate && order.due_date) {
    onTime = projectedCompletionDate <= order.due_date;
  }

  return { breakdown, missingRateFor, totalPersonDays, daysToComplete, projectedCompletionDate, onTime, resources };
};

export const ROLE_LABELS = {
  admin: "Admin",
  hr: "HR",
  finance: "Finance",
  gm: "General Manager",
  pm: "Production Manager",
  tl: "Team Lead",
  cutting_master: "Cutting Master",
  quality_manager: "Quality Manager",
  qc: "QC (Quality Team)",
  ironing: "Ironing",
  sales_manager: "Sales Manager",
  cutting: "Cutting (Cutter)",
  sales: "Sales",
  user: "Staff",
};
export const LOGIN_ROLES = ["admin", "hr", "gm", "pm", "tl", "cutting_master", "quality_manager", "qc", "ironing", "sales_manager", "cutting", "sales", "finance", "user"];

// Top-level modules and the roles that get them by default. The Admin can grant any of these
// (except User Management) to a particular user on top of their role — see User Management.
const EVERYONE = ["admin", "hr", "gm", "pm", "tl", "cutting_master", "quality_manager", "ironing", "sales_manager", "cutting", "sales", "finance", "user"];
export const MODULE_ROLES = {
  dashboard: EVERYONE,
  "floor-display": EVERYONE,
  production: ["admin", "gm", "pm", "tl", "cutting_master", "cutting", "quality_manager", "qc", "sales_manager", "sales"], // sales roles get Production Management for its Measurements tab only
  hr: EVERYONE,
  sales: ["admin", "sales", "sales_manager"],
  inventory: ["admin", "hr", "gm", "pm", "cutting_master", "finance"],
  finance: ["admin", "finance"],
  reports: ["admin", "quality_manager", "sales", "sales_manager", "finance"],
  users: ["admin"],
};
export const GRANTABLE_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "floor-display", label: "Floor Display" },
  { id: "production", label: "Production Management" },
  { id: "hr", label: "HR & Workforce" },
  { id: "sales", label: "CRM & Sales" },
  { id: "inventory", label: "Inventory & Procurement" },
  { id: "finance", label: "Finance & Accounts" },
  { id: "reports", label: "Reports & Analytics" },
];

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

// ---------- Reverse geocoding (lat/lng -> place name) ----------
// Uses OpenStreetMap's free Nominatim service — no API key or billing
// needed. Returns a short, readable area name, or null if the lookup
// fails (never blocks check-in/out — this is a nice-to-have, not
// required for attendance to work).
export const reverseGeocode = async (lat, lng) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    // Prefer a locality-level name over the full formatted address (which
    // is often long) — falls back progressively to whatever's available.
    const area = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || a.county;
    const region = a.state_district || a.state;
    const parts = [area, region].filter(Boolean);
    return parts.length ? parts.join(", ") : data.display_name || null;
  } catch {
    return null;
  }
};

export const googleMapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// ---- delay RCA + customer feedback (v34) ----
export const DELAY_CAUSES = [
  "Under-estimated (time / capacity)",
  "Fabric delay",
  "Sample approval delay",
  "Delay from the customer",
  "Delay due to rework",
  "Other",
];
export const FEEDBACK_ITEMS = [
  ["fabric_quality", "Quality of fabric"],
  ["stitching_quality", "Quality of stitching"],
  ["size_matching", "Size matching"],
  ["durability", "Durability"],
  ["pricing", "Pricing / value for money"],
  ["design_matching", "Design matching (against sample)"],
  ["color_matching", "Colour matching"],
  ["packing", "Packing and finishing"],
  ["communication", "Communication and support"],
  ["overall", "Overall experience"],
];
export const DELIVERY_TIMINGS = ["On time", "Slightly delayed", "Very delayed"];
export const isOrderOverdue = (o, today) => !!o?.due_date && o.due_date < today && !["Completed", "Shipped", "Rejected by Customer"].includes(o.status);
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

// ---------- CRM ----------
export const LEAD_TYPES = ["School", "Hospital", "Company", "Retailer", "Other"];
export const LEAD_STATUSES = ["New", "Contacted", "Interested", "Quotation Sent", "Order Created", "Won", "Lost"];
// one-click "next stage" in the Leads table; the rest is automatic (Order Created -> Won when the customer agrees)
export const LEAD_NEXT_STAGE = { New: "Contacted", Contacted: "Interested", Interested: "Quotation Sent" };
export const LEAD_STATUS_COLORS = {
  New: "bg-stone-100 text-stone-700",
  Contacted: "bg-sky-100 text-sky-800",
  Interested: "bg-indigo-100 text-indigo-800",
  "Quotation Sent": "bg-amber-100 text-amber-800",
  "Order Created": "bg-violet-100 text-violet-800",
  Won: "bg-emerald-100 text-emerald-800",
  Lost: "bg-rose-100 text-rose-800",
};
export const LEAD_SOURCES = ["Marketing visit", "Referral", "Phone enquiry", "WhatsApp", "Exhibition", "Existing customer", "Other"];
export const ACTIVITY_KINDS = ["Visit", "Call", "WhatsApp", "Email", "Meeting", "Quotation", "Note"];
export const COMMISSION_COLORS = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-sky-100 text-sky-800",
  Paid: "bg-emerald-100 text-emerald-800",
};
export const PERIOD_LABELS = { month: "calendar month", quarter: "financial quarter", year: "financial year", all: "all time" };
export const periodKeyLabel = (k) => {
  if (!k || k === "all") return "All time";
  if (/^\d{4}-\d{2}$/.test(k)) return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(k.slice(5, 7)) - 1] + " " + k.slice(0, 4);
  const m = k.match(/^FY(\d{4})(?:-Q(\d))?$/);
  if (m) return `${m[2] ? `Q${m[2]} ` : ""}FY ${m[1]}-${String((Number(m[1]) + 1) % 100).padStart(2, "0")}`;
  return k;
};
export const isLeadOverdue = (l, today) => !!l?.next_followup_date && l.next_followup_date <= today && !["Won", "Lost"].includes(l.status) && l.next_followup_date < today;


// ---- duplicate expenditure detection ----
// "exact": same date, category, vendor, item and amount. "possible": same vendor and amount within 3 days.
// Entries a reviewer has marked as correct (dup_cleared_at) are skipped. Payroll / commission postings are ignored.
const _norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const _dayNum = (d) => Math.round(new Date(`${d}T00:00:00Z`).getTime() / 86400000);
export function findDuplicateExpenditures(rows = []) {
  const list = rows.filter((r) => !r.payroll_id && !r.commission_id && Number(r.amount) > 0);
  const out = {}; // id -> { level: "exact" | "possible", group: [ids], with: [ids] }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Number(a.amount) !== Number(b.amount)) continue;
      const sameVendor = _norm(a.vendor) === _norm(b.vendor);
      const exact = a.expense_date === b.expense_date && a.category === b.category && sameVendor && _norm(a.item) === _norm(b.item);
      const possible = !exact && sameVendor && _norm(a.vendor) !== "" && Math.abs(_dayNum(a.expense_date) - _dayNum(b.expense_date)) <= 3;
      if (!exact && !possible) continue;
      if (a.dup_cleared_at && b.dup_cleared_at) continue; // both already validated
      const level = exact ? "exact" : "possible";
      for (const [x, y] of [[a, b], [b, a]]) {
        if (x.dup_cleared_at) continue;
        const cur = out[x.id] || { level, with: [] };
        if (level === "exact") cur.level = "exact";
        cur.with.push(y.id);
        out[x.id] = cur;
      }
    }
  }
  return out;
}
