import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { Card, Field, inputCls } from "./ui";
import { fmtMoney, monthKey } from "../lib/helpers";

export default function SalesTeam() {
  const [mk, setMk] = useState(monthKey());
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [rows, setRows] = useState({});

  const load = async () => {
    const [{ data: emp }, { data: targets }] = await Promise.all([
      supabase.from("employees").select("*").eq("role", "Sales"),
      supabase.from("sales_targets").select("*").eq("month", mk),
    ]);
    setSalesEmployees(emp || []);
    const r = {};
    (targets || []).forEach((t) => (r[t.employee_id] = t));
    setRows(r);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("sales-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  const update = async (empId, patch) => {
    const existing = rows[empId] || { target: 0, achieved: 0, leads: 0 };
    const next = { ...existing, ...patch, employee_id: empId, month: mk };
    delete next.id;
    await supabase.from("sales_targets").upsert(next, { onConflict: "employee_id,month" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Sales team progress</h2>
        <input type="month" value={mk} onChange={(e) => setMk(e.target.value)} className={inputCls + " w-auto"} />
      </div>
      {salesEmployees.length === 0 ? (
        <Card className="p-8 text-center text-stone-400 text-sm">
          No employees with role "Sales" yet. Add one in the Employees tab.
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {salesEmployees.map((e) => {
            const entry = rows[e.id] || { target: 0, achieved: 0, leads: 0 };
            const pct = entry.target ? Math.min(100, (entry.achieved / entry.target) * 100) : 0;
            return (
              <Card key={e.id} className="p-4">
                <div className="font-semibold mb-2">{e.name}</div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Field label="Target (₹)">
                    <input
                      type="number"
                      min="0"
                      className={inputCls}
                      defaultValue={entry.target}
                      key={`t-${e.id}-${mk}`}
                      onBlur={(ev) => update(e.id, { target: Number(ev.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="Achieved (₹)">
                    <input
                      type="number"
                      min="0"
                      className={inputCls}
                      defaultValue={entry.achieved}
                      key={`a-${e.id}-${mk}`}
                      onBlur={(ev) => update(e.id, { achieved: Number(ev.target.value) || 0 })}
                    />
                  </Field>
                  <Field label="Leads / orders">
                    <input
                      type="number"
                      min="0"
                      className={inputCls}
                      defaultValue={entry.leads}
                      key={`l-${e.id}-${mk}`}
                      onBlur={(ev) => update(e.id, { leads: Number(ev.target.value) || 0 })}
                    />
                  </Field>
                </div>
                <div className="flex justify-between text-xs text-stone-500 mb-1">
                  <span>{fmtMoney(entry.achieved)}</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-700" style={{ width: `${pct}%` }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
