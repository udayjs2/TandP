// Rule-based "why did output change?" analysis. Everything here is pure
// functions over rows loaded from Supabase, so it is easy to read and test.
import { todayStr, HOUR_SLOTS } from "./helpers";

// ---------- dates (all "YYYY-MM-DD", India time) ----------
export const addDays = (d, n) => {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
export const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
export const isSunday = (d) => dow(d) === 0;
const mondayOf = (d) => addDays(d, -((dow(d) + 6) % 7));
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const dateList = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
export const dayLabel = (d) => {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[dow(d)]} ${Number(d.slice(8, 10))}`;
};
export const shortDate = (d) => {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d.slice(8, 10))} ${m[Number(d.slice(5, 7)) - 1]}`;
};

export const PERIODS = [
  { id: "last_week", label: "Last week (Mon–Sun)" },
  { id: "this_week", label: "This week so far" },
  { id: "last_7", label: "Last 7 days" },
  { id: "last_30", label: "Last 30 days" },
];

// returns { from, to, prevFrom, prevTo }
export const periodRange = (id, today = todayStr()) => {
  const mon = mondayOf(today);
  if (id === "this_week") {
    const n = daysBetween(mon, today) + 1;
    return { from: mon, to: today, prevFrom: addDays(mon, -7), prevTo: addDays(mon, -7 + n - 1) };
  }
  if (id === "last_7") return { from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7) };
  if (id === "last_30") return { from: addDays(today, -29), to: today, prevFrom: addDays(today, -59), prevTo: addDays(today, -30) };
  return { from: addDays(mon, -7), to: addDays(mon, -1), prevFrom: addDays(mon, -14), prevTo: addDays(mon, -8) };
};

const sumSizes = (sizes) => Object.values(sizes || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
const round1 = (n) => Math.round(n * 10) / 10;
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ---------- one period's numbers ----------
export function periodStats(from, to, { attendance, progress, cuts, cuttingEmpIds }) {
  const days = dateList(from, to);
  const out = {};
  const present = {};
  const leave = {};
  const cut = {};
  const cutterOff = {}; // date -> true when every cutting master is on leave / absent / unmarked
  days.forEach((d) => {
    out[d] = 0;
    present[d] = 0;
    leave[d] = 0;
    cut[d] = 0;
  });
  const hourly = {};
  const leaveByEmp = {};
  const statusByEmpDay = {};

  (progress || []).forEach((p) => {
    if (p.date in out) {
      out[p.date] += Number(p.quantity) || 0;
      hourly[p.hour_slot] = (hourly[p.hour_slot] || 0) + (Number(p.quantity) || 0);
    }
  });
  (attendance || []).forEach((a) => {
    if (!(a.date in present)) return;
    statusByEmpDay[`${a.employee_id}|${a.date}`] = a.status;
    if (a.status === "Present") present[a.date] += 1;
    else if (a.status === "Half Day") present[a.date] += 0.5;
    else if (a.status === "Leave" && !isSunday(a.date)) {
      leave[a.date] += 1;
      leaveByEmp[a.employee_id] = (leaveByEmp[a.employee_id] || 0) + 1;
    }
  });
  (cuts || []).forEach((c) => {
    if (c.cut_date in cut) cut[c.cut_date] += sumSizes(c.sizes);
  });

  // a day counts as a working day if the factory produced or people clocked in
  const workingDays = days.filter((d) => out[d] > 0 || present[d] > 0);
  const personDays = workingDays.reduce((s, d) => s + present[d], 0);
  const totalOutput = days.reduce((s, d) => s + out[d], 0);
  const totalCut = days.reduce((s, d) => s + cut[d], 0);

  const cutters = [...(cuttingEmpIds || [])];
  if (cutters.length) {
    workingDays.forEach((d) => {
      if (isSunday(d)) return;
      cutterOff[d] = cutters.every((id) => {
        const st = statusByEmpDay[`${id}|${d}`];
        return !st || st === "Leave" || st === "Absent";
      });
    });
  }

  return {
    days, out, present, leave, cut, hourly, leaveByEmp, cutterOff,
    workingDays, personDays, totalOutput, totalCut,
    avgPresent: workingDays.length ? personDays / workingDays.length : 0,
    perPerson: personDays ? totalOutput / personDays : 0,
    avgDaily: workingDays.length ? totalOutput / workingDays.length : 0,
    leaveDays: days.reduce((s, d) => s + leave[d], 0),
  };
}

// ---------- the full analysis ----------
export function analyse({ from, to, prevFrom, prevTo, employees, attendance, progress, cuts, ops, fabricReqs, fabrics, orders, orderTotals, cuttingEmpIds, today = todayStr() }) {
  const inCur = (d) => d >= from && d <= to;
  const inPrev = (d) => d >= prevFrom && d <= prevTo;
  const cur = periodStats(from, to, {
    attendance: attendance.filter((a) => inCur(a.date)),
    progress: progress.filter((p) => inCur(p.date)),
    cuts: cuts.filter((c) => inCur(c.cut_date)),
    cuttingEmpIds,
  });
  const prev = periodStats(prevFrom, prevTo, {
    attendance: attendance.filter((a) => inPrev(a.date)),
    progress: progress.filter((p) => inPrev(p.date)),
    cuts: cuts.filter((c) => inPrev(c.cut_date)),
    cuttingEmpIds,
  });
  const empName = Object.fromEntries((employees || []).map((e) => [e.id, e.name]));
  const findings = [];
  const add = (severity, title, detail, action) => findings.push({ severity, title, detail, action });

  // 1. headline
  const change = pct(cur.totalOutput, prev.totalOutput);
  const delta = cur.totalOutput - prev.totalOutput;
  if (prev.totalOutput === 0 && cur.totalOutput === 0) {
    add("info", "No production logged in either period", "Nothing was entered in the hourly production table (Orders → progress) for these dates, so no comparison is possible.", "Make sure hourly output is entered every day.");
  } else {
    const dir = delta < 0 ? "fell" : "rose";
    add(
      delta < 0 ? "high" : "info",
      `Output ${dir} ${change === null ? "" : `${Math.abs(round1(change))}% `}(${Math.round(prev.totalOutput)} → ${Math.round(cur.totalOutput)} pcs)`,
      `Average ${round1(cur.avgDaily)} pcs per working day against ${round1(prev.avgDaily)} before.`,
      delta < 0 ? "The checks below show the most likely causes." : "Check what worked and repeat it."
    );
  }

  // 2. headcount vs productivity split
  if (prev.personDays > 0 && cur.personDays >= 0 && prev.perPerson > 0) {
    const headcountEffect = (cur.personDays - prev.personDays) * prev.perPerson;
    const productivityEffect = delta - headcountEffect;
    const headDrop = pct(cur.avgPresent, prev.avgPresent);
    if (headDrop !== null && headDrop <= -10) {
      const names = Object.entries(cur.leaveByEmp).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, d]) => `${empName[id] || "Unknown"} (${d}d)`);
      add(
        "high",
        `Fewer people present: ${round1(prev.avgPresent)} → ${round1(cur.avgPresent)} per day (${round1(headDrop)}%)`,
        `${cur.leaveDays} leave-days were taken${names.length ? `: ${names.join(", ")}` : ""}. About ${Math.round(Math.abs(headcountEffect))} pcs of the ${delta < 0 ? "drop" : "change"} is explained by fewer people-days${Math.abs(productivityEffect) > 1 ? `, and about ${Math.round(Math.abs(productivityEffect))} pcs by ${productivityEffect < 0 ? "lower" : "higher"} output per person` : ""}.`,
        "Plan leave in advance, keep a few cross-trained operators who can cover key operations, and move people between lines when absences are high."
      );
    }
    const ppChange = pct(cur.perPerson, prev.perPerson);
    if (ppChange !== null && ppChange <= -10) {
      add(
        "medium",
        `Output per person dropped ${Math.abs(round1(ppChange))}% (${round1(prev.perPerson)} → ${round1(cur.perPerson)} pcs per person-day)`,
        "Even with similar attendance, each person produced less. That usually points to waiting for material or cut pieces, a harder style, machine trouble, or a bottleneck operation.",
        "Look at the bottleneck, fabric and cutting findings below."
      );
    }
  }

  // 3. cutting master / cutting
  if (cuttingEmpIds && cuttingEmpIds.size) {
    const offDays = cur.workingDays.filter((d) => cur.cutterOff[d]);
    const zeroCutDays = cur.workingDays.filter((d) => !isSunday(d) && cur.cut[d] === 0);
    const cutChange = pct(cur.totalCut, prev.totalCut);
    if (offDays.length > 0 || (cutChange !== null && cutChange <= -20)) {
      add(
        offDays.length ? "high" : "medium",
        offDays.length ? `Cutting master was away on ${offDays.length} working day(s)` : `Cutting output fell ${Math.abs(round1(cutChange))}%`,
        `${offDays.length ? `Away: ${offDays.map(dayLabel).join(", ")}. ` : ""}Pieces cut: ${Math.round(prev.totalCut)} → ${Math.round(cur.totalCut)}. ${zeroCutDays.length ? `No cutting was logged on ${zeroCutDays.map(dayLabel).join(", ")}, so the stitching line may have run out of cut pieces.` : ""}`,
        "Name a backup cutter, and cut 1–2 days ahead of stitching so the line never waits for cut pieces."
      );
    }
  } else {
    add("info", "Cutting master not identified", "No login with the Cutting Master role is linked to an employee record, so cutting-master absence can't be checked.", "In User Management, link the Cutting Master login to their employee record.");
  }

  // 4. stitching vs cutting backlog (all-time per active order)
  const backlogOrders = (orders || [])
    .filter((o) => o.status !== "Completed" && o.status !== "Shipped")
    .map((o) => {
      const t = orderTotals?.[o.id] || { cut: 0, stitched: 0 };
      return { o, cut: t.cut, stitched: t.stitched, gap: t.cut - t.stitched };
    })
    .filter((r) => r.cut > 0);
  const waiting = backlogOrders.filter((r) => r.gap > 0 && r.gap / r.cut > 0.2);
  if (waiting.length) {
    add(
      "medium",
      `${waiting.reduce((s, r) => s + r.gap, 0)} cut pieces are waiting to be stitched`,
      waiting.slice(0, 4).map((r) => `${r.o.order_number}: ${r.gap} of ${r.cut} pcs still unstitched`).join("; ") + ".",
      "Stitching, not cutting, is the constraint on these orders — add operators or overtime there."
    );
  }

  // 5. operations bottleneck (needs the operation log)
  const opsCur = (ops || []).filter((r) => inCur(r.work_date));
  const opTable = [];
  const workloadTable = [];
  if (opsCur.length) {
    const byOrderItem = {};
    opsCur.forEach((r) => {
      const k = `${r.order_id}|${r.item_description || ""}`;
      byOrderItem[k] = byOrderItem[k] || {};
      byOrderItem[k][r.operation] = (byOrderItem[k][r.operation] || 0) + (Number(r.quantity) || 0);
    });
    const ratios = {};
    Object.values(byOrderItem).forEach((m) => {
      const names = Object.keys(m);
      if (names.length < 2) return;
      const max = Math.max(...Object.values(m));
      names.forEach((n) => {
        ratios[n] = ratios[n] || [];
        ratios[n].push(max ? m[n] / max : 1);
      });
    });
    const totals = {};
    const crew = {};
    opsCur.forEach((r) => {
      totals[r.operation] = (totals[r.operation] || 0) + (Number(r.quantity) || 0);
      crew[r.operation] = crew[r.operation] || new Set();
      crew[r.operation].add(`${r.employee_id}|${r.work_date}`);
    });
    Object.keys(totals).forEach((n) => {
      const rs = ratios[n] || [];
      const avgRatio = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
      opTable.push({ operation: n, pieces: totals[n], perPersonDay: crew[n].size ? totals[n] / crew[n].size : 0, completion: avgRatio === null ? null : avgRatio * 100 });
    });
    opTable.sort((a, b) => (a.completion ?? 101) - (b.completion ?? 101));
    const worst = opTable.find((r) => r.completion !== null && r.completion < 80);
    if (worst) {
      add(
        "high",
        `Bottleneck operation: ${worst.operation}`,
        `On the same orders, ${worst.operation} reached only ${Math.round(worst.completion)}% of the pieces the busiest operation completed, so work piles up in front of it. It averaged ${round1(worst.perPersonDay)} pcs per person-day.`,
        `Put more operators (or a faster/better machine) on ${worst.operation}, and train a second person for it.`
      );
    }

    // employee workload
    const perEmp = {};
    opsCur.forEach((r) => {
      if (!r.employee_id) return;
      perEmp[r.employee_id] = perEmp[r.employee_id] || { qty: 0, days: new Set() };
      perEmp[r.employee_id].qty += Number(r.quantity) || 0;
      perEmp[r.employee_id].days.add(r.work_date);
    });
    const rows = Object.entries(perEmp).map(([id, v]) => ({ id, name: empName[id] || "Unknown", pieces: v.qty, days: v.days.size, perDay: v.days.size ? v.qty / v.days.size : 0 }));
    if (rows.length) {
      const mean = rows.reduce((s, r) => s + r.perDay, 0) / rows.length;
      rows.forEach((r) => workloadTable.push({ ...r, vsAverage: mean ? (r.perDay / mean) * 100 : 0 }));
      workloadTable.sort((a, b) => b.perDay - a.perDay);
      if (rows.length >= 3) {
        const heavy = workloadTable.filter((r) => r.vsAverage >= 130);
        const light = workloadTable.filter((r) => r.vsAverage <= 70);
        if (heavy.length || light.length) {
          add(
            "medium",
            "Work is unevenly spread across operators",
            `${heavy.length ? `Carrying much more than average: ${heavy.map((r) => `${r.name} (${Math.round(r.vsAverage)}%)`).join(", ")}. ` : ""}${light.length ? `Well below average: ${light.map((r) => `${r.name} (${Math.round(r.vsAverage)}%)`).join(", ")}.` : ""}`,
            "Rebalance operations so no one is overloaded while others wait; check whether low-output people are waiting for work or need training."
          );
        }
      }
    }
  } else {
    add("info", "No operation-wise data for this period", "Bottlenecks by operation and uneven workload can only be found from the Operation log (Insights → Operation log).", "Have team leads log pieces per operation per person at the end of each day.");
  }

  // 6. fabric
  const late = [];
  (fabricReqs || []).forEach((r) => {
    if (r.status !== "Approved" || !r.expected_arrival) return;
    const end = r.received_at || today;
    const lateBy = daysBetween(r.expected_arrival, end);
    if (lateBy > 0 && end >= addDays(from, -14)) late.push({ r, lateBy, received: !!r.received_at });
  });
  const stockOut = (fabrics || []).filter((f) => Number(f.stock_kg || 0) <= 0 && Number(f.stock_meters || 0) <= 0);
  const orderNo = Object.fromEntries((orders || []).map((o) => [o.id, o.order_number]));
  if (late.length || stockOut.length) {
    add(
      late.length ? "high" : "medium",
      late.length ? `${late.length} fabric delivery(ies) arrived late or are overdue` : `${stockOut.length} fabric(s) are out of stock`,
      [
        late.length ? late.slice(0, 4).map(({ r, lateBy, received }) => `${r.item}${r.order_id ? ` (${orderNo[r.order_id] || "order"})` : ""}: ${lateBy} day(s) ${received ? "late" : "overdue, not received"}`).join("; ") + "." : "",
        stockOut.length ? `Out of stock: ${stockOut.slice(0, 4).map((f) => `${f.fabric_type}${f.color ? ` ${f.color}` : ""}`).join(", ")}.` : "",
      ].filter(Boolean).join(" "),
      "Order fabric earlier (add transit time to the order date), chase the transporter using the tracking details, and keep a safety stock of fast-moving fabrics."
    );
  }

  // 7. weak hours
  const hourVals = HOUR_SLOTS.map((h) => ({ ...h, qty: cur.hourly[h.key] || 0 }));
  const active = hourVals.filter((h) => h.qty > 0);
  if (cur.workingDays.length >= 3 && active.length >= 4) {
    const med = median(active.map((h) => h.qty));
    const weak = hourVals.filter((h) => h.qty < med * 0.6);
    if (weak.length) {
      add("info", `Weak hours: ${weak.map((h) => h.label).join(", ")}`, `These slots produced under 60% of a typical hour (${Math.round(med)} pcs). Common causes are lunch overruns, power cuts, waiting for work, or output not being entered.`, "Check these hours on the floor, and stagger breaks so lines never stop together.");
    }
  }

  const rank = { high: 0, medium: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const leaveRows = Object.entries(cur.leaveByEmp)
    .map(([id, d]) => ({ name: empName[id] || "Unknown", days: d }))
    .sort((a, b) => b.days - a.days);

  // aligned daily series for charts
  const daily = cur.days.map((d, i) => {
    const pd = prev.days[i];
    return {
      date: d,
      label: dayLabel(d),
      output: cur.out[d],
      present: cur.present[d],
      cut: cur.cut[d],
      prevOutput: pd ? prev.out[pd] : 0,
      prevPresent: pd ? prev.present[pd] : 0,
    };
  });

  return { cur, prev, findings, daily, leaveRows, opTable, workloadTable, hourVals, change, delta };
}

// ---------- daily report ----------
export function dailySummary({ date, employees, attendance, progress, orders, ops }) {
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const attBy = {};
  (attendance || []).forEach((a) => (attBy[a.employee_id] = a));
  const counts = { Present: 0, "Half Day": 0, Leave: 0, Absent: 0, Unmarked: 0 };
  const people = (employees || []).map((e) => {
    const a = attBy[e.id];
    const status = a?.status || "Unmarked";
    counts[status] = (counts[status] || 0) + 1;
    return { id: e.id, name: e.name, role: e.role, status, checkIn: a?.check_in ? a.check_in.slice(0, 5) : "", checkOut: a?.check_out ? a.check_out.slice(0, 5) : "" };
  });
  const orderById = Object.fromEntries((orders || []).map((o) => [o.id, o]));
  const byItem = {};
  const byHour = {};
  let total = 0;
  (progress || []).forEach((p) => {
    const q = Number(p.quantity) || 0;
    total += q;
    const k = `${p.order_id}|${p.item_description}`;
    byItem[k] = byItem[k] || { order: orderById[p.order_id]?.order_number || "—", customer: orderById[p.order_id]?.customer_name || "", item: p.item_description, qty: 0 };
    byItem[k].qty += q;
    byHour[p.hour_slot] = (byHour[p.hour_slot] || 0) + q;
  });
  const target = (orders || []).filter((o) => o.status !== "Completed" && o.status !== "Shipped").reduce((s, o) => s + (Number(o.daily_target) || 0), 0);
  const presentEq = counts.Present + counts["Half Day"] * 0.5;
  const opsTotal = {};
  (ops || []).forEach((r) => (opsTotal[r.operation] = (opsTotal[r.operation] || 0) + (Number(r.quantity) || 0)));
  return {
    counts, people, total, target, presentEq,
    perPerson: presentEq ? total / presentEq : 0,
    items: Object.values(byItem).sort((a, b) => b.qty - a.qty),
    hours: HOUR_SLOTS.map((h) => ({ label: h.label, qty: byHour[h.key] || 0 })),
    opsTotal,
    late: (attendance || []).filter((a) => a.check_in && a.check_in.slice(0, 5) > "09:15").length,
    empById,
  };
}

// ---------- financial quarters (Indian FY: Apr–Mar) ----------
export const quarterRange = (fyStartYear, q) => {
  // q = 1..4 ; FY 2025 means Apr 2025 – Mar 2026
  const startMonth = [4, 7, 10, 1][q - 1];
  const year = q === 4 ? fyStartYear + 1 : fyStartYear;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, label: `Q${q} FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`, months: [0, 1, 2].map((i) => `${year}-${String(startMonth + i).padStart(2, "0")}`) };
};
export const currentQuarter = (today = todayStr()) => {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 && m <= 12 ? 3 : 4;
  return { fy, q };
};

// half-years and whole financial years (Indian FY: Apr–Mar)
const fyLabel = (fy) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
const monthsFrom = (startYear, startMonth, n) =>
  Array.from({ length: n }, (_, i) => {
    const idx = startMonth - 1 + i;
    return `${startYear + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  });
const lastDayOf = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
export const periodRangeFor = (mode, fy, n = 1) => {
  // mode: quarter (n = 1..4) | half (n = 1..2) | year
  if (mode === "quarter") return quarterRange(fy, n);
  const months = mode === "half" ? monthsFrom(fy, n === 1 ? 4 : 10, 6) : monthsFrom(fy, 4, 12);
  return {
    from: `${months[0]}-01`,
    to: lastDayOf(months[months.length - 1]),
    label: mode === "half" ? `H${n} ${fyLabel(fy)}` : fyLabel(fy),
    months,
  };
};
export const previousPeriod = (mode, fy, n = 1) => {
  if (mode === "year") return { fy: fy - 1, n: 1 };
  const per = mode === "quarter" ? 4 : 2;
  return n === 1 ? { fy: fy - 1, n: per } : { fy, n: n - 1 };
};
export const currentHalf = (today = todayStr()) => {
  const { fy, q } = currentQuarter(today);
  return { fy, h: q <= 2 ? 1 : 2 };
};
