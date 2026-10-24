import { useEffect, useState } from "react";
import { AlertTriangle, X, Settings2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Field, inputCls, Btn } from "./ui";

const KIND_LABEL = {
  delivery: "Delivery",
  target: "Production target",
  material: "Fabric / accessories",
  quality: "Quality",
  machine: "Machine",
  cost: "Cost",
};

// Red scrolling alert bar for the Dashboard — Production Manager, General Manager and Admin.
// The alerts are computed by the database (factory_alerts) from live data, so they clear by themselves once fixed.
export default function AlertTicker({ profile }) {
  const allowed = ["admin", "gm", "pm"].includes(profile?.role);
  const [alerts, setAlerts] = useState(null);
  const [open, setOpen] = useState(false);
  const [limits, setLimits] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc("factory_alerts");
    if (error) {
      console.error("factory_alerts:", error.message);
      setAlerts((a) => a || []);
      return;
    }
    setAlerts(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    if (!allowed) return undefined;
    load();
    const t = setInterval(load, 120000); // refresh every 2 minutes
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  if (!allowed || alerts === null) return null;

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <span>No active alerts — deliveries, targets, material, quality, machines and costs are within limits.</span>
        {profile.role === "admin" && <button onClick={() => setLimits(true)} className="underline font-medium">Alert limits</button>}
        {limits && <LimitsModal onClose={() => { setLimits(false); load(); }} profile={profile} />}
      </div>
    );
  }

  const escalated = alerts.filter((a) => a.escalated).length;
  // the list is shown twice so the loop scrolls without a gap
  const strip = alerts.map((a) => (
    <span key={a.key} className="inline-flex items-center gap-2 mx-8 whitespace-nowrap">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      {a.escalated && <b className="bg-white text-red-700 text-[10px] rounded px-1.5 py-0.5">ESCALATED</b>}
      <b>{KIND_LABEL[a.kind] || a.kind}:</b> {a.message}
    </span>
  ));

  return (
    <div data-testid="alert-ticker">
      <style>{`
        @keyframes tp-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .tp-ticker-track { display: inline-flex; animation: tp-scroll ${Math.max(25, alerts.length * 14)}s linear infinite; }
        .tp-ticker:hover .tp-ticker-track { animation-play-state: paused; }
      `}</style>
      <div className="flex items-stretch rounded-lg overflow-hidden border border-red-700 bg-red-600 text-white shadow-sm">
        <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 bg-red-800 px-3 py-2 text-xs font-bold whitespace-nowrap hover:bg-red-900" title="Open the full list">
          <AlertTriangle size={14} /> {alerts.length} ALERT{alerts.length === 1 ? "" : "S"}{escalated > 0 ? ` · ${escalated} ESCALATED` : ""}
        </button>
        <div className="tp-ticker flex-1 overflow-hidden py-2 text-sm cursor-pointer" onClick={() => setOpen(true)}>
          <div className="tp-ticker-track">{strip}{strip}</div>
        </div>
      </div>

      {open && (
        <Modal title={`Active alerts (${alerts.length})`} onClose={() => setOpen(false)}>
          <p className="text-[11px] text-stone-500 mb-3">
            Sent to the Production Manager, General Manager and Admin. An alert that stays open for a day or more is marked ESCALATED. They clear automatically once the problem is fixed.
          </p>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.key} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide">
                  <span>{KIND_LABEL[a.kind] || a.kind}{a.order_number ? ` · ${a.order_number}` : ""}</span>
                  <span>{a.escalated ? "ESCALATED · " : ""}open {a.age_hours >= 48 ? `${Math.round(a.age_hours / 24)} days` : a.age_hours >= 1 ? `${Math.round(a.age_hours)} h` : "just now"}</span>
                </div>
                <div className="mt-0.5">{a.message}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4">
            {profile.role === "admin" ? <Btn variant="ghost" onClick={() => { setOpen(false); setLimits(true); }}><Settings2 size={13} /> Alert limits</Btn> : <span />}
            <Btn variant="ghost" onClick={() => setOpen(false)}><X size={13} /> Close</Btn>
          </div>
        </Modal>
      )}
      {limits && <LimitsModal onClose={() => { setLimits(false); load(); }} profile={profile} />}
    </div>
  );
}

function LimitsModal({ onClose, profile }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    supabase.from("alert_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) =>
      setF(data || { defect_limit_pct: 5, cost_overrun_pct: 0, target_shortfall_pct: 20, low_stock_qty: 20, escalate_after_hours: 24 })
    );
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const row = {
      id: 1,
      defect_limit_pct: Number(f.defect_limit_pct) || 0,
      cost_overrun_pct: Number(f.cost_overrun_pct) || 0,
      target_shortfall_pct: Number(f.target_shortfall_pct) || 0,
      low_stock_qty: Number(f.low_stock_qty) || 0,
      escalate_after_hours: Number(f.escalate_after_hours) || 24,
      updated_by: profile?.name || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("alert_settings").upsert(row);
    setSaving(false);
    if (error) return alert(`Couldn't save:\n${error.message}`);
    onClose();
  };
  return (
    <Modal title="Alert limits (Admin)" onClose={onClose}>
      {!f ? <p className="text-sm text-stone-500">Loading…</p> : (
        <form onSubmit={save}>
          <Field label="Approved quality defect limit (% of inspected pieces)"><input type="number" min="0" step="any" className={inputCls} value={f.defect_limit_pct} onChange={set("defect_limit_pct")} /></Field>
          <Field label="Cost tolerance above the approved estimate (%)"><input type="number" min="0" step="any" className={inputCls} value={f.cost_overrun_pct} onChange={set("cost_overrun_pct")} /></Field>
          <Field label="Alert when output is this % below the pro-rated daily target"><input type="number" min="0" max="100" step="any" className={inputCls} value={f.target_shortfall_pct} onChange={set("target_shortfall_pct")} /></Field>
          <Field label="Accessories count as insufficient at or below (quantity)"><input type="number" min="0" step="any" className={inputCls} value={f.low_stock_qty} onChange={set("low_stock_qty")} /></Field>
          <Field label="Mark an alert ESCALATED after (hours)"><input type="number" min="1" step="any" className={inputCls} value={f.escalate_after_hours} onChange={set("escalate_after_hours")} /></Field>
          <div className="flex justify-end gap-2 mt-3">
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save limits"}</Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}
