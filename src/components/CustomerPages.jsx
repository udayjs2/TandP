import { useEffect, useState } from "react";
import { Loader2, ArrowLeft, Star, ThumbsUp, ThumbsDown, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Field, inputCls, Btn } from "./ui";
import { FEEDBACK_ITEMS, DELIVERY_TIMINGS } from "../lib/helpers";

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

function Group({ label, children }) {
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
    </div>
  );
}

function Shell({ subtitle, children }) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo-full-navy.png" alt="T&P Textiles" className="h-16 w-auto mb-1" />
          <p className="text-stone-500 text-sm">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

// ================= Agreement: Agree / Disagree =================
export function AgreementPage() {
  const params = new URLSearchParams(window.location.search);
  const order = params.get("order") || "";
  const code = params.get("code") || "";
  const [data, setData] = useState(undefined); // undefined = loading, null = not found
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [choice, setChoice] = useState(null);

  const load = async () => {
    const { data: d } = await supabase.rpc("public_agreement", { p_order_number: order, p_tracking_code: code });
    setData(d || null);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const respond = async (decision) => {
    setMsg("");
    if (name.trim().length < 2) return setMsg("Please type your name so we know who confirmed.");
    if (decision === "Disagreed" && comment.trim().length < 3) return setMsg("Please tell us what you disagree with.");
    setBusy(true);
    const { data: r, error } = await supabase.rpc("public_agreement_respond", { p_order_number: order, p_tracking_code: code, p_decision: decision, p_name: name, p_comment: comment });
    setBusy(false);
    if (error || !r?.ok) {
      setMsg(r?.error === "not_open" ? "This agreement has already been answered or is not open." : "Couldn't save your response. Please try again.");
      return;
    }
    setChoice(decision);
    load();
  };

  if (data === undefined) return <Shell subtitle="Order agreement"><p className="text-center text-stone-500"><Loader2 className="inline animate-spin mr-1" size={15} />Loading…</p></Shell>;
  if (data === null) return <Shell subtitle="Order agreement"><Card className="p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">This link isn't valid. Please ask T&amp;P Textiles to send it again.</Card></Shell>;

  const items = data.items || [];
  const subtotal = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.rate || 0), 0);
  const t = data.terms;
  const gst = t ? (subtotal * Number(t.gst_percent || 0)) / 100 : 0;
  const open = data.agreement_status === "Sent";

  return (
    <Shell subtitle="Please review and confirm your order">
      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">{data.order_number}</h2>
          <span className="text-xs text-stone-500">{data.customer_name}</span>
        </div>
        <p className="text-xs text-stone-500 mb-3">Ordered {data.order_date || "—"} · Delivery by {data.due_date || "to be confirmed"}</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-500 uppercase"><tr><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((i, k) => (
              <tr key={k}><td className="py-1.5">{i.description}</td><td className="text-right font-mono">{i.quantity}</td><td className="text-right font-mono">{i.rate ? money(i.rate) : "—"}</td><td className="text-right font-mono">{i.rate ? money(Number(i.quantity) * Number(i.rate)) : "—"}</td></tr>
            ))}
          </tbody>
        </table>
        {subtotal > 0 && (
          <div className="text-sm mt-2 space-y-0.5 text-right">
            <div>Subtotal <span className="font-mono ml-2">{money(subtotal)}</span></div>
            {t && Number(t.gst_percent) > 0 && <div>GST {t.gst_percent}% <span className="font-mono ml-2">{money(gst)}</span></div>}
            <div className="font-semibold">Total <span className="font-mono ml-2">{money(subtotal + gst)}</span></div>
          </div>
        )}
        {t && (
          <div className="mt-4 text-xs text-stone-600 space-y-0.5 border-t border-stone-100 pt-3">
            <div className="font-medium text-stone-700 mb-1">Terms</div>
            {Number(t.advance_pct) > 0 && <div>Advance with order: {t.advance_pct}%</div>}
            {Number(t.before_dispatch_pct) > 0 && <div>Before dispatch: {t.before_dispatch_pct}%</div>}
            {Number(t.balance_pct) > 0 && <div>Balance: {t.balance_pct}% within {t.balance_days} days of delivery</div>}
            <div>Transportation: {t.transportation}</div>
            <div>Goods not collected within {t.unclaimed_goods_days} days may be disposed of.</div>
          </div>
        )}
      </Card>

      {(choice || !open) && (
        <Card className={`p-5 text-sm ${data.agreement_status === "Agreed" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : data.agreement_status === "Disagreed" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-white"}`}>
          {data.agreement_status === "Agreed" && <><CheckCircle2 className="inline mr-1" size={16} /> Thank you{data.responder ? `, ${data.responder}` : ""}. You have <b>agreed</b> to this order. We will start work as planned.</>}
          {data.agreement_status === "Disagreed" && <>Thank you. We have recorded that you <b>disagree</b> and our team will contact you shortly to resolve it.</>}
          {data.agreement_status === "Not sent" && <>This agreement has not been opened for confirmation yet. Please contact T&amp;P Textiles.</>}
        </Card>
      )}

      {open && !choice && (
        <Card className="p-5">
          <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person confirming" /></Field>
          <Field label="Comments (required if you disagree)"><textarea rows={3} className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything you would like to change: rate, quantity, date, terms…" /></Field>
          {msg && <p className="text-xs text-rose-600 mb-2">{msg}</p>}
          <div className="grid grid-cols-2 gap-3">
            <button disabled={busy} onClick={() => respond("Agreed")} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-3 font-medium disabled:opacity-60"><ThumbsUp size={16} /> I agree</button>
            <button disabled={busy} onClick={() => respond("Disagreed")} className="flex items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white py-3 font-medium disabled:opacity-60"><ThumbsDown size={16} /> I disagree</button>
          </div>
        </Card>
      )}
      <a href={trackUrl} className="flex items-center justify-center gap-1.5 text-sm font-medium text-indigo-800 mt-5"><ArrowLeft size={15} /> Back to order tracking</a>
    </Shell>
  );
}

// ================= Feedback form =================
function Stars({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} onClick={() => onChange(n)} aria-label={`${n} star`} className="p-0.5">
          <Star size={26} className={n <= (value || 0) ? "fill-amber-400 text-amber-400" : "text-stone-300"} />
        </button>
      ))}
    </div>
  );
}

export function FeedbackPage() {
  const params = new URLSearchParams(window.location.search);
  const order = params.get("order") || "";
  const code = params.get("code") || "";
  const [info, setInfo] = useState(undefined);
  const [ratings, setRatings] = useState({});
  const [timing, setTiming] = useState("");
  const [reorder, setReorder] = useState("");
  const [issues, setIssues] = useState("");
  const [comments, setComments] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.rpc("public_feedback_status", { p_order_number: order, p_tracking_code: code }).then(({ data }) => setInfo(data || null));
  }, []); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    if (Object.keys(ratings).length === 0) return setMsg("Please rate at least one item.");
    setBusy(true);
    const { data, error } = await supabase.rpc("public_feedback_submit", {
      p_order_number: order, p_tracking_code: code,
      p_payload: { ratings, delivery_timing: timing, would_reorder: reorder, issues, comments, respondent_name: name },
    });
    setBusy(false);
    if (error || !data?.ok) return setMsg(data?.error === "already_submitted" ? "Feedback has already been submitted for this order. Thank you!" : "Couldn't submit. Please try again.");
    setDone(true);
  };

  if (info === undefined) return <Shell subtitle="Your feedback"><p className="text-center text-stone-500"><Loader2 className="inline animate-spin mr-1" size={15} />Loading…</p></Shell>;
  if (info === null) return <Shell subtitle="Your feedback"><Card className="p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">This link isn't valid. Please ask T&amp;P Textiles to send it again.</Card></Shell>;
  if (done || info.already_submitted) return <Shell subtitle="Your feedback"><Card className="p-6 text-center"><CheckCircle2 className="mx-auto text-emerald-600 mb-2" size={32} /><p className="font-medium">Thank you for your feedback!</p><p className="text-sm text-stone-500 mt-1">It helps us improve every order.</p></Card></Shell>;
  if (!info.open) return <Shell subtitle="Your feedback"><Card className="p-5 text-sm">Order {info.order_number} is still in progress. Feedback opens once it is completed or shipped.</Card></Shell>;

  return (
    <Shell subtitle={`How was order ${info.order_number}?`}>
      <form onSubmit={submit}>
        <Card className="p-5 mb-4">
          <p className="text-xs text-stone-500 mb-3">Tap the stars (1 = poor, 5 = excellent). Skip anything that doesn't apply.</p>
          <div className="space-y-3">
            {FEEDBACK_ITEMS.map(([k, label]) => (
              <div key={k} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm">{label}</span>
                <Stars value={ratings[k]} onChange={(n) => setRatings({ ...ratings, [k]: n })} />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5 mb-4">
          <Group label="Delivery timing">
            <div className="flex gap-2 flex-wrap">
              {DELIVERY_TIMINGS.map((t) => (
                <button type="button" key={t} onClick={() => setTiming(t)} className={`text-sm px-3 py-1.5 rounded-lg border ${timing === t ? "bg-indigo-900 text-white border-indigo-900" : "bg-white border-stone-200"}`}>{t}</button>
              ))}
            </div>
          </Group>
          <Group label="Would you order from us again?">
            <div className="flex gap-2">
              {["Yes", "Maybe", "No"].map((t) => (
                <button type="button" key={t} onClick={() => setReorder(t)} className={`text-sm px-3 py-1.5 rounded-lg border ${reorder === t ? "bg-indigo-900 text-white border-indigo-900" : "bg-white border-stone-200"}`}>{t}</button>
              ))}
            </div>
          </Group>
          <Field label="Any problems (size, colour, stitching, damage…)?"><textarea rows={3} className={inputCls} value={issues} onChange={(e) => setIssues(e.target.value)} /></Field>
          <Field label="Other comments"><textarea rows={3} className={inputCls} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
          <Field label="Your name (optional)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {msg && <p className="text-xs text-rose-600 mb-2">{msg}</p>}
          <Btn type="submit" className="w-full justify-center" disabled={busy}>{busy ? "Sending…" : "Submit feedback"}</Btn>
        </Card>
      </form>
    </Shell>
  );
}

// ================= Dispatch confirmation: accept / reject the counts, delivery history, payments =================
const fmtDate = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return `${day}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}-${y}`;
};
const STATUS_STYLE = {
  Pending: "bg-amber-100 text-amber-800",
  Accepted: "bg-emerald-100 text-emerald-800",
  "Partly accepted": "bg-sky-100 text-sky-800",
  Rejected: "bg-rose-100 text-rose-800",
};

export function DeliveryPage() {
  const params = new URLSearchParams(window.location.search);
  const order = params.get("order") || "";
  const code = params.get("code") || "";
  const [data, setData] = useState(undefined);
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState({}); // delivery id -> { accepted, reason }
  const [busy, setBusy] = useState("");
  const [msgs, setMsgs] = useState({});
  const [tab, setTab] = useState(["dispatches", "confirm", "payments"].includes(params.get("view")) ? params.get("view") : "dispatches");
  const trackUrl = `/?track=1&order=${encodeURIComponent(order)}&code=${encodeURIComponent(code)}`;

  const load = async () => {
    const { data: d } = await supabase.rpc("public_delivery_status", { p_order_number: order, p_tracking_code: code });
    setData(d || null);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const send = async (d, accepted) => {
    const a = answer[d.id] || {};
    const note = (text) => setMsgs((m) => ({ ...m, [d.id]: text }));
    note("");
    if (name.trim().length < 2) return note("Please type your name first (at the top of the page).");
    const acc = Number(accepted);
    if (!Number.isInteger(acc) || acc < 0 || acc > Number(d.quantity)) return note(`Enter a whole number from 0 to ${d.quantity}.`);
    if (acc < Number(d.quantity) && (a.reason || "").trim().length < 3) return note("Please tell us the reason for the pieces you are not accepting.");
    setBusy(d.id);
    const { data: r, error } = await supabase.rpc("public_delivery_respond", {
      p_order_number: order, p_tracking_code: code, p_delivery_id: d.id, p_accepted: acc, p_reason: a.reason || "", p_name: name,
    });
    setBusy("");
    if (error || !r?.ok) {
      const e = r?.error;
      return note(e === "already_answered" ? "This dispatch has already been answered." : e === "reason_required" ? "Please write the reason." : e === "name_required" ? "Please type your name." : "Couldn't save your reply. Please try again.");
    }
    load();
  };

  if (data === undefined) return <Shell subtitle="Your dispatch"><p className="text-center text-stone-500"><Loader2 className="inline animate-spin mr-1" size={15} />Loading…</p></Shell>;
  if (data === null) return <Shell subtitle="Your dispatch"><Card className="p-5 text-sm text-rose-700 bg-rose-50 border-rose-200">This link isn't valid. Please ask T&amp;P Textiles to send it again.</Card></Shell>;

  const items = data.items || [];
  const deliveries = data.deliveries || [];
  const payments = data.payments || [];
  const invoices = data.invoices || [];
  const totals = items.reduce((t, i) => ({
    ordered: t.ordered + Number(i.ordered), dispatched: t.dispatched + Number(i.dispatched), accepted: t.accepted + Number(i.accepted),
    rejected: t.rejected + Number(i.rejected), awaiting: t.awaiting + Number(i.awaiting),
  }), { ordered: 0, dispatched: 0, accepted: 0, rejected: 0, awaiting: 0 });
  const toDispatch = Math.max(0, totals.ordered - totals.dispatched);
  const pendingRows = deliveries.filter((d) => d.customer_status === "Pending");

  return (
    <Shell subtitle="Your dispatch — please check and confirm">
      <a href={trackUrl} className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-800 hover:text-indigo-950 mb-3"><ArrowLeft size={15} /> Back to order tracking</a>
      <div className="grid grid-cols-3 gap-2 mb-4" role="tablist">
        {[["dispatches", "View dispatches"], ["confirm", pendingRows.length ? `Confirm what you received (${pendingRows.length})` : "Confirm what you received"], ["payments", "See payments"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg border px-2 py-2 text-xs font-medium leading-tight ${tab === id ? "bg-indigo-900 text-white border-indigo-900" : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"}`}>{label}</button>
        ))}
      </div>
      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-lg">{data.order_number}</h2>
          <span className="text-xs text-stone-500">{data.customer_name}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mt-3 text-xs">
          {[["Ordered", totals.ordered, "text-stone-800"], ["Dispatched", totals.dispatched, "text-indigo-800"], ["Yet to dispatch", toDispatch, toDispatch ? "text-amber-700" : "text-stone-500"],
            ["Accepted", totals.accepted, "text-emerald-700"], ["Rejected", totals.rejected, totals.rejected ? "text-rose-700" : "text-stone-500"], ["Awaiting your reply", totals.awaiting, totals.awaiting ? "text-amber-700" : "text-stone-500"]].map(([l, v, c]) => (
            <div key={l} className="border border-stone-100 rounded-lg py-2"><div className="text-stone-400">{l}</div><div className={`text-lg font-semibold font-mono ${c}`}>{v}</div></div>
          ))}
        </div>
        <table className="w-full text-xs mt-4">
          <thead className="text-stone-500 uppercase"><tr><th className="text-left py-1">Item</th><th className="text-right">Ordered</th><th className="text-right">Sent</th><th className="text-right">Accepted</th><th className="text-right">Yet to send</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((i, k) => (
              <tr key={k}><td className="py-1.5">{i.description}</td><td className="text-right font-mono">{i.ordered}</td><td className="text-right font-mono">{i.dispatched}</td><td className="text-right font-mono">{i.accepted}</td><td className="text-right font-mono">{Math.max(0, Number(i.ordered) - Number(i.dispatched))}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      {tab === "confirm" && pendingRows.length === 0 && <Card className="p-5 mb-4 text-sm text-stone-500">Nothing is waiting for your confirmation. Thank you!</Card>}
      {tab === "confirm" && pendingRows.length > 0 && (
        <Card className="p-5 mb-4">
          <h3 className="font-semibold mb-1">Please confirm what you received</h3>
          <p className="text-xs text-stone-500 mb-3">Check the count and quality of each dispatch. Accept it, or tell us how many pieces you accept and why the rest are not accepted.</p>
          <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of the person confirming" /></Field>
          <div className="space-y-4 mt-2">
            {pendingRows.map((d) => {
              const a = answer[d.id] || {};
              return (
                <div key={d.id} className="border border-stone-200 rounded-lg p-3">
                  <div className="flex justify-between text-sm"><span className="font-medium">{d.item_description}</span><span className="font-mono">{d.quantity} pcs</span></div>
                  <div className="text-xs text-stone-400 mb-2">Dispatched {fmtDate(d.date)}</div>
                  <button disabled={busy === d.id} onClick={() => send(d, d.quantity)} className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 text-sm font-medium disabled:opacity-60 mb-3">
                    <ThumbsUp size={15} /> Accept all {d.quantity} pcs — count and quality are correct
                  </button>
                  <div className="text-xs font-medium text-stone-600 mb-1">Or accept only some</div>
                  <div className="grid grid-cols-[110px_1fr] gap-2 mb-2">
                    <input type="number" min="0" max={d.quantity} placeholder="Accepted" className={inputCls} value={a.accepted ?? ""} onChange={(e) => setAnswer({ ...answer, [d.id]: { ...a, accepted: e.target.value } })} />
                    <input className={inputCls} placeholder="Reason for the rest (short count, damage, wrong size…)" value={a.reason || ""} onChange={(e) => setAnswer({ ...answer, [d.id]: { ...a, reason: e.target.value } })} />
                  </div>
                  <button disabled={busy === d.id || a.accepted === undefined || a.accepted === ""} onClick={() => send(d, a.accepted)} className="w-full flex items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white py-2.5 text-sm font-medium disabled:opacity-50">
                    <ThumbsDown size={15} /> Send my reply (accept {a.accepted === undefined || a.accepted === "" ? "…" : a.accepted}, reject {a.accepted === undefined || a.accepted === "" ? "…" : Math.max(0, Number(d.quantity) - Number(a.accepted))})
                  </button>
                  {msgs[d.id] && <p className="text-xs text-rose-600 mt-2">{msgs[d.id]}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tab === "dispatches" && <Card className="p-5 mb-4">
        <h3 className="font-semibold mb-2">Delivery history</h3>
        {deliveries.length === 0 ? <p className="text-sm text-stone-400">Nothing has been dispatched yet.</p> : (
          <div className="space-y-2">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-3 text-sm border-b border-stone-100 pb-2">
                <div>
                  <div><span className="font-medium">{d.item_description}</span> × {d.quantity}</div>
                  <div className="text-xs text-stone-400">{fmtDate(d.date)}</div>
                  {d.customer_status !== "Pending" && (
                    <div className="text-xs text-stone-600 mt-0.5">
                      {d.accepted_qty} accepted{Number(d.rejected_qty) > 0 ? `, ${d.rejected_qty} rejected` : ""}{d.customer_responder ? ` · ${d.customer_responder}` : ""}{d.customer_responded_at ? ` · ${fmtDate(d.customer_responded_at)}` : ""}
                      {d.customer_reason && <div className="text-rose-700">Reason: {d.customer_reason}</div>}
                    </div>
                  )}
                </div>
                <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_STYLE[d.customer_status] || STATUS_STYLE.Pending}`}>{d.customer_status === "Pending" ? "Awaiting your reply" : d.customer_status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>}

      {tab === "payments" && (
        <Card className="p-5">
          <h3 className="font-semibold mb-2">Payments</h3>
          {payments.length > 0 ? (
            <>
              <div className="space-y-1.5">
                {payments.map((p, k) => (
                  <div key={k} className="flex justify-between text-sm border-b border-stone-100 pb-1.5"><span>{fmtDate(p.payment_date)} <span className="text-xs text-stone-400">· {p.mode}</span></span><span className="font-mono">{money(p.amount)}</span></div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-semibold mt-2"><span>Total received</span><span className="font-mono">{money(data.payments_total)}</span></div>
            </>
          ) : <p className="text-sm text-stone-400">No payment has been received yet.</p>}
          {invoices.length > 0 && (
            <div className="mt-4 pt-3 border-t border-stone-100">
              <div className="text-xs font-medium text-stone-600 mb-1">Invoices</div>
              {invoices.map((i, k) => (
                <div key={k} className="flex justify-between text-xs text-stone-600"><span>{i.invoice_number || "Invoice"} · {fmtDate(i.issue_date)} · {i.status}</span><span className="font-mono">{money(i.amount)}</span></div>
              ))}
            </div>
          )}
        </Card>
      )}
      <a href={trackUrl} className="flex items-center justify-center gap-1.5 text-sm font-medium text-indigo-800 mt-5"><ArrowLeft size={15} /> Back to order tracking</a>
    </Shell>
  );
}
