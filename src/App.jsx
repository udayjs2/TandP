import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Package, Receipt, CalendarCheck, Wallet, TrendingUp,
  Landmark, ShieldCheck, CalendarClock, MapPinned, Tv, Scissors, CalendarDays, Loader2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LoginScreen from "./components/LoginScreen";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import Employees from "./components/Employees";
import Orders from "./components/Orders";
import Invoices from "./components/Invoices";
import Attendance from "./components/Attendance";
import Payroll from "./components/Payroll";
import SalesTeam from "./components/SalesTeam";
import Finance from "./components/Finance";
import UserManagement from "./components/UserManagement";
import Planner from "./components/Planner";
import MyAttendance from "./components/MyAttendance";
import FloorDisplay from "./components/FloorDisplay";
import Cutting from "./components/Cutting";
import LeaveRequests from "./components/LeaveRequests";

// Full access roles: Admin and HR (HR was explicitly made equal to Admin)
const FULL = ["admin", "hr"];

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "hr", "gm", "pm", "tl", "cutting_master", "sales", "user"] },
  { id: "floor-display", label: "Floor Display", icon: Tv, roles: ["admin", "hr", "gm", "pm", "tl", "cutting_master", "sales", "user"] },
  { id: "employees", label: "Employees", icon: Users, roles: FULL },
  { id: "orders", label: "Orders", icon: Package, roles: [...FULL, "gm", "pm", "tl"] },
  { id: "invoices", label: "Invoices", icon: Receipt, roles: [...FULL, "gm"] },
  { id: "cutting", label: "Cutting", icon: Scissors, roles: [...FULL, "gm", "pm", "cutting_master"] },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, roles: FULL },
  { id: "my-attendance", label: "My Attendance", icon: MapPinned, roles: ["admin", "hr", "gm", "pm", "tl", "cutting_master", "sales", "user"] },
  { id: "leave-requests", label: "Leave Requests", icon: CalendarDays, roles: ["admin", "hr", "gm", "pm", "tl", "cutting_master", "sales", "user"] },
  { id: "payroll", label: "Payroll", icon: Wallet, roles: ["admin", "hr", "gm", "pm", "tl", "cutting_master", "sales", "user"] },
  { id: "sales", label: "Sales Team", icon: TrendingUp, roles: [...FULL, "gm", "pm", "sales", "user"] },
  { id: "finance", label: "Finance", icon: Landmark, roles: FULL },
  { id: "users", label: "User Management", icon: ShieldCheck, roles: [...FULL, "gm", "pm"] },
  { id: "planner", label: "Planner", icon: CalendarClock, roles: [...FULL, "gm", "pm"] },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const logout = async () => {
    await supabase.auth.signOut();
    setTab("dashboard");
  };

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading…
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your account…
      </div>
    );
  }

  const role = profile.role;
  const isAdmin = FULL.includes(role); // Admin or HR — same access everywhere
  const canAttendance = FULL.includes(role); // full roster attendance marking (not GM/PM/TL — they get My Attendance self check-in)
  const canOrders = isAdmin || ["gm", "pm", "tl"].includes(role);
  const canInvoices = isAdmin || role === "gm";
  const canCutting = isAdmin || ["gm", "pm", "cutting_master"].includes(role);
  const canFinance = isAdmin;
  const canPlanner = isAdmin || ["gm", "pm"].includes(role);
  const canUsers = isAdmin || ["gm", "pm"].includes(role); // GM/PM get the limited (password-reset-only) view, handled inside the component

  const visibleTabs = TABS.filter((t) => t.roles.includes(role));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  if (activeTab === "floor-display") {
    return <FloorDisplay onBack={() => setTab("dashboard")} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Header tabs={visibleTabs} tab={activeTab} setTab={setTab} profile={profile} onLogout={logout} saving={false} />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === "dashboard" && <Dashboard profile={profile} />}
        {activeTab === "employees" && isAdmin && <Employees />}
        {activeTab === "orders" && canOrders && <Orders profile={profile} />}
        {activeTab === "invoices" && canInvoices && <Invoices isAdmin={canInvoices} />}
        {activeTab === "cutting" && canCutting && <Cutting profile={profile} />}
        {activeTab === "attendance" && canAttendance && <Attendance profile={profile} />}
        {activeTab === "my-attendance" && <MyAttendance profile={profile} />}
        {activeTab === "leave-requests" && <LeaveRequests profile={profile} />}
        {activeTab === "payroll" && <Payroll profile={profile} />}
        {activeTab === "sales" && <SalesTeam profile={profile} />}
        {activeTab === "finance" && canFinance && <Finance profile={profile} />}
        {activeTab === "users" && canUsers && <UserManagement profile={profile} />}
        {activeTab === "planner" && canPlanner && <Planner />}
      </main>
    </div>
  );
}
