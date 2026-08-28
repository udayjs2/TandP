import { X, Receipt } from "lucide-react";
import { Btn } from "./ui";
import { fmtMoney, itemsTotal } from "../lib/helpers";

export default function PrintInvoice({ invoice, settings, onClose }) {
  const items = invoice.items?.length ? invoice.items : [{ description: "Invoice amount", quantity: 1, price: invoice.amount }];
  const total = itemsTotal(items);

  return (
    <div className="fixed inset-0 bg-white text-stone-900 z-50 overflow-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-invoice, #print-invoice * { visibility: visible; }
          #print-invoice { position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
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

      <div id="print-invoice" className="max-w-2xl mx-auto p-8">
        <div className="flex justify-between items-start border-b border-stone-300 pb-4 mb-4">
          <div>
            <h1 className="text-xl font-bold">{settings.business_name || "T&P Textiles"}</h1>
            {settings.address && <p className="text-sm text-stone-600 whitespace-pre-line">{settings.address}</p>}
            {settings.phone && <p className="text-sm text-stone-600">{settings.phone}</p>}
            {settings.gstin && <p className="text-sm text-stone-600">GSTIN: {settings.gstin}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-lg font-bold uppercase tracking-wide">Invoice</h2>
            <p className="text-sm">{invoice.invoice_number}</p>
          </div>
        </div>

        <div className="flex justify-between text-sm mb-6">
          <div>
            <p className="text-stone-500 text-xs uppercase mb-0.5">Bill to</p>
            <p className="font-medium">{invoice.customer_name}</p>
          </div>
          <div className="text-right">
            <p>
              <span className="text-stone-500">Issue date: </span>
              {invoice.issue_date}
            </p>
            <p>
              <span className="text-stone-500">Due date: </span>
              {invoice.due_date || "—"}
            </p>
            <p>
              <span className="text-stone-500">Status: </span>
              {invoice.status}
            </p>
          </div>
        </div>

        <table className="w-full text-sm mb-6 border-collapse">
          <thead>
            <tr className="border-b-2 border-stone-800">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2">Qty</th>
              <th className="text-right py-2">Price</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-stone-200">
                <td className="py-2">{it.description}</td>
                <td className="text-right py-2">{it.quantity}</td>
                <td className="text-right py-2">{fmtMoney(it.price)}</td>
                <td className="text-right py-2">{fmtMoney((Number(it.quantity) || 0) * (Number(it.price) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="w-48 text-sm">
            <div className="flex justify-between py-1 border-t-2 border-stone-800 font-bold text-base">
              <span>Total</span>
              <span>{fmtMoney(total)}</span>
            </div>
          </div>
        </div>

        {(settings.account_name || settings.bank_name || settings.account_number) && (
          <div className="border border-stone-300 rounded mb-6">
            <div className="font-bold text-sm px-3 py-2 border-b border-stone-300">BANK DETAILS</div>
            <table className="w-full text-sm">
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
                    <tr key={label} className="border-t border-stone-200">
                      <td className="px-3 py-1.5 w-1/3 text-stone-600">{label}</td>
                      <td className="px-3 py-1.5 border-l border-stone-200">{value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {settings.terms && (
          <div className="mb-8">
            <div className="font-bold text-sm mb-1.5">Terms & Conditions</div>
            <div className="text-sm text-stone-700 whitespace-pre-line leading-relaxed">{settings.terms}</div>
          </div>
        )}

        <div className="flex justify-end mb-6">
          <div className="text-right text-sm font-bold">For {settings.business_name || "T&P Textiles"}</div>
        </div>

        <p className="text-xs text-stone-400 text-center">Thank you for your business.</p>
      </div>
    </div>
  );
}
