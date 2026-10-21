// Read-only data tools for the AI Factory Manager. Every tool takes (ctx, args) and returns plain JSON.
//   ctx = { sb, role, svc }   sb = supabase client (the user's own session in the app, so row-level security applies;
//   a service client for scheduled reports / WhatsApp, where `role` limits what may be read).
import { todayIST, addDays, daysBetween, isSunday, nextWorkingDay, sum, round, pctOf, groupBy, sizesTotal, itemsQty,
  resolveRange, fetchRows, softRows } from "./util.js";

const isOpen = (o) => !["Completed", "Shipped"].includes(o.status);
const money = (n) => Math.round(Number(n) || 0);

async function activeEmployees(sb) {
  const rows = await fetchRows(sb, "employees", "id, name, department, role, status, reporting_manager_id");
  return rows.filter((e) => e.status !== "Inactive");
}

// ------------------------------------------------------------------ HR & attendance
export async function attendance_summary(ctx, args = {}) {
  const date = args.date || todayIST();
  const emps = await activeEmployees(ctx.sb);
  const att = await fetchRows(ctx.sb, "attendance", "employee_id, status", (q) => q.eq("date", date));
  const st = Object.fromEntries(att.map((a) => [a.employee_id, a.status]));
  const kind = (e) => { const s = st[e.id]; if (!s) return "not_marked"; if (s === "Present") return "present"; if (s === "Half Day") return "half_day"; if (/leave/i.test(s)) return "on_leave"; return "absent"; };
  const tally = { present: 0, half_day: 0, on_leave: 0, absent: 0, not_marked: 0 };
  emps.forEach((e) => { tally[kind(e)] += 1; });
  const dept = {};
  emps.forEach((e) => { const d = e.department || e.role || "Unassigned"; const r = (dept[d] = dept[d] || { department: d, employees: 0, present: 0 }); r.employees += 1; if (["present", "half_day"].includes(kind(e))) r.present += 1; });
  return {
    date, total_employees: emps.length, ...tally,
    attendance_pct: pctOf(tally.present + tally.half_day, emps.length),
    department_availability: Object.values(dept).map((d) => ({ ...d, pct: pctOf(d.present, d.employees) })),
    absent_names: emps.filter((e) => kind(e) === "absent").map((e) => e.name).slice(0, 30),
    not_marked_names: emps.filter((e) => kind(e) === "not_marked").map((e) => e.name).slice(0, 30),
    note: tally.not_marked ? "Employees with no attendance record for the day are listed as not_marked." : undefined,
  };
}

// ------------------------------------------------------------------ production
export async function production_summary(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "last_7_days");
  const sb = ctx.sb;
  const [progress, cuts, ops, orders, att, emps] = await Promise.all([
    fetchRows(sb, "order_progress", "order_id, date, quantity", (q) => q.gte("date", r.from).lte("date", r.to)),
    fetchRows(sb, "cutting_entries", "order_id, cut_date, sizes, status", (q) => q.gte("cut_date", r.from).lte("cut_date", r.to)),
    fetchRows(sb, "operation_output", "employee_id, operation, quantity, work_date", (q) => q.gte("work_date", r.from).lte("work_date", r.to)),
    fetchRows(sb, "orders", "id, order_number, customer_name, daily_target, status"),
    fetchRows(sb, "attendance", "employee_id, date, status", (q) => q.gte("date", r.from).lte("date", r.to)),
    activeEmployees(sb),
  ]);
  const ordMap = Object.fromEntries(orders.map((o) => [o.id, o]));
  const days = [...new Set([...progress.map((p) => p.date), ...cuts.map((c) => c.cut_date)])].sort();
  const stitchedBy = groupBy(progress, (p) => p.date), cutBy = groupBy(cuts.filter((c) => c.status === "Approved"), (c) => c.cut_date);
  const presentBy = groupBy(att.filter((a) => a.status === "Present" || a.status === "Half Day"), (a) => a.date);
  const daily = days.map((d) => ({ date: d, stitched: sum(stitchedBy[d] || [], (x) => x.quantity), cut: sum(cutBy[d] || [], (c) => sizesTotal(c.sizes)), people_present: (presentBy[d] || []).length }));
  const totalStitched = sum(progress, (p) => p.quantity);
  const workDays = days.filter((d) => !isSunday(d) && sum(stitchedBy[d] || [], (x) => x.quantity) > 0).length;
  const personDays = att.filter((a) => a.status === "Present" || a.status === "Half Day").length;
  const plannedPerDay = sum(orders.filter(isOpen), (o) => o.daily_target);
  const perOrder = Object.entries(groupBy(progress, (p) => p.order_id)).map(([id, xs]) => ({ order: ordMap[id]?.order_number || "?", customer: ordMap[id]?.customer_name, stitched: sum(xs, (x) => x.quantity) })).sort((a, b) => b.stitched - a.stitched).slice(0, 12);
  const byOp = Object.entries(groupBy(ops, (o) => o.operation)).map(([operation, xs]) => ({ operation, pieces: sum(xs, (x) => x.quantity) })).sort((a, b) => b.pieces - a.pieces);
  // "lines" = the team under each reporting manager (Team Lead)
  const empMap = Object.fromEntries(emps.map((e) => [e.id, e]));
  const team = {};
  ops.forEach((o) => {
    const e = empMap[o.employee_id]; if (!e) return;
    const mgr = e.reporting_manager_id ? empMap[e.reporting_manager_id]?.name : null;
    const t = (team[mgr || "Unassigned"] = team[mgr || "Unassigned"] || { pieces: 0, people: new Set(), dayset: new Set() });
    t.pieces += Number(o.quantity) || 0; t.people.add(e.id); t.dayset.add(`${e.id}|${o.work_date}`);
  });
  const lines = Object.entries(team).map(([name, t]) => ({ team_lead: name, pieces: t.pieces, people: t.people.size, pieces_per_person_day: round(t.pieces / Math.max(1, t.dayset.size), 1) }));
  const mean = lines.length ? sum(lines, (l) => l.pieces_per_person_day) / lines.length : 0;
  lines.forEach((l) => { l.vs_average_pct = mean ? round((l.pieces_per_person_day / mean) * 100) : null; l.below_par = mean ? l.pieces_per_person_day < mean * 0.7 : false; });
  return {
    period: r.label, from: r.from, to: r.to,
    total_stitched: totalStitched, total_cut_approved: sum(daily, (d) => d.cut),
    working_days_with_output: workDays, avg_stitched_per_working_day: workDays ? round(totalStitched / workDays) : 0,
    planned_per_day_open_orders: plannedPerDay, vs_plan_pct: plannedPerDay && workDays ? pctOf(totalStitched / workDays, plannedPerDay) : null,
    output_per_present_person_day: personDays ? round(totalStitched / personDays, 1) : null,
    daily, by_order: perOrder, by_operation: byOp.slice(0, 15), team_lines: lines.sort((a, b) => a.pieces_per_person_day - b.pieces_per_person_day),
    note: "Team lines are the people under each reporting manager, from the Output (operation) log. Machine availability is not tracked.",
  };
}

// ------------------------------------------------------------------ orders
export async function orders_status(ctx, args = {}) {
  const today = todayIST();
  const [orders, progress, deliveries] = await Promise.all([
    fetchRows(ctx.sb, "orders", "id, order_number, customer_name, items, due_date, status, daily_target"),
    fetchRows(ctx.sb, "order_progress", "order_id, quantity"),
    fetchRows(ctx.sb, "order_deliveries", "order_id, date, quantity"),
  ]);
  const st = Object.fromEntries(Object.entries(groupBy(progress, (p) => p.order_id)).map(([k, v]) => [k, sum(v, (x) => x.quantity)]));
  const dl = groupBy(deliveries, (d) => d.order_id);
  const row = (o) => { const ordered = itemsQty(o.items), stitched = st[o.id] || 0; return { order: o.order_number, customer: o.customer_name, status: o.status, due_date: o.due_date, ordered, stitched, remaining_to_stitch: Math.max(0, ordered - stitched), delivered: sum(dl[o.id] || [], (x) => x.quantity), days_late: o.due_date && o.due_date < today ? daysBetween(o.due_date, today) : 0, days_to_due: o.due_date ? daysBetween(today, o.due_date) : null }; };
  const open = orders.filter(isOpen).map(row);
  const completedToday = orders.filter((o) => ["Completed", "Shipped"].includes(o.status) && (dl[o.id] || []).some((d) => d.date === today)).map((o) => o.order_number);
  return {
    today, total_orders: orders.length, by_status: Object.fromEntries(Object.entries(groupBy(orders, (o) => o.status)).map(([k, v]) => [k, v.length])),
    open_orders: open.length, completed_today: completedToday,
    delayed: open.filter((o) => o.days_late > 0).sort((a, b) => b.days_late - a.days_late).slice(0, 25),
    approaching_due_7_days: open.filter((o) => o.days_to_due !== null && o.days_to_due >= 0 && o.days_to_due <= 7).sort((a, b) => a.days_to_due - b.days_to_due).slice(0, 25),
    in_progress: open.filter((o) => o.days_late === 0).slice(0, 25),
  };
}

// ------------------------------------------------------------------ quality
export async function quality_summary(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "last_7_days");
  const [insp, orders] = await Promise.all([
    fetchRows(ctx.sb, "quality_inspections", "order_id, decision, checks, inspected_qty, defective_qty, created_at", (q) => q.gte("created_at", r.from).lte("created_at", `${r.to}T23:59:59`)),
    fetchRows(ctx.sb, "orders", "id, order_number, customer_name"),
  ]);
  const ord = Object.fromEntries(orders.map((o) => [o.id, o]));
  const inspected = sum(insp, (i) => i.inspected_qty), defective = sum(insp, (i) => i.defective_qty);
  const fails = {};
  insp.forEach((i) => (i.checks || []).forEach((c) => { if (/fail/i.test(c.result || "")) fails[c.label || c.key] = (fails[c.label || c.key] || 0) + 1; }));
  const history = {};
  (await softRows(ctx.sb, "quality_inspections", "order_id, decision, created_at", (q) => q.in("order_id", [...new Set(insp.map((i) => i.order_id))]), "created_at"))
    .forEach((h) => (history[h.order_id] = history[h.order_id] || []).push(h));
  const rework = Object.values(history).filter((hs) => { const ri = hs.findIndex((h) => h.decision === "Rejected"); return ri >= 0 && hs.slice(ri + 1).some((h) => h.decision === "Approved"); }).length;
  const perOrder = Object.entries(groupBy(insp, (i) => i.order_id)).map(([id, xs]) => ({ order: ord[id]?.order_number || "?", customer: ord[id]?.customer_name, inspections: xs.length, rejected_inspections: xs.filter((x) => x.decision === "Rejected").length, inspected: sum(xs, (x) => x.inspected_qty), defective: sum(xs, (x) => x.defective_qty), defect_rate_pct: pctOf(sum(xs, (x) => x.defective_qty), sum(xs, (x) => x.inspected_qty)) })).sort((a, b) => (b.defect_rate_pct || 0) - (a.defect_rate_pct || 0));
  return {
    period: r.label, inspections: insp.length, approved: insp.filter((i) => i.decision === "Approved").length, rejected: insp.filter((i) => i.decision === "Rejected").length,
    pieces_inspected: inspected, defective_pieces: defective, defect_rate_pct: pctOf(defective, inspected),
    approved_pieces: sum(insp.filter((i) => i.decision === "Approved"), (i) => i.inspected_qty), orders_reworked_then_approved: rework,
    top_failed_checks: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([check, count]) => ({ check, count })),
    by_order: perOrder.slice(0, 12),
  };
}

// ------------------------------------------------------------------ cutting
export async function cutting_summary(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "last_7_days");
  const [cuts, orders] = await Promise.all([
    fetchRows(ctx.sb, "cutting_entries", "order_id, cut_date, sizes, status, fabric_kg_used, fabric_meters_used", (q) => q.gte("cut_date", r.from).lte("cut_date", r.to)),
    fetchRows(ctx.sb, "orders", "id, order_number"),
  ]);
  const ord = Object.fromEntries(orders.map((o) => [o.id, o.order_number]));
  const by = (s) => cuts.filter((c) => c.status === s);
  const kg = (xs) => round(sum(xs, (c) => c.fabric_kg_used), 1), m = (xs) => round(sum(xs, (c) => c.fabric_meters_used), 1);
  const approved = by("Approved"), rejected = by("Rejected"), pending = by("Submitted");
  return {
    period: r.label, entries: cuts.length,
    pieces_cut_approved: sum(approved, (c) => sizesTotal(c.sizes)), pieces_rejected: sum(rejected, (c) => sizesTotal(c.sizes)), pieces_awaiting_review: sum(pending, (c) => sizesTotal(c.sizes)),
    pending_bundles_awaiting_review: pending.length,
    fabric_used: { kg: kg(cuts), meters: m(cuts) }, fabric_in_rejected_cuts_wastage: { kg: kg(rejected), meters: m(rejected), pct_of_fabric_kg: pctOf(kg(rejected), kg(cuts)) },
    rejected_entries: rejected.slice(0, 10).map((c) => ({ order: ord[c.order_id], date: c.cut_date, pieces: sizesTotal(c.sizes), kg: c.fabric_kg_used })),
    note: "Wastage is measured as fabric used in rejected cutting entries; fabric offcuts are not separately recorded.",
  };
}

// ------------------------------------------------------------------ inventory
export async function inventory_status(ctx, args = {}) {
  const low = Number.isFinite(Number(args.low_threshold)) ? Number(args.low_threshold) : 20;
  const [fabric, items, orders, progress, deliveries] = await Promise.all([
    fetchRows(ctx.sb, "inventory_fabric", "fabric_type, color, stock_kg, stock_meters"),
    fetchRows(ctx.sb, "inventory_items", "category, name, quantity, unit"),
    fetchRows(ctx.sb, "orders", "id, order_number, customer_name, status"),
    fetchRows(ctx.sb, "order_progress", "order_id, quantity"),
    fetchRows(ctx.sb, "order_deliveries", "order_id, quantity"),
  ]);
  const st = Object.fromEntries(Object.entries(groupBy(progress, (p) => p.order_id)).map(([k, v]) => [k, sum(v, (x) => x.quantity)]));
  const dl = Object.fromEntries(Object.entries(groupBy(deliveries, (p) => p.order_id)).map(([k, v]) => [k, sum(v, (x) => x.quantity)]));
  const awaiting = orders.map((o) => ({ order: o.order_number, customer: o.customer_name, status: o.status, awaiting_dispatch: Math.max(0, (st[o.id] || 0) - (dl[o.id] || 0)) })).filter((x) => x.awaiting_dispatch > 0).sort((a, b) => b.awaiting_dispatch - a.awaiting_dispatch);
  return {
    fabric: fabric.map((f) => ({ fabric: `${f.fabric_type}${f.color ? ` ${f.color}` : ""}`, kg: Number(f.stock_kg) || 0, meters: Number(f.stock_meters) || 0 })).sort((a, b) => a.kg - b.kg).slice(0, 40),
    fabric_total_kg: round(sum(fabric, (f) => f.stock_kg), 1),
    accessories_low_stock: items.filter((i) => Number(i.quantity) <= low).map((i) => ({ item: i.name, category: i.category, quantity: Number(i.quantity), unit: i.unit })).sort((a, b) => a.quantity - b.quantity),
    low_stock_threshold_used: low, note: "No minimum stock levels are stored, so 'low stock' means at or below the threshold above.",
    finished_pieces_awaiting_dispatch: sum(awaiting, (x) => x.awaiting_dispatch), awaiting_dispatch_by_order: awaiting.slice(0, 15),
  };
}

export async function fabric_required_tomorrow(ctx) {
  const today = todayIST(), day = nextWorkingDay(today);
  const [orders, progress, cuts, fabric] = await Promise.all([
    fetchRows(ctx.sb, "orders", "id, order_number, customer_name, items, daily_target, status"),
    fetchRows(ctx.sb, "order_progress", "order_id, date, quantity"),
    fetchRows(ctx.sb, "cutting_entries", "order_id, sizes, status, fabric_kg_used", (q) => q.eq("status", "Approved")),
    fetchRows(ctx.sb, "inventory_fabric", "stock_kg"),
  ]);
  const st = groupBy(progress, (p) => p.order_id), cu = groupBy(cuts, (c) => c.order_id);
  const globalPieces = sum(cuts, (c) => sizesTotal(c.sizes)), globalKg = sum(cuts, (c) => c.fabric_kg_used);
  const globalRate = globalPieces ? globalKg / globalPieces : null;
  const since = addDays(today, -13);
  const rows = orders.filter(isOpen).map((o) => {
    const done = sum(st[o.id] || [], (x) => x.quantity), remaining = Math.max(0, itemsQty(o.items) - done);
    const recent = (st[o.id] || []).filter((x) => x.date >= since); const days = new Set(recent.filter((x) => Number(x.quantity) > 0).map((x) => x.date)).size;
    const plan = Number(o.daily_target) > 0 ? Number(o.daily_target) : days ? sum(recent, (x) => x.quantity) / days : 0;
    const planned = Math.min(plan, remaining);
    const pieces = sum(cu[o.id] || [], (c) => sizesTotal(c.sizes)), kgUsed = sum(cu[o.id] || [], (c) => c.fabric_kg_used);
    const rate = pieces && kgUsed ? kgUsed / pieces : globalRate;
    return { order: o.order_number, customer: o.customer_name, planned_pieces: Math.round(planned), kg_per_piece: rate ? round(rate, 3) : null, fabric_kg_needed: rate ? round(planned * rate, 1) : null, rate_source: pieces && kgUsed ? "this order's cutting history" : globalRate ? "factory average" : "no history" };
  }).filter((r) => r.planned_pieces > 0);
  const need = round(sum(rows, (r) => r.fabric_kg_needed), 1), stock = round(sum(fabric, (f) => f.stock_kg), 1);
  return { for_date: day, orders: rows, total_fabric_kg_needed: need, fabric_in_stock_kg: stock, shortfall_kg: Math.max(0, round(need - stock, 1)), note: "Estimate: planned pieces for the next working day (daily target, else recent pace, capped at pieces remaining) x fabric kg per cut piece. Stock is compared in total, not per fabric type." };
}

// ------------------------------------------------------------------ finance (admin / finance only)
export async function finance_summary(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "this_quarter");
  const sb = ctx.sb;
  const [inv, exp, pay, allInv, allPay] = await Promise.all([
    fetchRows(sb, "invoices", "amount, issue_date", (q) => q.gte("issue_date", r.from).lte("issue_date", r.to)),
    fetchRows(sb, "expenditures", "amount, category, expense_date", (q) => q.gte("expense_date", r.from).lte("expense_date", r.to)),
    fetchRows(sb, "order_payments", "amount, payment_date", (q) => q.gte("payment_date", r.from).lte("payment_date", r.to)),
    fetchRows(sb, "invoices", "amount"), fetchRows(sb, "order_payments", "amount"),
  ]);
  const byCat = Object.entries(groupBy(exp, (e) => e.category || "Other")).map(([category, xs]) => ({ category, amount: money(sum(xs, (x) => x.amount)) })).sort((a, b) => b.amount - a.amount);
  const revenue = sum(inv, (i) => i.amount), expenses = sum(exp, (e) => e.amount);
  const months = [...new Set([...inv.map((i) => (i.issue_date || "").slice(0, 7)), ...exp.map((e) => e.expense_date.slice(0, 7))])].filter(Boolean).sort();
  return {
    period: r.label, from: r.from, to: r.to, revenue_invoiced: money(revenue), expenses_recorded: money(expenses), profit_or_loss: money(revenue - expenses),
    payments_received: money(sum(pay, (p) => p.amount)), receivables_outstanding_all_time: money(Math.max(0, sum(allInv, (i) => i.amount) - sum(allPay, (p) => p.amount))),
    expenses_by_category: byCat.slice(0, 10),
    monthly: months.map((m) => ({ month: m, revenue: money(sum(inv.filter((i) => (i.issue_date || "").startsWith(m)), (i) => i.amount)), expenses: money(sum(exp.filter((e) => e.expense_date.startsWith(m)), (e) => e.amount)) })),
    note: "Revenue = invoices issued in the period; expenses = logged expenditures (including salaries if they were posted).",
  };
}

export async function order_profitability(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "this_quarter");
  const limit = Math.min(60, Number(args.limit) || 40);
  const [orders, invoices, pays] = await Promise.all([
    fetchRows(ctx.sb, "orders", "id, order_number, customer_name"),
    fetchRows(ctx.sb, "invoices", "linked_order_id, amount, issue_date"),
    fetchRows(ctx.sb, "order_payments", "order_id, amount"),
  ]);
  const inRange = invoices.filter((i) => i.linked_order_id && i.issue_date >= r.from && i.issue_date <= r.to);
  const ids = [...new Set(inRange.map((i) => i.linked_order_id))].slice(0, limit);
  const fn = ctx.svc ? "order_actual_cost_internal" : "order_actual_cost";
  const costs = await Promise.all(ids.map((id) => ctx.sb.rpc(fn, { p_order: id }).then((x) => [id, x.data, x.error])));
  const ord = Object.fromEntries(orders.map((o) => [o.id, o])), inv = groupBy(invoices, (i) => i.linked_order_id), pay = groupBy(pays, (p) => p.order_id);
  const rows = costs.filter(([, d]) => d && d.totals).map(([id, d]) => {
    const revenue = sum(inRange.filter((i) => i.linked_order_id === id), (i) => i.amount), cost = Number(d.totals.total) || 0;
    return { order: ord[id]?.order_number, customer: ord[id]?.customer_name, revenue: money(revenue), actual_cost: money(cost), profit: money(revenue - cost), margin_pct: pctOf(revenue - cost, revenue), outstanding: money(Math.max(0, sum(inv[id] || [], (i) => i.amount) - sum(pay[id] || [], (p) => p.amount))), orders_missing_prices: d.unpriced_lines > 0 };
  });
  const byCust = Object.entries(groupBy(rows, (x) => x.customer || "?")).map(([customer, xs]) => ({ customer, orders: xs.length, revenue: sum(xs, (x) => x.revenue), profit: sum(xs, (x) => x.profit) })).sort((a, b) => a.profit - b.profit);
  const err = costs.find(([, , e]) => e);
  return { period: r.label, orders_costed: rows.length, loss_making_orders: rows.filter((x) => x.profit < 0).sort((a, b) => a.profit - b.profit), loss_making_customers: byCust.filter((c) => c.profit < 0), best_orders: [...rows].sort((a, b) => b.profit - a.profit).slice(0, 5), customers: byCust, error: err ? err[2].message : undefined, note: "Actual cost = fabric used, trims issued, tagged expenses and manpower. Orders missing prices look more profitable than they are." };
}

// ------------------------------------------------------------------ sales & commission (admin only)
export async function sales_summary(ctx, args = {}) {
  const r = resolveRange(args, todayIST(), "this_month");
  const today = todayIST();
  const [leads, emps, sales] = await Promise.all([
    fetchRows(ctx.sb, "sales_leads", "company_name, status, salesperson_id, estimated_value, quotation_value, next_followup_date, created_at, lead_number"),
    fetchRows(ctx.sb, "employees", "id, name"),
    fetchRows(ctx.sb, "order_sales", "order_id, salesperson_id, order_value"),
  ]);
  const name = Object.fromEntries(emps.map((e) => [e.id, e.name]));
  const open = leads.filter((l) => !["Won", "Lost"].includes(l.status));
  const inP = leads.filter((l) => l.created_at.slice(0, 10) >= r.from && l.created_at.slice(0, 10) <= r.to);
  return {
    period: r.label, leads_total: leads.length, new_leads_in_period: inP.length, by_status: Object.fromEntries(Object.entries(groupBy(leads, (l) => l.status)).map(([k, v]) => [k, v.length])),
    won: leads.filter((l) => l.status === "Won").length, conversion_pct: pctOf(leads.filter((l) => l.status === "Won").length, leads.length),
    open_pipeline_value: money(sum(open, (l) => l.quotation_value || l.estimated_value)),
    overdue_followups: open.filter((l) => l.next_followup_date && l.next_followup_date < today).map((l) => ({ lead: l.lead_number, company: l.company_name, salesperson: name[l.salesperson_id], due: l.next_followup_date })).slice(0, 20),
    by_salesperson: Object.entries(groupBy(leads, (l) => l.salesperson_id)).map(([id, xs]) => ({ salesperson: name[id] || "Unassigned", leads: xs.length, won: xs.filter((x) => x.status === "Won").length, open: xs.filter((x) => !["Won", "Lost"].includes(x.status)).length, confirmed_order_value: money(sum(sales.filter((s) => s.salesperson_id === id), (s) => s.order_value)) })),
  };
}

export async function commission_summary(ctx) {
  const [settings, rows, emps] = await Promise.all([
    fetchRows(ctx.sb, "commission_settings", "*", null, null),
    fetchRows(ctx.sb, "sales_commissions", "salesperson_id, period_key, order_number, order_value, amount, status"),
    fetchRows(ctx.sb, "employees", "id, name"),
  ]);
  const name = Object.fromEntries(emps.map((e) => [e.id, e.name]));
  const prog = await ctx.sb.rpc(ctx.svc ? "commission_progress_internal" : "commission_progress");
  const s = settings[0] || {};
  return {
    rule: `${s.rate_pct}% of each order's value once a salesperson's combined orders in a ${s.period} exceed ₹${Number(s.threshold || 0).toLocaleString("en-IN")} (basis: ${s.basis} orders)`,
    by_salesperson: Object.entries(groupBy(rows, (r) => r.salesperson_id)).map(([id, xs]) => ({ salesperson: name[id] || "?", pending: money(sum(xs.filter((x) => x.status === "Pending"), (x) => x.amount)), approved_unpaid: money(sum(xs.filter((x) => x.status === "Approved"), (x) => x.amount)), paid: money(sum(xs.filter((x) => x.status === "Paid"), (x) => x.amount)), payable_now: money(sum(xs.filter((x) => x.status !== "Paid"), (x) => x.amount)) })),
    threshold_progress: Array.isArray(prog.data) ? prog.data.slice(0, 30).map((p) => ({ salesperson: p.salesperson_name, period: p.period_key, orders: p.orders, confirmed_value: p.confirmed_value, counted_value: p.counted_value, threshold: p.threshold, eligible: Number(p.counted_value) > Number(p.threshold) })) : [],
  };
}

// ------------------------------------------------------------------ generic read-only lookup
const TABLES = {
  employees: { cols: "id, name, department, role, status, join_date, reporting_manager_id", any: ["admin", "gm", "pm"] },
  orders: { cols: "*", any: ["admin", "gm", "pm"] }, order_progress: { cols: "*", any: ["admin", "gm", "pm"] }, order_deliveries: { cols: "*", any: ["admin", "gm", "pm"] },
  cutting_entries: { cols: "*", any: ["admin", "gm", "pm"] }, quality_inspections: { cols: "*", any: ["admin", "gm", "pm"] }, operation_output: { cols: "*", any: ["admin", "gm", "pm"] },
  attendance: { cols: "employee_id, date, status, check_in, check_out", any: ["admin", "gm", "pm"] }, leave_requests: { cols: "*", any: ["admin", "gm", "pm"] },
  inventory_fabric: { cols: "*", any: ["admin", "gm", "pm"] }, inventory_items: { cols: "*", any: ["admin", "gm", "pm"] }, fabric_usage: { cols: "*", any: ["admin", "gm", "pm"] },
  order_labor: { cols: "*", any: ["admin", "gm", "pm"] }, purchase_requests: { cols: "*", any: ["admin", "gm", "pm"] },
  invoices: { cols: "*", any: ["admin", "finance"] }, order_payments: { cols: "*", any: ["admin", "finance"] }, expenditures: { cols: "*", any: ["admin", "finance"] },
  sales_leads: { cols: "*", any: ["admin"] }, lead_activities: { cols: "*", any: ["admin"] }, sales_commissions: { cols: "*", any: ["admin", "finance"] },
};
export async function query_table(ctx, args = {}) {
  const t = TABLES[args.table];
  if (!t) return { error: `Table not available. Choose one of: ${Object.keys(TABLES).filter((k) => TABLES[k].any.includes(ctx.role)).join(", ")}` };
  if (!t.any.includes(ctx.role)) return { error: `Your role cannot read ${args.table}.` };
  const cols = t.cols === "*" ? "*" : t.cols;
  let q = ctx.sb.from(args.table).select(cols);
  for (const f of args.filters || []) {
    const op = { eq: "eq", neq: "neq", gt: "gt", gte: "gte", lt: "lt", lte: "lte" }[f.op];
    if (!op || !/^[a-z_]+$/.test(f.column || "")) return { error: "Bad filter" };
    q = q[op](f.column, f.value);
  }
  if (args.order_by && /^[a-z_]+$/.test(args.order_by)) q = q.order(args.order_by, { ascending: args.ascending !== false });
  const { data, error } = await q.limit(Math.min(100, Number(args.limit) || 50));
  if (error) return { error: error.message };
  return { table: args.table, rows: (data || []).map((r) => { const { base_salary, ...rest } = r; return rest; }), count: (data || []).length };
}

// ------------------------------------------------------------------ the daily factory report (sections A - E)
export async function daily_factory_report(ctx, args = {}) {
  const date = args.date || todayIST();
  const canMoney = ["admin", "finance"].includes(ctx.role);
  const safe = async (fn, a) => { try { return await fn(ctx, a); } catch (e) { return { error: e.message }; } };
  const [att, prod, ordr, qual, cut, inv, fab] = await Promise.all([
    safe(attendance_summary, { date }), safe(production_summary, { from: date, to: date }), safe(orders_status, {}), safe(quality_summary, { from: date, to: date }),
    safe(cutting_summary, { from: date, to: date }), safe(inventory_status, {}), safe(fabric_required_tomorrow, {}),
  ]);
  const fin = canMoney ? await safe(finance_summary, { from: date, to: date }) : null;
  // labour cost today = (monthly salary / days in month) for everyone who was present
  let labour = null;
  if (canMoney) {
    try {
      const [emps, a] = await Promise.all([fetchRows(ctx.sb, "employees", "id, base_salary"), fetchRows(ctx.sb, "attendance", "employee_id, status", (q) => q.eq("date", date))]);
      const dim = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
      const pres = Object.fromEntries(a.map((x) => [x.employee_id, x.status]));
      labour = round(sum(emps, (e) => (pres[e.id] === "Present" ? 1 : pres[e.id] === "Half Day" ? 0.5 : 0) * (Number(e.base_salary) || 0) / dim));
    } catch { labour = null; }
  }
  const sections = [];
  const bad = (x) => !x || x.error;
  if (!bad(att)) sections.push({ key: "A", heading: "A. Workforce", kpis: [
    { label: "Total employees", value: String(att.total_employees) }, { label: "Present", value: String(att.present + att.half_day) }, { label: "Absent / on leave", value: String(att.absent + att.on_leave) }, { label: "Not marked", value: String(att.not_marked) }, { label: "Attendance", value: att.attendance_pct === null ? "—" : `${att.attendance_pct}%` } ],
    table: { columns: [{ label: "Department" }, { label: "Employees", type: "int" }, { label: "Present", type: "int" }, { label: "Availability", type: "pct" }], rows: att.department_availability.map((d) => [d.department, d.employees, d.present, d.pct]) } });
  if (!bad(prod)) {
    const cutN = !bad(cut) ? cut.pieces_cut_approved : null;
    const ops = prod.by_operation;
    const fin_ops = ops.filter((o) => /finish|iron|press|pack|trim|thread/i.test(o.operation));
    sections.push({ key: "B", heading: "B. Production", kpis: [
      { label: "Cutting output", value: cutN === null ? "—" : String(cutN) }, { label: "Stitching output", value: String(prod.total_stitched) },
      { label: "Finishing output", value: fin_ops.length ? String(sum(fin_ops, (o) => o.pieces)) : "not tracked" },
      { label: "Quality-approved", value: !bad(qual) ? String(qual.approved_pieces) : "—" }, { label: "Rejected pieces", value: !bad(qual) ? String(qual.defective_pieces) : "—" },
      { label: "Rework (orders)", value: !bad(qual) ? String(qual.orders_reworked_then_approved) : "—" }, { label: "Output / present employee", value: prod.output_per_present_person_day === null ? "—" : String(prod.output_per_present_person_day) } ],
      table: { columns: [{ label: "Operation" }, { label: "Pieces", type: "int" }], rows: ops.map((o) => [o.operation, o.pieces]) } });
  }
  if (!bad(ordr)) sections.push({ key: "C", heading: "C. Orders", kpis: [
    { label: "Completed today", value: String(ordr.completed_today.length) }, { label: "In progress", value: String(ordr.in_progress.length) }, { label: "Delayed", value: String(ordr.delayed.length) }, { label: "Due within 7 days", value: String(ordr.approaching_due_7_days.length) } ],
    table: { columns: [{ label: "Order" }, { label: "Customer" }, { label: "Due" }, { label: "Days late", type: "int" }, { label: "Left to stitch", type: "int" }], rows: [...ordr.delayed, ...ordr.approaching_due_7_days].slice(0, 20).map((o) => [o.order, o.customer, o.due_date, o.days_late, o.remaining_to_stitch]) } });
  if (!bad(inv)) sections.push({ key: "D", heading: "D. Inventory", kpis: [
    { label: "Fabric consumed today (kg)", value: !bad(cut) ? String(cut.fabric_used.kg) : "—" }, { label: "Fabric in stock (kg)", value: String(inv.fabric_total_kg) },
    { label: "Fabric needed tomorrow (kg)", value: !bad(fab) ? String(fab.total_fabric_kg_needed) : "—" }, { label: "Accessories low", value: String(inv.accessories_low_stock.length) }, { label: "Finished pcs awaiting dispatch", value: String(inv.finished_pieces_awaiting_dispatch) } ],
    table: { columns: [{ label: "Accessory / item" }, { label: "Quantity", type: "int" }, { label: "Unit" }], rows: inv.accessories_low_stock.slice(0, 15).map((i) => [i.item, i.quantity, i.unit]) },
    bullets: !bad(fab) && fab.shortfall_kg > 0 ? [`Fabric shortfall for ${fab.for_date}: about ${fab.shortfall_kg} kg.`] : undefined });
  if (canMoney && !bad(fin)) sections.push({ key: "E", heading: "E. Financial performance", kpis: [
    { label: "Revenue recorded", value: `₹${fin.revenue_invoiced.toLocaleString("en-IN")}` }, { label: "Costs recorded", value: `₹${fin.expenses_recorded.toLocaleString("en-IN")}` }, { label: "Payments received", value: `₹${fin.payments_received.toLocaleString("en-IN")}` },
    { label: "Customer payments outstanding", value: `₹${fin.receivables_outstanding_all_time.toLocaleString("en-IN")}` }, ...(labour !== null ? [{ label: "Labour cost today (est.)", value: `₹${labour.toLocaleString("en-IN")}` }] : []), { label: "Profit / loss (today's records)", value: `₹${fin.profit_or_loss.toLocaleString("en-IN")}` } ],
    bullets: ["Profit or loss shown is today's invoices minus today's logged expenses; see Order Profitability for true per-order results."] });
  return { date, sections, errors: Object.fromEntries(Object.entries({ att, prod, ordr, qual, cut, inv, fab, fin }).filter(([, v]) => v && v.error).map(([k, v]) => [k, v.error])) };
}
