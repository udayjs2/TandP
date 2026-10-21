import { useEffect, useRef, useState } from "react";
import { Bot, Send, FileBarChart, CalendarClock, MessageCircle, Loader2, Trash2, Plus, Sparkles } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, StatCard, Btn, Field, inputCls } from "./ui";
import ModuleShell from "./ModuleShell";
import ExportBar from "./ExportBar";
import { fmtCell } from "./ReportView";
import { todayStr } from "../lib/helpers";

async function callApi(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  let res;
  try {
    res = await fetch("/api/ai-manager", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the AI service. Check your internet connection.");
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !json) {
    if (res.status === 404 || !json) throw new Error("The AI service isn't available here. It runs on the deployed (Vercel) site, not in local development.");
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

const AGENTS = [
  { id: "management", label: "Management", icon: "📊", ask: ["What should I prioritise tomorrow?", "Why did production decrease this week?", "Which orders are delayed?", "How many employees attended today?"] },
  { id: "production", label: "Production", icon: "🏭", ask: ["Which production line is performing poorly?", "What are today's production output and plan vs actual?", "How much fabric is required for tomorrow's production?"] },
  { id: "hr", label: "HR & Attendance", icon: "👥", ask: ["How many employees attended today?", "Who is absent today, department-wise?"] },
  { id: "cutting", label: "Cutting", icon: "✂️", ask: ["How much fabric was used in cutting this week and what was wasted?", "How many cutting entries are pending review?"] },
  { id: "quality", label: "Quality", icon: "✅", ask: ["What is the defect rate this week and which checks fail most?", "Which orders have the most rejections?"] },
  { id: "inventory", label: "Inventory", icon: "📦", ask: ["Which accessories are running low?", "Do we have enough fabric for tomorrow?"] },
  { id: "finance", label: "Finance", icon: "💰", admin: true, ask: ["What is my factory's profit or loss this quarter?", "Which customers and orders are generating losses?", "What are today's production output and labour costs?"] },
  { id: "sales", label: "Sales", icon: "📈", admin: true, ask: ["How much commission should each salesperson receive?", "Which leads have overdue follow-ups?"] },
];

// tiny markdown: "- " bullets, **bold**, paragraphs
function Answer({ text }) {
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const blocks = String(text || "").split("\n").filter((l) => l.trim() !== "");
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`} className="list-disc pl-5 space-y-1">{list}</ul>); list = []; } };
  blocks.forEach((l, i) => {
    const m = l.match(/^\s*[-•*]\s+(.*)$/);
    if (m) list.push(<li key={i}>{bold(m[1])}</li>);
    else { flush(); out.push(<p key={i}>{bold(l)}</p>); }
  });
  flush();
  return <div className="space-y-2 text-sm text-stone-800">{out}</div>;
}

const TOOL_LABELS = { attendance_summary: "attendance", production_summary: "production output", orders_status: "orders", quality_summary: "quality", cutting_summary: "cutting", inventory_status: "inventory", fabric_required_tomorrow: "fabric forecast", finance_summary: "finance", order_profitability: "order profitability", sales_summary: "sales", commission_summary: "commission", query_table: "records" };

function Ask({ profile }) {
  const isAdmin = profile?.role === "admin";
  const agents = AGENTS.filter((a) => !a.admin || isAdmin);
  const [agent, setAgent] = useState("management");
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);
  const cur = agents.find((a) => a.id === agent) || agents[0];
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    const next = [...msgs, { role: "user", content: question }];
    setMsgs(next); setText(""); setBusy(true); setError("");
    try {
      const r = await callApi({ action: "chat", agent, messages: next.map(({ role, content }) => ({ role, content })) });
      setMsgs([...next, { role: "assistant", content: r.text, used: r.used, agent: cur.label }]);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => (
          <button key={a.id} onClick={() => setAgent(a.id)} className={`text-xs px-3 py-1.5 rounded-full border ${agent === a.id ? "bg-indigo-950 text-white border-indigo-950" : "bg-white text-stone-600 border-stone-200 hover:border-indigo-300"}`}>
            <span className="mr-1">{a.icon}</span>{a.label} Agent
          </button>
        ))}
      </div>
      <Card className="p-4 min-h-[320px] max-h-[60vh] overflow-y-auto space-y-4">
        {msgs.length === 0 && (
          <div className="text-sm text-stone-500 space-y-3">
            <p>Ask the <b>{cur.label} Agent</b> anything about your factory in plain language. Answers come from your live data.</p>
            <div className="flex flex-wrap gap-2">{cur.ask.map((q) => <button key={q} onClick={() => send(q)} className="text-xs text-left px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:border-indigo-300 text-stone-700">{q}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="bg-indigo-950 text-white text-sm rounded-2xl rounded-br-sm px-3.5 py-2 max-w-[85%]">{m.content}</div>
            ) : (
              <div className="max-w-[95%]">
                <div className="text-[11px] text-stone-400 mb-1 flex items-center gap-1"><Sparkles size={11} /> {m.agent}</div>
                <Answer text={m.content} />
                {m.used?.length > 0 && <div className="text-[11px] text-stone-400 mt-1.5">Data used: {m.used.map((u) => TOOL_LABELS[u] || u).join(", ")}</div>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-xs text-stone-500 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking your factory data…</div>}
        <div ref={endRef} />
      </Card>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Ask the ${cur.label} Agent…`} disabled={busy} />
        <Btn type="submit" disabled={busy || !text.trim()}><Send size={14} /> Ask</Btn>
        {msgs.length > 0 && <Btn variant="ghost" onClick={() => { setMsgs([]); setError(""); }}>New chat</Btn>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- daily factory report
function DailyReport() {
  const [date, setDate] = useState(todayStr());
  const [rep, setRep] = useState(null);
  const [recs, setRecs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError(""); setRecs(null);
    try { setRep(await callApi({ action: "report", date })); } catch (e) { setError(e.message); setRep(null); }
    setBusy(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date]);
  const getRecs = async () => {
    setRecBusy(true); setError("");
    try { setRecs((await callApi({ action: "recommend", date })).text); } catch (e) { setError(e.message); }
    setRecBusy(false);
  };
  const recLines = (recs || "").split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
  const buildReport = () => ({
    title: "T&P Textiles — Daily Factory Report", subtitle: date, filename: `daily-factory-report-${date}`,
    sections: [...(rep?.sections || []).map((s) => ({ heading: s.heading, kpis: s.kpis, bullets: s.bullets, table: s.table })), ...(recLines.length ? [{ heading: "F. AI recommendations", bullets: recLines }] : [])],
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <input type="date" className={inputCls + " w-auto"} value={date} max={todayStr()} onChange={(e) => setDate(e.target.value || todayStr())} />
        <div className="flex gap-2 items-center">{busy && <Loader2 size={15} className="animate-spin text-stone-400" />}<ExportBar buildReport={buildReport} disabled={!rep} /></div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {rep?.sections.map((s) => (
        <Card key={s.key} className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-stone-800">{s.heading}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{s.kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} />)}</div>
          {s.bullets && <ul className="text-sm text-stone-700 list-disc pl-5">{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          {s.table && s.table.rows.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr>{s.table.columns.map((c, i) => <th key={i} className={`px-3 py-2 text-xs uppercase ${c.type ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-stone-100">{s.table.rows.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} className={`px-3 py-1.5 ${s.table.columns[ci].type ? "text-right font-mono" : ""}`}>{fmtCell(s.table.columns[ci].type, v)}</td>)}</tr>)}</tbody>
            </table></div>
          )}
        </Card>
      ))}
      {rep && Object.keys(rep.errors || {}).length > 0 && <p className="text-xs text-amber-700">Some sections couldn't be built: {Object.keys(rep.errors).join(", ")}.</p>}
      {rep && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-stone-800">F. AI recommendations</h3>
            <Btn variant="ghost" onClick={getRecs} disabled={recBusy}>{recBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {recs ? "Refresh" : "Generate"}</Btn>
          </div>
          {recs ? <Answer text={recs} /> : <p className="text-xs text-stone-500">Which orders need attention, which team is behind, where wastage is high and what to prioritise tomorrow. Generated from the data above when you ask.</p>}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- scheduled reports
const SCHEDULE = [["9:00 AM", "Today's production priorities and material shortages"], ["1:00 PM", "Orders at risk of delay"], ["5:30 PM", "Daily production and attendance report"], ["Saturday 6:00 PM", "Weekly production, quality and labour productivity comparison"], ["Last day of month, 7:00 PM", "Monthly revenue, expenses and order profitability (Admin only)"]];
function Scheduled() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    supabase.from("ai_reports").select("id, kind, title, body, created_at").order("created_at", { ascending: false }).limit(40)
      .then(({ data, error: e }) => { if (e) setError(`${e.message} (run migration_43.sql if the table is missing)`); setRows(data || []); });
  }, []);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Automatic schedule (India time)</h3>
        <table className="w-full text-sm"><thead><tr><th className="text-left px-3 py-2 text-xs uppercase">When</th><th className="text-left px-3 py-2 text-xs uppercase">What the AI manager prepares</th></tr></thead>
          <tbody className="divide-y divide-stone-100">{SCHEDULE.map(([t, w]) => <tr key={t}><td className="px-3 py-1.5 whitespace-nowrap font-medium">{t}</td><td className="px-3 py-1.5">{w}</td></tr>)}</tbody></table>
        <p className="text-xs text-stone-400 mt-2">Sundays are skipped for the daily reports. Reports appear below and are also sent on WhatsApp to the numbers marked “receive reports”.</p>
      </Card>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {rows.map((r) => (
        <Card key={r.id} className="p-4">
          <button className="w-full text-left flex items-center justify-between gap-2" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span className="text-sm font-medium">{r.title}</span>
            <span className="text-xs text-stone-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </button>
          {open === r.id && <div className="mt-3 pt-3 border-t border-stone-100"><Answer text={r.body} /></div>}
        </Card>
      ))}
      {rows.length === 0 && !error && <Card className="p-8 text-center text-sm text-stone-400">No scheduled reports yet. They appear here after the first scheduled run.</Card>}
    </div>
  );
}

// ---------------------------------------------------------------- WhatsApp access (admin)
function WhatsApp() {
  const [users, setUsers] = useState([]);
  const [log, setLog] = useState([]);
  const [f, setF] = useState({ name: "", phone: "", role: "pm", receive_reports: false });
  const [error, setError] = useState("");
  const load = async () => {
    const [{ data: u, error: e }, { data: l }] = await Promise.all([
      supabase.from("ai_whatsapp_users").select("*").order("created_at"),
      supabase.from("ai_whatsapp_log").select("*").order("created_at", { ascending: false }).limit(15),
    ]);
    if (e) setError(`${e.message} (run migration_43.sql if the table is missing)`);
    setUsers(u || []); setLog(l || []);
  };
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault();
    const phone = f.phone.replace(/\D/g, "");
    if (phone.length < 10) return alert("Enter the number with country code, e.g. 919876543210.");
    const { error: err } = await supabase.from("ai_whatsapp_users").insert({ ...f, phone });
    if (err) return alert(err.message);
    setF({ name: "", phone: "", role: "pm", receive_reports: false }); load();
  };
  const patch = async (phone, p) => { await supabase.from("ai_whatsapp_users").update(p).eq("phone", phone); load(); };
  const del = async (phone) => { if (confirm("Remove this number?")) { await supabase.from("ai_whatsapp_users").delete().eq("phone", phone); load(); } };
  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-stone-600 space-y-1.5">
        <h3 className="text-sm font-semibold text-stone-800">Ask the AI manager on WhatsApp</h3>
        <p>Only the numbers below can ask questions or receive reports. Their role decides what the agent may read (Admin: everything; GM / PM: operations only, no finance or commission).</p>
        <p className="text-xs text-stone-500">Webhook URL for the WhatsApp Cloud API: <span className="font-mono">{window.location.origin}/api/whatsapp</span></p>
      </Card>
      <Card className="p-4">
        <form onSubmit={add} className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="Name"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="WhatsApp number (with country code)"><input required className={inputCls} placeholder="919876543210" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Role"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Admin</option><option value="gm">General Manager</option><option value="pm">Production Manager</option></select></Field>
          <label className="text-xs flex items-center gap-2 pb-2"><input type="checkbox" checked={f.receive_reports} onChange={(e) => setF({ ...f, receive_reports: e.target.checked })} /> Receive reports</label>
          <Btn type="submit"><Plus size={14} /> Add</Btn>
        </form>
      </Card>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>{["Name", "Number", "Role", "Reports", "Active", ""].map((h) => <th key={h} className="px-3 py-2.5 text-left text-xs uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((u) => (
              <tr key={u.phone}>
                <td className="px-3 py-2">{u.name}</td><td className="px-3 py-2 font-mono text-xs">{u.phone}</td><td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2"><input type="checkbox" checked={u.receive_reports} onChange={(e) => patch(u.phone, { receive_reports: e.target.checked })} /></td>
                <td className="px-3 py-2"><input type="checkbox" checked={u.active} onChange={(e) => patch(u.phone, { active: e.target.checked })} /></td>
                <td className="px-3 py-2 text-right"><button onClick={() => del(u.phone)} className="text-stone-400 hover:text-rose-700"><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-stone-400">No numbers added yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {log.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-stone-800 mb-2">Recent WhatsApp questions</h3>
          <div className="space-y-1.5">{log.map((l) => <div key={l.message_id} className="text-xs text-stone-600 border border-stone-200 rounded-lg px-3 py-1.5"><span className="font-mono text-stone-400">{l.phone}</span> — {l.question}</div>)}</div>
        </div>
      )}
    </div>
  );
}

export default function AiManager({ profile }) {
  const tabs = [
    { id: "ask", label: "Ask AI", icon: Bot, render: () => <Ask profile={profile} /> },
    { id: "report", label: "Daily Factory Report", icon: FileBarChart, render: () => <DailyReport /> },
    { id: "scheduled", label: "Scheduled Reports", icon: CalendarClock, render: () => <Scheduled /> },
    ...(profile?.role === "admin" ? [{ id: "whatsapp", label: "WhatsApp", icon: MessageCircle, render: () => <WhatsApp /> }] : []),
  ];
  return <ModuleShell title="AI Factory Manager" subtitle="Ask questions in plain language and get answers from your factory's live data — production, attendance, orders, quality, inventory, sales and profit." tabs={tabs} />;
}
