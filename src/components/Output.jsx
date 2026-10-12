import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card } from "./ui";
import { sizeLabel } from "./Cutting";

// Compares approved cutting (per order + item, by size) against stitched
// pieces logged in the Orders tab's hourly production progress.
export default function Output() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: orders }, { data: cuts }, { data: prog }] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_name"),
      supabase.from("cutting_entries").select("order_id, item_description, sizes").eq("status", "Approved"),
      supabase.from("order_progress").select("order_id, item_description, quantity"),
    ]);

    const map = {}; // key: order_id||item
    (cuts || []).forEach((c) => {
      const k = `${c.order_id}||${c.item_description}`;
      map[k] ||= { order_id: c.order_id, item: c.item_description, sizes: {}, cut: 0, stitched: 0 };
      Object.entries(c.sizes || {}).forEach(([sz, q]) => {
        map[k].sizes[sz] = (map[k].sizes[sz] || 0) + Number(q || 0);
        map[k].cut += Number(q || 0);
      });
    });
    (prog || []).forEach((p) => {
      const k = `${p.order_id}||${p.item_description}`;
      if (map[k]) map[k].stitched += Number(p.quantity || 0); // only compare items that have cutting
    });

    const ordById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
    const list = Object.values(map)
      .map((r) => ({ ...r, order: ordById[r.order_id] }))
      .sort((a, b) => (a.order?.order_number || "").localeCompare(b.order?.order_number || ""));
    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("output-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "cutting_entries" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const matched = rows.filter((r) => r.cut === r.stitched).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Output</h2>
        <p className="text-xs text-stone-500 mt-0.5">
          Approved cutting vs pieces stitched (from order progress). Green = equal, red = not equal.
          {rows.length > 0 && ` ${matched} of ${rows.length} items match.`}
        </p>
      </div>

      <div className="grid gap-3">
        {rows.map((r) => {
          const equal = r.cut === r.stitched;
          const diff = r.stitched - r.cut;
          return (
            <Card key={`${r.order_id}${r.item}`} className={`p-4 border-l-4 ${equal ? "border-l-emerald-500" : "border-l-rose-500"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{r.order ? `${r.order.order_number} — ${r.order.customer_name}` : "Unknown order"}</div>
                  <div className="text-xs text-stone-500">{r.item}</div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right">
                    <div className="text-[11px] text-stone-400 uppercase">Cut</div>
                    <div className="font-mono font-semibold">{r.cut}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-stone-400 uppercase">Stitched</div>
                    <div className={`font-mono font-semibold ${equal ? "text-emerald-700" : "text-rose-700"}`}>{r.stitched}</div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${equal ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                    {equal ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {equal ? "Matched" : diff < 0 ? `${-diff} pcs short` : `${diff} pcs extra`}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(r.sizes).map(([sz, q]) => (
                  <span key={sz} className="text-xs bg-stone-100 text-stone-700 rounded px-2 py-0.5">
                    {sizeLabel(sz)}: <span className="font-mono">{q}</span>
                  </span>
                ))}
              </div>
            </Card>
          );
        })}
        {!loading && rows.length === 0 && (
          <Card className="p-8 text-center text-stone-400 text-sm">No approved cutting entries yet. Output appears once cutting is approved.</Card>
        )}
      </div>
    </div>
  );
}
