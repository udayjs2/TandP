import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, orderItemsRequired, computeOrderProjection } from "../lib/helpers";

export default function Planner() {
  const [orders, setOrders] = useState([]);
  const [progressByOrder, setProgressByOrder] = useState({});
  const [rates, setRates] = useState([]);
  const [totalWorkforce, setTotalWorkforce] = useState(0);
  const [rateModal, setRateModal] = useState(null);
  const [workforceEditing, setWorkforceEditing] = useState(false);
  const [workforceDraft, setWorkforceDraft] = useState("");

  const load = async () => {
    const [{ data: ord }, { data: prog }, { data: rateRows }, { data: settings }] = await Promise.all([
      supabase.from("orders").select("*").not("status", "in", "(Completed,Shipped)").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("order_progress").select("order_id, item_description, quantity"),
      supabase.from("garment_rates").select("*").order("garment_type", { ascending: true }),
      supabase.from("settings").select("total_workforce").eq("id", 1).single(),
    ]);
    setOrders(ord || []);
    const byOrder = {};
    (prog || []).forEach((p) => {
      byOrder[p.order_id] = byOrder[p.order_id] || {};
      byOrder[p.order_id][p.item_description] = (byOrder[p.order_id][p.item_description] || 0) + Number(p.quantity || 0);
    });
    setProgressByOrder(byOrder);
    setRates(rateRows || []);
    setTotalWorkforce(Number(settings?.total_workforce) || 0);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("planner-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_progress" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "garment_rates" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const updateResources = async (orderId, value) => {
    await supabase.from("orders").update({ planned_resources: Number(value) || 0 }).eq("id", orderId);
    load();
  };

  const saveRate = async (rate) => {
    if (rate.id) {
      const { id, ...rest } = rate;
      await supabase.from("garment_rates").update(rest).eq("id", id);
    } else {
      const { id, ...rest } = rate;
      await supabase.from("garment_rates").insert(rest);
    }
    setRateModal(null);
    load();
  };

  const removeRate = async (id) => {
    if (!confirm("Remove this garment rate?")) return;
    await supabase.from("garment_rates").delete().eq("id", id);
    load();
  };

  const saveWorkforce = async () => {
    await supabase.from("settings").update({ total_workforce: Number(workforceDraft) || 0 }).eq("id", 1);
    setWorkforceEditing(false);
    load();
  };

  const today = todayStr();
  const projections = orders.map((o) => ({
    order: o,
    projection: computeOrderProjection(o, progressByOrder[o.id] || {}, rates, today),
  }));
  const assignedTotal = orders.reduce((s, o) => s + (Number(o.planned_resources) || 0), 0);
  const latestCompletion = projections
    .map((p) => p.projection.projectedCompletionDate)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Production Planner</h2>
        <p className="text-xs text-stone-500">
          Projects how many days each order needs and when it'll finish, based on remaining items, your per-garment
          production rates, and how many people are assigned to it.
        </p>
      </div>

      {/* Capacity summary */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-xs text-stone-500 uppercase">Total workforce</div>
              {workforceEditing ? (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="number"
                    min="0"
                    className={inputCls + " w-20"}
                    value={workforceDraft}
                    onChange={(e) => setWorkforceDraft(e.target.value)}
                    autoFocus
                  />
                  <Btn onClick={saveWorkforce}>Save</Btn>
                </div>
              ) : (
                <button
                  className="text-lg font-mono font-semibold hover:underline"
                  onClick={() => {
                    setWorkforceDraft(totalWorkforce || "");
                    setWorkforceEditing(true);
                  }}
                >
                  {totalWorkforce || "Set"} people
                </button>
              )}
            </div>
            <div>
              <div className="text-xs text-stone-500 uppercase">Currently assigned</div>
              <div className={`text-lg font-mono font-semibold ${totalWorkforce > 0 && assignedTotal > totalWorkforce ? "text-rose-700" : ""}`}>
                {assignedTotal} people
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 uppercase">Busy until</div>
              <div className="text-lg font-mono font-semibold">{latestCompletion || "—"}</div>
            </div>
          </div>
          {totalWorkforce > 0 && assignedTotal > totalWorkforce && (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-rose-100 text-rose-800 rounded-full px-2.5 py-1">
              <AlertTriangle size={12} /> Over-assigned by {assignedTotal - totalWorkforce}
            </span>
          )}
        </div>
      </Card>

      {/* Garment rates */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Garment production rates</h3>
          <Btn variant="ghost" onClick={() => setRateModal({})}>
            <Plus size={14} /> Add rate
          </Btn>
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Garment type</th>
                <th className="text-right px-4 py-2">Pieces / day / person</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rates.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2">{r.garment_type}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.pieces_per_day_per_person}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setRateModal(r)} className="text-stone-400 hover:text-indigo-700 p-1"><Pencil size={13} /></button>
                      <button onClick={() => removeRate(r.id)} className="text-stone-400 hover:text-rose-700 p-1"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-stone-400 text-sm">
                    No rates set yet. Add one for each garment type you make (e.g. T-Shirt, Pant, Pant with Back Pocket,
                    Pant with Elastic) — projections below need this to work.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Pipeline */}
      <div>
        <h3 className="font-semibold text-sm mb-2">Pipeline — sorted by due date</h3>
        <div className="grid gap-3">
          {projections.map(({ order, projection }) => (
            <PipelineCard key={order.id} order={order} projection={projection} onResourcesChange={(v) => updateResources(order.id, v)} />
          ))}
          {projections.length === 0 && <Card className="p-8 text-center text-stone-400 text-sm">No active orders in the pipeline.</Card>}
        </div>
      </div>

      {rateModal && <RateModal rate={rateModal} onClose={() => setRateModal(null)} onSave={saveRate} />}
    </div>
  );
}

function PipelineCard({ order, projection, onResourcesChange }) {
  const required = orderItemsRequired(order.items);
  const { breakdown, missingRateFor, totalPersonDays, daysToComplete, projectedCompletionDate, onTime, resources } = projection;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div>
          <div className="font-semibold text-sm">{order.order_number} — {order.customer_name}</div>
          <div className="text-xs text-stone-400">Due {order.due_date || "—"} · Status: {order.status}</div>
        </div>
        <div className="flex items-center gap-2">
          <Users size={14} className="text-stone-400" />
          <input
            type="number"
            min="0"
            className="w-16 border border-stone-300 rounded px-1.5 py-1 text-sm text-right"
            defaultValue={order.planned_resources || ""}
            key={`res-${order.id}-${order.planned_resources}`}
            onBlur={(e) => onResourcesChange(e.target.value)}
            placeholder="0"
          />
          <span className="text-xs text-stone-400">assigned</span>
        </div>
      </div>

      {required === 0 ? (
        <p className="text-xs text-stone-400">No items on this order yet.</p>
      ) : resources === 0 ? (
        <p className="text-xs text-amber-700">Assign at least 1 person to this order to see a projection.</p>
      ) : missingRateFor.length > 0 ? (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle size={12} /> No rate set for: {missingRateFor.join(", ")} — add it above to complete this projection.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4 text-sm mb-2">
          <span>
            <span className="text-stone-500">Person-days needed: </span>
            <span className="font-mono font-medium">{totalPersonDays.toFixed(1)}</span>
          </span>
          <span>
            <span className="text-stone-500">Days to complete: </span>
            <span className="font-mono font-medium">{Math.ceil(daysToComplete)}</span>
          </span>
          <span>
            <span className="text-stone-500">Projected finish: </span>
            <span className="font-mono font-medium">{projectedCompletionDate}</span>
          </span>
          {onTime !== null && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${onTime ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
              {onTime ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {onTime ? "On track" : "At risk"}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-1 mt-2 border-t border-stone-100 pt-2">
        {breakdown.map((b) => (
          <div key={b.description} className="flex items-center justify-between text-xs text-stone-500">
            <span className="w-32 truncate">{b.description}</span>
            <span className="font-mono">
              {b.remaining}/{b.required} remaining
              {b.rate ? ` · ${b.rate.pieces_per_day_per_person}/day/person` : " · no rate set"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RateModal({ rate, onClose, onSave }) {
  const [f, setF] = useState({
    id: rate.id || null,
    garment_type: rate.garment_type || "",
    pieces_per_day_per_person: rate.pieces_per_day_per_person || "",
    notes: rate.notes || "",
  });
  return (
    <Modal title={rate.id ? "Edit garment rate" : "Add garment rate"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!f.garment_type) return;
          onSave({ ...f, pieces_per_day_per_person: Number(f.pieces_per_day_per_person) || 0 });
        }}
      >
        <Field label="Garment type (must match how it's typed in Orders' item list)">
          <input required className={inputCls} placeholder="e.g. Pant with Back Pocket" value={f.garment_type} onChange={(e) => setF({ ...f, garment_type: e.target.value })} />
        </Field>
        <Field label="Pieces per day, per person">
          <input type="number" min="0" required className={inputCls} value={f.pieces_per_day_per_person} onChange={(e) => setF({ ...f, pieces_per_day_per_person: e.target.value })} />
        </Field>
        <Field label="Notes (optional)">
          <input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit">Save</Btn>
        </div>
      </form>
    </Modal>
  );
}
