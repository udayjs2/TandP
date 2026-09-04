import { X, Receipt } from "lucide-react";
import { Btn } from "./ui";
import { fmtMoney, itemsTotal } from "../lib/helpers";

export default function PrintInvoice({ invoice, settings, onClose }) {
  const items = invoice.items?.length ? invoice.items : [{ description: "Invoice amount", quantity: 1, price: invoice.amount }];
  const total = itemsTotal(items);
  const businessName = settings.business_name || "T&P Textiles";

  return (
    <div className="fixed inset-0 bg-white text-stone-900 z-50 overflow-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-invoice, #print-invoice * { visibility: visible; }
          #print-invoice { position: absolute; top: 0; left: 0; width: 100%; padding: 20px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}>
          <X size={14} /> Close preview
        </Btn>
        <Btn onClick={() => window.print()}>
          <Receipt size={14} /> Print
        </Btn>
      </div>

      <div id="print-invoice" className="max-w-2xl mx-auto p-8 border border-stone-800">
        {/* Letterhead */}
        <div className="text-center border-b-2 border-stone-800 pb-3 mb-3">
          <h1 className="text-2xl font-extrabold tracking-wide uppercase">{businessName}</h1>
          {settings.address && <p className="text-sm text-stone-700 mt-1">{settings.address}</p>}
          <p className="text-sm text-stone-700 mt-0.5">
            {settings.phone && <>Mobile: {settings.phone}</>}
            {settings.phone && settings.gstin && "  |  "}
            {settings.gstin && <>GSTIN: {settings.gstin}</>}
          </p>
        </div>

        <h2 className="text-center text-lg font-bold uppercase tracking-wide mb-4">Pro Forma Invoice</h2>

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
              <th className="border border-stone-800 text-right py-2 px-2">Qty</th>
              <th className="border border-stone-800 text-right py-2 px-2">Price (₹)</th>
              <th className="border border-stone-800 text-right py-2 px-2">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="border border-stone-800 py-2 px-2">{it.description}</td>
                <td className="border border-stone-800 text-right py-2 px-2">{it.quantity}</td>
                <td className="border border-stone-800 text-right py-2 px-2">{fmtMoney(it.price)}</td>
                <td className="border border-stone-800 text-right py-2 px-2">{fmtMoney((Number(it.quantity) || 0) * (Number(it.price) || 0))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="border border-stone-800 text-right py-2 px-2 font-bold bg-stone-50">Total</td>
              <td className="border border-stone-800 text-right py-2 px-2 font-bold bg-stone-50">{fmtMoney(total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-stone-500 mb-5">Note: Prices include GST as applicable.</p>

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
            <div className="font-bold text-sm mb-1.5">Terms &amp; Conditions</div>
            <div className="text-sm text-stone-700 whitespace-pre-line leading-relaxed">{settings.terms}</div>
          </div>
        )}

        <div className="flex justify-end">
          <div className="text-right text-sm font-bold">For {businessName}</div>
        </div>
      </div>
    </div>
  );
}
