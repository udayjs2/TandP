import { useEffect, useState } from "react";
import { supabase, fetchAll } from "../lib/fetchAll";
import { Card, StatCard } from "./ui";
import { FEEDBACK_ITEMS, DELAY_CAUSES } from "../lib/helpers";

// Insights -> "Feedback & delays": what customers said, and why late orders were late.
export default function CustomerInsights() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [fb, rca, orders] = await Promise.all([
          fetchAll(() => supabase.from("order_feedback").select("*").order("submitted_at", { ascending: false })),
          fetchAll(() => supabase.from("order_delay_rca").select("*").order("submitted_at", { ascending: false })),
          fetchAll(() => supabase.from("orders").select("id, order_number, customer_name, due_date").order("id")),
        ]);
        setData({ fb, rca, orders: Object.fromEntries(orders.map((o) => [o.id, o])) });
      } catch (e) {
        setError((e.message || String(e)) + " (run migration_38.sql if the tables are missing)");
      }
    })();
  }, []);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="text-sm text-stone-500">Loading…</p>;

  const { fb, rca, orders } = data;
  const avg = (key) => {
    const v = fb.map((f) => Number(f.ratings?.[key])).filter((n) => n > 0);
    return v.length ? { value: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null;
  };
  const overall = avg("overall");
  const count = (field, val) => fb.filter((f) => f[field] === val).length;
  const causeStats = DELAY_CAUSES.map((c) => {
    const hits = rca.flatMap((r) => (r.causes || []).filter((x) => x.cause === c));
    return { cause: c, orders: hits.length, days: hits.reduce((s, x) => s + (Number(x.days) || 0), 0) };
  }).filter((c) => c.orders > 0).sort((a, b) => b.orders - a.orders);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-semibold">Customer feedback</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Responses" value={String(fb.length)} />
          <StatCard label="Overall rating" value={overall ? `${overall.value.toFixed(1)} / 5` : "—"} tone={overall && overall.value < 3.5 ? "bad" : "good"} />
          <StatCard label="Delivered late" value={String(count("delivery_timing", "Slightly delayed") + count("delivery_timing", "Very delayed"))} sub={`${count("delivery_timing", "On time")} on time`} tone="warn" />
          <StatCard label="Would reorder" value={String(count("would_reorder", "Yes"))} sub={`${count("would_reorder", "No")} said no`} />
        </div>
        <Card className="p-4">
          <div className="space-y-2">
            {FEEDBACK_ITEMS.map(([k, label]) => {
              const a = avg(k);
              return (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-56 shrink-0">{label}</span>
                  <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                    {a && <div className={`h-full ${a.value < 3 ? "bg-rose-500" : a.value < 4 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${(a.value / 5) * 100}%` }} />}
                  </div>
                  <span className="w-20 text-right font-mono text-xs">{a ? `${a.value.toFixed(1)} (${a.n})` : "—"}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <div className="grid gap-2">
          {fb.map((f) => {
            const o = orders[f.order_id];
            return (
              <Card key={f.id} className="p-3.5 text-sm">
                <div className="flex justify-between gap-2 flex-wrap">
                  <span className="font-medium">{o?.order_number || "—"} <span className="font-normal text-stone-500">{o?.customer_name}{f.respondent_name ? ` · ${f.respondent_name}` : ""}</span></span>
                  <span className="text-xs text-stone-400">{new Date(f.submitted_at).toLocaleDateString("en-IN")} · {f.delivery_timing || "—"} · reorder: {f.would_reorder || "—"}</span>
                </div>
                {f.issues && <div className="mt-1 text-rose-700">Problems: {f.issues}</div>}
                {f.comments && <div className="mt-1 text-stone-600">“{f.comments}”</div>}
              </Card>
            );
          })}
          {fb.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No feedback yet. Send the feedback link from the star icon on a completed order.</Card>}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Why orders were late (RCA)</h3>
        {causeStats.length > 0 && (
          <Card className="p-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-stone-500 uppercase"><tr><th className="text-left py-1">Reason</th><th className="text-right">Orders</th><th className="text-right">Days lost</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {causeStats.map((c) => <tr key={c.cause}><td className="py-1.5">{c.cause}</td><td className="text-right font-mono">{c.orders}</td><td className="text-right font-mono">{c.days || "—"}</td></tr>)}
              </tbody>
            </table>
          </Card>
        )}
        <div className="grid gap-2">
          {rca.map((r) => {
            const o = orders[r.order_id];
            return (
              <Card key={r.id} className="p-3.5 text-sm">
                <div className="flex justify-between gap-2 flex-wrap">
                  <span className="font-medium">{o?.order_number || "—"} <span className="font-normal text-stone-500">{o?.customer_name}</span></span>
                  <span className="text-xs text-rose-700">{r.days_late ?? "?"} days late · {(r.causes || []).map((c) => c.cause).join(", ")}</span>
                </div>
                <div className="mt-1"><b>Root cause:</b> {r.root_cause}</div>
                <div className="mt-0.5"><b>Lessons learned:</b> {r.lessons_learned}</div>
                {r.corrective_action && <div className="mt-0.5 text-stone-600"><b>Action:</b> {r.corrective_action}</div>}
                <div className="text-xs text-stone-400 mt-1">{r.submitted_by_name || ""} · {new Date(r.submitted_at).toLocaleDateString("en-IN")}</div>
              </Card>
            );
          })}
          {rca.length === 0 && <Card className="p-6 text-center text-stone-400 text-sm">No delay RCAs submitted yet.</Card>}
        </div>
      </section>
    </div>
  );
}
