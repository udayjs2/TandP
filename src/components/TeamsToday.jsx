import { useEffect, useState } from "react";
import { Users2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card } from "./ui";
import { todayStr } from "../lib/helpers";
import { peopleOf } from "../lib/orgRoles";

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

// Dashboard "Teams working today". Built from Employees: each person's Role says where they sit, and Reports to
// says whose team they are in. Layout: General Manager (with Cutting), Management Team (Production Manager, HR,
// Sales Manager), Production Manager's Team Leads + Quality + Ironing, then HR and Sales teams and everyone else.
export default function TeamsToday() {
  const [data, setData] = useState(null);

  const load = async () => {
    const today = todayStr();
    const [pr, em, at] = await Promise.all([
      supabase.from("profiles").select("id, name, role, employee_id"),
      supabase.from("employees").select("id, name, role, department, status, reporting_manager_id"),
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
  const org = { employees, profiles };

  const person = (x) => ({ id: x.empId || x.id, empId: x.empId, name: x.name, roleLabel: x.empRole || empById[x.empId]?.role || "", status: statusOf(x.empId) });
  const fromEmp = (e) => ({ id: e.id, empId: e.id, name: e.name, roleLabel: e.role || "", status: statusOf(e.id) });
  const lead = (roles, logins, label) => peopleOf(org, roles, logins).map((x) => ({ ...person(x), roleLabel: x.empRole || label })).sort((a, b) => a.name.localeCompare(b.name));
  const byName = (a, b) => a.name.localeCompare(b.name);

  const placed = new Set();
  const take = (list) => { list.forEach((x) => x.empId && placed.add(x.empId)); return list; };

  const gm = take(lead(["General Manager"], ["gm"], "General Manager"));
  const pm = take(lead(["Production Manager"], ["pm"], "Production Manager"));
  const hr = take(lead(["HR Manager"], ["hr"], "HR Manager"));
  const sm = take(lead(["Sales Manager"], ["sales_manager"], "Sales Manager"));
  const tls = take(lead(["Team Lead"], ["tl"], "Team Lead"));
  const cutLeads = take(lead(["Cutting Master"], ["cutting_master"], "Cutting Master"));
  const qualLeads = take(lead(["Quality Manager"], ["quality_manager"], "Quality Manager"));
  const ironLeads = take(peopleOf({ employees, profiles }, [], ["ironing"]).map((x) => ({ ...person(x), roleLabel: "Ironing lead" })));

  const reporting = (leaders) => {
    const ids = new Set(leaders.map((l) => l.empId).filter(Boolean));
    return employees.filter((e) => e.reporting_manager_id && ids.has(e.reporting_manager_id) && !placed.has(e.id));
  };
  const claim = (list) => { const seen = new Set(); const uniq = list.filter((e) => !seen.has(e.id) && seen.add(e.id)); uniq.forEach((e) => placed.add(e.id)); return uniq.map(fromEmp).sort(byName); };

  const tlTeams = tls.map((t) => ({ lead: t, members: claim(reporting([t])) }));
  const cutMembers = claim([...reporting(cutLeads), ...employees.filter((e) => !placed.has(e.id) && (e.role === "Cutter" || e.department === "Cutting"))]);
  const qualMembers = claim([...reporting(qualLeads), ...employees.filter((e) => !placed.has(e.id) && e.role === "Quality Executive")]);
  const ironMembers = claim([...reporting(ironLeads), ...employees.filter((e) => !placed.has(e.id) && (e.role === "Ironing" || e.department === "Ironing & Packing"))]);
  const hrMembers = claim([...reporting(hr), ...employees.filter((e) => !placed.has(e.id) && e.role === "HR Executive")]);
  const salesMembers = claim([...reporting(sm), ...employees.filter((e) => !placed.has(e.id) && ["Sales Executive", "Sales"].includes(e.role))]);
  const loose = claim(employees.filter((e) => !placed.has(e.id) && (["Operator", "Production"].includes(e.role) || e.department === "Production")));
  // everyone else, by department
  const rest = {};
  employees.filter((e) => !placed.has(e.id)).forEach((e) => { (rest[e.department || "No department"] ||= []).push(fromEmp(e)); });

  const everyone = [...gm, ...pm, ...hr, ...sm, ...tls, ...cutLeads, ...qualLeads, ...ironLeads, ...tlTeams.flatMap((t) => t.members), ...cutMembers, ...qualMembers, ...ironMembers, ...hrMembers, ...salesMembers, ...loose, ...Object.values(rest).flat()];
  const present = everyone.filter((p) => isIn(p.status)).length;
  const Row = ({ children }) => <div className="flex gap-3 overflow-x-auto pb-2">{children}</div>;
  const Heading = ({ children }) => <div className="text-xs font-semibold text-stone-600 uppercase tracking-wide mb-1.5">{children}</div>;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Users2 size={14} className="text-indigo-700" /> Teams working today</h3>
        <span className="text-xs text-stone-500">{present} of {everyone.length} present</span>
      </div>

      <div className="space-y-4" data-testid="teams-today">
        <Cell title="General Manager" people={gm} />
        <div>
          <Heading>Cutting — reports to the General Manager{gm.length ? ` (${gm.map((p) => p.name).join(", ")})` : ""}</Heading>
          <Row><TeamColumn title="Cutting team" lead={cutLeads[0] || null} members={[...cutLeads.slice(1), ...cutMembers]} /></Row>
        </div>

        <div>
          <Heading>Management Team{gm.length ? ` — under ${gm.map((p) => p.name).join(", ")} (General Manager)` : ""}</Heading>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Cell title="Production Manager" people={pm} />
            <Cell title="HR" people={hr} />
            <Cell title="Sales Manager" people={sm} />
          </div>
        </div>

        <div>
          <Heading>Under the Production Manager{pm.length ? ` (${pm.map((p) => p.name).join(", ")})` : ""} — Team Leads, Quality and Ironing</Heading>
          <Row>
            {tlTeams.map((t) => <TeamColumn key={t.lead.id} title="Team Lead" lead={t.lead} members={t.members} />)}
            {loose.length > 0 && <TeamColumn title="Not under a Team Lead" lead={null} members={loose} />}
            <TeamColumn title="Quality team" lead={qualLeads[0] || null} members={[...qualLeads.slice(1), ...qualMembers]} />
            <TeamColumn title="Ironing team" lead={ironLeads[0] || null} members={[...ironLeads.slice(1), ...ironMembers]} />
          </Row>
        </div>

        <div>
          <Heading>HR and Sales teams</Heading>
          <Row>
            <TeamColumn title="HR team" lead={hr[0] || null} members={[...hr.slice(1), ...hrMembers]} />
            <TeamColumn title="Sales team" lead={sm[0] || null} members={[...sm.slice(1), ...salesMembers]} />
          </Row>
        </div>

        {Object.keys(rest).length > 0 && (
          <div>
            <Heading>Other staff</Heading>
            <Row>{Object.entries(rest).map(([dept, list]) => <TeamColumn key={dept} title={dept} lead={null} members={list} />)}</Row>
          </div>
        )}
      </div>
      <p className="text-[11px] text-stone-400 mt-2">Built from Employees: Role places a person in the chart and “Reports to” puts them in a team. “Not marked” means today's attendance has not been recorded yet.</p>
    </Card>
  );
}
