import { useEffect, useState } from "react";
import { Loader2, Search, PackageCheck } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Field, inputCls, Btn } from "./ui";
import { ORDER_STATUSES } from "../lib/helpers";

export default function TrackOrder() {
  const params = new URLSearchParams(window.location.search);
  const [orderNumber, setOrderNumber] = useState(params.get("order") || "");
  const [code, setCode] = useState(params.get("code") || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const lookup = async (e) => {
    e?.preventDefault();
    if (!orderNumber.trim() || !code.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    const { data, error: rpcError } = await supabase.rpc("public_order_status", {
      p_order_number: orderNumber.trim(),
      p_tracking_code: code.trim(),
    });
    setLoading(false);
    if (rpcError || !data) {
      setError("We couldn't find an order matching that number and tracking code. Please double-check and try again.");
      setResult(null);
      return;
    }
    setResult(data);
  };

  // auto-lookup if the link already has both params
  useEffect(() => {
    if (params.get("order") && params.get("code")) {
      lookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stageIndex = result ? ORDER_STATUSES.indexOf(result.status) : -1;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo-full.png" alt="T&P Textiles" className="h-20 w-auto mb-1" />
          <p className="text-stone-500 text-sm">Track your order</p>
        </div>

        <Card className="p-5 mb-4">
          <form onSubmit={lookup} className="grid sm:grid-cols-2 gap-3">
            <Field label="Order number">
              <input required className={inputCls} placeholder="e.g. ORD-0001" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </Field>
            <Field label="Tracking code">
              <input required className={inputCls} placeholder="e.g. 8f3a2c" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Btn type="submit" className="w-full justify-center" disabled={loading}>
                {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Check status
              </Btn>
            </div>
          </form>
          <p className="text-xs text-stone-400 mt-2">Both the order number and tracking code were shared with you by T&amp;P Textiles.</p>
        </Card>

        {searched && !loading && error && (
          <Card className="p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">{error}</Card>
        )}

        {result && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-lg">{result.order_number}</h2>
              <span className="text-xs text-stone-500">{result.customer_name}</span>
            </div>

            {/* stage tracker */}
            <div className="flex items-center mt-4 mb-5 overflow-x-auto">
              {ORDER_STATUSES.filter((s) => s !== "Shipped" || result.status === "Shipped").map((s, idx) => {
                const isDone = idx < stageIndex || (idx === stageIndex && s === "Completed");
                const isCurrent = idx === stageIndex;
                return (
                  <div key={s} className="flex items-center flex-1 min-w-[70px]">
                    <div className="flex flex-col items-center flex-1">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isCurrent ? "bg-indigo-900 text-white" : isDone ? "bg-emerald-500 text-white" : "bg-stone-200 text-stone-500"
                        }`}
                      >
                        {isDone && !isCurrent ? <PackageCheck size={12} /> : idx + 1}
                      </div>
                      <span className={`text-[10px] mt-1 text-center leading-tight ${isCurrent ? "font-semibold text-stone-900" : "text-stone-400"}`}>{s}</span>
                    </div>
                    {idx < ORDER_STATUSES.length - 1 && <div className={`h-0.5 flex-1 ${idx < stageIndex ? "bg-emerald-500" : "bg-stone-200"}`} />}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-stone-500 mb-5 text-center border-y border-stone-100 py-2">
              <div>
                <div className="text-stone-400">Ordered</div>
                <div className="font-medium text-stone-700">{result.order_date || "—"}</div>
              </div>
              <div>
                <div className="text-stone-400">Planned</div>
                <div className="font-medium text-stone-700">{result.planned_start_date || "—"} → {result.planned_end_date || "—"}</div>
              </div>
              <div>
                <div className="text-stone-400">Due</div>
                <div className="font-medium text-stone-700">{result.due_date || "—"}</div>
              </div>
            </div>

            <div className="text-xs font-semibold text-stone-600 uppercase mb-2">Items</div>
            <div className="space-y-3">
              {(result.items || []).map((it) => {
                const pct = it.required ? Math.min(100, (it.completed / it.required) * 100) : 0;
                return (
                  <div key={it.description}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{it.description}</span>
                      <span className="text-stone-500">{it.completed} / {it.required} completed</span>
                    </div>
                    <div className="h-2 bg-stone-100 rounded-full overflow-hidden mb-1">
                      <div className="h-full bg-indigo-700" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs text-stone-400">{it.delivered} delivered so far</div>
                  </div>
                );
              })}
              {(!result.items || result.items.length === 0) && <p className="text-sm text-stone-400">No item details available yet.</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
