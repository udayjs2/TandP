import { LayoutDashboard, Users2, Factory, ClipboardCheck, Users, Boxes, Landmark, Truck, CalendarRange, Activity } from "lucide-react";
import ModuleShell from "./ModuleShell";
import Insights from "./Insights";
import QuarterlyReport from "./QuarterlyReport";
import BusinessOverview from "./reports/BusinessOverview";
import SalesReport from "./reports/SalesReport";
import ProductionReport from "./reports/ProductionReport";
import QualityReport from "./reports/QualityReport";
import HrReport from "./reports/HrReport";
import InventoryReport from "./reports/InventoryReport";
import FinanceReport from "./reports/FinanceReport";
import DeliveryReport from "./reports/DeliveryReport";

export default function Reports({ profile }) {
  const role = profile?.role;
  const FULL = ["admin", "hr"];
  const defs = [
    { id: "overview", label: "Business Overview", icon: LayoutDashboard, roles: ["admin"], render: () => <BusinessOverview /> },
    { id: "sales", label: "Sales & CRM", icon: Users2, roles: ["admin", "gm", "pm", "sales"], render: () => <SalesReport /> },
    { id: "production", label: "Production", icon: Factory, roles: [...FULL, "gm", "pm", "tl"], render: () => <ProductionReport /> },
    { id: "quality", label: "Quality", icon: ClipboardCheck, roles: [...FULL, "gm", "pm", "tl", "quality_manager"], render: () => <QualityReport profile={profile} /> },
    { id: "hr", label: "HR, Attendance & Payroll", icon: Users, roles: FULL, render: () => <HrReport /> },
    { id: "inventory", label: "Inventory & Procurement", icon: Boxes, roles: [...FULL, "gm", "pm"], render: () => <InventoryReport /> },
    { id: "finance", label: "Finance & Profitability", icon: Landmark, roles: ["admin"], render: () => <FinanceReport /> },
    { id: "delivery", label: "Delivery & Fulfilment", icon: Truck, roles: [...FULL, "gm", "pm", "tl"], render: () => <DeliveryReport /> },
    { id: "periods", label: "Quarterly, Half-yearly & Yearly", icon: CalendarRange, roles: ["admin"], render: () => <QuarterlyReport /> },
    { id: "insights", label: "Insights", icon: Activity, roles: [...FULL, "gm", "pm", "tl"], render: () => <Insights profile={profile} /> },
  ];
  const tabs = defs.filter((t) => t.roles.includes(role));
  return (
    <ModuleShell
      title="Reports & Analytics"
      subtitle="Business, sales, production, quality, HR, inventory, finance and delivery reports — each can be downloaded as PDF, PowerPoint or Excel."
      tabs={tabs}
    />
  );
}
