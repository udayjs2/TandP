import { useEffect, useState } from "react";
import { Users2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card } from "./ui";
import { todayStr, ROLE_LABELS } from "../lib/helpers";

const STATUS = {
  Present: "bg-emerald-100 text-emerald-800",
  "Half Day": "bg-amber-100 text-amber-800",
  Absent: "bg-rose-100 text-rose-800",
  Leave: "bg-sky-100 text-sky-800",
  "Not marked": "bg-stone-100 text-stone-500",
};
const isIn = (s) => s === "Present" || s === "Half Day";

function Chip({ s }) {
  return <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS[s] || STATUS["Not marked"]}`}>{s}</span>;
}

// One person: name, role and today's attendance.
function Person({ p, big = false }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${big ? "py-1" : "py-1 border-b border-stone-100 last:border-0"}`} data-person={p.name}>
      <div className="min-w-0">
        <div className={`${big ? "font-semibold" : "text-sm"} truncate`}>{p.name}</div>
        <div className="text-[11px] text-stone-400 truncate">{p.roleLabel}</div>
      </div>
      <Chip s={p.status} />
    </div>
  );
}

function Cell({ title, people, empty }) {
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-indigo-50 text-indigo-900 text-xs font-semibold uppercase tracking-wide px-3 py-1.5">{title}</div>
      <div className="px-3 py-1.5">
        {people.length === 0 ? <div className="text-xs text-stone-400 py-1">{empty || "Not set up"}</div> : people.map((p, i) => <Person key={`${p.name}-${i}`} p={p} big />)}
      </div>
    </div>
  );
}

// Team table: lead on top, then everyone reporting to them.
function TeamColumn({ title, lead, members }) {
  const present = members.filter((m) => isIn(m.status)).length;
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden bg-white min-w-[210px] w-[230px] shrink-0" data-team={title}>
      <div className="bg-indigo-50 px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-wide text-indigo-700">{title}</div>
        {lead ? <Person p={lead} big /> : <div className="text-xs text-stone-500 py-1">No lead set</div>}
      </div>
      <div className="px-3 py-1">
        <div className="flex justify-between text-[11px] text-stone-400 py-1"><span>Team members</span><span>{present}/{members.length} present</span></div>
        {members.length === 0 ? <div className="text-xs text-stone-400 py-1">No one reports here yet</div> : members.map((m) => <Person key={m.id || m.name} p={m} />)}
      </div>
    </div>
  );
}

// Dashboard "Teams working today": management, then each Team Lead's team, then Cutting / QC / Ironing.
export default function TeamsToday() {
  const [data, setData] = useState(null);

  const load = async () => {
    const today = todayStr();
    const [pr, em, at] = await Promise.all([
      supabase.from("profiles").select("id, name, role, employee_id"),
      supabase.from("employees").select("id, name, role, status, reporting_manager_id"),
      supabase.from("attendance").select("employee_id, status").eq("date", today),
    ]);
    setData({ profiles: pr.data || [], employees: (em.data || []).filter((e) => e.status !== "Inactive"), attendance: at.data || [] });
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("teams-today")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  if (!data) return null;
  const { profiles, employees, attendance } = data;
  const attBy = Object.fromEntries(attendance.map((a) => [a.employee_id, a.status]));
  const statusOf = (empId) => (empId && attBy[empId]) || "Not marked";
  const empById = Object.fromEntries(employees.map((e) => [e.id, e]));

  // a login (profile) as a person; attendance comes from the linked employee record
  const fromProfile = (pr) => {
    const e = pr.employee_id ? empById[pr.employee_id] : null;
    return { id: pr.employee_id || pr.id, empId: pr.employee_id, name: e?.name || pr.name || "—", roleLabel: ROLE_LABELS[pr.role] || pr.role, status: statusOf(pr.employee_id) };
  };
  const byRole = (...roles) => profiles.filter((p) => roles.includes(p.role)).map(fromProfile).sort((a, b) => a.name.localeCompare(b.name));
  const leadIds = new Set(profiles.filter((p) => ["gm", "pm", "hr", "tl", "cutting_master", "quality_manager", "qc", "ironing", "admin", "sales_manager"].includes(p.role) && p.employee_id).map((p) => p.employee_id));
  const reportsTo = (leaders) => {
    const ids = new Set(leaders.map((l) => l.empId).filter(Boolean));
    return employees
      .filter((e) => e.reporting_manager_id && ids.has(e.reporting_manager_id) && !leadIds.has(e.id))
      .map((e) => ({ id: e.id, name: e.name, roleLabel: e.role || "Operator", status: statusOf(e.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const gm = byRole("gm"), pm = byRole("pm"), hr = byRole("hr"), sales = byRole("sales_manager");
  const tls = byRole("tl");
  const tlTeams = tls.map((t) => ({ lead: t, members: reportsTo([t]) }));
  // operators who are not under any Team Lead
  const underTl = new Set(tlTeams.flatMap((t) => t.members.map((m) => m.id)));
  const loose = employees
    .filter((e) => e.role === "Production" && !underTl.has(e.id) && !leadIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, roleLabel: "Operator", status: statusOf(e.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const support = [
    ["Cutting team", byRole("cutting_master")],
    ["QC team", byRole("quality_manager", "qc")],
    ["Ironing team", byRole("ironing")],
    ["Sales team", sales],
  ].map(([title, leads]) => {
    const members = reportsTo(leads);
    if (title === "Ironing team") {
      // people with the Ironing employee role who report to nobody else
      const have = new Set(members.map((m) => m.id));
      employees.filter((e) => e.role === "Ironing" && !have.has(e.id) && !leadIds.has(e.id) && !underTl.has(e.id))
        .forEach((e) => members.push({ id: e.id, name: e.name, roleLabel: "Ironing", status: statusOf(e.id) }));
    }
    if (title === "Sales team") {
      // sales executives: those reporting to the Sales Manager, plus anyone with the Sales employee role
      const have = new Set(members.map((m) => m.id));
      employees.filter((e) => e.role === "Sales" && !have.has(e.id) && !leadIds.has(e.id))
        .forEach((e) => members.push({ id: e.id, name: e.name, roleLabel: "Sales", status: statusOf(e.id) }));
    }
    return { title, leads, members };
  });

  const everyone = [...gm, ...pm, ...hr, ...sales, ...tls, ...tlTeams.flatMap((t) => t.members), ...loose, ...support.flatMap((s) => [...s.leads, ...s.members])];
  const present = everyone.filter((p) => isIn(p.status)).length;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Users2 size={14} className="text-indigo-700" /> Teams working today</h3>
        <span className="text-xs text-stone-500">{present} of {everyone.length} present</span>
      </div>

      <div className="space-y-4" data-testid="teams-today">
        {/* management */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3"><Cell title="General Manager" people={gm} /></div>
          <Cell title="Production Manager" people={pm} />
          <Cell title="HR" people={hr} />
          <Cell title="Sales Manager" people={sales} />
        </div>

        {/* production teams */}
        <div>
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">
            Production — Team Leads and their teams{pm.length ? ` (under ${pm.map((p) => p.name).join(", ")})` : ""}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {tlTeams.map((t) => <TeamColumn key={t.lead.id} title="Team Lead" lead={t.lead} members={t.members} />)}
            {loose.length > 0 && <TeamColumn title="Not under a Team Lead" lead={null} members={loose} />}
            {tlTeams.length === 0 && loose.length === 0 && <p className="text-sm text-stone-400">No Team Leads or operators set up yet.</p>}
          </div>
        </div>

        {/* support teams */}
        <div>
          <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">Cutting, Quality, Ironing and Sales</div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {support.map((s) => (
              <TeamColumn key={s.title} title={s.title} lead={s.leads[0] || null} members={[...s.leads.slice(1), ...s.members]} />
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-stone-400 mt-2">Teams follow “Reports to” in Employees (Sales team: everyone with the Sales role). Attendance is today's; “Not marked” means it hasn't been recorded yet.</p>
    </Card>
  );
}
