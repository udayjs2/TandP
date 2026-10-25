import { useEffect, useState } from "react";
import { Upload, X, Check, Users2, Wallet, Store, Target, PackageSearch, BadgeIndianRupee } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Field, inputCls, Btn, Modal } from "./ui";
import { fmtMoney, monthKey, todayStr, EXPENSE_CATEGORIES, TRANSPORT_MODES, EXPENSE_STATUS_COLORS } from "../lib/helpers";
import CustomerManagement from "./CustomerManagement";
import Vendors from "./Vendors";
import { advanceBalance } from "./Advances";
import ModuleShell from "./ModuleShell";
import Leads from "./Leads";
import SalesOrders from "./SalesOrders";
import Commission from "./Commission";

export default function SalesTeam({ profile }) {
  const role = profile?.role;
  const isAdmin = ["admin", "hr", "gm", "pm"].includes(role);
  const isSales = role === "sales" || role === "sales_manager";
  const tabs = [
    ...(isAdmin || isSales ? [{ id: "leads", label: "Leads", icon: Target, render: () => <Leads profile={profile} /> }] : []),
    ...(["admin", "gm", "pm", "sales", "sales_manager"].includes(role) ? [{ id: "orders", label: "Sales Orders", icon: PackageSearch, render: () => <SalesOrders profile={profile} /> }] : []),
    ...(["admin", "gm", "pm", "sales", "sales_manager"].includes(role) ? [{ id: "commission", label: "Commission", icon: BadgeIndianRupee, render: () => <Commission profile={profile} /> }] : []),
    ...(isAdmin ? [{ id: "targets", label: "Targets & Expenses", icon: Wallet, render: () => <AdminSalesTeam /> }] : []),
    { id: "customers", label: "Customers", icon: Users2, render: () => <CustomerManagement profile={profile} /> },
    ...(isAdmin || isSales ? [{ id: "vendors", label: "Vendors", icon: Store, render: () => <Vendors profile={profile} /> }] : []),
  ];
  return (
    <ModuleShell
      title="CRM & Sales"
      subtitle="Track every customer from the first marketing visit to the finished order, and the salesperson's commission."
      tabs={tabs}
    />
  );
}

// ==================== ADMIN VIEW ====================
function AdminSalesTeam() {
  const [mk, setMk] = useState(monthKey());
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [rows, setRows] = useState({});
  const [claims, setClaims] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [orders, setOrders] = useState([]);
  const [viewClaim, setViewClaim] = useState(null);

  const load = async () => {
    const [{ data: emp }, { data: targets }, { data: allEmp }, { data: exp }, { data: ord }] = await Promise.all([
      supabase.from("employees").select("*").eq("role", "Sales"),
      supabase.from("sales_targets").select("*").eq("month", mk),
      supabase.from("employees").select("*"),
      supabase.from("expense_claims").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("id, order_number, customer_name"),
    ]);
    setSalesEmployees(emp || []);
    setEmployees(allEmp || []);
    setClaims(exp || []);
    setOrders(ord || []);
    const r = {};
    (targets || []).forEach((t) => (r[t.employee_id] = t));
    setRows(r);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sales-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_claims" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  const update = async (empId, patch) => {
    const existing = rows[empId] || { target: 0, achieved: 0, leads: 0 };
    const next = { ...existing, ...patch, employee_id: empId, month: mk };
    delete next.id;
    await supabase.from("sales_targets").upsert(next, { onConflict: "employee_id,month" });
    load();
  };

  const setClaimStatus = async (id, status, admin_notes) => {
    await supabase.from("expense_claims").update({ status, admin_notes: admin_notes ?? undefined }).eq("id", id);
    load();
    setViewClaim(null);
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.name || "—";
  const orderLabel = (id) => {
    if (!id) return "Marketing / Other";
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : "—";
  };
  const pendingCount = claims.filter((c) => c.status === "Submitted").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Sales team progress</h2>
        <input type="month" value={mk} onChange={(e) => setMk(e.target.value)} className={inputCls + " w-auto"} />
      </div>
      {salesEmployees.length === 0 ? (
        <Card className="p-8 text-center text-stone-400 text-sm">
          No employees with role "Sales" yet. Add one in the Employees tab.
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {salesEmployees.map((e) => {
            const entry = rows[e.id] || { target: 0, achieved: 0, leads: 0 };
            const pct = entry.target ? Math.min(100, (entry.achieved / entry.target) * 100) : 0;
            return (
              <Card key={e.id} className="p-4">
                <div className="font-semibold mb-2">{e.name}</div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Field label="Target (₹)">
                    <input type="number" min="0" className={inputCls} defaultValue={entry.target} key={`t-${e.id}-${mk}`} onBlur={(ev) => update(e.id, { target: Number(ev.target.value) || 0 })} />
                  </Field>
                  <Field label="Achieved (₹)">
                    <input type="number" min="0" className={inputCls} defaultValue={entry.achieved} key={`a-${e.id}-${mk}`} onBlur={(ev) => update(e.id, { achieved: Number(ev.target.value) || 0 })} />
                  </Field>
                  <Field label="Leads / orders">
                    <input type="number" min="0" className={inputCls} defaultValue={entry.leads} key={`l-${e.id}-${mk}`} onBlur={(ev) => update(e.id, { leads: Number(ev.target.value) || 0 })} />
                  </Field>
                </div>
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span>{fmtMoney(entry.achieved)}</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-700" style={{ width: `${pct}%` }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            Expense claims {pendingCount > 0 && <span className="text-xs font-normal text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 ml-1">{pendingCount} pending</span>}
          </h3>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-left px-4 py-2.5">Relates to</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {claims.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => setViewClaim(c)}>
                  <td className="px-4 py-2.5 font-medium">{employeeName(c.employee_id)}</td>
                  <td className="px-4 py-2.5">{c.category}{c.transport_mode ? ` · ${c.transport_mode}` : ""}<div className={`text-[10px] ${c.paid_from === "Advance" ? "text-indigo-700" : "text-amber-700"}`}>{c.paid_from === "Advance" ? "From advance" : "Own money"}</div></td>
                  <td className="px-4 py-2.5 text-stone-500 text-xs">{orderLabel(c.linked_order_id)}</td>
                  <td className="px-4 py-2.5 text-stone-500">{c.expense_date}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(c.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${EXPENSE_STATUS_COLORS[c.status]}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-stone-400 text-xs">View →</td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-stone-400">No expense claims submitted yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {viewClaim && (
        <ClaimReviewModal claim={viewClaim} employeeName={employeeName(viewClaim.employee_id)} orderLabel={orderLabel(viewClaim.linked_order_id)} onClose={() => setViewClaim(null)} onSetStatus={setClaimStatus} />
      )}
    </div>
  );
}

function ClaimReviewModal({ claim, employeeName, orderLabel, onClose, onSetStatus }) {
  const [notes, setNotes] = useState(claim.admin_notes || "");
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const viewReceipt = async () => {
    if (!claim.receipt_path) return;
    setLoadingUrl(true);
    const { data } = await supabase.storage.from("bills").createSignedUrl(claim.receipt_path, 300);
    setLoadingUrl(false);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <Modal title="Review expense claim" onClose={onClose}>
      <div className="space-y-1 text-sm mb-4">
        <div className="flex justify-between"><span className="text-stone-500">Employee</span><span className="font-medium">{employeeName}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Category</span><span>{claim.category}{claim.transport_mode ? ` · ${claim.transport_mode}` : ""}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Relates to</span><span>{orderLabel}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Paid from</span><span className="font-medium">{claim.paid_from === "Advance" ? "Company advance" : "Employee's own money"}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Date</span><span>{claim.expense_date}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">Amount</span><span className="font-mono font-semibold">{fmtMoney(claim.amount)}</span></div>
        {claim.description && <div className="pt-1"><span className="text-stone-500 block text-xs mb-0.5">Notes from staff</span>{claim.description}</div>}
      </div>

      {claim.receipt_path && (
        <Btn variant="ghost" onClick={viewReceipt} className="mb-4">
          {loadingUrl ? "Loading…" : <>View receipt photo</>}
        </Btn>
      )}

      <Field label="Admin notes (optional)">
        <textarea rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Reimbursed via cash on 12 Aug" />
      </Field>

      <div className="flex flex-wrap gap-2 mt-3">
        <Btn variant="ghost" onClick={() => onSetStatus(claim.id, "Rejected", notes)}>
          <X size={14} /> Reject
        </Btn>
        <Btn variant="ghost" onClick={() => onSetStatus(claim.id, "Approved", notes)}>
          <Check size={14} /> Approve
        </Btn>
        {claim.paid_from === "Advance"
          ? <p className="text-xs text-stone-500 self-center">Paid from the employee's advance, so there is nothing to reimburse. Approving records it in Expenditures.</p>
          : <Btn onClick={() => onSetStatus(claim.id, "Reimbursed", notes)}>Mark reimbursed (pay employee back)</Btn>}
      </div>
    </Modal>
  );
}

// ==================== STAFF VIEW ====================
export function MyExpenses({ profile }) {
  const [claims, setClaims] = useState([]);
  const [orders, setOrders] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const orderLabel = (id) => {
    if (!id) return "Marketing / Other";
    const o = orders.find((x) => x.id === id);
    return o ? `${o.order_number} — ${o.customer_name}` : null;
  };

  const load = async () => {
    if (!profile?.employee_id) {
      setLoading(false);
      return;
    }
    const [{ data }, { data: ord }, { data: adv }] = await Promise.all([
      supabase.from("expense_claims").select("*").eq("employee_id", profile.employee_id).order("created_at", { ascending: false }),
      supabase.from("orders").select("id, order_number, customer_name"),
      supabase.from("employee_advances").select("*").eq("employee_id", profile.employee_id).order("given_date", { ascending: false }),
    ]);
    setAdvances(adv || []);
    setClaims(data || []);
    setOrders(ord || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("my-expenses-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "expense_claims" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_advances" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.employee_id]);

  const viewReceipt = async (path) => {
    const { data } = await supabase.storage.from("bills").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const withdraw = async (id) => {
    if (!confirm("Withdraw this claim?")) return;
    await supabase.from("expense_claims").delete().eq("id", id);
    load();
  };

  if (loading) return <p className="text-sm text-stone-500">Loading…</p>;

  if (!profile?.employee_id) {
    return (
      <Card className="p-6 text-sm text-stone-600">
        Your login isn't linked to an employee record yet, so you can't submit expense claims here.
        Ask your admin to link your account (from the Payroll tab).
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My expense claims</h2>
        <Btn onClick={() => setShowForm(true)}>
          <Upload size={15} /> Submit a bill
        </Btn>
      </div>
      {advances.filter((a) => a.status === "Open").length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {advances.filter((a) => a.status === "Open").map((a) => {
            const b = advanceBalance(a, claims);
            return (
              <Card key={a.id} className="p-3.5 border-indigo-200">
                <div className="text-xs text-stone-500">Advance for {a.purpose} · {a.given_date}</div>
                <div className="font-mono text-lg font-semibold">{fmtMoney(b.left)} <span className="text-xs font-normal text-stone-400">left of {fmtMoney(a.amount)}</span></div>
                {a.notes && <div className="text-xs text-stone-400">{a.notes}</div>}
              </Card>
            );
          })}
        </div>
      )}
      <div className="grid gap-2">
        {claims.map((c) => (
          <Card key={c.id} className="p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-sm">
                  {c.category}{c.transport_mode ? ` · ${c.transport_mode}` : ""} — {fmtMoney(c.amount)}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">{c.expense_date}{c.description ? ` · ${c.description}` : ""}</div>
                <div className="text-xs text-stone-400 mt-0.5">{orderLabel(c.linked_order_id)}</div>
                <div className={`text-xs mt-0.5 ${c.paid_from === "Advance" ? "text-indigo-700" : "text-amber-700"}`}>{c.paid_from === "Advance" ? "Paid from company advance" : "Paid from my own money"}</div>
                {c.admin_notes && <div className="text-xs text-stone-500 mt-1 italic">Admin: {c.admin_notes}</div>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${EXPENSE_STATUS_COLORS[c.status]}`}>{c.status}</span>
                <div className="flex gap-2">
                  {c.receipt_path && (
                    <button onClick={() => viewReceipt(c.receipt_path)} className="text-xs text-indigo-700 hover:underline">
                      Receipt
                    </button>
                  )}
                  {c.status === "Submitted" && (
                    <button onClick={() => withdraw(c.id)} className="text-xs text-rose-600 hover:underline">
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {claims.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No claims submitted yet.</Card>}
      </div>
      {showForm && <SubmitClaimModal profile={profile} advances={advances} claims={claims} onClose={() => setShowForm(false)} onSaved={load} />}
    </div>
  );
}

function SubmitClaimModal({ profile, advances, claims, onClose, onSaved }) {
  const [category, setCategory] = useState("Food");
  const [transportMode, setTransportMode] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const usable = (advances || []).filter((a) => a.status === "Open").map((a) => ({ a, left: advanceBalance(a, claims).left })).filter((x) => x.left > 0);
  const [paidFrom, setPaidFrom] = useState("Own money");
  const [advanceId, setAdvanceId] = useState("");
  const [orders, setOrders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const needsTransportMode = category === "Petrol" || category === "Transport";

  useEffect(() => {
    supabase
      .from("orders")
      .select("id, order_number, customer_name")
      .order("order_date", { ascending: false })
      .then(({ data }) => setOrders(data || []));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!amount || Number(amount) <= 0) return setError("Enter a valid amount.");
    if (paidFrom === "Advance") {
      const pick = usable.find((x) => x.a.id === advanceId);
      if (!pick) return setError("Choose which advance this was paid from.");
      if (Number(amount) > pick.left) return setError(`Only ${fmtMoney(pick.left)} is left in that advance. Submit the extra as a separate "My own money" bill.`);
    }
    setSaving(true);
    try {
      let receiptPath = null;
      if (file) {
        const path = `${profile.employee_id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("bills").upload(path, file);
        if (upErr) throw upErr;
        receiptPath = path;
      }
      const { error: insErr } = await supabase.from("expense_claims").insert({
        employee_id: profile.employee_id,
        category,
        transport_mode: needsTransportMode ? transportMode || null : null,
        amount: Number(amount),
        expense_date: date,
        description: description || null,
        receipt_path: receiptPath,
        submitted_by: profile.id,
        status: "Submitted",
        linked_order_id: linkedOrderId || null,
        paid_from: paidFrom,
        advance_id: paidFrom === "Advance" ? advanceId : null,
      });
      if (insErr) throw insErr;
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
    setSaving(false);
  };

  return (
    <Modal title="Submit a bill" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {needsTransportMode && (
          <Field label="Mode of transport">
            <select className={inputCls} value={transportMode} onChange={(e) => setTransportMode(e.target.value)}>
              <option value="">— select —</option>
              {TRANSPORT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Paid from">
          <div className="flex gap-2">
            {[["Own money", "My own money"], ["Advance", "Company advance"]].map(([v, l]) => (
              <button type="button" key={v} onClick={() => { setPaidFrom(v); if (v === "Advance" && !advanceId && usable[0]) setAdvanceId(usable[0].a.id); }}
                className={`flex-1 text-sm px-3 py-2 rounded-lg border ${paidFrom === v ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-700 border-stone-200"}`}>{l}</button>
            ))}
          </div>
          {paidFrom === "Own money" && <p className="text-xs text-stone-400 mt-1">The company will reimburse you once approved.</p>}
          {paidFrom === "Advance" && (usable.length === 0
            ? <p className="text-xs text-rose-600 mt-1">You have no advance with money left. Ask your admin to record the advance, or choose "My own money".</p>
            : <select className={inputCls + " mt-2"} value={advanceId} onChange={(e) => setAdvanceId(e.target.value)}>
                {usable.map(({ a, left }) => <option key={a.id} value={a.id}>{a.purpose} · {a.given_date} · {fmtMoney(left)} left</option>)}
              </select>)}
        </Field>
        <Field label="Amount (₹)">
          <input type="number" min="0" required className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <input className={inputCls} placeholder="e.g. Client visit — Vijayawada" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Relates to">
          <select className={inputCls} value={linkedOrderId} onChange={(e) => setLinkedOrderId(e.target.value)}>
            <option value="">Marketing / Other (not order-specific)</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Receipt photo (optional)">
          <input
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
        {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
