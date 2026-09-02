import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Landmark, Wallet, TrendingUp, LayoutDashboard } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn, StatCard } from "./ui";
import { fmtMoney, todayStr, monthKey, EXPENDITURE_CATEGORIES } from "../lib/helpers";

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "investors", label: "Investors", icon: Landmark },
  { id: "expenditures", label: "Expenditures", icon: Wallet },
  { id: "profitability", label: "Order Profitability", icon: TrendingUp },
];

export default function Finance() {
  const [sub, setSub] = useState("overview");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Finance</h2>
        <p className="text-xs text-stone-500 mb-3">Admin-only — investor capital, business expenditures, and per-order profit &amp; loss.</p>
        <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
          {SUB_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 ${
                  sub === t.id ? "border-indigo-900 text-indigo-900" : "border-transparent text-stone-500 hover:text-stone-800"
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {sub === "overview" && <Overview />}
      {sub === "investors" && <Investors />}
      {sub === "expenditures" && <Expenditures />}
      {sub === "profitability" && <OrderProfitability />}
    </div>
  );
}

// ==================== OVERVIEW ====================
function Overview() {
  const [stats, setStats] = useState(null);

  const load = async () => {
    const [{ data: investments }, { data: expenditures }, { data: invoices }, { data: finance }] = await Promise.all([
      supabase.from("investments").select("amount"),
      supabase.from("expenditures").select("amount"),
      supabase.from("invoices").select("amount"),
      supabase.from("order_finance").select("*"),
    ]);
    const totalInvested = (investments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalExpenditure = (expenditures || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalRevenue = (invoices || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalOrderCosts = (finance || []).reduce(
      (s, r) => s + Number(r.raw_material_cost || 0) + Number(r.labor_cost || 0) + Number(r.overhead_cost || 0),
      0
    );
    setStats({ totalInvested, totalExpenditure, totalRevenue, totalOrderCosts, netPosition: totalInvested + totalRevenue - totalExpenditure });
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("finance-overview")
      .on("postgres_changes", { event: "*", schema: "public" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  if (!stats) return <p className="text-sm text-stone-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total invested" value={fmtMoney(stats.totalInvested)} icon={Landmark} />
        <StatCard label="Total expenditure" value={fmtMoney(stats.totalExpenditure)} icon={Wallet} tone="warn" />
        <StatCard label="Total revenue (invoices)" value={fmtMoney(stats.totalRevenue)} icon={TrendingUp} tone="good" />
        <StatCard label="Raw material + labor costs" value={fmtMoney(stats.totalOrderCosts)} />
      </div>
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-2">Cash position (rough)</h3>
        <div className="text-2xl font-mono font-semibold">{fmtMoney(stats.netPosition)}</div>
        <p className="text-xs text-stone-400 mt-1">Invested capital + revenue received − business expenditures. Doesn't include unpaid invoices, payroll paid out, or bank balances — a directional estimate, not an accounting statement.</p>
      </Card>
    </div>
  );
}

// ==================== INVESTORS ====================
function Investors() {
  const [investors, setInvestors] = useState([]);
  const [investmentsByInvestor, setInvestmentsByInvestor] = useState({});
  const [modal, setModal] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const load = async () => {
    const [{ data: inv }, { data: allInvestments }] = await Promise.all([
      supabase.from("investors").select("*").order("created_at", { ascending: true }),
      supabase.from("investments").select("*").order("invested_date", { ascending: false }),
    ]);
    setInvestors(inv || []);
    const byInvestor = {};
    (allInvestments || []).forEach((r) => {
      byInvestor[r.investor_id] = byInvestor[r.investor_id] || [];
      byInvestor[r.investor_id].push(r);
    });
    setInvestmentsByInvestor(byInvestor);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("investors-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "investors" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "investments" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const saveInvestor = async (inv) => {
    if (inv.id) {
      const { id, ...rest } = inv;
      await supabase.from("investors").update(rest).eq("id", id);
    } else {
      const { id, ...rest } = inv;
      await supabase.from("investors").insert(rest);
    }
    setModal(null);
    load();
  };

  const removeInvestor = async (id) => {
    if (!confirm("Remove this investor? This also removes their investment history.")) return;
    await supabase.from("investors").delete().eq("id", id);
    load();
  };

  const totalInvested = Object.values(investmentsByInvestor).flat().reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-stone-500">Total invested: <span className="font-mono font-semibold text-stone-800">{fmtMoney(totalInvested)}</span></span>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add investor
        </Btn>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {investors.map((inv) => {
          const entries = investmentsByInvestor[inv.id] || [];
          const total = entries.reduce((s, r) => s + Number(r.amount || 0), 0);
          return (
            <Card key={inv.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-semibold">{inv.name}</div>
                  <div className="text-xs text-stone-500">{inv.phone || "—"}{inv.email ? ` · ${inv.email}` : ""}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setModal(inv)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                  <button onClick={() => removeInvestor(inv.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="text-xl font-mono font-semibold mt-2">{fmtMoney(total)}</div>
              <div className="text-xs text-stone-400 mb-3">{entries.length} investment{entries.length === 1 ? "" : "s"}</div>
              <Btn variant="ghost" onClick={() => setHistoryFor(inv)}>View / add investments</Btn>
            </Card>
          );
        })}
        {investors.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm md:col-span-2">No investors added yet.</Card>}
      </div>
      {modal && <InvestorModal investor={modal} onClose={() => setModal(null)} onSave={saveInvestor} />}
      {historyFor && (
        <InvestmentHistoryModal investor={historyFor} entries={investmentsByInvestor[historyFor.id] || []} onClose={() => setHistoryFor(null)} onChanged={load} />
      )}
    </div>
  );
}

function InvestorModal({ investor, onClose, onSave }) {
  const [f, setF] = useState({
    id: investor.id || null,
    name: investor.name || "",
    phone: investor.phone || "",
    email: investor.email || "",
    notes: investor.notes || "",
  });
  return (
    <Modal title={investor.id ? "Edit investor" : "Add investor"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.name) return; onSave(f); }}>
        <Field label="Investor name"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function InvestmentHistoryModal({ investor, entries, onClose, onChanged }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState("");

  const addEntry = async (e) => {
    e.preventDefault();
    if (!amount) return;
    await supabase.from("investments").insert({ investor_id: investor.id, amount: Number(amount), invested_date: date, notes: notes || null });
    setAmount("");
    setNotes("");
    onChanged();
  };

  const removeEntry = async (id) => {
    if (!confirm("Remove this investment entry?")) return;
    await supabase.from("investments").delete().eq("id", id);
    onChanged();
  };

  const total = entries.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <Modal title={`${investor.name} — investments`} onClose={onClose}>
      <form onSubmit={addEntry} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Add investment entry</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" placeholder="Amount (₹)" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <input placeholder="Notes (optional)" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Btn type="submit" className="w-full justify-center">Add entry</Btn>
      </form>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History — total {fmtMoney(total)}</div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {entries.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
            <div>
              <span className="font-mono font-medium">{fmtMoney(r.amount)}</span>
              <div className="text-xs text-stone-400">{r.invested_date}{r.notes ? ` · ${r.notes}` : ""}</div>
            </div>
            <button onClick={() => removeEntry(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={13} /></button>
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-stone-400">No investments logged yet.</p>}
      </div>
      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

// ==================== EXPENDITURES ====================
function Expenditures() {
  const [mk, setMk] = useState(monthKey());
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-31`;
    const { data } = await supabase.from("expenditures").select("*").gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false });
    setItems(data || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("expenditures-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenditures" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  const save = async (exp) => {
    if (exp.id) {
      const { id, ...rest } = exp;
      await supabase.from("expenditures").update(rest).eq("id", id);
    } else {
      const { id, ...rest } = exp;
      await supabase.from("expenditures").insert(rest);
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this expenditure entry?")) return;
    await supabase.from("expenditures").delete().eq("id", id);
    load();
  };

  const total = items.reduce((s, r) => s + Number(r.amount || 0), 0);
  const byCategory = {};
  items.forEach((r) => (byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount || 0)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="month" value={mk} onChange={(e) => setMk(e.target.value)} className={inputCls + " w-auto"} />
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add expenditure
        </Btn>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <StatCard label="Total this month" value={fmtMoney(total)} />
        {EXPENDITURE_CATEGORIES.filter((c) => byCategory[c]).map((c) => (
          <StatCard key={c} label={c} value={fmtMoney(byCategory[c])} />
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Date</th>
              <th className="text-left px-4 py-2.5">Category</th>
              <th className="text-left px-4 py-2.5">Item</th>
              <th className="text-left px-4 py-2.5">Vendor</th>
              <th className="text-right px-4 py-2.5">Amount</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 text-stone-500">{r.expense_date}</td>
                <td className="px-4 py-2.5">{r.category}</td>
                <td className="px-4 py-2.5">{r.item || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{r.vendor || "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(r.amount)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModal(r)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                    <button onClick={() => remove(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No expenditures logged this month.</td></tr>}
          </tbody>
        </table>
      </Card>
      {modal && <ExpenditureModal exp={modal} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function ExpenditureModal({ exp, onClose, onSave }) {
  const [f, setF] = useState({
    id: exp.id || null,
    category: exp.category || "Raw Material",
    item: exp.item || "",
    vendor: exp.vendor || "",
    amount: exp.amount || "",
    expense_date: exp.expense_date || todayStr(),
    notes: exp.notes || "",
  });
  return (
    <Modal title={exp.id ? "Edit expenditure" : "Add expenditure"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.amount) return; onSave({ ...f, amount: Number(f.amount) || 0 }); }}>
        <Field label="Category">
          <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {EXPENDITURE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Item"><input className={inputCls} placeholder="e.g. Cotton fabric, Buttons, Sewing machine" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
        <Field label="Vendor / supplier"><input className={inputCls} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
        <Field label="Amount (₹)"><input type="number" min="0" required className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ==================== ORDER PROFITABILITY ====================
function OrderProfitability() {
  const [orders, setOrders] = useState([]);
  const [financeByOrder, setFinanceByOrder] = useState({});
  const [revenueByOrder, setRevenueByOrder] = useState({});

  const load = async () => {
    const [{ data: ord }, { data: finance }, { data: invoices }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status").order("order_date", { ascending: false }),
      supabase.from("order_finance").select("*"),
      supabase.from("invoices").select("linked_order_id, amount").not("linked_order_id", "is", null),
    ]);
    setOrders(ord || []);
    const fin = {};
    (finance || []).forEach((r) => (fin[r.order_id] = r));
    setFinanceByOrder(fin);
    const rev = {};
    (invoices || []).forEach((i) => (rev[i.linked_order_id] = (rev[i.linked_order_id] || 0) + Number(i.amount || 0)));
    setRevenueByOrder(rev);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("order-finance-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_finance" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const updateFinance = async (orderId, patch) => {
    const existing = financeByOrder[orderId] || { raw_material_cost: 0, labor_cost: 0, overhead_cost: 0, manpower_count: 0, man_days: 0 };
    const next = { ...existing, ...patch, order_id: orderId };
    await supabase.from("order_finance").upsert(next, { onConflict: "order_id" });
    load();
  };

  const rows = orders.map((o) => {
    const fin = financeByOrder[o.id] || { raw_material_cost: 0, labor_cost: 0, overhead_cost: 0, manpower_count: 0, man_days: 0 };
    const revenue = revenueByOrder[o.id] || 0;
    const totalCost = Number(fin.raw_material_cost || 0) + Number(fin.labor_cost || 0) + Number(fin.overhead_cost || 0);
    const profit = revenue - totalCost;
    const margin = revenue ? (profit / revenue) * 100 : null;
    return { order: o, fin, revenue, totalCost, profit, margin };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.totalCost,
      profit: acc.profit + r.profit,
    }),
    { revenue: 0, cost: 0, profit: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total revenue" value={fmtMoney(totals.revenue)} tone="good" />
        <StatCard label="Total cost" value={fmtMoney(totals.cost)} tone="warn" />
        <StatCard label="Total profit" value={fmtMoney(totals.profit)} tone={totals.profit >= 0 ? "good" : "bad"} />
      </div>
      <p className="text-xs text-stone-400">
        Revenue is pulled automatically from invoices linked to each order. Enter raw material cost, labor cost, overhead, manpower and days — they save when you click away from the field.
      </p>
      <div className="grid gap-3">
        {rows.map(({ order, fin, revenue, totalCost, profit, margin }) => (
          <Card key={order.id} className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="font-semibold text-sm">{order.order_number} — {order.customer_name}</div>
              <div className="text-sm">
                <span className="text-stone-500">Revenue </span>
                <span className="font-mono">{fmtMoney(revenue)}</span>
                <span className="mx-2 text-stone-300">·</span>
                <span className="text-stone-500">Profit </span>
                <span className={`font-mono font-semibold ${profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmtMoney(profit)}{margin !== null && ` (${margin.toFixed(0)}%)`}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Field label="Raw material (₹)">
                <input type="number" min="0" className={inputCls} defaultValue={fin.raw_material_cost} key={`rm-${order.id}`} onBlur={(e) => updateFinance(order.id, { raw_material_cost: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Labor (₹)">
                <input type="number" min="0" className={inputCls} defaultValue={fin.labor_cost} key={`lc-${order.id}`} onBlur={(e) => updateFinance(order.id, { labor_cost: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Overhead (₹)">
                <input type="number" min="0" className={inputCls} defaultValue={fin.overhead_cost} key={`oh-${order.id}`} onBlur={(e) => updateFinance(order.id, { overhead_cost: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Manpower (people)">
                <input type="number" min="0" className={inputCls} defaultValue={fin.manpower_count} key={`mp-${order.id}`} onBlur={(e) => updateFinance(order.id, { manpower_count: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Days">
                <input type="number" min="0" className={inputCls} defaultValue={fin.man_days} key={`md-${order.id}`} onBlur={(e) => updateFinance(order.id, { man_days: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            <div className="text-xs text-stone-400 mt-2">Total cost: {fmtMoney(totalCost)}</div>
          </Card>
        ))}
        {rows.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders yet.</Card>}
      </div>
    </div>
  );
}
