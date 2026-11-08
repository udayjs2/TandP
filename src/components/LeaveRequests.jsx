import { useEffect, useState } from "react";
import { Plus, Check, X, Clock } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { publicHolidayOn } from "../lib/holidays";
import { todayStr, quarterLabel, quarterMonths } from "../lib/helpers";

const LEAVE_TYPES = [["Casual", "Casual leave"], ["Earned", "Earned leave"], ["Sick", "Sick leave"], ["Unpaid", "Leave without pay"]];
const fmtDays = (n) => String(Math.round(Number(n || 0) * 100) / 100);
const typeLabel = (t) => (LEAVE_TYPES.find(([v]) => v === t) || [t, t || "Leave"])[1];
// days between two dates, Sundays excluded
const workDays = (a, b) => { let n = 0; for (let d = new Date(`${a}T00:00:00`); d <= new Date(`${b}T00:00:00`); d.setDate(d.getDate() + 1)) { const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; if (d.getDay() !== 0 && !publicHolidayOn(iso)) n += 1; } return n; };

const STATUS_COLORS = {
  Pending: "bg-amber-100 text-amber-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Rejected: "bg-rose-100 text-rose-800",
};

export default function LeaveRequests({ profile }) {
  const isAdmin = ["admin", "hr", "gm", "pm", "tl"].includes(profile?.role); // anyone who reviews requests
  const [myRequests, setMyRequests] = useState([]);
  const [toApprove, setToApprove] = useState([]);
  const [employeeNames, setEmployeeNames] = useState({});
  const [reviewed, setReviewed] = useState([]);
  const [modal, setModal] = useState(false);
  const [balance, setBalance] = useState([]);

  const load = async () => {
    const [{ data: mine }, { data: all }, { data: employees }] = await Promise.all([
      profile?.employee_id
        ? supabase.from("leave_requests").select("*").eq("employee_id", profile.employee_id).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name"),
    ]);
    setMyRequests(mine || []);
    if (profile?.employee_id) {
      const { data: bal } = await supabase.rpc("leave_balance", { p_employee: profile.employee_id });
      setBalance(Array.isArray(bal) ? bal : []);
    }
    const names = {};
    (employees || []).forEach((e) => (names[e.id] = e.name));
    setEmployeeNames(names);
    // "to approve" = pending requests not from me, that RLS already scoped
    // to either my direct reports or (for admin/hr) everyone
    setToApprove((all || []).filter((r) => r.status === "Pending" && r.employee_id !== profile?.employee_id));
    setReviewed((all || []).filter((r) => r.status !== "Pending" && r.employee_id !== profile?.employee_id).slice(0, 15));
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("leave-requests-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leave_requests" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.employee_id]);

  const decide = async (req, status) => {
    const { error } = await supabase
      .from("leave_requests")
      .update({ status, reviewed_by: profile?.name || null, reviewed_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) alert(`Couldn't update:\n${error.message}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Leave Requests</h2>
        {profile?.employee_id && (
          <Btn onClick={() => setModal(true)}>
            <Plus size={15} /> Request leave
          </Btn>
        )}
      </div>

      {profile?.employee_id && (
        <div data-testid="leave-balance">
          <h3 className="font-semibold text-sm mb-2">My leave balance ({new Date().getFullYear()})</h3>
          <div className="grid grid-cols-3 gap-2">
            {(balance.length ? balance : LEAVE_TYPES.filter(([v]) => v !== "Unpaid").map(([v]) => ({ leave_type: v, entitled: 0, used: 0, pending: 0, balance: 0 }))).map((b) => b.leave_type === "Earned" ? (
              <Card key="Earned" className="p-3" data-type="Earned">
                <div className="text-[11px] text-stone-500">Earned leave ({quarterLabel(todayStr()).replace(/ \d{4}$/, "")})</div>
                <div className="text-2xl font-semibold font-mono">{fmtDays(b.entitled)}<span className="text-xs font-normal text-stone-400"> days</span></div>
                <div className="text-[11px] text-stone-400">Not applied for — paid as an attendance bonus if you have no leave or absence in the quarter</div>
              </Card>
            ) : (
              <Card key={b.leave_type} className="p-3" data-type={b.leave_type}>
                <div className="text-[11px] text-stone-500">{typeLabel(b.leave_type)}</div>
                <div className="text-2xl font-semibold font-mono">{fmtDays(b.balance)}<span className="text-xs font-normal text-stone-400"> left</span></div>
                <div className="text-[11px] text-stone-400">
                  {b.period === "accrual" ? `${fmtDays(b.entitled)} earned so far (${fmtDays(Number(b.yearly || 7) / 12)} a month)` : `${fmtDays(b.entitled)} a year`} · {fmtDays(b.used)} used{Number(b.pending) > 0 ? ` · ${fmtDays(b.pending)} pending` : ""}{b.leave_type === "Sick" ? " · max 2 a month" : ""}
                </div>
              </Card>
            ))}
          </div>
          <p className="text-[11px] text-stone-400 mt-1">Sundays are not counted as leave days. Casual leave is earned month by month (7 days over 12 months, counted from your joining month). Earned leave cannot be applied for: if you have no absent or leave day in a whole quarter, 4 days' salary is added to your pay in the first month of the next quarter as an attendance bonus.</p>
        </div>
      )}

      {(toApprove.length > 0 || isAdmin) && (
        <div>
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Clock size={14} /> Requests to review {toApprove.length > 0 && <span className="text-xs font-normal text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">{toApprove.length} pending</span>}
          </h3>
          <div className="grid gap-2">
            {toApprove.map((r) => (
              <Card key={r.id} className="p-3.5 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium text-sm">{employeeNames[r.employee_id] || "—"}</div>
                  <div className="text-xs text-stone-500">{r.start_date} → {r.end_date} · {typeLabel(r.leave_type)}{r.days != null ? ` · ${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}` : ""}{r.reason ? ` · ${r.reason}` : ""}</div>
                </div>
                <div className="flex gap-2">
                  <Btn variant="ghost" onClick={() => decide(r, "Rejected")}><X size={13} /> Reject</Btn>
                  <Btn onClick={() => decide(r, "Approved")}><Check size={13} /> Approve</Btn>
                </div>
              </Card>
            ))}
            {toApprove.length === 0 && <Card className="p-4 text-center text-stone-400 text-sm">Nothing pending right now.{profile?.role === "tl" ? " (You see requests from people who report to you.)" : ""}</Card>}
          </div>
        </div>
      )}

      {isAdmin && reviewed.length > 0 && (
        <div>
          <h3 className="font-semibold text-sm mb-2">Recently reviewed</h3>
          <div className="grid gap-2">
            {reviewed.map((r) => (
              <Card key={r.id} className="p-3 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-medium">{employeeNames[r.employee_id] || "—"}</div>
                  <div className="text-xs text-stone-500">{r.start_date} → {r.end_date} · {typeLabel(r.leave_type)}{r.days != null ? ` · ${Number(r.days)}d` : ""}{r.reviewed_by ? ` · by ${r.reviewed_by}` : ""}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {profile?.employee_id && (
        <div>
          <h3 className="font-semibold text-sm mb-2">My requests</h3>
          <div className="grid gap-2">
            {myRequests.map((r) => (
              <Card key={r.id} className="p-3.5 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm">{r.start_date} → {r.end_date} <span className="text-xs text-stone-500">· {typeLabel(r.leave_type)}{r.days != null ? ` · ${Number(r.days)} day${Number(r.days) === 1 ? "" : "s"}` : ""}</span></div>
                  {r.reason && <div className="text-xs text-stone-400">{r.reason}</div>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span>
              </Card>
            ))}
            {myRequests.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No leave requests yet.</Card>}
          </div>
        </div>
      )}

      {!profile?.employee_id && toApprove.length === 0 && !isAdmin && (
        <Card className="p-6 text-sm text-stone-600">
          Your login isn't linked to an employee record yet, so you can't submit leave requests here. Ask your admin to link your account.
        </Card>
      )}

      {modal && <RequestModal profile={profile} balance={balance} requests={myRequests} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

function RequestModal({ profile, balance, requests, onClose, onSaved }) {
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const days = endDate >= startDate ? workDays(startDate, endDate) : 0;
  const bal = (balance || []).find((b) => b.leave_type === leaveType);
  const unpaid = leaveType === "Unpaid";
  const left = unpaid ? Infinity : bal ? Number(bal.balance) : 0;
  // sick leave: at most 2 days in a month, and a request stays inside one month
  const sick = leaveType === "Sick";
  const monthOf = (d) => String(d).slice(0, 7);
  const sickTaken = sick ? (requests || []).filter((r) => r.leave_type === "Sick" && ["Approved", "Pending"].includes(r.status) && monthOf(r.start_date) === monthOf(startDate)).reduce((t, r) => t + Number(r.days || 0), 0) : 0;
  const sickCross = sick && monthOf(startDate) !== monthOf(endDate);
  const sickOver = sick && !sickCross && sickTaken + days > 2;
  const save = async (e) => {
    e.preventDefault();
    if (!leaveType) return alert("Choose the leave type.");
    if (endDate < startDate) return alert("The end date is before the start date.");
    if (days <= 0) return alert("These dates are only Sundays; no leave is needed.");
    if (sickCross) return alert("Sick leave: please raise a separate request for each month.");
    if (sickOver) return alert(`Sick leave is limited to 2 days a month (${sickTaken} already taken or pending in that month).`);
    if (days > left) return alert(`You have only ${left} day(s) of ${typeLabel(leaveType)} available.`);
    setSaving(true);
    const { error } = await supabase.from("leave_requests").insert({
      leave_type: leaveType,
      employee_id: profile.employee_id,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    });
    setSaving(false);
    if (error) {
      alert(`Couldn't submit:\n${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal title="Request leave" onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Leave type">
          <select required className={inputCls} value={leaveType} onChange={(e) => setLeaveType(e.target.value)} aria-label="Leave type">
            <option value="">— select the leave type —</option>
            {LEAVE_TYPES.filter(([v]) => v !== "Earned").map(([v, l]) => {
              const b = (balance || []).find((x) => x.leave_type === v);
              return <option key={v} value={v}>{v === "Unpaid" ? `${l} — salary is deducted` : `${l}${b ? ` — ${fmtDays(b.balance)} left` : ""}${v === "Sick" ? " (max 2 a month)" : ""}`}</option>;
            })}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <p className={`text-xs mb-2 ${leaveType && (days > left || sickOver || sickCross) ? "text-rose-600" : "text-stone-500"}`} data-testid="leave-days">
          {days} leave day{days === 1 ? "" : "s"} (Sundays and public holidays not counted){leaveType && !unpaid ? ` · ${fmtDays(left)} ${typeLabel(leaveType).toLowerCase()} left` : ""}{unpaid ? " · one day's salary (monthly ÷ 30) is deducted for each day" : ""}{leaveType && days > left ? " — not enough balance" : ""}{sickCross ? " — sick leave: one request per month" : sickOver ? ` — sick leave is limited to 2 days a month (${sickTaken} already this month)` : ""}
        </p>
        <Field label="Reason (optional)">
          <textarea rows={2} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit request"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
