import { useEffect, useState } from "react";
import { Users, CalendarCheck, Package, Receipt, AlertTriangle } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, StatCard } from "./ui";
import { fmtMoney, monthKey, todayStr } from "../lib/helpers";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  const load = async () => {
    const today = todayStr();
    const mk = monthKey();

    const [{ data: employees }, { data: todaysAtt }, { data: orders }, { data: invoices }, { data: sales }, { data: recentOrders }] =
      await Promise.all([
        supabase.from("employees").select("id, role"),
        supabase.from("attendance").select("employee_id, status").eq("date", today),
        supabase.from("orders").select("id, status"),
        supabase.from("invoices").select("id, amount, status, due_date, invoice_number, customer_name"),
        supabase.from("sales_targets").select("employee_id, target, achieved").eq("month", mk),
        supabase.from("orders").select("*").order("order_date", { ascending: false }).limit(5),
      ]);

    const presentToday = (todaysAtt || []).filter((a) => a.status === "Present" || a.status === "Half Day").length;
    const pendingOrders = (orders || []).filter((o) => o.status !== "Completed" && o.status !== "Shipped").length;
    const unpaid = (invoices || []).filter((i) => i.status !== "Paid");
    const unpaidAmount = unpaid.reduce((s, i) => s + Number(i.amount || 0), 0);
    const overdue = unpaid.filter((i) => i.due_date && i.due_date < today);
    const totalTarget = (sales || []).reduce((s, r) => s + Number(r.target || 0), 0);
    const totalAchieved = (sales || []).reduce((s, r) => s + Number(r.achieved || 0), 0);

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
        <StatCard
          label="Unpaid invoices"
          value={fmtMoney(stats.unpaidAmount)}
          sub={`${stats.unpaid.length} invoice(s)`}
          icon={Receipt}
          tone={stats.overdue.length ? "bad" : "slate"}
        />
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
      </div>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">Recent orders</h3>
        {stats.recentOrders.length === 0 ? (
          <p className="text-sm text-stone-500">No orders logged yet.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {stats.recentOrders.map((o) => (
              <div key={o.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">{o.order_number} — {o.customer_name}</div>
                  <div className="text-xs text-stone-500">{o.order_date} · due {o.due_date || "—"}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-700">{o.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
