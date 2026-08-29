import { useEffect, useState } from "react";
import { LayoutDashboard, Users, Package, Receipt, CalendarCheck, Wallet, TrendingUp, Loader2 } from "lucide-react";
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

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "user"] },
  { id: "employees", label: "Employees", icon: Users, roles: ["admin"] },
  { id: "orders", label: "Orders", icon: Package, roles: ["admin"] },
  { id: "invoices", label: "Invoices", icon: Receipt, roles: ["admin", "user"] },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, roles: ["admin"] },
  { id: "payroll", label: "Payroll", icon: Wallet, roles: ["admin", "user"] },
  { id: "sales", label: "Sales Team", icon: TrendingUp, roles: ["admin", "user"] },
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

  const isAdmin = profile.role === "admin";
  const visibleTabs = TABS.filter((t) => t.roles.includes(profile.role));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0]?.id;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <Header tabs={visibleTabs} tab={activeTab} setTab={setTab} profile={profile} onLogout={logout} saving={false} />
      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "employees" && isAdmin && <Employees />}
        {activeTab === "orders" && isAdmin && <Orders profile={profile} />}
        {activeTab === "invoices" && <Invoices isAdmin={isAdmin} />}
        {activeTab === "attendance" && isAdmin && <Attendance profile={profile} />}
        {activeTab === "payroll" && <Payroll profile={profile} />}
        {activeTab === "sales" && <SalesTeam profile={profile} />}
      </main>
    </div>
  );
}
