import ReportView from "../ReportView";
import { fmtMoney } from "../../lib/helpers";
import { supabase, fetchAll, useRange, useData, ReportShell, sum, groupBy, safeAll } from "./common";

// 6. Inventory & procurement: stock, accessories, consumption, wastage, supplier purchases, valuation
export default function InventoryReport() {
  const { range, controls } = useRange("this_month");
  const state = useData(async () => {
    const [fabrics, items, fabUse, matUse, rejected, prs, orders] = await Promise.all([
      fetchAll(() => supabase.from("inventory_fabric").select("*").order("fabric_type")),
      fetchAll(() => supabase.from("inventory_items").select("*").order("name")),
      safeAll(() => supabase.from("fabric_usage").select("order_id, fabric_id, kg_used, meters_used, restored, created_at").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("created_at")),
      safeAll(() => supabase.from("order_material_usage").select("order_id, item_name, category, unit, quantity, unit_price, returned, used_on").gte("used_on", range.from).lte("used_on", range.to).order("used_on")),
      safeAll(() => supabase.from("cutting_entries").select("id, order_id, fabric_kg_used, fabric_meters_used, cut_date, status").eq("status", "Rejected").gte("cut_date", range.from).lte("cut_date", range.to).order("id")),
      safeAll(() => supabase.from("purchase_requests").select("category, item, amount, vendor, status, created_at, quantity, unit").gte("created_at", range.from).lte("created_at", `${range.to}T23:59:59`).order("created_at")),
      fetchAll(() => supabase.from("orders").select("id, order_number, customer_name").order("id")),
    ]);
    return { fabrics, items, fabUse, matUse, rejected, prs, orders };
  }, JSON.stringify(range));

  return (
    <ReportShell state={state} controls={controls}>
      {(d) => {
        const ord = Object.fromEntries(d.orders.map((o) => [o.id, o]));
        const fabValue = (f) => Number(f.stock_kg || 0) * Number(f.price_per_kg || 0) + Number(f.stock_meters || 0) * Number(f.price_per_meter || 0);
        const fabricValue = sum(d.fabrics, fabValue);
        const itemValue = sum(d.items, (i) => Number(i.quantity || 0) * Number(i.unit_price || 0));
        const unpriced = d.fabrics.filter((f) => (Number(f.stock_kg) > 0 && !f.price_per_kg) && (Number(f.stock_meters) > 0 ? !f.price_per_meter : true)).length + d.items.filter((i) => Number(i.quantity) > 0 && !i.unit_price).length;
        const used = d.fabUse.filter((u) => !u.restored);
        const kgUsed = sum(used, (u) => u.kg_used), mUsed = sum(used, (u) => u.meters_used);
        const mats = d.matUse.filter((m) => !m.returned);
        const matValue = sum(mats, (m) => Number(m.quantity) * Number(m.unit_price || 0));
        const wasteKg = sum(d.rejected, (c) => c.fabric_kg_used);
        const wasteM = sum(d.rejected, (c) => c.fabric_meters_used);
        const bought = d.prs.filter((p) => p.status === "Approved");
        const boughtValue = sum(bought);
        const byVendor = Object.entries(groupBy(bought, (p) => p.vendor || "Unspecified")).map(([v, ps]) => [v, ps.length, sum(ps)]).sort((a, b) => b[2] - a[2]);
        const byCat = Object.entries(groupBy(bought, (p) => p.category)).map(([c, ps]) => [c, ps.length, sum(ps)]).sort((a, b) => b[2] - a[2]);
        const byOrderUse = {};
        used.forEach((u) => { const k = u.order_id || "none"; const r = (byOrderUse[k] = byOrderUse[k] || { kg: 0, m: 0, trims: 0 }); r.kg += Number(u.kg_used || 0); r.m += Number(u.meters_used || 0); });
        mats.forEach((m) => { const k = m.order_id || "none"; const r = (byOrderUse[k] = byOrderUse[k] || { kg: 0, m: 0, trims: 0 }); r.trims += Number(m.quantity) * Number(m.unit_price || 0); });
        const useRows = Object.entries(byOrderUse).map(([k, r]) => [ord[k]?.order_number || "—", ord[k]?.customer_name || "—", r.kg, r.m, r.trims]).sort((a, b) => b[2] - a[2]);
        const trimByName = Object.entries(groupBy(mats, (m) => `${m.item_name}|${m.unit || ""}`)).map(([k, ms]) => [k.split("|")[0], k.split("|")[1] || "", sum(ms, (m) => m.quantity), sum(ms, (m) => Number(m.quantity) * Number(m.unit_price || 0))]).sort((a, b) => b[3] - a[3]);
        const stockRows = [
          ...d.fabrics.map((f) => [`${f.fabric_type}${f.color ? ` - ${f.color}` : ""}`, "Fabric", `${Number(f.stock_kg || 0)} kg / ${Number(f.stock_meters || 0)} m`, fabValue(f)]),
          ...d.items.map((i) => [i.name, i.category, `${Number(i.quantity || 0)} ${i.unit || ""}`, Number(i.quantity || 0) * Number(i.unit_price || 0)]),
        ].sort((a, b) => b[3] - a[3]);
        return (
          <ReportView
            title="Inventory & procurement report"
            subtitle={`${range.label} (${range.from} to ${range.to}); stock figures are as of today - T&P Textiles`}
            filename="inventory-procurement-report"
            controls={controls}
            kpis={[
              { label: "Stock valuation", value: fmtMoney(fabricValue + itemValue), tone: "good", sub: unpriced ? `${unpriced} line(s) have no price` : "all lines priced" },
              { label: "Fabric stock value", value: fmtMoney(fabricValue), sub: `${Math.round(sum(d.fabrics, (f) => f.stock_kg) * 10) / 10} kg in stock` },
              { label: "Accessories & trims value", value: fmtMoney(itemValue) },
              { label: "Fabric used (cutting)", value: `${Math.round(kgUsed * 10) / 10} kg`, sub: mUsed ? `${Math.round(mUsed)} m` : undefined },
              { label: "Trims issued to orders", value: fmtMoney(matValue) },
              { label: "Possible fabric wastage", value: `${Math.round(wasteKg * 10) / 10} kg`, tone: wasteKg ? "warn" : "good", sub: "in rejected cutting entries" },
              { label: "Supplier purchases", value: fmtMoney(boughtValue), sub: `${bought.length} approved request(s)` },
              { label: "Requests pending", value: String(d.prs.filter((p) => p.status === "Pending").length) },
            ]}
            charts={[
              { type: "pie", title: "Stock valuation split", labels: ["Fabric", "Accessories & trims"], series: [{ name: "Value", values: [fabricValue, itemValue] }] },
              ...(byVendor.length ? [{ type: "hbar", title: "Purchases by supplier (₹)", labels: byVendor.slice(0, 10).map((r) => r[0]), series: [{ name: "Purchases", values: byVendor.slice(0, 10).map((r) => Math.round(r[2])) }] }] : []),
              ...(byCat.length ? [{ type: "pie", title: "Purchases by category", labels: byCat.map((r) => r[0]), series: [{ name: "Purchases", values: byCat.map((r) => r[2]) }] }] : []),
            ]}
            tables={[
              { heading: "Stock and valuation (today)", columns: [{ label: "Item" }, { label: "Type" }, { label: "In stock" }, { label: "Value", type: "money" }], rows: stockRows },
              { heading: "Consumption by order", columns: [{ label: "Order" }, { label: "Customer" }, { label: "Fabric kg", type: "num" }, { label: "Fabric m", type: "num" }, { label: "Trims issued (₹)", type: "money" }], rows: useRows },
              { heading: "Trims and accessories issued", columns: [{ label: "Item" }, { label: "Unit" }, { label: "Quantity", type: "num" }, { label: "Value", type: "money" }], rows: trimByName },
              { heading: "Supplier purchases", columns: [{ label: "Supplier" }, { label: "Requests", type: "int" }, { label: "Amount", type: "money" }], rows: byVendor },
            ]}
            footnote={`Valuation uses the prices entered in Inventory (fabric per kg / per metre, items per unit). Possible wastage is fabric logged against cutting entries that were rejected${wasteM ? ` (${Math.round(wasteM)} m as well)` : ""}. Supplier purchases are approved purchase requests created in the period.`}
          />
        );
      }}
    </ReportShell>
  );
}
