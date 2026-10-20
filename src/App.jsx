import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Package, CalendarCheck, Wallet, Landmark, ShieldCheck, ClipboardCheck, CalendarClock,
  MapPinned, Tv, Scissors, CalendarDays, Loader2, Boxes, BarChart3, Factory, UsersRound, Handshake, LineChart,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LoginScreen from "./components/LoginScreen";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import Employees from "./components/Employees";
import Orders from "./components/Orders";
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
import ResetPassword from "./components/ResetPassword";
import Inventory from "./components/Inventory";
import Output from "./components/Output";
import Quality from "./components/Quality";
import Reports from "./components/Reports";
import ModuleShell from "./components/ModuleShell";

// Full access roles: Admin and HR (HR was explicitly made equal to Admin)
const FULL = ["admin", "hr"];

const ALL = ["admin", "hr", "gm", "pm", "tl", "cutting_master", "quality_manager", "sales", "user"];

// Top-level modules. Sub-tabs inside each module are filtered by role below.
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
  { id: "floor-display", label: "Floor Display", icon: Tv, roles: ALL },
  { id: "orders", label: "Orders", icon: Package, roles: [...FULL, "gm", "pm", "tl"] },
  { id: "production", label: "Production Management", icon: Factory, roles: [...FULL, "gm", "pm", "tl", "cutting_master", "quality_manager"] },
  { id: "hr", label: "HR & Workforce", icon: UsersRound, roles: ALL },
  { id: "sales", label: "CRM & Sales", icon: Handshake, roles: [...FULL, "gm", "pm", "sales", "user"] },
  { id: "inventory", label: "Inventory & Procurement", icon: Boxes, roles: [...FULL, "gm", "pm", "tl", "cutting_master"] },
  { id: "finance", label: "Finance & Accounts", icon: Landmark, roles: [...FULL, "gm", "pm"] }, // Admin: all; HR: Expenditures, Purchase Requests, Advances; GM/PM: Purchase Requests
  { id: "reports", label: "Reports & Analytics", icon: LineChart, roles: [...FULL, "gm", "pm", "tl", "quality_manager", "sales"] },
  { id: "users", label: "User Management", icon: ShieldCheck, roles: [...FULL, "gm", "pm"] },
  { id: "planner", label: "Planner", icon: CalendarClock, roles: [...FULL, "gm", "pm"] },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [recovering, setRecovering] = useState(false); // opened from a password-reset email

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(s);
    });
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

  if (session && recovering) return <ResetPassword onDone={() => setRecovering(false)} />;

  if (!session) return <LoginScreen />;

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading your account…
      </div>
    );
  }

  const role = profile.role;
  const isAdmin = FULL.includes(role); // Admin or HR
  const canPlanner = isAdmin || ["gm", "pm"].includes(role);
  const canUsers = isAdmin || ["gm", "pm"].includes(role); // GM/PM get the limited (password-reset-only) view, handled inside the component

  // sub-tabs of the Production Management and HR & Workforce modules
  const productionTabs = [
    { id: "cutting", label: "Cutting", icon: Scissors, roles: [...FULL, "gm", "pm", "cutting_master"], render: () => <Cutting profile={profile} /> },
    { id: "output", label: "Output", icon: BarChart3, roles: [...FULL, "gm", "pm", "tl", "quality_manager"], render: () => <Output /> },
    { id: "quality", label: "Quality", icon: ClipboardCheck, roles: [...FULL, "gm", "pm", "tl", "quality_manager"], render: () => <Quality profile={profile} /> },
  ].filter((t) => t.roles.includes(role));
  const hrTabs = [
    { id: "employees", label: "Employees", icon: Users, roles: FULL, render: () => <Employees /> },
    { id: "attendance", label: "Attendance", icon: CalendarCheck, roles: FULL, render: () => <Attendance profile={profile} /> }, // full roster marking (GM/PM/TL use My Attendance)
    { id: "my-attendance", label: "My Attendance", icon: MapPinned, roles: ALL, render: () => <MyAttendance profile={profile} /> },
    { id: "leave-requests", label: "Leave Requests", icon: CalendarDays, roles: ALL, render: () => <LeaveRequests profile={profile} /> },
    { id: "payroll", label: "Payroll", icon: Wallet, roles: ALL, render: () => <Payroll profile={profile} /> },
  ].filter((t) => t.roles.includes(role));

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
        {activeTab === "orders" && <Orders profile={profile} />}
        {activeTab === "production" && <ModuleShell title="Production Management" subtitle="Cutting, daily output and quality inspection." tabs={productionTabs} />}
        {activeTab === "hr" && <ModuleShell title="HR & Workforce Management" subtitle="Employees, attendance, leave and payroll." tabs={hrTabs} />}
        {activeTab === "sales" && <SalesTeam profile={profile} />}
        {activeTab === "inventory" && <Inventory profile={profile} />}
        {activeTab === "finance" && <Finance profile={profile} />}
        {activeTab === "reports" && <Reports profile={profile} />}
        {activeTab === "users" && canUsers && <UserManagement profile={profile} />}
        {activeTab === "planner" && canPlanner && <Planner />}
      </main>
    </div>
  );
}
