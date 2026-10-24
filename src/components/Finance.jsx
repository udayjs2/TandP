import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, Plus, Trash2, Pencil, Landmark, Wallet, TrendingUp, LayoutDashboard, Banknote, CreditCard, Receipt, ShoppingCart, Check, X, Truck, FileText, PackageCheck } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn, StatCard } from "./ui";
import Invoices from "./Invoices";
import ActualCostModal from "./ActualCost";
import { fmtMoney, todayStr, monthKey, daysInMonth, EXPENDITURE_CATEGORIES, PAYMENT_MODES, computeLaborCost, findDuplicateExpenditures } from "../lib/helpers";

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "investors", label: "Investors", icon: Landmark },
  { id: "expenditures", label: "Expenditures", icon: Wallet },
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "profitability", label: "Order Profitability", icon: TrendingUp },
  { id: "loans", label: "Loans", icon: Banknote },
];

export default function Finance({ profile }) {
  // Admin and Finance: everything. (Purchase Requests live in Inventory & Procurement, Advances in HR & Workforce.)
  const role = profile?.role;
  const fullAccess = ["admin", "finance"].includes(role);
  const allowed = fullAccess ? SUB_TABS.map((t) => t.id) : [];
  const limited = !fullAccess;
  const tabs = SUB_TABS.filter((t) => allowed.includes(t.id));
  const [sub, setSub] = useState(allowed[0] === "overview" ? "overview" : allowed[0]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold mb-1">Finance &amp; Accounts</h1>
        <p className="text-xs text-stone-500 mb-3">{limited ? "Business expenditures and employee advances." : "Invoices, payments, investor capital, expenditures, advances, loans and per-order profit & loss."}</p>
        <div className="subtab-bar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={`subtab ${sub === t.id ? "subtab-active" : ""}`}
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
      {sub === "payments" && <Payments profile={profile} />}
      {sub === "profitability" && <OrderProfitability />}
      {sub === "loans" && <Loans />}
      {sub === "invoices" && fullAccess && <Invoices isAdmin={role === "admin"} />}
    </div>
  );
}

// ==================== OVERVIEW ====================
function Overview() {
  const [stats, setStats] = useState(null);

  const load = async () => {
    const [{ data: investments }, { data: expenditures }, { data: invoices }, { data: orderPayments }, { data: finance }, { data: loans }, { data: loanPayments }] = await Promise.all([
      supabase.from("investments").select("amount"),
      supabase.from("expenditures").select("amount, investor_id"),
      supabase.from("invoices").select("amount"),
      supabase.from("order_payments").select("amount"),
      supabase.from("order_finance").select("*"),
      supabase.from("loans").select("*"),
      supabase.from("loan_payments").select("loan_id, amount"),
    ]);
    const totalCashInvestments = (investments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const investorFundedExpenditure = (expenditures || []).filter((r) => r.investor_id).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalExpenditure = (expenditures || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    // Revenue = the full (gross) value of what's been invoiced. Advance
    // payments are a partial payment TOWARD that same amount, not extra
    // revenue on top of it — an invoice's amount already represents the
    // full order value, with the advance simply deducted to show what's
    // still owed (Balance Due).
    const totalRevenue = (invoices || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalAdvancePending = (orderPayments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
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
      totalAdvancePending,
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
        <StatCard label="Total revenue (invoiced)" value={fmtMoney(stats.totalRevenue)} icon={TrendingUp} tone="good" />
        <StatCard label="Total expenditure" value={fmtMoney(stats.totalExpenditure)} icon={Wallet} />
        <StatCard label="Raw material + labor costs" value={fmtMoney(stats.totalOrderCosts)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Loan outstanding" value={fmtMoney(stats.totalLoanOutstanding)} icon={Banknote} tone={stats.totalLoanOutstanding > 0 ? "warn" : "good"} />
        <StatCard label="Monthly EMI commitment" value={fmtMoney(stats.monthlyLoanCommitment)} icon={Banknote} />
        <StatCard label="Advance payments received" value={fmtMoney(stats.totalAdvancePending)} sub="Cash collected — see each invoice for balance due" />
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
  const [onlyDup, setOnlyDup] = useState(false);
  const [pad, setPad] = useState([]); // entries just outside the month, used only for duplicate matching

  const load = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(daysInMonth(mk)).padStart(2, "0")}`;
    const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const [{ data, error }, { data: ord }, { data: inv }, { data: edge }] = await Promise.all([
      supabase.from("expenditures").select("*").gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false }),
      supabase.from("orders").select("id, order_number, customer_name").order("order_date", { ascending: false }),
      supabase.rpc("investor_names"),
      supabase.from("expenditures").select("*").or(`and(expense_date.gte.${shift(start, -3)},expense_date.lt.${start}),and(expense_date.gt.${end},expense_date.lte.${shift(end, 3)})`),
    ]);
    if (error) console.error("Failed to load expenditures:", error.message);
    setPad(edge || []);
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

  const dups = findDuplicateExpenditures([...items, ...pad]);
  const dupItems = items.filter((r) => dups[r.id]);
  const shownItems = onlyDup ? dupItems : items;

  // Finance / Admin: this entry is correct, so it (and the entries it was matched with) stop being flagged.
  const markNotDuplicate = async (r) => {
    const ids = [r.id, ...(dups[r.id]?.with || [])];
    if (!window.confirm("Mark this as a genuine entry (not a duplicate)?\nThe matching entries will also stop being flagged.")) return;
    const { data: who } = await supabase.auth.getUser?.() || {};
    const { error } = await supabase
      .from("expenditures")
      .update({ dup_cleared_at: new Date().toISOString(), dup_cleared_by: who?.user?.email || null })
      .in("id", ids);
    if (error) alert(`Couldn't update:\n${error.message}`);
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

      {dupItems.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span className="inline-flex items-center gap-2 font-medium"><AlertTriangle size={16} /> {dupItems.length} entr{dupItems.length === 1 ? "y looks" : "ies look"} like a duplicate — please review (red rows).</span>
          <button onClick={() => setOnlyDup(!onlyDup)} className="text-xs font-medium underline">{onlyDup ? "Show all entries" : "Show only these"}</button>
        </div>
      )}

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
            {shownItems.map((r) => (
              <tr key={r.id} className={dups[r.id] ? "bg-rose-50 hover:bg-rose-100" : "hover:bg-stone-50"}>
                <td className="px-4 py-2.5 text-stone-500">
                  {r.expense_date}
                  {dups[r.id] && (
                    <div className="text-[10px] font-semibold text-rose-700 inline-flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={10} /> {dups[r.id].level === "exact" ? "DUPLICATE" : "POSSIBLE DUPLICATE"}
                    </div>
                  )}
                  {r.dup_cleared_at && <div className="text-[10px] text-emerald-700 inline-flex items-center gap-1 mt-0.5" title={`Validated${r.dup_cleared_by ? ` by ${r.dup_cleared_by}` : ""}`}><ShieldCheck size={10} /> Verified</div>}
                </td>
                <td className="px-4 py-2.5">{r.category}</td>
                <td className="px-4 py-2.5">{r.item || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{r.vendor || "—"}</td>
                <td className="px-4 py-2.5 text-stone-500">{r.linked_order_id ? orderLabel(r.linked_order_id) : <span className="text-stone-300">Other</span>}</td>
                <td className="px-4 py-2.5 text-stone-500">{r.investor_id ? investorLabel(r.investor_id) : <span className="text-stone-300">—</span>}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(r.amount)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1 items-center">
                    {dups[r.id] && (
                      <button onClick={() => markNotDuplicate(r)} className="text-[11px] font-medium text-emerald-700 border border-emerald-300 rounded-full px-2 py-0.5 hover:bg-emerald-50 whitespace-nowrap">
                        Not a duplicate
                      </button>
                    )}
                    {r.payroll_id ? (
                      <span className="text-[10px] text-stone-400 px-1" title="Posted from Payroll. Change it there.">from Payroll</span>
                    ) : (<>
                      <button onClick={() => setModal(r)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={14} /></button>
                      <button onClick={() => remove(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
            {shownItems.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">{onlyDup ? "No duplicates to review." : "No expenditures logged this month."}</td></tr>}
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
  const [advanceByOrder, setAdvanceByOrder] = useState({});
  const [laborByOrder, setLaborByOrder] = useState({});
  const [employeesById, setEmployeesById] = useState({});
  const [materialByOrder, setMaterialByOrder] = useState({});
  const [costFor, setCostFor] = useState(null);

  const load = async () => {
    const [{ data: ord }, { data: finance }, { data: invoices }, { data: payments }, { data: labor }, { data: employees }, { data: linkedExpenditures }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status").order("order_date", { ascending: false }),
      supabase.from("order_finance").select("*"),
      supabase.from("invoices").select("linked_order_id, amount").not("linked_order_id", "is", null),
      supabase.from("order_payments").select("order_id, amount"),
      supabase.from("order_labor").select("*"),
      supabase.from("employees").select("id, base_salary"),
      supabase.from("expenditures").select("linked_order_id, amount").not("linked_order_id", "is", null).eq("category", "Raw Material"),
    ]);
    setOrders(ord || []);
    const fin = {};
    (finance || []).forEach((r) => (fin[r.order_id] = r));
    setFinanceByOrder(fin);
    const rev = {};
    (invoices || []).forEach((i) => (rev[i.linked_order_id] = (rev[i.linked_order_id] || 0) + Number(i.amount || 0)));
    setRevenueByOrder(rev);
    const adv = {};
    (payments || []).forEach((p) => (adv[p.order_id] = (adv[p.order_id] || 0) + Number(p.amount || 0)));
    setAdvanceByOrder(adv);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "order_payments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_labor" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenditures" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const updateFinance = async (orderId, patch) => {
    const existing = financeByOrder[orderId] || { approved_estimate: 0, raw_material_cost: 0, labor_cost: 0, overhead_cost: 0, manpower_count: 0, man_days: 0 };
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
    // Revenue is the invoice's full (gross) amount — advance payments are a
    // partial payment toward that same amount, shown as a deduction on the
    // invoice itself (Balance Due), not counted a second time here.
    const revenue = revenueByOrder[o.id] || 0;
    const advancePending = advanceByOrder[o.id] || 0;
    const totalCost = materialCost + laborCost + Number(fin.overhead_cost || 0);
    const profit = revenue - totalCost;
    const margin = revenue ? (profit / revenue) * 100 : null;
    return { order: o, fin, autoLabor, laborCost, autoMaterial, materialCost, revenue, advancePending, totalCost, profit, margin };
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
        Revenue is each order's full invoiced amount (not increased by advance payments — see the Payments tab for those;
        an advance is part of the invoiced amount, deducted on the invoice itself as a Balance Due). Raw material cost
        auto-totals from Expenditures tagged to that order with category "Raw Material" specifically — other categories
        linked to an order (e.g. a reimbursed sales expense) don't get counted here. Labor cost, manpower and days
        auto-calculate from staff assignments logged in the Orders tab (people icon). Where nothing is logged, you can
        type the numbers in manually instead.
      </p>
      <div className="grid gap-3">
        {rows.map(({ order, fin, autoLabor, laborCost, autoMaterial, materialCost, revenue, advancePending, totalCost, profit, margin }) => (
          <Card key={order.id} className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="font-semibold text-sm flex items-center gap-2">{order.order_number} — {order.customer_name}
                <button onClick={() => setCostFor({ order, revenue })} className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-800 hover:bg-indigo-100">Actual cost</button>
              </div>
              <div className="text-sm">
                <span className="text-stone-500">Revenue </span>
                <span className="font-mono">{fmtMoney(revenue)}</span>
                {advancePending > 0 && (
                  <span className="text-xs text-stone-400"> ({fmtMoney(advancePending)} advance received so far)</span>
                )}
                <span className="mx-2 text-stone-300">·</span>
                <span className="text-stone-500">Profit </span>
                <span className={`font-mono font-semibold ${profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmtMoney(profit)}{margin !== null && ` (${margin.toFixed(0)}%)`}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Field label="Approved cost estimate (₹)">
                <input type="number" min="0" className={inputCls} defaultValue={fin.approved_estimate || ""} key={`ae-${order.id}`} placeholder="alerts if exceeded" onBlur={(e) => updateFinance(order.id, { approved_estimate: Number(e.target.value) || 0 })} />
              </Field>
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
      {costFor && <ActualCostModal order={costFor.order} revenue={costFor.revenue} onClose={() => setCostFor(null)} />}
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

// ==================== PAYMENTS ====================
function Payments({ profile }) {
  const [orders, setOrders] = useState([]);
  const [paymentsByOrder, setPaymentsByOrder] = useState({});
  const [invoicedByOrder, setInvoicedByOrder] = useState({});
  const [paymentOrder, setPaymentOrder] = useState(null);

  const load = async () => {
    const [{ data: ord }, { data: pay }, { data: inv }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name, status, due_date").order("order_date", { ascending: false }),
      supabase.from("order_payments").select("order_id, amount"),
      supabase.from("invoices").select("linked_order_id, amount").not("linked_order_id", "is", null),
    ]);
    const invd = {};
    (inv || []).forEach((i) => (invd[i.linked_order_id] = (invd[i.linked_order_id] || 0) + Number(i.amount || 0)));
    setInvoicedByOrder(invd);
    setOrders(ord || []);
    const totals = {};
    (pay || []).forEach((p) => (totals[p.order_id] = (totals[p.order_id] || 0) + Number(p.amount || 0)));
    setPaymentsByOrder(totals);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("finance-payments-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_payments" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const grandTotal = Object.values(paymentsByOrder).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <StatCard label="Total advance/payments received (all orders)" value={fmtMoney(grandTotal)} icon={CreditCard} tone="good" />
      <p className="text-xs text-stone-400">
        Log advance and milestone payments received directly against an order here. This moved from the Orders tab since
        Orders is now also open to Production Manager, General Manager and Team Lead — payment amounts stay restricted to Finance.
      </p>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Order</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Due date</th>
              <th className="text-right px-4 py-2.5">Invoiced</th>
              <th className="text-right px-4 py-2.5">Received so far</th>
              <th className="text-right px-4 py-2.5">Balance</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orders.map((o) => {
              const invoiced = invoicedByOrder[o.id] || 0;
              const received = paymentsByOrder[o.id] || 0;
              const balance = invoiced - received;
              return (
              <tr key={o.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium">{o.order_number} — {o.customer_name}</td>
                <td className="px-4 py-2.5 text-stone-500">{o.status}</td>
                <td className="px-4 py-2.5 text-stone-500">{o.due_date || "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono text-stone-500">{invoiced ? fmtMoney(invoiced) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(received)}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-semibold ${!invoiced ? "text-stone-300" : balance <= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {!invoiced ? "—" : balance <= 0 ? "Paid in full" : fmtMoney(balance)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Btn variant="ghost" onClick={() => setPaymentOrder({ ...o, invoiced })}>Log / view</Btn>
                </td>
              </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">No orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {paymentOrder && <PaymentModal order={paymentOrder} profile={profile} onClose={() => setPaymentOrder(null)} onChanged={load} />}
    </div>
  );
}

function PaymentModal({ order, profile, onClose, onChanged }) {
  const [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [mode, setMode] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("order_payments").select("*").eq("order_id", order.id).order("payment_date", { ascending: false });
    setPayments(data || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const addPayment = async (e) => {
    e.preventDefault();
    if (!amount) return;
    setSaving(true);
    const { error } = await supabase.from("order_payments").insert({
      order_id: order.id,
      amount: Number(amount),
      payment_date: date,
      mode,
      notes: notes || null,
      updated_by: profile?.name || null,
    });
    setSaving(false);
    if (error) { alert(`Couldn't save this payment:\n${error.message}`); return; }
    setAmount("");
    setNotes("");
    load();
    onChanged();
  };

  const removePayment = async (id) => {
    if (!confirm("Remove this payment entry?")) return;
    await supabase.from("order_payments").delete().eq("id", id);
    load();
    onChanged();
  };

  return (
    <Modal title={`Advance / payments — ${order.order_number}`} onClose={onClose}>
      <div className={`grid ${order.invoiced ? "grid-cols-3" : "grid-cols-1"} gap-2 mb-4 text-center`}>
        {order.invoiced > 0 && (
          <div className="bg-stone-50 rounded-lg p-3">
            <div className="text-lg font-mono font-semibold">{fmtMoney(order.invoiced)}</div>
            <div className="text-[11px] text-stone-500">Invoice total</div>
          </div>
        )}
        <div className="bg-stone-50 rounded-lg p-3">
          <div className="text-lg font-mono font-semibold">{fmtMoney(total)}</div>
          <div className="text-[11px] text-stone-500">Received so far</div>
        </div>
        {order.invoiced > 0 && (
          <div className={`rounded-lg p-3 ${order.invoiced - total <= 0 ? "bg-emerald-50" : "bg-rose-50"}`}>
            <div className={`text-lg font-mono font-semibold ${order.invoiced - total <= 0 ? "text-emerald-700" : "text-rose-700"}`}>{order.invoiced - total <= 0 ? "Paid" : fmtMoney(order.invoiced - total)}</div>
            <div className="text-[11px] text-stone-500">{order.invoiced - total <= 0 ? "Invoice fully paid" : "Balance to receive"}</div>
          </div>
        )}
      </div>

      <form onSubmit={addPayment} className="border border-stone-200 rounded-lg p-3 mb-4 space-y-2">
        <div className="text-xs font-semibold text-stone-600 uppercase mb-1">Log a payment received</div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min="0" placeholder="Amount (₹)" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
          {PAYMENT_MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input placeholder="Notes (optional)" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Btn type="submit" disabled={saving} className="w-full justify-center">
          {saving ? "Saving…" : "Add payment"}
        </Btn>
      </form>

      <div className="text-xs font-semibold text-stone-600 uppercase mb-1.5">History</div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-sm border-b border-stone-100 pb-1.5">
            <div>
              <span className="font-mono font-medium">{fmtMoney(p.amount)}</span>
              <span className="text-xs text-stone-400"> · {p.mode}</span>
              <div className="text-xs text-stone-400">{p.payment_date}{p.notes ? ` · ${p.notes}` : ""}</div>
            </div>
            <button onClick={() => removePayment(p.id)} className="text-stone-400 hover:text-rose-700 p-1">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {payments.length === 0 && <p className="text-xs text-stone-400">No payments logged yet.</p>}
      </div>

      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Modal>
  );
}


// ==================== PURCHASE REQUESTS ====================
const PR_CATEGORIES = ["Fabric", "Machine", "Spare Parts", "Accessories", "Other"];
const PR_STATUS_COLORS = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

export function PurchaseRequests({ profile }) {
  const role = profile?.role;
  const isGM = role === "gm";
  const isAdminish = ["admin", "hr"].includes(role);
  const isFinanceRole = role === "finance";
  const [rows, setRows] = useState([]);
  const [orders, setOrders] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [filter, setFilter] = useState("Pending");
  const [modal, setModal] = useState(false);
  const [stage, setStage] = useState(null); // { kind: "payment"|"invoice"|"dispatch"|"receive", row }

  const load = async () => {
    const [{ data: pr, error }, { data: ord }, { data: inv }] = await Promise.all([
      supabase.from("purchase_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("id, order_number, customer_name").order("order_date", { ascending: false }),
      supabase.rpc("investor_names"),
    ]);
    if (error) console.error("Failed to load purchase requests:", error.message);
    setRows(pr || []);
    setOrders(ord || []);
    setInvestors(inv || []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("purchase-requests-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_requests" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const orderLabel = (id) => {
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : "Not tied to an order";
  };
  const investorLabel = (id) => investors.find((x) => x.id === id)?.name || "Not investor-funded";

  const approve = async (r) => {
    const { data, error } = await supabase.rpc("approve_purchase_request", { p_id: r.id });
    if (error || data?.ok === false) alert(error?.message || data?.error);
    load();
  };
  const reject = async (r) => {
    const reason = window.prompt("Reason for rejecting (optional):");
    if (reason === null) return;
    const { data, error } = await supabase.rpc("reject_purchase_request", { p_id: r.id, p_reason: reason || null });
    if (error || data?.ok === false) alert(error?.message || data?.error);
    load();
  };
  const remove = async (r) => {
    if (!window.confirm("Delete this request?")) return;
    const { error } = await supabase.from("purchase_requests").delete().eq("id", r.id);
    if (error) alert(error.message);
    load();
  };

  const inTransit = (r) => r.status === "Approved" && !r.received_at;
  const shown = rows.filter((r) =>
    filter === "All" ? true : filter === "Awaiting delivery" ? inTransit(r) : filter === "Received" ? !!r.received_at : r.status === filter
  );
  const countFor = (f) => (f === "Awaiting delivery" ? rows.filter(inTransit).length : f === "Received" ? rows.filter((r) => r.received_at).length : rows.filter((r) => r.status === f).length);
  const openInvoice = async (r) => {
    const { data, error } = await supabase.storage.from("bills").createSignedUrl(r.invoice_path, 300);
    if (error) return alert(error.message);
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-stone-500 max-w-xl">
          Approval goes in order: <b>General Manager</b> → <b>Finance</b> → <b>Admin</b>. Once all three approve, the amount is added to Expenditures against the selected order and investor. After that: record payment → vendor invoice → dispatch/tracking → goods received, which adds the stock to Inventory.
        </p>
        {!isFinanceRole && <Btn onClick={() => setModal(true)}><Plus size={15} /> New purchase request</Btn>}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {["Pending", "Awaiting delivery", "Received", "Rejected", "All"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === f ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-600 border-stone-200"}`}>
            {f}{f !== "All" ? ` (${countFor(f)})` : ""}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {shown.map((r) => {
          // approval chain: General Manager -> Finance -> Admin
          const canGm = isGM && !r.gm_approved_at;
          const canFin = isFinanceRole && !!r.gm_approved_at && !r.finance_approved_at;
          const canAdmin = isAdminish && !!r.finance_approved_at && !r.admin_approved_at;
          const canReject = (isGM || isFinanceRole || isAdminish) && r.status === "Pending";
          const canDelete = r.status === "Pending" && (role === "admin" || r.requested_by === profile?.id);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{r.category} — {r.item}</div>
                  <div className="text-xs text-stone-500">
                    {r.quantity ? `${r.quantity}${r.unit ? ` ${r.unit}` : ""} · ` : ""}₹{Number(r.amount).toLocaleString("en-IN")}{r.vendor ? ` · ${r.vendor}` : ""}
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">Order: {orderLabel(r.order_id)} · Funded by: {investorLabel(r.investor_id)}</div>
                  <div className="text-xs text-stone-400 mt-0.5">Requested by {r.requested_by_name || "—"} on {new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
                  {r.notes && <div className="text-xs text-stone-500 mt-1">{r.notes}</div>}
                  {r.status === "Rejected" && <div className="text-xs text-rose-700 mt-1">Rejected by {r.rejected_by}{r.reject_reason ? `: ${r.reject_reason}` : ""}</div>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PR_STATUS_COLORS[r.status]}`}>{r.status}</span>
              </div>

              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${r.gm_approved_at ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-stone-50 border-stone-200 text-stone-500"}`}>
                  {r.gm_approved_at ? <Check size={11} /> : null} General Manager{r.gm_approved_by ? `: ${r.gm_approved_by}` : " — pending"}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${r.finance_approved_at ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-stone-50 border-stone-200 text-stone-500"}`}>
                  {r.finance_approved_at ? <Check size={11} /> : null} Finance{r.finance_approved_by ? `: ${r.finance_approved_by}` : r.gm_approved_at ? " — pending" : " — after GM"}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${r.admin_approved_at ? "bg-emerald-50 border-emerald-300 text-emerald-800" : "bg-stone-50 border-stone-200 text-stone-500"}`}>
                  {r.admin_approved_at ? <Check size={11} /> : null} Admin{r.admin_approved_by ? `: ${r.admin_approved_by}` : r.finance_approved_at ? " — pending" : " — after Finance"}
                </span>
                {r.status === "Approved" && <span className="text-emerald-700 self-center">Added to expenditures</span>}
              </div>

              {r.status === "Approved" && (
                <div className="mt-3 border-t border-stone-100 pt-3">
                  <div className="grid sm:grid-cols-4 gap-2 text-xs">
                    <FulfilStep done={!!r.paid_at} icon={Banknote} title="Payment to vendor">
                      {r.paid_at ? `₹${Number(r.paid_amount || 0).toLocaleString("en-IN")} · ${r.payment_mode} · ${r.paid_at}${r.payment_ref ? ` · Ref ${r.payment_ref}` : ""}` : "Not paid yet"}
                    </FulfilStep>
                    <FulfilStep done={!!r.invoice_number} icon={FileText} title="Vendor invoice">
                      {r.invoice_number ? (
                        <>
                          #{r.invoice_number}{r.invoice_amount != null ? ` · ₹${Number(r.invoice_amount).toLocaleString("en-IN")}` : ""}
                          {r.invoice_path && <button onClick={() => openInvoice(r)} className="block text-indigo-700 hover:underline">View file</button>}
                        </>
                      ) : "Awaiting invoice"}
                    </FulfilStep>
                    <FulfilStep done={!!r.transporter} icon={Truck} title="Dispatch / transport">
                      {r.transporter ? (
                        <>
                          {r.transporter}{r.tracking_number ? ` · ${r.tracking_number}` : ""}
                          <span className="block text-stone-400">
                            {r.dispatch_date ? `Sent ${r.dispatch_date}` : ""}{r.expected_arrival ? ` · ETA ${r.expected_arrival}` : ""}
                          </span>
                          {r.tracking_number && (
                            <a className="text-indigo-700 hover:underline" target="_blank" rel="noreferrer"
                              href={`https://www.google.com/search?q=${encodeURIComponent(`${r.transporter} tracking ${r.tracking_number}`)}`}>Track shipment</a>
                          )}
                        </>
                      ) : "Not dispatched yet"}
                    </FulfilStep>
                    <FulfilStep done={!!r.received_at} icon={PackageCheck} title="Received at factory">
                      {r.received_at ? `${r.received_at} · by ${r.received_by}${r.received_qty != null ? ` · qty ${r.received_qty}` : ""}${r.inventory_posted ? ` · ${r.inventory_posted}` : ""}` : "Not received yet"}
                    </FulfilStep>
                  </div>
                  {!r.received_at && !isFinanceRole && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {isAdminish && <Btn variant="ghost" onClick={() => setStage({ kind: "payment", row: r })}><Banknote size={13} /> {r.paid_at ? "Edit payment" : "Record payment"}</Btn>}
                      <Btn variant="ghost" onClick={() => setStage({ kind: "invoice", row: r })}><FileText size={13} /> {r.invoice_number ? "Edit invoice" : "Add vendor invoice"}</Btn>
                      <Btn variant="ghost" onClick={() => setStage({ kind: "dispatch", row: r })}><Truck size={13} /> {r.transporter ? "Edit dispatch" : "Add dispatch / tracking"}</Btn>
                      <Btn onClick={() => setStage({ kind: "receive", row: r })}><PackageCheck size={13} /> Goods received → Inventory</Btn>
                    </div>
                  )}
                </div>
              )}

              {r.status === "Pending" && (canGm || canFin || canAdmin || canReject || canDelete) && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {(canGm || canFin || canAdmin) && <Btn onClick={() => approve(r)}><Check size={13} /> Approve{canGm ? " as GM" : canFin ? " as Finance" : " as Admin"}</Btn>}
                  {canReject && <Btn variant="ghost" onClick={() => reject(r)}><X size={13} /> Reject</Btn>}
                  {canDelete && <Btn variant="ghost" onClick={() => remove(r)}><Trash2 size={13} /> Delete</Btn>}
                </div>
              )}
            </Card>
          );
        })}
        {shown.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No {filter === "All" ? "" : filter.toLowerCase() + " "}purchase requests.</Card>}
      </div>

      {stage?.kind === "payment" && <PaymentStageModal row={stage.row} onClose={() => setStage(null)} onSaved={load} />}
      {stage?.kind === "invoice" && <InvoiceStageModal row={stage.row} onClose={() => setStage(null)} onSaved={load} />}
      {stage?.kind === "dispatch" && <DispatchStageModal row={stage.row} onClose={() => setStage(null)} onSaved={load} />}
      {stage?.kind === "receive" && <ReceiveStageModal row={stage.row} onClose={() => setStage(null)} onSaved={load} />}
      {modal && <PurchaseRequestModal orders={orders} investors={investors} profile={profile} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

function PurchaseRequestModal({ orders, investors, profile, onClose, onSaved }) {
  const [f, setF] = useState({ category: "Fabric", item: "", quantity: "", unit: "", amount: "", vendor: "", order_id: "", investor_id: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("purchase_requests").insert({
      category: f.category,
      item: f.item,
      quantity: f.quantity === "" ? null : Number(f.quantity),
      unit: f.unit || null,
      amount: Number(f.amount) || 0,
      vendor: f.vendor || null,
      order_id: f.order_id || null,
      investor_id: f.investor_id || null,
      notes: f.notes || null,
      requested_by: profile.id,
      requested_by_name: profile.name || null,
    });
    setSaving(false);
    if (error) return alert(`Couldn't submit:\n${error.message}`);
    onSaved();
    onClose();
  };

  return (
    <Modal title="New purchase request" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="What are you buying?">
          <select className={inputCls} value={f.category} onChange={set("category")}>
            {PR_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Item">
          <input required className={inputCls} value={f.item} onChange={set("item")}
            placeholder={f.category === "Accessories" ? "e.g. Elastic 20mm, collar cups, buttons" : f.category === "Machine" ? "e.g. JUKI single needle" : f.category === "Fabric" ? "e.g. Single jersey, navy" : "Item name"} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity"><input type="number" min="0" step="any" className={inputCls} value={f.quantity} onChange={set("quantity")} /></Field>
          <Field label="Unit"><input className={inputCls} value={f.unit} onChange={set("unit")} placeholder="kg, m, pcs, rolls" /></Field>
          <Field label="Amount (₹)"><input type="number" min="0" required className={inputCls} value={f.amount} onChange={set("amount")} /></Field>
          <Field label="Vendor / supplier"><input className={inputCls} value={f.vendor} onChange={set("vendor")} /></Field>
        </div>
        <Field label="For which order?">
          <select className={inputCls} value={f.order_id} onChange={set("order_id")}>
            <option value="">Not tied to a specific order</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>)}
          </select>
        </Field>
        <Field label="Who is funding this?">
          <select className={inputCls} value={f.investor_id} onChange={set("investor_id")}>
            <option value="">Not investor-funded</option>
            {investors.map((inv) => <option key={inv.id} value={inv.id}>{inv.name}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit for approval"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function FulfilStep({ done, icon: Icon, title, children }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${done ? "border-emerald-300 bg-emerald-50/60" : "border-stone-200 bg-stone-50"}`}>
      <div className={`flex items-center gap-1 font-semibold mb-0.5 ${done ? "text-emerald-800" : "text-stone-500"}`}>
        <Icon size={12} /> {title}
      </div>
      <div className="text-stone-600 break-words">{children}</div>
    </div>
  );
}

async function runStage(row, stage, data) {
  const { data: res, error } = await supabase.rpc("update_purchase_fulfilment", { p_id: row.id, p_stage: stage, p_data: data });
  if (error || res?.ok === false) {
    alert(`Couldn't save:\n${error?.message || res?.error}`);
    return false;
  }
  return true;
}

function PaymentStageModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    paid_at: row.paid_at || todayStr(),
    paid_amount: row.paid_amount ?? row.invoice_amount ?? row.amount ?? "",
    payment_mode: row.payment_mode || "Bank Transfer",
    payment_ref: row.payment_ref || "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const ok = await runStage(row, "payment", { ...f, paid_amount: Number(f.paid_amount) || 0 });
    setSaving(false);
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={`Payment — ${row.item}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Amount paid to vendor (₹)"><input type="number" min="0" required className={inputCls} value={f.paid_amount} onChange={(e) => setF({ ...f, paid_amount: e.target.value })} /></Field>
        <Field label="Payment date"><input type="date" required className={inputCls} value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
        <Field label="Mode">
          <select className={inputCls} value={f.payment_mode} onChange={(e) => setF({ ...f, payment_mode: e.target.value })}>
            {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Reference / UTR / cheque no."><input className={inputCls} value={f.payment_ref} onChange={(e) => setF({ ...f, payment_ref: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 mt-4"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save payment"}</Btn></div>
      </form>
    </Modal>
  );
}

function InvoiceStageModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    invoice_number: row.invoice_number || "",
    invoice_date: row.invoice_date || todayStr(),
    invoice_amount: row.invoice_amount ?? row.amount ?? "",
    vendor: row.vendor || "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    let invoice_path = "";
    if (file) {
      const path = `vendor-invoices/${row.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("bills").upload(path, file);
      if (error) {
        setSaving(false);
        return alert(`Couldn't upload the file:\n${error.message}`);
      }
      invoice_path = path;
    }
    const ok = await runStage(row, "invoice", { ...f, invoice_amount: f.invoice_amount === "" ? null : Number(f.invoice_amount), invoice_path });
    setSaving(false);
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={`Vendor invoice — ${row.item}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Vendor"><input className={inputCls} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
        <Field label="Invoice number"><input required className={inputCls} value={f.invoice_number} onChange={(e) => setF({ ...f, invoice_number: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice date"><input type="date" className={inputCls} value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></Field>
          <Field label="Invoice amount (₹)"><input type="number" min="0" className={inputCls} value={f.invoice_amount} onChange={(e) => setF({ ...f, invoice_amount: e.target.value })} /></Field>
        </div>
        <Field label={row.invoice_path ? "Replace invoice file (optional)" : "Invoice file (photo or PDF)"}>
          <input type="file" accept="image/*,application/pdf" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <p className="text-xs text-stone-400 mb-2">The invoice amount replaces the estimate in this order's expenditure.</p>
        <div className="flex justify-end gap-2 mt-4"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save invoice"}</Btn></div>
      </form>
    </Modal>
  );
}

function DispatchStageModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    transporter: row.transporter || "",
    tracking_number: row.tracking_number || "",
    dispatch_date: row.dispatch_date || todayStr(),
    expected_arrival: row.expected_arrival || "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const ok = await runStage(row, "dispatch", f);
    setSaving(false);
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={`Dispatch & tracking — ${row.item}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Transporter / courier"><input required className={inputCls} placeholder="e.g. VRL, DTDC, Professional Couriers" value={f.transporter} onChange={(e) => setF({ ...f, transporter: e.target.value })} /></Field>
        <Field label="LR / consignment / tracking number"><input className={inputCls} value={f.tracking_number} onChange={(e) => setF({ ...f, tracking_number: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dispatch date"><input type="date" className={inputCls} value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} /></Field>
          <Field label="Expected arrival"><input type="date" className={inputCls} value={f.expected_arrival} onChange={(e) => setF({ ...f, expected_arrival: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-4"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save dispatch details"}</Btn></div>
      </form>
    </Modal>
  );
}

function ReceiveStageModal({ row, onClose, onSaved }) {
  const [fabrics, setFabrics] = useState([]);
  const [items, setItems] = useState([]);
  const [machines, setMachines] = useState([]);
  const [recvQty, setRecvQty] = useState(row.quantity ?? "");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState("existing");
  const [inv, setInv] = useState({
    id: "", fabric_type: "", color: "", weight_gsm: "", kg: "", meters: "",
    category: "Elastic", name: "", unit: row.unit || "", quantity: row.quantity ?? "",
    model: "JUKI", model_other: "", machine_type: row.item || "", machine_id: "", part_name: row.item || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setInv({ ...inv, [k]: e.target.value });

  useEffect(() => {
    (async () => {
      const [{ data: f }, { data: i }, { data: m }] = await Promise.all([
        supabase.from("inventory_fabric").select("id, fabric_type, color, stock_kg, stock_meters").order("fabric_type"),
        supabase.from("inventory_items").select("id, name, category, quantity, unit").order("name"),
        supabase.from("inventory_machines").select("id, model, model_other, machine_type, working_condition"),
      ]);
      setFabrics(f || []);
      setItems(i || []);
      setMachines(m || []);
    })();
  }, []);

  const num = (v) => (v === "" || v == null ? null : Number(v));

  const submit = async (e) => {
    e.preventDefault();
    let payload = {};
    if (row.category === "Fabric") {
      if (mode === "existing" && !inv.id) return alert("Select which fabric stock to add to.");
      payload = { mode, id: inv.id, fabric_type: inv.fabric_type, color: inv.color, weight_gsm: inv.weight_gsm, kg: num(inv.kg) ?? 0, meters: num(inv.meters) ?? 0 };
    } else if (row.category === "Accessories") {
      if (mode === "existing" && !inv.id) return alert("Select which item to add to.");
      payload = { mode, id: inv.id, category: inv.category, name: inv.name, unit: inv.unit, quantity: num(inv.quantity) ?? 0 };
    } else if (row.category === "Machine") {
      payload = { model: inv.model, model_other: inv.model_other, machine_type: inv.machine_type, quantity: num(inv.quantity) ?? 1 };
    } else if (row.category === "Spare Parts") {
      payload = { machine_id: inv.machine_id, part_name: inv.part_name, quantity: num(inv.quantity) ?? 1 };
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("receive_purchase_request", { p_id: row.id, p_received_qty: num(recvQty), p_notes: notes, p_inv: payload });
    setSaving(false);
    if (error || data?.ok === false) return alert(`Couldn't save:\n${error?.message || data?.error}`);
    onSaved();
    onClose();
  };

  const machineName = (m) => `${m.model === "OTHER" ? m.model_other || "Other" : m.model} ${m.machine_type} (${m.working_condition})`;

  return (
    <Modal title={`Goods received — ${row.item}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-xs text-stone-500 mb-3">
          Confirm what actually reached the factory. {row.category === "Other" ? "This category isn't stocked in Inventory, so it is only marked received." : "The quantity below is added to Inventory automatically."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantity received${row.unit ? ` (${row.unit})` : ""}`}>
            <input type="number" min="0" step="any" className={inputCls} value={recvQty} onChange={(e) => setRecvQty(e.target.value)} />
          </Field>
          <Field label="Ordered quantity"><div className="text-sm py-2">{row.quantity ?? "—"}{row.unit ? ` ${row.unit}` : ""}</div></Field>
        </div>

        {(row.category === "Fabric" || row.category === "Accessories") && (
          <Field label="Add to">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="existing">Existing inventory entry</option>
              <option value="new">Create a new inventory entry</option>
            </select>
          </Field>
        )}

        {row.category === "Fabric" && (
          <>
            {mode === "existing" ? (
              <Field label="Fabric">
                <select className={inputCls} value={inv.id} onChange={set("id")}>
                  <option value="">— select —</option>
                  {fabrics.map((f) => <option key={f.id} value={f.id}>{f.fabric_type}{f.color ? ` · ${f.color}` : ""} (now {f.stock_kg ?? 0} kg / {f.stock_meters ?? 0} m)</option>)}
                </select>
              </Field>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Fabric type"><input required className={inputCls} value={inv.fabric_type} onChange={set("fabric_type")} /></Field>
                <Field label="Color"><input className={inputCls} value={inv.color} onChange={set("color")} /></Field>
                <Field label="GSM"><input type="number" min="0" className={inputCls} value={inv.weight_gsm} onChange={set("weight_gsm")} /></Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Add (kg)"><input type="number" min="0" step="any" className={inputCls} value={inv.kg} onChange={set("kg")} /></Field>
              <Field label="Add (meters)"><input type="number" min="0" step="any" className={inputCls} value={inv.meters} onChange={set("meters")} /></Field>
            </div>
          </>
        )}

        {row.category === "Accessories" && (
          <>
            {mode === "existing" ? (
              <Field label="Item">
                <select className={inputCls} value={inv.id} onChange={set("id")}>
                  <option value="">— select —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.category} · {i.name} (now {i.quantity} {i.unit})</option>)}
                </select>
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select className={inputCls} value={inv.category} onChange={set("category")}>
                    {["Thread", "Elastic", "Accessory", "Other"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Item name"><input required className={inputCls} value={inv.name} onChange={set("name")} placeholder="e.g. Collar cups" /></Field>
                <Field label="Unit"><input className={inputCls} value={inv.unit} onChange={set("unit")} placeholder="pcs, m, cones" /></Field>
              </div>
            )}
            <Field label="Add quantity"><input type="number" min="0" step="any" className={inputCls} value={inv.quantity} onChange={set("quantity")} /></Field>
          </>
        )}

        {row.category === "Machine" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <select className={inputCls} value={inv.model} onChange={set("model")}>
                {["JUKI", "ZOJE", "JIN", "JACK", "KANSAI", "OTHER"].map((m) => <option key={m} value={m}>{m === "OTHER" ? "Other" : m}</option>)}
              </select>
            </Field>
            {inv.model === "OTHER" && <Field label="Model name"><input required className={inputCls} value={inv.model_other} onChange={set("model_other")} /></Field>}
            <Field label="Type"><input required className={inputCls} value={inv.machine_type} onChange={set("machine_type")} /></Field>
            <Field label="Quantity"><input type="number" min="1" className={inputCls} value={inv.quantity} onChange={set("quantity")} /></Field>
          </div>
        )}

        {row.category === "Spare Parts" && (
          <>
            <Field label="Part name"><input required className={inputCls} value={inv.part_name} onChange={set("part_name")} /></Field>
            <Field label="For machine (optional)">
              <select className={inputCls} value={inv.machine_id} onChange={set("machine_id")}>
                <option value="">General spare stock</option>
                {machines.map((m) => <option key={m.id} value={m.id}>{machineName(m)}</option>)}
              </select>
            </Field>
            <Field label="Quantity"><input type="number" min="1" className={inputCls} value={inv.quantity} onChange={set("quantity")} /></Field>
          </>
        )}

        <Field label="Notes (damage, shortage, remarks)"><textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 mt-4"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Confirm receipt"}</Btn></div>
      </form>
    </Modal>
  );
}
