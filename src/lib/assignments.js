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

// Pieces credited to each assignment, worked out in the database (assignment_outputs): the Team Lead with the
// exact item wins over a whole-order Team Lead; ties go to whoever logged the hour, then to team size.
export async function fetchOutputs(supabase, from, to) {
  const { data } = await supabase.rpc("assignment_outputs", { p_from: from, p_to: to || from });
  return Object.fromEntries((data || []).map((r) => [r.assignment_id, Number(r.output) || 0]));
}
