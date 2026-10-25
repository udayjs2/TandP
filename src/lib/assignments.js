// Shared bits for Order Assignment, the dashboard and the day-end report.
export const PRIORITIES = ["Top", "High", "Normal", "Low"];
export const PRIORITY_RANK = { Top: 0, High: 1, Normal: 2, Low: 3 };
export const PRIORITY_STYLE = {
  Top: "bg-rose-600 text-white",
  High: "bg-amber-500 text-white",
  Normal: "bg-sky-100 text-sky-800",
  Low: "bg-stone-100 text-stone-600",
};
export const TL_STATUS_STYLE = {
  "Not assigned": "bg-stone-100 text-stone-600",
  Assigned: "bg-amber-100 text-amber-800",
  Accepted: "bg-sky-100 text-sky-800",
  "In progress": "bg-indigo-100 text-indigo-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Declined: "bg-rose-100 text-rose-800",
};
export const byPriority = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
  String(a.order_number || "").localeCompare(String(b.order_number || ""));

// pieces made on `date` for an assignment (its item, or every item when it covers the whole order)
export const assignmentOutput = (a, progress, date) =>
  (progress || [])
    .filter((p) => p.order_id === a.order_id && p.date === date && (!a.item_description || p.item_description === a.item_description))
    .reduce((t, p) => t + Number(p.quantity || 0), 0);
