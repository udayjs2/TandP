import { useEffect, useState } from "react";
import { Users, CalendarCheck, Package, Receipt, AlertTriangle, Activity } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, StatCard } from "./ui";
import { fmtMoney, monthKey, todayStr, orderItemsRequired, ORDER_STATUS_COLORS } from "../lib/helpers";

export default function Dashboard({ profile }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const isAdmin = profile?.role === "admin";

  const load = async () => {
    const today = todayStr();
    const mk = monthKey();

    const [
      { data: employees },
      { data: todaysAtt },
      { data: orders },
      invoicesResult,
      { data: sales },
      { data: recentOrders },
      { data: todaysProgress },
    ] = await Promise.all([
      supabase.from("employees").select("id, role"),
      supabase.from("attendance").select("employee_id, status").eq("date", today),
      supabase.from("orders").select("id, status, order_number, customer_name, daily_target, items"),
      // Unpaid/overdue invoice figures are financial data — only fetch for admins.
      isAdmin
        ? supabase.from("invoices").select("id, amount, status, due_date, invoice_number, customer_name")
        : Promise.resolve({ data: [] }),
      supabase.from("sales_targets").select("employee_id, target, achieved").eq("month", mk),
      supabase.from("orders").select("*").order("order_date", { ascending: false }).limit(5),
      supabase.from("order_progress").select("order_id, quantity").eq("date", today),
    ]);
    const invoices = invoicesResult.data;

    const presentToday = (todaysAtt || []).filter((a) => a.status === "Present" || a.status === "Half Day").length;
    const pendingOrders = (orders || []).filter((o) => o.status !== "Completed" && o.status !== "Shipped").length;
    const unpaid = (invoices || []).filter((i) => i.status !== "Paid");
    const unpaidAmount = unpaid.reduce((s, i) => s + Number(i.amount || 0), 0);
    const overdue = unpaid.filter((i) => i.due_date && i.due_date < today);
    const totalTarget = (sales || []).reduce((s, r) => s + Number(r.target || 0), 0);
    const totalAchieved = (sales || []).reduce((s, r) => s + Number(r.achieved || 0), 0);

    const doneByOrder = {};
    (todaysProgress || []).forEach((p) => (doneByOrder[p.order_id] = (doneByOrder[p.order_id] || 0) + Number(p.quantity || 0)));

    const activeOrders = (orders || []).filter((o) => o.status !== "Completed" && o.status !== "Shipped" && (o.daily_target > 0 || orderItemsRequired(o.items) > 0));
    const orderProgressToday = activeOrders.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      customer_name: o.customer_name,
      done: doneByOrder[o.id] || 0,
      target: o.daily_target || 0,
    }));
    const todayTotalDone = orderProgressToday.reduce((s, o) => s + o.done, 0);
    const todayTotalTarget = orderProgressToday.reduce((s, o) => s + o.target, 0);

    setStats({
      employeeCount: (employees || []).length,
      presentToday,
      pendingOrders,
      unpaid,
      unpaidAmount,
      overdue,
      totalTarget,
      totalAchieved,
      recentOrders: recentOrders || [],
      salesCount: (employees || []).filter((e) => e.role === "Sales").length,
      orderProgressToday,
      todayTotalDone,
      todayTotalTarget,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Employees" value={stats.employeeCount} icon={Users} />
        <StatCard
          label="Present today"
          value={stats.employeeCount ? `${stats.presentToday}/${stats.employeeCount}` : "—"}
          icon={CalendarCheck}
          tone={stats.employeeCount && stats.presentToday / stats.employeeCount < 0.7 ? "warn" : "good"}
        />
        <StatCard label="Orders in progress" value={stats.pendingOrders} icon={Package} />
        {isAdmin ? (
          <StatCard
            label="Unpaid invoices"
            value={fmtMoney(stats.unpaidAmount)}
            sub={`${stats.unpaid.length} invoice(s)`}
            icon={Receipt}
            tone={stats.overdue.length ? "bad" : "slate"}
          />
        ) : (
          <StatCard label="Sales team" value={stats.salesCount} icon={Receipt} />
        )}
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

        {isAdmin && (
          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
              {stats.overdue.length > 0 && <AlertTriangle size={14} className="text-rose-600" />}
              Overdue invoices
            </h3>
            {stats.overdue.length === 0 ? (
              <p className="text-sm text-stone-500">Nothing overdue. All caught up.</p>
            ) : (
              <ul className="text-sm space-y-1.5">
                {stats.overdue.slice(0, 5).map((i) => (
                  <li key={i.id} className="flex justify-between">
                    <span>{i.invoice_number} — {i.customer_name}</span>
                    <span className="font-mono text-rose-700">{fmtMoney(i.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
          <Activity size={14} className="text-indigo-700" />
          Today's production progress
        </h3>
        {stats.orderProgressToday.length === 0 ? (
          <p className="text-sm text-stone-500">No active orders with a daily target set.</p>
        ) : (
          <div className="space-y-3">
            {stats.todayTotalTarget > 0 && (
              <div>
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span>{stats.todayTotalDone} items completed</span>
                  <span>Target {stats.todayTotalTarget}</span>
                </div>
                <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-700"
                    style={{ width: `${Math.min(100, (stats.todayTotalDone / stats.todayTotalTarget) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <div className="divide-y divide-stone-100">
              {stats.orderProgressToday.map((o) => {
                const pct = o.target ? Math.min(100, (o.done / o.target) * 100) : 0;
                return (
                  <div key={o.id} className="py-1.5 flex items-center justify-between text-sm gap-3">
                    <span className="truncate">{o.order_number} — {o.customer_name}</span>
                    <span className="font-mono text-xs text-stone-500 whitespace-nowrap">
                      {o.done}{o.target ? `/${o.target}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

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
