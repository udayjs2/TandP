export const fmtMoney = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

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
