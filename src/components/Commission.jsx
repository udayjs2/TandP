import { useEffect, useMemo, useState } from "react";
import { Settings2, Check, BadgeIndianRupee } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import ReportView from "./ReportView";
import { fmtMoney, todayStr, COMMISSION_COLORS, PERIOD_LABELS, periodKeyLabel } from "../lib/helpers";
import { isSalesPerson } from "../lib/orgRoles";

// same bucketing as commission_period_key() in the database
export function periodKeyFor(date, period) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  if (period === "month") return date.slice(0, 7);
  if (period === "quarter") return `FY${fy}-Q${m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4}`;
  if (period === "year") return `FY${fy}`;
  return "all";
}

export default function Commission({ profile }) {
  const isAdmin = profile?.role === "admin";
  const [settings, setSettings] = useState(null);
  const [progress, setProgress] = useState([]);
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [periodKey, setPeriodKey] = useState("");
  const [spF, setSpF] = useState("All");
  const [statusF, setStatusF] = useState("All");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: st, error: e1 }, { data: pr }, { data: cm }, { data: emps }] = await Promise.all([
      supabase.from("commission_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.rpc("commission_progress"),
      supabase.from("sales_commissions").select("*").order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name, role, status"),
    ]);
    if (e1) setError(e1.message + " (run migration_40.sql)");
    setSettings(st || { threshold: 500000, rate_pct: 1, period: "month", basis: "completed" });
    setProgress(Array.isArray(pr) ? pr : []);
    setRows(cm || []);
    setPeople(emps || []);
  };
  useEffect(() => {
    (isAdmin ? supabase.rpc("refresh_all_commissions") : Promise.resolve()).then(load);
    const ch = supabase
      .channel("commission-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_commissions" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_sales" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id) => people.find((p) => p.id === id)?.name || "—";
  const curKey = settings ? periodKeyFor(todayStr(), settings.period) : "";
  const keys = useMemo(() => {
    const set = new Set([curKey, ...progress.map((p) => p.period_key), ...rows.map((r) => r.period_key)].filter(Boolean));
    return [...set].sort().reverse();
  }, [curKey, progress, rows]);
  const allPeriods = periodKey === "ALL";
  const activeKey = allPeriods || !periodKey ? curKey : periodKey;

  if (!settings) return <p className="text-sm text-stone-500">Loading…</p>;

  const threshold = Number(settings.threshold);
  const rate = Number(settings.rate_pct);

  // salespeople to show in the progress cards: everyone with orders, plus Sales employees (managers) / me
  const salesEmps = people.filter((p) => isSalesPerson(p.role) && p.status !== "Inactive");
  const idsInProgress = new Set(progress.map((p) => p.salesperson_id));
  const cardIds = [...new Set([...progress.filter((p) => p.period_key === activeKey).map((p) => p.salesperson_id), ...(isAdmin || ["gm", "pm", "sales_manager"].includes(profile?.role) ? salesEmps.map((s) => s.id) : profile?.employee_id ? [profile.employee_id] : [])])];
  const cards = cardIds
    .map((id) => {
      const p = progress.find((x) => x.salesperson_id === id && x.period_key === activeKey);
      const counted = Number(p?.counted_value || 0);
      return {
        id, name: nameOf(id), orders: Number(p?.orders || 0), confirmed: Number(p?.confirmed_value || 0), executed: Number(p?.executed_value || 0),
        counted, qualified: counted > threshold, remaining: Math.max(0, threshold - counted),
        earned: counted > threshold ? counted * rate / 100 : 0,
      };
    })
    .filter((c) => spF === "All" || c.id === spF)
    .sort((a, b) => b.counted - a.counted);

  const shownRows = rows.filter((r) => (r.period_key === activeKey || allPeriods) && (spF === "All" || r.salesperson_id === spF) && (statusF === "All" || r.status === statusF));
  const groups = [...new Set(shownRows.map((r) => `${r.salesperson_id}|${r.period_key}`))].map((k) => {
    const list = shownRows.filter((r) => `${r.salesperson_id}|${r.period_key}` === k);
    return { key: k, salesperson_id: list[0].salesperson_id, period_key: list[0].period_key, list, total: list.reduce((s, r) => s + Number(r.amount), 0) };
  });

  const act = async (ids, status) => {
    if (!ids.length) return;
    if (status === "Paid" && !confirm(`Mark ${ids.length} commission${ids.length === 1 ? "" : "s"} as paid? This posts them to Finance → Expenditures and cannot be undone.`)) return;
    setBusy(true);
    const { data, error: err } = await supabase.rpc("commission_set_status", { p_ids: ids, p_status: status, p_note: null });
    setBusy(false);
    if (err || !data?.ok) return alert(err?.message || data?.error || "Couldn't update");
    load();
  };

  // ----- report (salesperson-wise x period)
  const allKeysSorted = [...new Set(rows.map((r) => r.period_key))].sort();
  const summaryMap = {};
  rows.forEach((r) => {
    const k = `${r.salesperson_id}|${r.period_key}`;
    const s = (summaryMap[k] = summaryMap[k] || { sp: r.salesperson_id, pk: r.period_key, orders: 0, value: 0, pending: 0, approved: 0, paid: 0 });
    s.orders += 1; s.value += Number(r.order_value); s[r.status.toLowerCase()] += Number(r.amount);
  });
  const summary = Object.values(summaryMap).sort((a, b) => (a.pk < b.pk ? 1 : -1) || nameOf(a.sp).localeCompare(nameOf(b.sp)));
  const totals = rows.reduce((t, r) => ({ ...t, [r.status]: (t[r.status] || 0) + Number(r.amount) }), {});
  const bySp = {};
  rows.forEach((r) => (bySp[r.salesperson_id] = (bySp[r.salesperson_id] || 0) + Number(r.amount)));
  const monthTotals = allKeysSorted.map((k) => rows.filter((r) => r.period_key === k).reduce((s, r) => s + Number(r.amount), 0));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Commission</h2>
          <p className="text-sm text-stone-600 mt-0.5 max-w-2xl">
            A salesperson earns <b>{rate}%</b> on their orders once the <b>combined</b> value of their {settings.basis === "completed" ? "completed (executed)" : "confirmed"} orders in a {PERIOD_LABELS[settings.period]} <b>exceeds {fmtMoney(threshold)}</b>.
            Orders are added together — e.g. three orders of ₹2,00,000 make ₹6,00,000 and earn {fmtMoney(600000 * rate / 100)}. Each order is paid only once.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className={inputCls + " w-auto"} value={activeKey} onChange={(e) => setPeriodKey(e.target.value)}>
            {keys.map((k) => <option key={k} value={k}>{periodKeyLabel(k)}{k === curKey ? " (current)" : ""}</option>)}
          </select>
          {(isAdmin || ["gm", "pm", "sales_manager"].includes(profile?.role)) && (
            <select className={inputCls + " w-auto"} value={spF} onChange={(e) => setSpF(e.target.value)}>
              <option value="All">All salespeople</option>
              {[...new Set([...salesEmps.map((s) => s.id), ...idsInProgress])].map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          )}
          {isAdmin && <Btn variant="ghost" onClick={() => setSettingsOpen(true)}><Settings2 size={14} /> Rules</Btn>}
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div>
        <h3 className="text-sm font-semibold mb-2">Threshold progress — {periodKeyLabel(activeKey)}</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {cards.map((c) => {
            const pct = Math.min(100, (c.counted / threshold) * 100);
            return (
              <Card key={c.id} className={`p-4 ${c.qualified ? "border-emerald-300" : ""}`}>
                <div className="flex justify-between items-start">
                  <div className="font-semibold">{c.name}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.qualified ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{c.qualified ? "Qualified" : "Not yet"}</span>
                </div>
                <div className="flex justify-between text-xs text-stone-500 mt-2 mb-1">
                  <span>{fmtMoney(c.counted)} counted</span><span>of {fmtMoney(threshold)}</span>
                </div>
                <div className="h-2.5 bg-stone-100 rounded-full overflow-hidden"><div className={`h-full ${c.qualified ? "bg-emerald-600" : "bg-indigo-700"}`} style={{ width: `${pct}%` }} /></div>
                <div className="text-xs mt-2 text-stone-600">
                  {c.qualified ? <>Commission earned: <b className="font-mono">{fmtMoney(c.earned)}</b></> : <>{c.remaining > 0 ? `${fmtMoney(c.remaining)} more needed — the combined total must go above ${fmtMoney(threshold)}` : `Exactly at the threshold — the next order takes it above ${fmtMoney(threshold)}`}</>}
                </div>
                <div className="text-[11px] text-stone-400 mt-1">{c.orders} order{c.orders === 1 ? "" : "s"} · confirmed {fmtMoney(c.confirmed)} · executed {fmtMoney(c.executed)}</div>
              </Card>
            );
          })}
          {cards.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm md:col-span-2">No salesperson orders in this period yet.</Card>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h3 className="text-sm font-semibold">Commission records</h3>
          <div className="flex gap-1.5 flex-wrap">
            {["All", "Pending", "Approved", "Paid"].map((s) => (
              <button key={s} onClick={() => setStatusF(s)} className={`text-xs px-2.5 py-1 rounded-full border ${statusF === s ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"}`}>{s}</button>
            ))}
            <button onClick={() => setPeriodKey(allPeriods ? curKey : "ALL")} className={`text-xs px-2.5 py-1 rounded-full border ${allPeriods ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"}`}>All periods</button>
          </div>
        </div>
        <div className="space-y-3">
          {groups.map((g) => {
            const pend = g.list.filter((r) => r.status === "Pending").map((r) => r.id);
            const appr = g.list.filter((r) => r.status === "Approved").map((r) => r.id);
            return (
              <Card key={g.key} className="p-3.5">
                <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
                  <div className="font-semibold text-sm">{nameOf(g.salesperson_id)} <span className="text-stone-400 font-normal">· {periodKeyLabel(g.period_key)}</span></div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{fmtMoney(g.total)}</span>
                    {isAdmin && pend.length > 0 && <Btn variant="ghost" disabled={busy} onClick={() => act(pend, "Approved")}><Check size={13} /> Approve {pend.length}</Btn>}
                    {isAdmin && appr.length > 0 && <Btn disabled={busy} onClick={() => act(appr, "Paid")}><BadgeIndianRupee size={13} /> Pay {appr.length}</Btn>}
                  </div>
                </div>
                <div className="divide-y divide-stone-100">
                  {g.list.map((r) => (
                    <div key={r.id} className="flex justify-between items-center py-1.5 text-sm gap-2">
                      <span>{r.order_number} <span className="text-xs text-stone-400">{r.customer_name} · order {fmtMoney(r.order_value)} × {r.rate_pct}%</span></span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{fmtMoney(r.amount)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COMMISSION_COLORS[r.status]}`}>{r.status}{r.paid_at ? ` ${r.paid_at.slice(0, 10)}` : ""}</span>
                        {isAdmin && r.status === "Approved" && <button onClick={() => act([r.id], "Pending")} className="text-[11px] text-stone-400 hover:text-amber-700 underline">undo</button>}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
          {groups.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No commission has been earned in this view. It appears once a salesperson's combined orders exceed {fmtMoney(threshold)}.</Card>}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Commission report</h3>
        <ReportView
          title="Sales commission report"
          subtitle={`${rate}% above ${fmtMoney(threshold)} per ${PERIOD_LABELS[settings.period]} - T&P Textiles`}
          filename="sales-commission-report"
          kpis={[
            { label: "Pending", value: fmtMoney(totals.Pending || 0), tone: "warn" },
            { label: "Approved (to pay)", value: fmtMoney(totals.Approved || 0) },
            { label: "Paid", value: fmtMoney(totals.Paid || 0), tone: "good" },
            { label: "Total earned", value: fmtMoney((totals.Pending || 0) + (totals.Approved || 0) + (totals.Paid || 0)) },
          ]}
          charts={[
            ...(Object.keys(bySp).length ? [{ type: "hbar", title: "Commission by salesperson (₹)", labels: Object.keys(bySp).map(nameOf), series: [{ name: "Commission", values: Object.values(bySp).map((v) => Math.round(v)) }] }] : []),
            ...(allKeysSorted.length > 1 ? [{ type: "bar", title: "Commission by period (₹)", labels: allKeysSorted.map(periodKeyLabel), series: [{ name: "Commission", values: monthTotals.map((v) => Math.round(v)) }], format: (n) => fmtMoney(n) }] : []),
          ]}
          tables={[{
            heading: "Salesperson-wise, period-wise",
            columns: [{ label: "Salesperson" }, { label: "Period" }, { label: "Orders", type: "int" }, { label: "Order value", type: "money" }, { label: "Pending", type: "money" }, { label: "Approved", type: "money" }, { label: "Paid", type: "money" }],
            rows: summary.map((s) => [nameOf(s.sp), periodKeyLabel(s.pk), s.orders, s.value, s.pending, s.approved, s.paid]),
          }]}
        />
      </div>

      {settingsOpen && <RulesModal settings={settings} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />}
    </div>
  );
}

function RulesModal({ settings, onClose, onSaved }) {
  const [threshold, setThreshold] = useState(settings.threshold);
  const [rate, setRate] = useState(settings.rate_pct);
  const [period, setPeriod] = useState(settings.period);
  const [basis, setBasis] = useState(settings.basis);
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!confirm("Pending commissions will be recalculated under these rules. Approved and paid commissions stay as they are. Continue?")) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("set_commission_settings", { p_threshold: Number(threshold) || 0, p_rate: Number(rate) || 0, p_period: period, p_basis: basis });
    setSaving(false);
    if (error || !data?.ok) return alert(error?.message || data?.error);
    onSaved();
  };
  return (
    <Modal title="Commission rules" onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Threshold (₹) — must be exceeded"><input type="number" min="0" className={inputCls} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
          <Field label="Commission rate (%)"><input type="number" min="0" max="100" step="0.1" className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </div>
        <Field label="Orders are combined over a…">
          <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="month">Calendar month (by order date)</option>
            <option value="quarter">Financial quarter (Apr–Mar year)</option>
            <option value="year">Financial year (Apr–Mar)</option>
            <option value="all">All time (running total)</option>
          </select>
        </Field>
        <Field label="Which orders count?">
          <select className={inputCls} value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="completed">Only executed orders (status Completed or Shipped)</option>
            <option value="confirmed">Every confirmed order</option>
          </select>
        </Field>
        <p className="text-xs text-stone-500">When a salesperson's combined orders in the period exceed the threshold, every order in that period earns the rate on its full value.</p>
        <div className="flex justify-end gap-2 mt-3">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save rules"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
