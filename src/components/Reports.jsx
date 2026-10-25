import { LayoutDashboard, Users2, Factory, ClipboardCheck, Users, Boxes, Landmark, Truck, CalendarRange, Activity, Gauge, TrendingUp, Hourglass, UserCheck, Scale, Presentation } from "lucide-react";
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
import KpiDashboard from "./reports/KpiDashboard";
import ProfitTrends from "./reports/ProfitTrends";
import ProductionForecast from "./reports/ProductionForecast";
import CustomerProfitability from "./reports/CustomerProfitability";
import CostVariance from "./reports/CostVariance";
import DeliveryPerformance from "./reports/DeliveryPerformance";
import ManagementPresentation from "./reports/ManagementPresentation";

export default function Reports({ profile }) {
  const role = profile?.role;
  const FULL = ["admin", "hr"];
  const defs = [
    { id: "overview", label: "Business Overview", icon: LayoutDashboard, roles: ["admin", "finance"], render: () => <BusinessOverview /> },
    { id: "sales", label: "Sales & CRM", icon: Users2, roles: ["admin", "gm", "pm", "sales", "sales_manager"], render: () => <SalesReport /> },
    { id: "production", label: "Production", icon: Factory, roles: [...FULL, "gm", "pm", "tl"], render: () => <ProductionReport /> },
    { id: "quality", label: "Quality", icon: ClipboardCheck, roles: [...FULL, "gm", "pm", "tl", "quality_manager"], render: () => <QualityReport profile={profile} /> },
    { id: "hr", label: "HR, Attendance & Payroll", icon: Users, roles: FULL, render: () => <HrReport /> },
    { id: "inventory", label: "Inventory & Procurement", icon: Boxes, roles: [...FULL, "gm", "pm"], render: () => <InventoryReport /> },
    { id: "finance", label: "Finance & Profitability", icon: Landmark, roles: ["admin", "finance"], render: () => <FinanceReport /> },
    { id: "delivery", label: "Delivery & Fulfilment", icon: Truck, roles: [...FULL, "gm", "pm", "tl"], render: () => <DeliveryReport /> },
    { id: "periods", label: "Quarterly, Half-yearly & Yearly", icon: CalendarRange, roles: ["admin", "finance"], render: () => <QuarterlyReport /> },
    { id: "kpi", label: "KPI Dashboard", icon: Gauge, roles: [...FULL, "gm", "pm"], render: () => <KpiDashboard profile={profile} /> },
    { id: "profit-trends", label: "Profit Trends", icon: TrendingUp, roles: ["admin", "finance"], render: () => <ProfitTrends /> },
    { id: "forecast", label: "Production Forecast", icon: Hourglass, roles: [...FULL, "gm", "pm", "tl"], render: () => <ProductionForecast /> },
    { id: "cust-profit", label: "Customer Profitability", icon: UserCheck, roles: ["admin", "finance"], render: () => <CustomerProfitability /> },
    { id: "cost-variance", label: "Cost Variance", icon: Scale, roles: ["admin", "finance"], render: () => <CostVariance /> },
    { id: "delivery-perf", label: "Delivery Performance", icon: Truck, roles: [...FULL, "gm", "pm", "tl"], render: () => <DeliveryPerformance /> },
    { id: "deck", label: "Management Presentation", icon: Presentation, roles: ["admin", "finance", "gm", "pm"], render: () => <ManagementPresentation profile={profile} /> },
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
