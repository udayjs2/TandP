import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Package, ShoppingCart, CalendarCheck, Wallet, Landmark, ShieldCheck, ClipboardCheck, CalendarClock,
  MapPinned, ClipboardList, Bot, Tv, Banknote, Scissors, CalendarDays, Loader2, Boxes, BarChart3, History, Factory, UsersRound, Handshake, LineChart,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LoginScreen from "./components/LoginScreen";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import Employees from "./components/Employees";
import Orders from "./components/Orders";
import Attendance from "./components/Attendance";
import Payroll from "./components/Payroll";
import SalesTeam, { MyExpenses } from "./components/SalesTeam";
import Finance, { PurchaseRequests } from "./components/Finance";
import UserManagement from "./components/UserManagement";
import Planner from "./components/Planner";
import Advances from "./components/Advances";
import OperationLog from "./components/OperationLog";
import AiManager from "./components/AiManager";
import MyAttendance from "./components/MyAttendance";
import FloorDisplay from "./components/FloorDisplay";
import Cutting from "./components/Cutting";
import LeaveRequests from "./components/LeaveRequests";
import ResetPassword from "./components/ResetPassword";
import Inventory from "./components/Inventory";
import Output from "./components/Output";
import ProgressHistory from "./components/ProgressHistory";
import OrderAssignment from "./components/OrderAssignment";
import { loadGarmentNames } from "./lib/garments";
import Quality from "./components/Quality";
import Reports from "./components/Reports";
import ModuleShell from "./components/ModuleShell";
import { MODULE_ROLES } from "./lib/helpers";

// Full access roles: Admin and HR (HR was explicitly made equal to Admin)
const FULL = ["admin", "hr"];

// QC (quality team) is deliberately not in ALL: it only gets Production Management -> Quality.
const ALL = ["admin", "hr", "gm", "pm", "tl", "cutting_master", "quality_manager", "ironing", "sales_manager", "cutting", "sales", "finance", "user"];

// Top-level modules. Sub-tabs inside each module are filtered by role below.
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: MODULE_ROLES.dashboard },
  { id: "floor-display", label: "Floor Display", icon: Tv, roles: MODULE_ROLES["floor-display"] },
  { id: "production", label: "Production Management", icon: Factory, roles: MODULE_ROLES.production },
  { id: "hr", label: "HR & Workforce", icon: UsersRound, roles: MODULE_ROLES.hr },
  { id: "sales", label: "CRM & Sales", icon: Handshake, roles: MODULE_ROLES.sales },
  { id: "inventory", label: "Inventory & Procurement", icon: Boxes, roles: MODULE_ROLES.inventory },
  { id: "finance", label: "Finance & Accounts", icon: Landmark, roles: MODULE_ROLES.finance },
  { id: "reports", label: "Reports & Analytics", icon: LineChart, roles: MODULE_ROLES.reports },
  // AI Factory Manager menu hidden for now. To re-enable, uncomment the next line:
  // { id: "ai", label: "AI Factory Manager", icon: Bot, roles: ["admin", "gm", "pm"] },
  { id: "users", label: "User Management", icon: ShieldCheck, roles: MODULE_ROLES.users },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [recovering, setRecovering] = useState(false); // opened from a password-reset email
  const [grants, setGrants] = useState([]); // extra modules the Admin granted to this user

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

  // garment names make cutting counts like KURTI-XL readable everywhere
  useEffect(() => { if (profile?.id) loadGarmentNames(); }, [profile?.id]);
  useEffect(() => {
    if (!profile?.id) {
      setGrants([]);
      return;
    }
    const loadGrants = () =>
      supabase.from("user_module_access").select("modules").eq("user_id", profile.id).maybeSingle()
        .then(({ data }) => setGrants(data?.modules || []));
    loadGrants();
    const ch = supabase
      .channel(`my-module-access-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_module_access" }, loadGrants)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [profile?.id]);

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
  const canUsers = role === "admin";

  // sub-tabs of the Production Management and HR & Workforce modules
  const productionTabs = [
    { id: "orders", label: "Orders", icon: Package, roles: ["admin", "gm", "pm", "tl"], render: () => <Orders profile={profile} /> },
    { id: "cutting", label: "Cutting", icon: Scissors, roles: ["admin", "gm", "pm", "cutting_master", "cutting"], render: () => <Cutting profile={profile} /> },
    { id: "assignment", label: "Order Assignment", icon: ClipboardCheck, roles: ["admin", "gm", "pm", "tl"], render: () => <OrderAssignment profile={profile} /> },
    { id: "output", label: "Output", icon: BarChart3, roles: ["admin", "gm", "pm", "tl", "quality_manager"], render: () => <Output /> },
    { id: "progress-history", label: "Progress History", icon: History, roles: ["admin", "gm", "pm", "tl", "quality_manager"], render: () => <ProgressHistory /> },
    { id: "quality", label: "Quality", icon: ClipboardCheck, roles: ["admin", "gm", "pm", "tl", "quality_manager", "qc"], render: () => <Quality profile={profile} /> },
    { id: "operation-log", label: "Operation Log", icon: ClipboardList, roles: ["admin", "gm", "pm", "tl"], render: () => <OperationLog profile={profile} /> },
    { id: "planner", label: "Planner", icon: CalendarClock, roles: ["admin", "gm", "pm"], render: () => <Planner /> },
  ];
  const inventoryTabs = [
    { id: "inventory", label: "Inventory", icon: Boxes, roles: ["admin", "hr", "gm", "pm", "cutting_master"], render: () => <Inventory profile={profile} /> },
    { id: "purchase", label: "Purchase Requests", icon: ShoppingCart, roles: ["admin", "hr", "gm", "pm", "finance"], render: () => <PurchaseRequests profile={profile} /> },
  ];
  const hrTabs = [
    { id: "employees", label: "Employees", icon: Users, roles: FULL, render: () => <Employees /> },
    { id: "attendance", label: "Attendance", icon: CalendarCheck, roles: FULL, render: () => <Attendance profile={profile} /> }, // full roster marking (GM/PM/TL use My Attendance)
    { id: "my-attendance", label: "My Attendance", icon: MapPinned, roles: ALL, render: () => <MyAttendance profile={profile} /> },
    { id: "leave-requests", label: "Leave Requests", icon: CalendarDays, roles: ALL, render: () => <LeaveRequests profile={profile} /> },
    { id: "payroll", label: "Payroll", icon: Wallet, roles: ALL, render: () => <Payroll profile={profile} /> },
    { id: "my-expenses", label: "My Expenses", icon: Wallet, roles: ALL.filter((r) => r !== "admin"), render: () => <MyExpenses profile={profile} /> },
    { id: "advances", label: "Advances", icon: Banknote, roles: ["admin", "hr", "finance"], render: () => <Advances /> },
  ];
  // Granted modules open with all their sub-tabs; otherwise sub-tabs follow the user's role.
  const pick = (moduleId, defs) => (grants.includes(moduleId) ? defs : defs.filter((t) => t.roles.includes(role)));

  const visibleTabs = TABS.filter((t) => t.roles.includes(role) || (t.id !== "users" && grants.includes(t.id)));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  if (activeTab === "floor-display") {
    return <FloorDisplay onBack={() => setTab("dashboard")} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Header tabs={visibleTabs} tab={activeTab} setTab={setTab} profile={profile} onLogout={logout} saving={false} />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === "dashboard" && <Dashboard profile={profile} />}
        {activeTab === "production" && <ModuleShell title="Production Management" subtitle="Orders, cutting, daily output, quality inspection and the planner." tabs={pick("production", productionTabs)} />}
        {activeTab === "hr" && <ModuleShell title="HR & Workforce Management" subtitle="Employees, attendance, leave, payroll and staff advances." tabs={pick("hr", hrTabs)} />}
        {activeTab === "sales" && <SalesTeam profile={profile} />}
        {activeTab === "inventory" && <ModuleShell title="Inventory & Procurement" subtitle="Fabric, accessories, machines and spare parts, and purchase requests." tabs={pick("inventory", inventoryTabs)} />}
        {activeTab === "finance" && <Finance profile={profile} />}
        {activeTab === "reports" && <Reports profile={profile} />}
        {activeTab === "ai" && <AiManager profile={profile} />}
        {activeTab === "users" && canUsers && <UserManagement profile={profile} />}
      </main>
    </div>
  );
}
