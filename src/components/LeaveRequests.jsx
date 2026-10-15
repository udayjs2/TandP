import { useEffect, useState } from "react";
import { Plus, Check, X, Clock } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr } from "../lib/helpers";

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

  const load = async () => {
    const [{ data: mine }, { data: all }, { data: employees }] = await Promise.all([
      profile?.employee_id
        ? supabase.from("leave_requests").select("*").eq("employee_id", profile.employee_id).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("employees").select("id, name"),
    ]);
    setMyRequests(mine || []);
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
                  <div className="text-xs text-stone-500">{r.start_date} → {r.end_date}{r.reason ? ` · ${r.reason}` : ""}</div>
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
                  <div className="text-xs text-stone-500">{r.start_date} → {r.end_date}{r.reviewed_by ? ` · by ${r.reviewed_by}` : ""}</div>
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
                  <div className="text-sm">{r.start_date} → {r.end_date}</div>
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

      {modal && <RequestModal profile={profile} onClose={() => setModal(false)} onSaved={load} />}
    </div>
  );
}

function RequestModal({ profile, onClose, onSaved }) {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("leave_requests").insert({
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
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
