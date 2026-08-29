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
