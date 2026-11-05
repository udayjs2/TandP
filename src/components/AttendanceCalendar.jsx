import { monthCalendar } from "../lib/helpers";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL = {
  present: "bg-emerald-500 text-white",
  half: "bg-emerald-200 text-emerald-900",
  leave: "bg-amber-300 text-amber-950",
  absent: "bg-amber-300 text-amber-950",
  unmarked: "bg-amber-100 text-amber-900 border border-amber-300 border-dashed",
  sunday: "bg-stone-100 text-stone-400",
  future: "bg-white text-stone-300 border border-stone-100",
  before: "bg-white text-stone-200",
};
const TITLE = { present: "Present", half: "Half day", leave: "Leave", absent: "Absent", unmarked: "Not marked (counted absent)", sunday: "Sunday", future: "", before: "Before joining" };

// Month calendar: green = present, yellow = leave / absent / not marked
export default function AttendanceCalendar({ rows, mk, joined, today }) {
  const days = monthCalendar(rows, mk, today, joined);
  const lead = (days[0].dow + 6) % 7; // Monday first
  const off = days.filter((d) => ["leave", "absent", "unmarked"].includes(d.state));
  const fmt = (d) => `${d.day}`;
  return (
    <div data-testid="att-calendar">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-stone-500 mb-1">{WEEK.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <div key={"b" + i} />)}
        {days.map((d) => (
          <div key={d.date} data-date={d.date} data-state={d.state} title={`${d.date} — ${TITLE[d.state]}`} className={`h-9 rounded flex items-center justify-center text-sm font-medium ${CELL[d.state]}`}>{d.day}</div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-stone-600 mt-3">
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-emerald-500 inline-block" /> Present</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-emerald-200 inline-block" /> Half day</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-300 inline-block" /> Leave / Absent</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-100 border border-dashed border-amber-300 inline-block" /> Not marked</span>
        <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-stone-100 inline-block" /> Sunday</span>
      </div>
      <div className="text-sm mt-3" data-testid="att-off-dates">
        <span className="font-medium">Away on ({off.length}):</span>{" "}
        {off.length ? off.map((d) => `${fmt(d)}${d.state === "leave" ? " (leave)" : d.state === "absent" ? " (absent)" : " (not marked)"}`).join(", ") : <span className="text-stone-500">no leave or absent days</span>}
      </div>
    </div>
  );
}
