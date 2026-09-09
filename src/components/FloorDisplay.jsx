import { useEffect, useState } from "react";
import { Maximize2, Minimize2, ArrowLeft } from "lucide-react";
import { supabase } from "../supabaseClient";
import { monthKey, todayStr } from "../lib/helpers";

export default function FloorDisplay({ onBack }) {
  const [stats, setStats] = useState(null);
  const [businessName, setBusinessName] = useState("T&P Textiles");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(new Date());

  const load = async () => {
    const today = todayStr();
    const mk = monthKey();

    const [{ data: employees }, { data: todaysAtt }, { data: orders }, { data: todaysProgress }, { data: sales }, { data: settings }] =
      await Promise.all([
        supabase.from("employees").select("id"),
        supabase.from("attendance").select("status").eq("date", today),
        supabase.from("orders").select("id, status, daily_target"),
        supabase.from("order_progress").select("order_id, quantity").eq("date", today),
        supabase.from("sales_targets").select("target, achieved").eq("month", mk),
        supabase.from("settings").select("business_name").eq("id", 1).single(),
      ]);

    const employeeCount = (employees || []).length;
    const presentToday = (todaysAtt || []).filter((a) => a.status === "Present" || a.status === "Half Day").length;
    const activeOrders = (orders || []).filter((o) => o.status !== "Completed" && o.status !== "Shipped");
    const planToday = activeOrders.reduce((s, o) => s + Number(o.daily_target || 0), 0);
    const actualToday = (todaysProgress || []).reduce((s, p) => s + Number(p.quantity || 0), 0);
    const efficiency = planToday > 0 ? (actualToday / planToday) * 100 : null;
    const salesTarget = (sales || []).reduce((s, r) => s + Number(r.target || 0), 0);
    const salesAchieved = (sales || []).reduce((s, r) => s + Number(r.achieved || 0), 0);
    const salesPct = salesTarget > 0 ? (salesAchieved / salesTarget) * 100 : null;

    setBusinessName(settings?.business_name || "T&P Textiles");
    setStats({
      employeeCount,
      presentToday,
      activeOrdersCount: activeOrders.length,
      planToday,
      actualToday,
      efficiency,
      salesPct,
    });
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("floor-display").on("postgres_changes", { event: "*", schema: "public" }, load).subscribe();
    const clock = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(load, 60000); // safety refresh every minute even if realtime misses something
    return () => {
      supabase.removeChannel(ch);
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  const tone = (pct) => {
    if (pct === null) return "text-stone-400";
    if (pct >= 90) return "text-emerald-400";
    if (pct >= 70) return "text-amber-400";
    return "text-rose-400";
  };

  if (!stats) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-stone-400">Loading…</div>;
  }

  const attendancePct = stats.employeeCount > 0 ? (stats.presentToday / stats.employeeCount) * 100 : null;

  return (
    <div className="min-h-screen bg-black text-stone-100 p-6 md:p-10">
      <button
        onClick={onBack}
        className="fixed top-3 left-3 z-10 bg-stone-800/80 hover:bg-stone-700 text-stone-300 rounded-lg p-2"
        title="Back to app"
      >
        <ArrowLeft size={18} />
      </button>
      <button
        onClick={toggleFullscreen}
        className="fixed top-3 right-3 z-10 bg-stone-800/80 hover:bg-stone-700 text-stone-300 rounded-lg p-2"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
      </button>

      <div className="max-w-4xl mx-auto border-2 border-amber-500/40 rounded-2xl bg-stone-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b-2 border-amber-500/40 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
          <div className="text-amber-400 font-bold tracking-wide text-lg md:text-xl uppercase">
            {businessName} — Live Production Display
          </div>
          <div className="text-stone-400 font-mono text-sm md:text-base">
            {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · {now.toLocaleTimeString("en-IN")}
          </div>
        </div>

        {/* PRODUCTION section */}
        <div className="px-6 py-3 border-b border-stone-800">
          <div className="text-emerald-400 font-extrabold text-2xl md:text-3xl tracking-wide">PRODUCTION TODAY</div>
        </div>
        <Row label="PLAN vs ACTUAL" value={<><span className="text-amber-400">{stats.planToday}</span> <span className="text-stone-500">/</span> <span className={tone(stats.efficiency)}>{stats.actualToday}</span></>} />
        <Row label="EFFICIENCY" value={stats.efficiency !== null ? `${stats.efficiency.toFixed(1)}%` : "—"} valueClass={tone(stats.efficiency)} />
        <Row label="ORDERS IN PROGRESS" value={stats.activeOrdersCount} valueClass="text-stone-100" />

        {/* ATTENDANCE section */}
        <div className="px-6 py-3 border-y border-stone-800 mt-2">
          <div className="text-emerald-400 font-extrabold text-2xl md:text-3xl tracking-wide">ATTENDANCE</div>
        </div>
        <Row label="PRESENT TODAY" value={`${stats.presentToday} / ${stats.employeeCount}`} valueClass={tone(attendancePct)} />
        <Row label="ATTENDANCE RATE" value={attendancePct !== null ? `${attendancePct.toFixed(0)}%` : "—"} valueClass={tone(attendancePct)} />

        {/* SALES section */}
        {stats.salesPct !== null && (
          <>
            <div className="px-6 py-3 border-y border-stone-800 mt-2">
              <div className="text-emerald-400 font-extrabold text-2xl md:text-3xl tracking-wide">SALES TEAM — THIS MONTH</div>
            </div>
            <Row label="TARGET ACHIEVED" value={`${stats.salesPct.toFixed(0)}%`} valueClass={tone(stats.salesPct)} />
          </>
        )}

        <div className="px-6 py-3 text-[11px] text-stone-600">
          Updates live. Uptime/downtime, defect counts, OEE and 5S scores aren't shown — this app doesn't track
          machine sensor data or manual quality/5S audits yet.
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = "" }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-stone-900">
      <span className="text-stone-300 font-semibold text-lg md:text-xl tracking-wide">{label}:</span>
      <span className={`font-extrabold text-2xl md:text-4xl font-mono ${valueClass}`}>{value}</span>
    </div>
  );
}
