import { useEffect, useState } from "react";
import { X, Receipt } from "lucide-react";
import { supabase } from "../supabaseClient";
import PrintSheet, { PrintFrame, PrintHeader } from "./PrintSheet";
import { Btn } from "./ui";
import { fmtMoney, gstBreakup } from "../lib/helpers";

export default function PrintInvoice({ invoice, settings, onClose }) {
  const items = invoice.items?.length ? invoice.items : [{ description: "Invoice amount", quantity: 1, price: invoice.amount }];
  const gstType = invoice.gst_type || "";
  const gb = gstBreakup(items, gstType);
  const total = gb.total;
  const hasGst = !!gstType;
  const advanceReceived = Number(invoice.advance_received) || 0;
  const balanceDue = total - advanceReceived;
  const [deliveries, setDeliveries] = useState([]);
  const [pays, setPays] = useState([]);
  useEffect(() => {
    if (!invoice.linked_order_id) return;
    // Dispatch details are printed only when "Include previous dispatch details" is ticked on the invoice.
    // Then: every dispatch of the order up to this invoice's own batch, each marked with the invoice that billed it.
    if (!invoice.include_previous_dispatches) setDeliveries([]);
    else {
      Promise.all([
        supabase.from("order_deliveries").select("date, item_description, quantity, invoice_id, created_at").eq("order_id", invoice.linked_order_id).order("date").order("created_at"),
        supabase.from("invoices").select("id, invoice_number").eq("linked_order_id", invoice.linked_order_id),
      ]).then(([{ data }, { data: invs }]) => {
        const nums = Object.fromEntries((invs || []).map((x) => [x.id, x.invoice_number]));
        const all = data || [];
        const mine = all.filter((d) => d.invoice_id === invoice.id);
        const upTo = mine.length ? mine.map((d) => d.date).sort().at(-1) : null;
        setDeliveries(all.filter((d) => !upTo || d.date <= upTo || d.invoice_id === invoice.id).map((d) => ({ ...d, billedIn: d.invoice_id === invoice.id ? "This invoice" : d.invoice_id ? nums[d.invoice_id] || "—" : "Not billed" })));
      });
    }
    supabase.from("order_payments").select("amount, payment_date, mode").eq("order_id", invoice.linked_order_id).order("payment_date").then(({ data }) => setPays(data || []));
  }, [invoice.linked_order_id, invoice.include_previous_dispatches]);
  const businessName = settings.business_name || "T&P Textiles";

  return (
    <PrintSheet>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}>
          <X size={14} /> Close preview
        </Btn>
        <Btn onClick={() => window.print()}>
          <Receipt size={14} /> Print
        </Btn>
      </div>

      <div id="print-invoice" className="print-page max-w-2xl mx-auto"><div>
        <PrintFrame header={<PrintHeader name={businessName} address={settings.address} phone={settings.phone} gstin={settings.gstin} />}>

        <h2 className="text-center text-lg font-bold uppercase tracking-wide mb-4">{hasGst ? "Tax Invoice" : "Pro Forma Invoice"}</h2>

        {/* Invoice No / Date box */}
        <table className="w-full text-sm border border-stone-800 border-collapse mb-4">
          <tbody>
            <tr>
              <td className="border border-stone-800 px-3 py-1.5 font-semibold w-1/4 bg-stone-50">Invoice No.</td>
              <td className="border border-stone-800 px-3 py-1.5 w-1/4">{invoice.invoice_number}</td>
              <td className="border border-stone-800 px-3 py-1.5 font-semibold w-1/4 bg-stone-50">Date</td>
              <td className="border border-stone-800 px-3 py-1.5 w-1/4">{invoice.issue_date}</td>
            </tr>
          </tbody>
        </table>

        {/* Bill To box */}
        <table className="w-full text-sm border border-stone-800 border-collapse mb-4">
          <tbody>
            <tr>
              <td className="border border-stone-800 px-3 py-2 font-semibold bg-stone-50 w-1/5 align-top">Bill To</td>
              <td className="border border-stone-800 px-3 py-2">
                <div className="font-bold">{invoice.customer_name}</div>
                {invoice.customer_gstin && <div className="text-xs mt-0.5">GSTIN: {invoice.customer_gstin}</div>}
                {invoice.place_of_supply && <div className="text-xs">Place of supply: {invoice.place_of_supply}</div>}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="flex justify-between text-sm mb-3">
          <span><span className="text-stone-500">Due date: </span>{invoice.due_date || "—"}</span>
          <span><span className="text-stone-500">Status: </span>{invoice.status}</span>
        </div>

        {/* Items table */}
        <table className="w-full text-sm border border-stone-800 border-collapse mb-1">
          <thead>
            <tr className="bg-sky-100">
              <th className="border border-stone-800 text-left py-2 px-2">Description</th>
              {hasGst && <th className="border border-stone-800 text-left py-2 px-2">HSN</th>}
              <th className="border border-stone-800 text-right py-2 px-2">Qty</th>
              <th className="border border-stone-800 text-right py-2 px-2">Price (₹)</th>
              {hasGst && <th className="border border-stone-800 text-right py-2 px-2">GST %</th>}
              <th className="border border-stone-800 text-right py-2 px-2">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-stone-800 py-2 px-2">{it.description}</td>
                {hasGst && <td className="border border-stone-800 py-2 px-2">{it.hsn_code || ""}</td>}
                <td className="border border-stone-800 text-right py-2 px-2">{it.quantity}</td>
                <td className="border border-stone-800 text-right py-2 px-2">{fmtMoney(it.price)}</td>
                {hasGst && <td className="border border-stone-800 text-right py-2 px-2">{Number(it.gst_rate) || 0}%</td>}
                <td className="border border-stone-800 text-right py-2 px-2">{fmtMoney((Number(it.quantity) || 0) * (Number(it.price) || 0))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasGst ? 5 : 3} className="border border-stone-800 text-right py-2 px-2 font-semibold">{hasGst ? "Taxable value" : "Subtotal"}</td>
              <td className="border border-stone-800 text-right py-2 px-2 font-semibold">{fmtMoney(hasGst ? gb.taxable : total)}</td>
            </tr>
            {hasGst && gb.byRate.map((x) => (gstType === "intra" ? [
              <tr key={x.rate + "c"}><td colSpan={5} className="border border-stone-800 text-right py-1.5 px-2">CGST @ {x.rate / 2}%</td><td className="border border-stone-800 text-right py-1.5 px-2">{fmtMoney(x.gst / 2)}</td></tr>,
              <tr key={x.rate + "s"}><td colSpan={5} className="border border-stone-800 text-right py-1.5 px-2">SGST @ {x.rate / 2}%</td><td className="border border-stone-800 text-right py-1.5 px-2">{fmtMoney(x.gst / 2)}</td></tr>,
            ] : (
              <tr key={x.rate}><td colSpan={5} className="border border-stone-800 text-right py-1.5 px-2">IGST @ {x.rate}%</td><td className="border border-stone-800 text-right py-1.5 px-2">{fmtMoney(x.gst)}</td></tr>
            )))}
            {hasGst && (
              <tr>
                <td colSpan={5} className="border border-stone-800 text-right py-2 px-2 font-semibold">Invoice total (incl. GST)</td>
                <td className="border border-stone-800 text-right py-2 px-2 font-semibold">{fmtMoney(total)}</td>
              </tr>
            )}
            {advanceReceived > 0 && (
              <tr>
                <td colSpan={hasGst ? 5 : 3} className="border border-stone-800 text-right py-2 px-2 font-semibold">Advance Received</td>
                <td className="border border-stone-800 text-right py-2 px-2 font-semibold">−{fmtMoney(advanceReceived)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={hasGst ? 5 : 3} className="border border-stone-800 text-right py-2 px-2 font-bold bg-stone-50">{balanceDue < 0 ? "Excess Received (credit)" : "Balance Due"}</td>
              <td className="border border-stone-800 text-right py-2 px-2 font-bold bg-stone-50">{fmtMoney(balanceDue)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-stone-500 mb-5">{hasGst ? "Prices are before GST; GST is shown separately above." : "Note: Prices include GST as applicable."}</p>

        {deliveries.length > 0 && (
          <div className="mb-5">
            <div className="font-bold text-sm mb-1.5">DISPATCH DETAILS</div>
            <table className="w-full text-sm border border-stone-800 border-collapse">
              <thead><tr className="bg-stone-50"><th className="border border-stone-800 text-left py-1.5 px-2">Dispatch</th><th className="border border-stone-800 text-left py-1.5 px-2">Date</th><th className="border border-stone-800 text-left py-1.5 px-2">Item</th><th className="border border-stone-800 text-left py-1.5 px-2">Billed in</th><th className="border border-stone-800 text-right py-1.5 px-2">Qty</th></tr></thead>
              <tbody>
                {deliveries.map((d, k) => (
                  <tr key={k}><td className="border border-stone-800 py-1.5 px-2">{k + 1}</td><td className="border border-stone-800 py-1.5 px-2">{d.date}</td><td className="border border-stone-800 py-1.5 px-2">{d.item_description}</td><td className={`border border-stone-800 py-1.5 px-2 ${d.billedIn === "This invoice" ? "font-semibold" : ""}`}>{d.billedIn}</td><td className="border border-stone-800 text-right py-1.5 px-2">{d.quantity}</td></tr>
                ))}
                <tr><td colSpan={4} className="border border-stone-800 text-right py-1.5 px-2 font-semibold">Total dispatched so far</td><td className="border border-stone-800 text-right py-1.5 px-2 font-semibold">{deliveries.reduce((t, d) => t + Number(d.quantity || 0), 0)}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {pays.length > 0 && (
          <div className="mb-5">
            <div className="font-bold text-sm mb-1.5">PAYMENT DETAILS (whole order)</div>
            <table className="w-full text-sm border border-stone-800 border-collapse">
              <thead><tr className="bg-stone-50"><th className="border border-stone-800 text-left py-1.5 px-2">Received as</th><th className="border border-stone-800 text-left py-1.5 px-2">Date</th><th className="border border-stone-800 text-left py-1.5 px-2">Mode</th><th className="border border-stone-800 text-right py-1.5 px-2">Amount (₹)</th></tr></thead>
              <tbody>
                {pays.map((p, k) => (
                  <tr key={k}><td className="border border-stone-800 py-1.5 px-2">{k === 0 ? "Advance" : `Payment ${k + 1}`}</td><td className="border border-stone-800 py-1.5 px-2">{p.payment_date}</td><td className="border border-stone-800 py-1.5 px-2">{p.mode}</td><td className="border border-stone-800 text-right py-1.5 px-2">{fmtMoney(p.amount)}</td></tr>
                ))}
                <tr><td colSpan={3} className="border border-stone-800 text-right py-1.5 px-2 font-semibold">Total received</td><td className="border border-stone-800 text-right py-1.5 px-2 font-semibold">{fmtMoney(pays.reduce((t, p) => t + Number(p.amount || 0), 0))}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {(settings.account_name || settings.bank_name || settings.account_number) && (
          <div className="mb-5">
            <div className="font-bold text-sm mb-1.5">BANK DETAILS</div>
            <table className="w-full text-sm border border-stone-800 border-collapse">
              <tbody>
                {[
                  ["Account Name", settings.account_name],
                  ["Bank Name", settings.bank_name],
                  ["Account Number", settings.account_number],
                  ["IFSC Code", settings.ifsc],
                  ["Branch", settings.branch],
                  ["UPI / GPay", settings.upi],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <tr key={label}>
                      <td className="border border-stone-800 px-3 py-1.5 w-1/3 text-stone-600 bg-stone-50">{label}</td>
                      <td className="border border-stone-800 px-3 py-1.5">{value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {settings.terms && (
          <div className="mb-8">
            <div className="font-bold text-sm mb-1.5 avoid-break">Terms &amp; Conditions</div>
            <div className="text-sm text-stone-700 whitespace-pre-line leading-relaxed">{settings.terms}</div>
          </div>
        )}

        <div className="flex justify-end avoid-break">
          <div className="text-right text-sm font-bold">For {businessName}</div>
        </div>
        </PrintFrame>
      </div>
      </div>
    </PrintSheet>
  );
}
