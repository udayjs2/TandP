import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Landmark, Wallet, TrendingUp, LayoutDashboard, Banknote } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn, StatCard } from "./ui";
import { fmtMoney, todayStr, monthKey, daysInMonth, EXPENDITURE_CATEGORIES, computeLaborCost } from "../lib/helpers";

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "investors", label: "Investors", icon: Landmark },
  { id: "expenditures", label: "Expenditures", icon: Wallet },
  { id: "profitability", label: "Order Profitability", icon: TrendingUp },
  { id: "loans", label: "Loans", icon: Banknote },
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
      {sub === "loans" && <Loans />}
    </div>
  );
}

// ==================== OVERVIEW ====================
function Overview() {
  const [stats, setStats] = useState(null);

  const load = async () => {
    const [{ data: investments }, { data: expenditures }, { data: invoices }, { data: finance }, { data: loans }, { data: loanPayments }] = await Promise.all([
      supabase.from("investments").select("amount"),
      supabase.from("expenditures").select("amount, investor_id"),
      supabase.from("invoices").select("amount"),
      supabase.from("order_finance").select("*"),
      supabase.from("loans").select("*"),
      supabase.from("loan_payments").select("loan_id, amount"),
    ]);
    const totalCashInvestments = (investments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const investorFundedExpenditure = (expenditures || []).filter((r) => r.investor_id).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalExpenditure = (expenditures || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalRevenue = (invoices || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalOrderCosts = (finance || []).reduce(
      (s, r) => s + Number(r.raw_material_cost || 0) + Number(r.labor_cost || 0) + Number(r.overhead_cost || 0),
      0
    );
    const paidByLoan = {};
    (loanPayments || []).forEach((p) => (paidByLoan[p.loan_id] = (paidByLoan[p.loan_id] || 0) + Number(p.amount || 0)));
    const totalLoanOutstanding = (loans || []).reduce((s, l) => s + Math.max(0, Number(l.loan_amount || 0) - (paidByLoan[l.id] || 0)), 0);
    const monthlyLoanCommitment = (loans || []).reduce((s, l) => s + Number(l.emi_amount || 0), 0);

    setStats({
      // Total invested = cash contributions + purchases an investor funded directly.
      // Nothing here is subtracted for expenditure — investing and spending are
      // tracked separately, matching how an established, running business works.
      totalInvested: totalCashInvestments + investorFundedExpenditure,
      totalExpenditure,
      totalRevenue,
      totalOrderCosts,
      totalLoanOutstanding,
      monthlyLoanCommitment,
    });
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
        <StatCard label="Total invested" value={fmtMoney(stats.totalInvested)} icon={Landmark} sub="Includes investor-funded purchases" />
        <StatCard label="Total revenue (invoices)" value={fmtMoney(stats.totalRevenue)} icon={TrendingUp} tone="good" />
        <StatCard label="Total expenditure" value={fmtMoney(stats.totalExpenditure)} icon={Wallet} />
        <StatCard label="Raw material + labor costs" value={fmtMoney(stats.totalOrderCosts)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Loan outstanding" value={fmtMoney(stats.totalLoanOutstanding)} icon={Banknote} tone={stats.totalLoanOutstanding > 0 ? "warn" : "good"} />
        <StatCard label="Monthly EMI commitment" value={fmtMoney(stats.monthlyLoanCommitment)} icon={Banknote} />
      </div>
    </div>
  );
}

// ==================== INVESTORS ====================
function Investors() {
  const [investors, setInvestors] = useState([]);
  const [investmentsByInvestor, setInvestmentsByInvestor] = useState({});
  const [fundedExpByInvestor, setFundedExpByInvestor] = useState({});
  const [modal, setModal] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const load = async () => {
    const [{ data: inv }, { data: allInvestments }, { data: fundedExp }] = await Promise.all([
      supabase.from("investors").select("*").order("created_at", { ascending: true }),
      supabase.from("investments").select("*").order("invested_date", { ascending: false }),
      supabase.from("expenditures").select("*").not("investor_id", "is", null).order("expense_date", { ascending: false }),
    ]);
    setInvestors(inv || []);
    const byInvestor = {};
    (allInvestments || []).forEach((r) => {
      byInvestor[r.investor_id] = byInvestor[r.investor_id] || [];
      byInvestor[r.investor_id].push(r);
    });
    setInvestmentsByInvestor(byInvestor);
    const fundedBy = {};
    (fundedExp || []).forEach((r) => {
      fundedBy[r.investor_id] = fundedBy[r.investor_id] || [];
      fundedBy[r.investor_id].push(r);
    });
    setFundedExpByInvestor(fundedBy);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("investors-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "investors" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "investments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenditures" }, load)
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
    if (!confirm("Remove this investor? This also removes their investment history. Any expenditures funded by them will stay, just unlinked.")) return;
    await supabase.from("investors").delete().eq("id", id);
    load();
  };

  const cashTotal = Object.values(investmentsByInvestor).flat().reduce((s, r) => s + Number(r.amount || 0), 0);
  const fundedTotal = Object.values(fundedExpByInvestor).flat().reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalInvested = cashTotal + fundedTotal;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-stone-500">
          Total invested: <span className="font-mono font-semibold text-stone-800">{fmtMoney(totalInvested)}</span>
          {fundedTotal > 0 && <span className="text-xs text-stone-400 ml-1">(incl. {fmtMoney(fundedTotal)} funded purchases)</span>}
        </span>
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add investor
        </Btn>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {investors.map((inv) => {
          const cashEntries = investmentsByInvestor[inv.id] || [];
          const fundedEntries = fundedExpByInvestor[inv.id] || [];
          const cash = cashEntries.reduce((s, r) => s + Number(r.amount || 0), 0);
          const funded = fundedEntries.reduce((s, r) => s + Number(r.amount || 0), 0);
          const total = cash + funded;
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
              <div className="text-xs text-stone-400 mb-3">
                {cashEntries.length} cash investment{cashEntries.length === 1 ? "" : "s"}
                {funded > 0 && <> · {fmtMoney(funded)} funded purchases ({fundedEntries.length})</>}
              </div>
              <Btn variant="ghost" onClick={() => setHistoryFor(inv)}>View / add investments</Btn>
            </Card>
          );
        })}
        {investors.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm md:col-span-2">No investors added yet.</Card>}
      </div>
      {modal && <InvestorModal investor={modal} onClose={() => setModal(null)} onSave={saveInvestor} />}
      {historyFor && (
        <InvestmentHistoryModal
          investor={historyFor}
          entries={investmentsByInvestor[historyFor.id] || []}
          fundedEntries={fundedExpByInvestor[historyFor.id] || []}
          onClose={() => setHistoryFor(null)}
          onChanged={load}
        />
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

function InvestmentHistoryModal({ investor, entries, fundedEntries, onClose, onChanged }) {
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

  const cashTotal = entries.reduce((s, r) => s + Number(r.amount || 0), 0);
  const fundedTotal = (fundedEntries || []).reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <Modal title={`${investor.name} — investments`} onClose={onClose}>
      <form onSubmit={addEntry} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Add cash investment</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" placeholder="Amount (₹)" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <input placeholder="Notes (optional)" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Btn type="submit" className="w-full justify-center">Add entry</Btn>
      </form>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">Cash investments — total {fmtMoney(cashTotal)}</div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto mb-4">
        {entries.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
            <div>
              <span className="font-mono font-medium">{fmtMoney(r.amount)}</span>
              <div className="text-xs text-stone-400">{r.invested_date}{r.notes ? ` · ${r.notes}` : ""}</div>
            </div>
            <button onClick={() => removeEntry(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={13} /></button>
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-stone-400">No cash investments logged yet.</p>}
      </div>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">Purchases funded — total {fmtMoney(fundedTotal)}</div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {(fundedEntries || []).map((r) => (
          <div key={r.id} className="text-sm border-b border-stone-100 pb-1.5">
            <span className="font-mono font-medium">{fmtMoney(r.amount)}</span>
            <div className="text-xs text-stone-400">{r.expense_date} · {r.category}{r.item ? ` — ${r.item}` : ""}</div>
          </div>
        ))}
        {(!fundedEntries || fundedEntries.length === 0) && (
          <p className="text-xs text-stone-400">No purchases attributed to this investor yet — link one from the Expenditures tab.</p>
        )}
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
  const [orders, setOrders] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [modal, setModal] = useState(null);

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(daysInMonth(mk)).padStart(2, "0")}`;
    const [{ data, error }, { data: ord }, { data: inv }] = await Promise.all([
      supabase.from("expenditures").select("*").gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false }),
      supabase.from("orders").select("id, order_number, customer_name").order("order_date", { ascending: false }),
      supabase.from("investors").select("id, name").order("name", { ascending: true }),
    ]);
    if (error) console.error("Failed to load expenditures:", error.message);
    setItems(data || []);
    setOrders(ord || []);
    setInvestors(inv || []);
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
      const { error } = await supabase.from("expenditures").update(rest).eq("id", id);
      if (error) { alert(error.message); return; }
    } else {
      const { id, ...rest } = exp;
      const { error } = await supabase.from("expenditures").insert(rest);
      if (error) { alert(error.message); return; }
    }
    setModal(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this expenditure entry?")) return;
    await supabase.from("expenditures").delete().eq("id", id);
    load();
  };

  const orderLabel = (id) => {
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : "—";
  };
  const investorLabel = (id) => investors.find((x) => x.id === id)?.name || "—";

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
              <th className="text-left px-4 py-2.5">Order</th>
              <th className="text-left px-4 py-2.5">Funded by</th>
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
                <td className="px-4 py-2.5 text-stone-500">{r.linked_order_id ? orderLabel(r.linked_order_id) : <span className="text-stone-300">Other</span>}</td>
                <td className="px-4 py-2.5 text-stone-500">{r.investor_id ? investorLabel(r.investor_id) : <span className="text-stone-300">—</span>}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(r.amount)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setModal(r)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                    <button onClick={() => remove(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">No expenditures logged this month.</td></tr>}
          </tbody>
        </table>
      </Card>
      {modal && <ExpenditureModal exp={modal} orders={orders} investors={investors} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function ExpenditureModal({ exp, orders, investors, onClose, onSave }) {
  const [f, setF] = useState({
    id: exp.id || null,
    category: exp.category || "Raw Material",
    item: exp.item || "",
    vendor: exp.vendor || "",
    amount: exp.amount || "",
    expense_date: exp.expense_date || todayStr(),
    notes: exp.notes || "",
    linked_order_id: exp.linked_order_id || "",
    investor_id: exp.investor_id || "",
  });
  return (
    <Modal title={exp.id ? "Edit expenditure" : "Add expenditure"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!f.amount) return; onSave({ ...f, amount: Number(f.amount) || 0, linked_order_id: f.linked_order_id || null, investor_id: f.investor_id || null }); }}>
        <Field label="Category">
          <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {EXPENDITURE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Item"><input className={inputCls} placeholder="e.g. Cotton fabric, Buttons, Sewing machine" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} /></Field>
        <Field label="Vendor / supplier"><input className={inputCls} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
        <Field label="Amount (₹)"><input type="number" min="0" required className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
        <Field label="Is this for a specific order?">
          <select className={inputCls} value={f.linked_order_id} onChange={(e) => setF({ ...f, linked_order_id: e.target.value })}>
            <option value="">Other (not tied to a specific order)</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Funded by an investor? (optional)">
          <select className={inputCls} value={f.investor_id} onChange={(e) => setF({ ...f, investor_id: e.target.value })}>
            <option value="">Not investor-funded</option>
            {investors.map((inv) => (
              <option key={inv.id} value={inv.id}>{inv.name}</option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-stone-400 -mt-2 mb-3">If set, this amount counts toward that investor's total invested — nothing is deducted anywhere.</p>
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
  const [laborByOrder, setLaborByOrder] = useState({});
  const [employeesById, setEmployeesById] = useState({});
  const [materialByOrder, setMaterialByOrder] = useState({});

  const load = async () => {
    const [{ data: ord }, { data: finance }, { data: invoices }, { data: labor }, { data: employees }, { data: linkedExpenditures }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status").order("order_date", { ascending: false }),
      supabase.from("order_finance").select("*"),
      supabase.from("invoices").select("linked_order_id, amount").not("linked_order_id", "is", null),
      supabase.from("order_labor").select("*"),
      supabase.from("employees").select("id, base_salary"),
      supabase.from("expenditures").select("linked_order_id, amount").not("linked_order_id", "is", null),
    ]);
    setOrders(ord || []);
    const fin = {};
    (finance || []).forEach((r) => (fin[r.order_id] = r));
    setFinanceByOrder(fin);
    const rev = {};
    (invoices || []).forEach((i) => (rev[i.linked_order_id] = (rev[i.linked_order_id] || 0) + Number(i.amount || 0)));
    setRevenueByOrder(rev);
    const laborByOrd = {};
    (labor || []).forEach((r) => {
      laborByOrd[r.order_id] = laborByOrd[r.order_id] || [];
      laborByOrd[r.order_id].push(r);
    });
    setLaborByOrder(laborByOrd);
    const empById = {};
    (employees || []).forEach((e) => (empById[e.id] = e));
    setEmployeesById(empById);
    const matByOrd = {};
    (linkedExpenditures || []).forEach((e) => (matByOrd[e.linked_order_id] = (matByOrd[e.linked_order_id] || 0) + Number(e.amount || 0)));
    setMaterialByOrder(matByOrd);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("order-finance-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_finance" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_labor" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenditures" }, load)
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
    const laborRows = laborByOrder[o.id] || [];
    const autoLabor = laborRows.length > 0 ? computeLaborCost(laborRows, employeesById) : null;
    const laborCost = autoLabor ? autoLabor.laborCost : Number(fin.labor_cost || 0);
    const autoMaterial = materialByOrder[o.id] || null;
    const materialCost = autoMaterial !== null ? autoMaterial : Number(fin.raw_material_cost || 0);
    const revenue = revenueByOrder[o.id] || 0;
    const totalCost = materialCost + laborCost + Number(fin.overhead_cost || 0);
    const profit = revenue - totalCost;
    const margin = revenue ? (profit / revenue) * 100 : null;
    return { order: o, fin, autoLabor, laborCost, autoMaterial, materialCost, revenue, totalCost, profit, margin };
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
        Revenue is pulled automatically from invoices linked to each order. Raw material cost auto-totals from any Expenditures tagged to that order; labor cost, manpower and days auto-calculate from staff assignments logged in the Orders tab (people icon). Where nothing is logged, you can type the numbers in manually instead.
      </p>
      <div className="grid gap-3">
        {rows.map(({ order, fin, autoLabor, laborCost, autoMaterial, materialCost, revenue, totalCost, profit, margin }) => (
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
              {autoMaterial !== null ? (
                <Field label="Raw material (₹) — auto">
                  <div className="text-sm font-mono py-2 text-stone-600">{fmtMoney(autoMaterial)}</div>
                </Field>
              ) : (
                <Field label="Raw material (₹)">
                  <input type="number" min="0" className={inputCls} defaultValue={fin.raw_material_cost} key={`rm-${order.id}`} onBlur={(e) => updateFinance(order.id, { raw_material_cost: Number(e.target.value) || 0 })} />
                </Field>
              )}
              {autoLabor ? (
                <>
                  <Field label="Labor (₹) — auto">
                    <div className="text-sm font-mono py-2 text-stone-600">{fmtMoney(autoLabor.laborCost)}</div>
                  </Field>
                  <Field label="Overhead (₹)">
                    <input type="number" min="0" className={inputCls} defaultValue={fin.overhead_cost} key={`oh-${order.id}`} onBlur={(e) => updateFinance(order.id, { overhead_cost: Number(e.target.value) || 0 })} />
                  </Field>
                  <Field label="Manpower — auto">
                    <div className="text-sm font-mono py-2 text-stone-600">{autoLabor.manpowerCount}</div>
                  </Field>
                  <Field label="Man-days — auto">
                    <div className="text-sm font-mono py-2 text-stone-600">{autoLabor.manDays}</div>
                  </Field>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
            <div className="text-xs text-stone-400 mt-2">Total cost: {fmtMoney(totalCost)}</div>
          </Card>
        ))}
        {rows.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No orders yet.</Card>}
      </div>
    </div>
  );
}

// ==================== LOANS ====================
function Loans() {
  const [loans, setLoans] = useState([]);
  const [paymentsByLoan, setPaymentsByLoan] = useState({});
  const [modal, setModal] = useState(null);
  const [paymentLoan, setPaymentLoan] = useState(null);

  const load = async () => {
    const [{ data: ln, error }, { data: payments }] = await Promise.all([
      supabase.from("loans").select("*").order("created_at", { ascending: true }),
      supabase.from("loan_payments").select("*").order("payment_date", { ascending: false }),
    ]);
    if (error) console.error("Failed to load loans:", error.message);
    setLoans(ln || []);
    const byLoan = {};
    (payments || []).forEach((p) => {
      byLoan[p.loan_id] = byLoan[p.loan_id] || [];
      byLoan[p.loan_id].push(p);
    });
    setPaymentsByLoan(byLoan);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("loans-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "loans" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "loan_payments" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const saveLoan = async (loan) => {
    if (loan.id) {
      const { id, ...rest } = loan;
      const { error } = await supabase.from("loans").update(rest).eq("id", id);
      if (error) { alert(`Couldn't save this loan:\n${error.message}`); return; }
    } else {
      const { id, ...rest } = loan;
      const { error } = await supabase.from("loans").insert(rest);
      if (error) { alert(`Couldn't save this loan:\n${error.message}`); return; }
    }
    setModal(null);
    load();
  };

  const removeLoan = async (id) => {
    if (!confirm("Remove this loan? This also removes its payment history.")) return;
    await supabase.from("loans").delete().eq("id", id);
    load();
  };

  const totalOutstanding = loans.reduce((s, l) => {
    const paid = (paymentsByLoan[l.id] || []).reduce((s2, p) => s2 + Number(p.amount || 0), 0);
    return s + Math.max(0, Number(l.loan_amount || 0) - paid);
  }, 0);
  const totalEmi = loans.reduce((s, l) => s + Number(l.emi_amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Total outstanding" value={fmtMoney(totalOutstanding)} icon={Banknote} tone={totalOutstanding > 0 ? "warn" : "good"} />
        <StatCard label="Total monthly EMI" value={fmtMoney(totalEmi)} icon={Banknote} />
      </div>
      <div className="flex justify-end">
        <Btn onClick={() => setModal({})}>
          <Plus size={15} /> Add loan
        </Btn>
      </div>
      <div className="grid gap-3">
        {loans.map((l) => {
          const payments = paymentsByLoan[l.id] || [];
          const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
          const outstanding = Math.max(0, Number(l.loan_amount || 0) - paid);
          const pct = l.loan_amount ? Math.min(100, (paid / l.loan_amount) * 100) : 0;
          return (
            <Card key={l.id} className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="font-semibold">{l.lender}</div>
                  <div className="text-xs text-stone-500">
                    {fmtMoney(l.loan_amount)} loan
                    {l.interest_rate ? ` · ${l.interest_rate}% interest` : ""}
                    {l.emi_amount ? ` · EMI ${fmtMoney(l.emi_amount)}/mo` : ""}
                    {l.start_date ? ` · started ${l.start_date}` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setModal(l)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                  <button onClick={() => removeLoan(l.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex justify-between text-xs text-stone-500 mb-1">
                <span>{fmtMoney(paid)} paid</span>
                <span>{fmtMoney(outstanding)} outstanding</span>
              </div>
              <div className="h-2 bg-stone-100 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-indigo-700" style={{ width: `${pct}%` }} />
              </div>
              <Btn variant="ghost" onClick={() => setPaymentLoan(l)}>View / log payments</Btn>
            </Card>
          );
        })}
        {loans.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No loans added yet.</Card>}
      </div>
      {modal && <LoanModal loan={modal} onClose={() => setModal(null)} onSave={saveLoan} />}
      {paymentLoan && (
        <LoanPaymentModal loan={paymentLoan} payments={paymentsByLoan[paymentLoan.id] || []} onClose={() => setPaymentLoan(null)} onChanged={load} />
      )}
    </div>
  );
}

function LoanModal({ loan, onClose, onSave }) {
  const [f, setF] = useState({
    id: loan.id || null,
    lender: loan.lender || "",
    loan_amount: loan.loan_amount || "",
    interest_rate: loan.interest_rate || "",
    emi_amount: loan.emi_amount || "",
    start_date: loan.start_date || todayStr(),
    tenure_months: loan.tenure_months || "",
    notes: loan.notes || "",
  });
  return (
    <Modal title={loan.id ? "Edit loan" : "Add loan"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.lender) return;
          onSave({
            ...f,
            loan_amount: Number(f.loan_amount) || 0,
            interest_rate: f.interest_rate === "" ? null : Number(f.interest_rate),
            emi_amount: Number(f.emi_amount) || 0,
            tenure_months: f.tenure_months === "" ? null : Number(f.tenure_months),
          });
        }}
      >
        <Field label="Lender / bank"><input required className={inputCls} value={f.lender} onChange={(e) => setF({ ...f, lender: e.target.value })} /></Field>
        <Field label="Loan amount (₹)"><input type="number" min="0" required className={inputCls} value={f.loan_amount} onChange={(e) => setF({ ...f, loan_amount: e.target.value })} /></Field>
        <Field label="Interest rate (% per year, optional)"><input type="number" min="0" step="0.01" className={inputCls} value={f.interest_rate} onChange={(e) => setF({ ...f, interest_rate: e.target.value })} /></Field>
        <Field label="Monthly EMI (₹)"><input type="number" min="0" className={inputCls} value={f.emi_amount} onChange={(e) => setF({ ...f, emi_amount: e.target.value })} /></Field>
        <Field label="Start date"><input type="date" className={inputCls} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Tenure (months, optional)"><input type="number" min="0" className={inputCls} value={f.tenure_months} onChange={(e) => setF({ ...f, tenure_months: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}

function LoanPaymentModal({ loan, payments, onClose, onChanged }) {
  const [month, setMonth] = useState(monthKey());
  const [amount, setAmount] = useState(loan.emi_amount || "");
  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const addPayment = async (e) => {
    e.preventDefault();
    if (!amount) return;
    setSaving(true);
    const { error } = await supabase
      .from("loan_payments")
      .upsert(
        { loan_id: loan.id, payment_month: month, amount: Number(amount), payment_date: date, notes: notes || null },
        { onConflict: "loan_id,payment_month" }
      );
    setSaving(false);
    if (error) { alert(`Couldn't save this payment:\n${error.message}`); return; }
    setNotes("");
    onChanged();
  };

  const removePayment = async (id) => {
    if (!confirm("Remove this payment entry?")) return;
    await supabase.from("loan_payments").delete().eq("id", id);
    onChanged();
  };

  return (
    <Modal title={`${loan.lender} — payments`} onClose={onClose}>
      <form onSubmit={addPayment} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Log a monthly payment</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} />
          <input type="number" min="0" placeholder="Amount (₹)" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="Notes (optional)" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Btn type="submit" disabled={saving} className="w-full justify-center">{saving ? "Saving…" : "Save payment (updates if that month already has one)"}</Btn>
      </form>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History</div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
            <div>
              <span className="font-mono font-medium">{fmtMoney(p.amount)}</span>
              <span className="text-xs text-stone-400"> · {p.payment_month}</span>
              <div className="text-xs text-stone-400">{p.payment_date}{p.notes ? ` · ${p.notes}` : ""}</div>
            </div>
            <button onClick={() => removePayment(p.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={13} /></button>
          </div>
        ))}
        {payments.length === 0 && <p className="text-xs text-stone-400">No payments logged yet.</p>}
      </div>

      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}
