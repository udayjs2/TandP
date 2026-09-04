import { useEffect, useState } from "react";
import { Upload, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, inputCls, Btn, Modal } from "./ui";
import { daysInMonth, todayStr, computeShiftStats, suggestStatusFromHours } from "../lib/helpers";

const ATT_STATUSES = ["Present", "Absent", "Half Day", "Leave"];
const ATT_COLORS = {
  Present: "bg-emerald-100 text-emerald-800 border-emerald-300",
  Absent: "bg-rose-100 text-rose-800 border-rose-300",
  "Half Day": "bg-amber-100 text-amber-800 border-amber-300",
  Leave: "bg-stone-200 text-stone-700 border-stone-300",
};

export default function Attendance({ profile }) {
  const [employees, setEmployees] = useState([]);
  const [date, setDate] = useState(todayStr());
  const [dayRecord, setDayRecord] = useState({});
  const [monthCounts, setMonthCounts] = useState({});
  const [importOpen, setImportOpen] = useState(false);

  const mk = date.slice(0, 7);
  const totalDays = daysInMonth(mk);

  const loadEmployees = async () => {
    const { data } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
    setEmployees(data || []);
  };

  const loadDay = async () => {
    const { data } = await supabase.from("attendance").select("employee_id, status, check_in, check_out").eq("date", date);
    const rec = {};
    (data || []).forEach((r) => (rec[r.employee_id] = r));
    setDayRecord(rec);
  };

  const loadMonth = async () => {
    const start = `${mk}-01`;
    const end = `${mk}-${String(totalDays).padStart(2, "0")}`;
    const { data } = await supabase.from("attendance").select("employee_id, status").gte("date", start).lte("date", end);
    const counts = {};
    (data || []).forEach((r) => {
      const add = r.status === "Present" ? 1 : r.status === "Half Day" ? 0.5 : 0;
      counts[r.employee_id] = (counts[r.employee_id] || 0) + add;
    });
    setMonthCounts(counts);
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadDay();
    loadMonth();
    const ch = supabase
      .channel("attendance-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, () => {
        loadDay();
        loadMonth();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const setStatus = async (empId, status) => {
    const { error } = await supabase.from("attendance").upsert({ employee_id: empId, date, status }, { onConflict: "employee_id,date" });
    if (error) alert(`Couldn't save attendance:\n${error.message}`);
    loadDay();
    loadMonth();
  };

  const setTimes = async (empId, patch) => {
    const existing = dayRecord[empId] || {};
    const check_in = "check_in" in patch ? patch.check_in : existing.check_in;
    const check_out = "check_out" in patch ? patch.check_out : existing.check_out;
    const { hoursWorked } = computeShiftStats(check_in, check_out);
    const suggested = suggestStatusFromHours(hoursWorked);
    const status = suggested || existing.status || "Present";
    const { error } = await supabase
      .from("attendance")
      .upsert({ employee_id: empId, date, status, check_in: check_in || null, check_out: check_out || null }, { onConflict: "employee_id,date" });
    if (error) alert(`Couldn't save attendance:\n${error.message}`);
    loadDay();
    loadMonth();
  };

  const markAll = async (status) => {
    const rows = employees.map((e) => ({ employee_id: e.id, date, status }));
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "employee_id,date" });
    if (error) alert(`Couldn't save attendance:\n${error.message}`);
    loadDay();
    loadMonth();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Attendance</h2>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " w-auto"} />
          <Btn variant="ghost" onClick={() => markAll("Present")}>
            Mark all present
          </Btn>
          <Btn variant="ghost" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import from device
          </Btn>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">Employee</th>
              <th className="text-left px-4 py-2.5">Status ({date})</th>
              <th className="text-left px-4 py-2.5">Check-in</th>
              <th className="text-left px-4 py-2.5">Check-out</th>
              <th className="text-left px-4 py-2.5">Hours</th>
              <th className="text-right px-4 py-2.5">Present days this month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {employees.map((e) => {
              const rec = dayRecord[e.id] || {};
              const { hoursWorked, isLate, overtimeHours } = computeShiftStats(rec.check_in, rec.check_out);
              return (
                <tr key={e.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">
                    {e.name}
                    {e.department && <div className="text-xs text-stone-400 font-normal">{e.department}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {ATT_STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(e.id, s)}
                          className={`text-xs px-2 py-1 rounded-full border font-medium ${
                            rec.status === s ? ATT_COLORS[s] : "bg-white text-stone-400 border-stone-200 hover:border-stone-300"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="time"
                      className="border border-stone-300 rounded px-1.5 py-1 text-sm w-28"
                      defaultValue={rec.check_in || ""}
                      key={`in-${e.id}-${date}-${rec.check_in || ""}`}
                      onBlur={(ev) => setTimes(e.id, { check_in: ev.target.value || null })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="time"
                      className="border border-stone-300 rounded px-1.5 py-1 text-sm w-28"
                      defaultValue={rec.check_out || ""}
                      key={`out-${e.id}-${date}-${rec.check_out || ""}`}
                      onBlur={(ev) => setTimes(e.id, { check_out: ev.target.value || null })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {hoursWorked !== null ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs">{hoursWorked.toFixed(1)}h</span>
                        {isLate && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-rose-100 text-rose-800 rounded-full px-1.5 py-0.5">
                            <AlertTriangle size={9} /> Late
                          </span>
                        )}
                        {overtimeHours > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-sky-100 text-sky-800 rounded-full px-1.5 py-0.5">
                            <Clock size={9} /> +{overtimeHours.toFixed(1)}h OT
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {monthCounts[e.id] || 0} / {totalDays}
                  </td>
                </tr>
              );
            })}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Add employees first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-stone-400">
        Shift: 9:00 AM – 6:00 PM. A person needs at least 9 hours to count as a full Present day. Enter check-in/check-out
        times to auto-flag late arrivals and overtime — status still updates automatically but you can always override it manually.
      </p>
      {profile?.name && <p className="text-xs text-stone-400">Marking as {profile.name}</p>}

      {importOpen && <ImportModal employees={employees} onClose={() => setImportOpen(false)} onDone={() => { loadDay(); loadMonth(); }} />}
    </div>
  );
}

function ImportModal({ employees, onClose, onDone }) {
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const empByNumber = {};
  const empByName = {};
  employees.forEach((e) => {
    if (e.employee_number) empByNumber[e.employee_number.trim().toLowerCase()] = e;
    empByName[e.name.trim().toLowerCase()] = e;
  });

  const parse = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return { rows: [], errors: ["No data rows found."] };
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idIdx = header.findIndex((h) => h.includes("employee") || h === "id" || h === "empno" || h === "emp_no");
    const dateIdx = header.findIndex((h) => h.includes("date"));
    const inIdx = header.findIndex((h) => h.includes("in"));
    const outIdx = header.findIndex((h) => h.includes("out"));
    if (idIdx === -1 || dateIdx === -1) {
      return { rows: [], errors: ["Couldn't find an employee and date column. Expected headers like: employee_number, date, check_in, check_out"] };
    }
    const rows = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const idVal = (cols[idIdx] || "").toLowerCase();
      const dateVal = cols[dateIdx];
      const checkIn = inIdx > -1 ? cols[inIdx] : "";
      const checkOut = outIdx > -1 ? cols[outIdx] : "";
      const emp = empByNumber[idVal] || empByName[idVal];
      if (!emp) {
        errors.push(`Row ${i + 1}: no employee matches "${cols[idIdx]}"`);
        continue;
      }
      if (!dateVal) {
        errors.push(`Row ${i + 1}: missing date`);
        continue;
      }
      rows.push({ employee_id: emp.id, employee_name: emp.name, date: dateVal, check_in: checkIn || null, check_out: checkOut || null });
    }
    return { rows, errors };
  };

  const handlePreview = () => {
    setPreview(parse(csvText));
    setResult(null);
  };

  const handleImport = async () => {
    if (!preview || preview.rows.length === 0) return;
    setImporting(true);
    const upsertRows = preview.rows.map((r) => {
      const { hoursWorked } = computeShiftStats(r.check_in, r.check_out);
      const status = suggestStatusFromHours(hoursWorked) || "Present";
      return { employee_id: r.employee_id, date: r.date, check_in: r.check_in, check_out: r.check_out, status };
    });
    const { error } = await supabase.from("attendance").upsert(upsertRows, { onConflict: "employee_id,date" });
    setImporting(false);
    if (error) {
      setResult({ ok: false, message: error.message });
      return;
    }
    setResult({ ok: true, message: `Imported ${upsertRows.length} attendance record(s).` });
    onDone();
  };

  return (
    <Modal title="Import attendance from your biometric device" onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">
        Most biometric attendance software (ZKTeco, eSSL, Realtime, Matrix, etc.) can export a log to Excel/CSV. Save that
        export as CSV with columns for employee number (or name), date, check-in, and check-out, then paste the contents below.
      </p>
      <div className="bg-stone-50 border border-stone-200 rounded-lg p-2 mb-3 text-[11px] font-mono text-stone-500">
        employee_number,date,check_in,check_out
        <br />
        EMP-001,2026-09-03,09:05,18:20
        <br />
        EMP-002,2026-09-03,09:40,17:50
      </div>
      <textarea
        rows={6}
        className={inputCls + " font-mono text-xs"}
        placeholder="Paste CSV content here..."
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
      />
      <Btn variant="ghost" onClick={handlePreview} className="mt-2">
        Preview
      </Btn>

      {preview && (
        <div className="mt-3 border-t border-stone-200 pt-3">
          <p className="text-xs text-stone-600 mb-2">
            {preview.rows.length} row(s) ready to import{preview.errors.length > 0 && `, ${preview.errors.length} problem(s)`}.
          </p>
          {preview.errors.length > 0 && (
            <ul className="text-xs text-rose-600 mb-2 max-h-24 overflow-y-auto list-disc pl-4">
              {preview.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-xs mb-3">
              {preview.rows.slice(0, 10).map((r, i) => (
                <div key={i} className="flex justify-between border-b border-stone-100 py-1">
                  <span>{r.employee_name}</span>
                  <span className="text-stone-400">{r.date} · {r.check_in || "—"} → {r.check_out || "—"}</span>
                </div>
              ))}
              {preview.rows.length > 10 && <p className="text-stone-400 pt-1">…and {preview.rows.length - 10} more</p>}
            </div>
          )}
          {preview.rows.length > 0 && (
            <Btn onClick={handleImport} disabled={importing} className="w-full justify-center">
              {importing ? "Importing…" : `Import ${preview.rows.length} record(s)`}
            </Btn>
          )}
        </div>
      )}

      {result && (
        <p className={`text-xs mt-3 ${result.ok ? "text-emerald-700" : "text-rose-600"}`}>{result.message}</p>
      )}

      <div className="flex justify-end mt-4">
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
    </Modal>
  );
}
