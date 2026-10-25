import { useEffect, useRef, useState } from "react";
import { FileText, Copy, Check, Send, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Btn, inputCls } from "./ui";
import { todayStr } from "../lib/helpers";
import { productionText, cuttingText, salesText } from "../lib/dayReportText";
import { sizeLabel } from "./Cutting";

const istHour = () => Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
const TABS = [["production", "Production"], ["cutting", "Cutting"], ["sales", "Sales"]];

// Day-end report: Admin / GM / Production Manager generate it (it is also created automatically at 6 PM);
// everyone else can read and copy it.
export default function DayReport({ profile }) {
  const canGenerate = ["admin", "hr", "gm", "pm"].includes(profile?.role);
  const [date, setDate] = useState(todayStr());
  const [report, setReport] = useState(undefined); // undefined = loading, null = none yet
  const [tab, setTab] = useState("production");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");
  const tried = useRef(false);

  const load = async () => {
    const { data } = await supabase.from("day_reports").select("*").eq("report_date", date).maybeSingle();
    setReport(data || null);
    return data;
  };

  const generate = async (silent = false) => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("generate_day_report", { p_date: date, p_auto: false });
    setBusy(false);
    if (error || !data?.ok) {
      if (!silent) setMsg(data?.error || (error ? error.message + " (run migration_49.sql)" : "Could not generate the report"));
      return;
    }
    load();
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await load();
      // 6 PM rule: the first time a manager opens the app after 6 PM and today's report is missing, create it
      if (alive && !r && canGenerate && date === todayStr() && istHour() >= 18 && !tried.current) {
        tried.current = true;
        generate(true);
      }
    })();
    const ch = supabase.channel(`day-report-${date}`).on("postgres_changes", { event: "*", schema: "public", table: "day_reports" }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const text = !report ? "" : tab === "production" ? productionText(report.data) : tab === "cutting" ? cuttingText(report.data, sizeLabel) : salesText(report.data);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(tab); setTimeout(() => setCopied(""), 2000);
  };

  const when = report?.generated_at ? new Date(report.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><FileText size={14} className="text-indigo-700" /> Day-end report</h3>
        <div className="flex items-center gap-2">
          <input type="date" aria-label="Report date" className={`${inputCls} !w-auto !py-1`} value={date} max={todayStr()} onChange={(e) => { setReport(undefined); setDate(e.target.value); }} />
          {canGenerate && (
            <Btn onClick={() => generate(false)} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {report ? "Regenerate" : "Generate"} day report
            </Btn>
          )}
        </div>
      </div>
      {msg && <p className="text-xs text-rose-600 mb-2">{msg}</p>}
      {report === undefined ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : report === null ? (
        <p className="text-sm text-stone-500">
          No report for this day yet. {canGenerate ? "Click “Generate day report”, or it is created automatically at 6 PM." : "It is created at 6 PM every day by the Production Manager, General Manager or Admin."}
        </p>
      ) : (
        <>
          <p className="text-xs text-stone-400 mb-2">Generated {report.auto ? "automatically" : `by ${report.generated_by || "—"}`} · {when}</p>
          <div className="subtab-bar mb-2">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`subtab ${tab === id ? "subtab-active" : ""}`}>{label}</button>
            ))}
          </div>
          <pre className="text-xs bg-stone-50 border border-stone-200 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-auto" data-testid="report-text">{text}</pre>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Btn onClick={copy}>{copied === tab ? <Check size={14} /> : <Copy size={14} />} {copied === tab ? "Copied" : "Copy for WhatsApp"}</Btn>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
              <Send size={14} /> Open in WhatsApp
            </a>
          </div>
        </>
      )}
    </Card>
  );
}
