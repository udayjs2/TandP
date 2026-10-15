import { useEffect, useState } from "react";
import { Loader2, Star, ThumbsUp, ThumbsDown, CheckCircle2 } from "lucide-react";
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
