import { useEffect, useState } from "react";
import { Users, CalendarCheck, Package, Receipt, Activity, Users2, UserCog } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, StatCard } from "./ui";
import AlertTicker from "./AlertTicker";
import DayReport from "./DayReport";
import { fmtMoney, monthKey, todayStr, ORDER_STATUS_COLORS } from "../lib/helpers";
import { PRIORITY_STYLE, TL_STATUS_STYLE, byPriority, assignmentOutput } from "../lib/assignments";

export default function Dashboard({ profile }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  const load = async () => {
    const today = todayStr();
    const mk = monthKey();

    const [
      { data: employees },
      { data: todaysAtt },
      { data: orders },
      { data: sales },
      { data: recentOrders },
      { data: todaysProgress },
      { data: todaysLabor },
      { data: allEmployees },
      { data: planToday },
      { data: tlProfiles },
    ] = await Promise.all([
      supabase.from("employees").select("id, role").neq("status", "Inactive"),
      supabase.from("attendance").select("employee_id, status").eq("date", today),
      supabase.from("orders").select("id, status, order_number, customer_name, daily_target, items"),
      supabase.from("sales_targets").select("employee_id, target, achieved").eq("month", mk),
      supabase.from("orders").select("*").order("order_date", { ascending: false }).limit(5),
      supabase.from("order_progress").select("order_id, quantity").eq("date", today),
      supabase.from("order_labor").select("order_id, employee_id").eq("work_date", today),
      supabase.from("employees").select("id, name, reporting_manager_id"),
      supabase.from("order_assignments").select("*").eq("work_date", today).eq("pm_status", "Accepted"),
      supabase.from("profiles").select("id, name, employee_id").eq("role", "tl"),
    ]);

    // Teams working today: group today's order_labor assignments by order,
    // and label each person's team by their reporting manager (their TL).
    const empById = {};
    (allEmployees || []).forEach((e) => (empById[e.id] = e));
    const orderNameById = {};
    (orders || []).forEach((o) => (orderNameById[o.id] = `${o.order_number} — ${o.customer_name}`));
    const teamsByOrder = {};
    (todaysLabor || []).forEach((l) => {
      const emp = empById[l.employee_id];
      if (!emp) return;
      teamsByOrder[l.order_id] = teamsByOrder[l.order_id] || { orderLabel: orderNameById[l.order_id] || "—", people: [] };
      const manager = emp.reporting_manager_id ? empById[emp.reporting_manager_id] : null;
      teamsByOrder[l.order_id].people.push({ name: emp.name, team: manager ? manager.name : null });
    });
    const teamsWorkingToday = Object.values(teamsByOrder);

    const presentToday = (todaysAtt || []).filter((a) => a.status === "Present" || a.status === "Half Day").length;
    const pendingOrders = (orders || []).filter((o) => !["Completed", "Shipped", "Rejected by Customer"].includes(o.status)).length;
    const totalTarget = (sales || []).reduce((s, r) => s + Number(r.target || 0), 0);
    const totalAchieved = (sales || []).reduce((s, r) => s + Number(r.achieved || 0), 0);

    // Only the orders the Production Manager planned for today (and accepted) show as today's production.
    const orderById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    const plan = (planToday || []).map((a) => ({ ...a, order_number: orderById[a.order_id]?.order_number, customer_name: orderById[a.order_id]?.customer_name }));
    const progressRows = (todaysProgress || []).map((p) => ({ ...p, date: today }));
    const orderProgressToday = plan.map((a) => ({ ...a, done: assignmentOutput(a, progressRows, today) })).sort(byPriority);
    const seen = new Set();
    let todayTotalDone = 0;
    orderProgressToday.forEach((a) => { const k = `${a.order_id}|${a.item_description || ""}`; if (!seen.has(k)) { seen.add(k); todayTotalDone += a.done; } });
    const todayTotalTarget = orderProgressToday.reduce((s, a) => s + Number(a.target_qty || 0), 0);

    // every Team Leader, with what they are working on today
    const nameOf = Object.fromEntries((allEmployees || []).map((e) => [e.id, e.name]));
    const tlList = [...new Map((tlProfiles || []).filter((t) => t.employee_id).map((t) => [t.employee_id, { id: t.employee_id, name: nameOf[t.employee_id] || t.name }])).values()].sort((x, y) => x.name.localeCompare(y.name));
    const tlRows = tlList.map((t) => ({ ...t, work: orderProgressToday.filter((a) => a.tl_employee_id === t.id) }));
    const unassignedWork = orderProgressToday.filter((a) => !a.tl_employee_id || !tlList.some((t) => t.id === a.tl_employee_id));

    setStats({
      employeeCount: (employees || []).length,
      presentToday,
      pendingOrders,
      totalTarget,
      totalAchieved,
      recentOrders: recentOrders || [],
      salesCount: (employees || []).filter((e) => e.role === "Sales").length,
      orderProgressToday,
      todayTotalDone,
      todayTotalTarget,
      tlRows,
      unassignedWork,
      teamsWorkingToday,
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  if (loading || !stats) return <p className="text-stone-500 text-sm">Loading dashboard…</p>;

  return (
    <div className="space-y-6">
      <AlertTicker profile={profile} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Employees" value={stats.employeeCount} icon={Users} />
        <StatCard
          label="Present today"
          value={stats.employeeCount ? `${stats.presentToday}/${stats.employeeCount}` : "—"}
          icon={CalendarCheck}
          tone={stats.employeeCount && stats.presentToday / stats.employeeCount < 0.7 ? "warn" : "good"}
        />
        <StatCard label="Orders in progress" value={stats.pendingOrders} icon={Package} />
        <StatCard label="Sales team" value={stats.salesCount} icon={Receipt} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3">Sales this month</h3>
          {stats.salesCount === 0 ? (
            <p className="text-sm text-stone-500">No sales team members yet.</p>
          ) : (
            <>
              <div className="flex justify-between text-xs text-stone-500 mb-1">
                <span>{fmtMoney(stats.totalAchieved)} achieved</span>
                <span>Target {fmtMoney(stats.totalTarget)}</span>
              </div>
              <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${stats.totalTarget ? Math.min(100, (stats.totalAchieved / stats.totalTarget) * 100) : 0}%` }}
                />
              </div>
            </>
          )}
        </Card>

      </div>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
          <Activity size={14} className="text-indigo-700" />
          Today's production progress
        </h3>
        {stats.orderProgressToday.length === 0 ? (
          <p className="text-sm text-stone-500">No orders have been planned for today. The Production Manager chooses them in Production Management → Order Assignment.</p>
        ) : (
          <div className="space-y-3">
            {stats.todayTotalTarget > 0 && (
              <div>
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span>{stats.todayTotalDone} items completed</span>
                  <span>Target {stats.todayTotalTarget}</span>
                </div>
                <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-700" style={{ width: `${Math.min(100, (stats.todayTotalDone / stats.todayTotalTarget) * 100)}%` }} />
                </div>
              </div>
            )}
            <div className="divide-y divide-stone-100">
              {stats.orderProgressToday.map((a) => (
                <div key={a.id} className="py-1.5 flex items-center justify-between text-sm gap-3">
                  <span className="truncate flex items-center gap-2">
                    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>
                    {a.order_number} — {a.customer_name}{a.item_description ? ` · ${a.item_description}` : ""}
                  </span>
                  <span className="font-mono text-xs text-stone-500 whitespace-nowrap">{a.done}{a.target_qty ? `/${a.target_qty}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5"><UserCog size={14} className="text-indigo-700" /> Team Leaders — today's work</h3>
        {stats.tlRows.length === 0 && stats.unassignedWork.length === 0 ? (
          <p className="text-sm text-stone-500">No Team Leaders found yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="tl-table">
              <thead className="text-xs uppercase text-stone-500 text-left">
                <tr><th className="py-1.5 pr-3">Team Leader</th><th className="pr-3">Order</th><th className="pr-3">Items</th><th className="text-right">Total output</th></tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {stats.tlRows.flatMap((t) =>
                  t.work.length === 0
                    ? [<tr key={t.id}><td className="py-1.5 pr-3 font-medium">{t.name}</td><td colSpan={3} className="text-stone-400 text-xs">No work assigned today</td></tr>]
                    : t.work.map((a, i) => (
                        <tr key={a.id}>
                          <td className="py-1.5 pr-3 font-medium">{i === 0 ? t.name : ""}</td>
                          <td className="pr-3">{a.order_number} — {a.customer_name}<span className={`ml-2 text-[10px] rounded-full px-1.5 py-0.5 ${TL_STATUS_STYLE[a.tl_status]}`}>{a.tl_status}</span></td>
                          <td className="pr-3">{a.item_description || "All items"}</td>
                          <td className="text-right font-mono">{a.done}</td>
                        </tr>
                      ))
                )}
                {stats.unassignedWork.map((a) => (
                  <tr key={a.id}><td className="py-1.5 pr-3 text-amber-700 text-xs">No Team Lead yet</td><td className="pr-3">{a.order_number} — {a.customer_name}</td><td className="pr-3">{a.item_description || "All items"}</td><td className="text-right font-mono">{a.done}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DayReport profile={profile} />

      {stats.teamsWorkingToday.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
            <Users2 size={14} className="text-indigo-700" /> Teams working today
          </h3>
          <div className="space-y-2.5">
            {stats.teamsWorkingToday.map((t, idx) => {
              const byTeam = {};
              t.people.forEach((p) => {
                const key = p.team || "Unassigned team";
                byTeam[key] = byTeam[key] || [];
                byTeam[key].push(p.name);
              });
              return (
                <div key={idx} className="text-sm">
                  <div className="font-medium">{t.orderLabel}</div>
                  {Object.entries(byTeam).map(([team, names]) => (
                    <div key={team} className="text-xs text-stone-500 ml-2">
                      {team}: {names.join(", ")}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">Orders in progress</h3>
        {stats.recentOrders.length === 0 ? (
          <p className="text-sm text-stone-500">No orders logged yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {stats.recentOrders.map((o) => (
              <div key={o.id} className="py-2 flex items-center justify-between text-sm gap-3">
                <div>
                  <div className="font-medium">{o.order_number} — {o.customer_name}</div>
                  <div className="text-xs text-stone-500">
                    Planned {o.planned_start_date || "—"} → {o.planned_end_date || "—"} · Due {o.due_date || "—"}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${ORDER_STATUS_COLORS[o.status] || "bg-stone-100 text-stone-700"}`}>
                  {o.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

    </div>
  );
}
