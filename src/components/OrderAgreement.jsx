import { useState } from "react";
import { X, FileText } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Modal, Field, inputCls, Btn } from "./ui";
import { todayStr, fmtMoney, orderItemsRequired } from "../lib/helpers";

export function AgreementModal({ order, settings, onClose }) {
  const [f, setF] = useState({
    agreement_date: todayStr(),
    quotation_no: "",
    supplier_gstin: settings?.gstin || "",
    supplier_contact: settings?.phone || "",
    school_address: "",
    contact_person: "",
    mobile: "",
    customer_gstin: "",
    gst_percent: 5,
    advance_pct: 50,
    before_dispatch_pct: 0,
    balance_pct: 50,
    balance_days: 7,
    transportation: "As mutually agreed",
    unclaimed_goods_days: 15,
  });
  const [rates, setRates] = useState((order.items || []).map((it) => ({ description: it.description, rate: "" })));
  const [saving, setSaving] = useState(false);
  const [agreement, setAgreement] = useState(null);

  const updateRate = (idx, rate) => setRates(rates.map((r, i) => (i === idx ? { ...r, rate } : r)));

  const generate = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      order_id: order.id,
      ...f,
      gst_percent: Number(f.gst_percent) || 0,
      advance_pct: Number(f.advance_pct) || 0,
      before_dispatch_pct: Number(f.before_dispatch_pct) || 0,
      balance_pct: Number(f.balance_pct) || 0,
      balance_days: Number(f.balance_days) || 0,
      unclaimed_goods_days: Number(f.unclaimed_goods_days) || 0,
      item_rates: rates.map((r) => ({ description: r.description, rate: Number(r.rate) || 0 })),
    };
    const { data, error } = await supabase.from("order_agreements").insert(payload).select().single();
    setSaving(false);
    if (error) {
      alert(`Couldn't generate agreement:\n${error.message}`);
      return;
    }
    setAgreement(data);
  };

  if (agreement) {
    return <PrintAgreement agreement={agreement} order={order} settings={settings} onClose={onClose} />;
  }

  return (
    <Modal title={`Order agreement — ${order.order_number}`} onClose={onClose}>
      <form onSubmit={generate}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Agreement date">
            <input type="date" className={inputCls} value={f.agreement_date} onChange={(e) => setF({ ...f, agreement_date: e.target.value })} />
          </Field>
          <Field label="Quotation No.">
            <input className={inputCls} value={f.quotation_no} onChange={(e) => setF({ ...f, quotation_no: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier GSTIN">
            <input className={inputCls} value={f.supplier_gstin} onChange={(e) => setF({ ...f, supplier_gstin: e.target.value })} />
          </Field>
          <Field label="Supplier contact">
            <input className={inputCls} value={f.supplier_contact} onChange={(e) => setF({ ...f, supplier_contact: e.target.value })} />
          </Field>
        </div>

        <div className="border-t border-stone-200 my-3 pt-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">School / customer details</span>
          <Field label="School address">
            <textarea rows={2} className={inputCls} value={f.school_address} onChange={(e) => setF({ ...f, school_address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Contact person">
              <input className={inputCls} value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className={inputCls} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
            </Field>
            <Field label="Customer GSTIN (optional)">
              <input className={inputCls} value={f.customer_gstin} onChange={(e) => setF({ ...f, customer_gstin: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="border-t border-stone-200 my-3 pt-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Rate per item (for this order)</span>
          {rates.length === 0 && <p className="text-xs text-stone-400">This order has no items yet.</p>}
          {rates.map((r, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_100px] gap-2 mb-2 items-center">
              <span className="text-sm">{r.description}</span>
              <input type="number" min="0" placeholder="Rate ₹" className={inputCls} value={r.rate} onChange={(e) => updateRate(idx, e.target.value)} />
            </div>
          ))}
          <Field label="GST %">
            <input type="number" min="0" className={inputCls + " w-24"} value={f.gst_percent} onChange={(e) => setF({ ...f, gst_percent: e.target.value })} />
          </Field>
        </div>

        <div className="border-t border-stone-200 my-3 pt-3">
          <span className="block text-xs font-semibold text-stone-700 mb-2">Payment terms</span>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Advance %">
              <input type="number" min="0" className={inputCls} value={f.advance_pct} onChange={(e) => setF({ ...f, advance_pct: e.target.value })} />
            </Field>
            <Field label="Before dispatch %">
              <input type="number" min="0" className={inputCls} value={f.before_dispatch_pct} onChange={(e) => setF({ ...f, before_dispatch_pct: e.target.value })} />
            </Field>
            <Field label="Balance %">
              <input type="number" min="0" className={inputCls} value={f.balance_pct} onChange={(e) => setF({ ...f, balance_pct: e.target.value })} />
            </Field>
            <Field label="...within days">
              <input type="number" min="0" className={inputCls} value={f.balance_days} onChange={(e) => setF({ ...f, balance_days: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <Field label="Transportation">
              <select className={inputCls} value={f.transportation} onChange={(e) => setF({ ...f, transportation: e.target.value })}>
                <option>Included in price</option>
                <option>Payable separately</option>
                <option>As mutually agreed</option>
              </select>
            </Field>
            <Field label="Unclaimed goods — storage charge after (days)">
              <input type="number" min="0" className={inputCls} value={f.unclaimed_goods_days} onChange={(e) => setF({ ...f, unclaimed_goods_days: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Generating…" : "Generate agreement"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function PrintAgreement({ agreement, order, settings, onClose }) {
  const items = order.items || [];
  const rateFor = (desc) => (agreement.item_rates || []).find((r) => r.description === desc)?.rate || 0;
  const totalQty = orderItemsRequired(items);
  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * rateFor(it.description), 0);
  const gstAmount = (subtotal * Number(agreement.gst_percent || 0)) / 100;
  const grandTotal = subtotal + gstAmount;
  const businessName = settings?.business_name || "TandP Textiles";
  const businessAddress = settings?.address || "";

  return (
    <div className="fixed inset-0 bg-white text-stone-900 z-50 overflow-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-agreement, #print-agreement * { visibility: visible; }
          #print-agreement { position: absolute; top: 0; left: 0; width: 100%; padding: 16px; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
      `}</style>
      <div className="no-print sticky top-0 flex justify-end gap-2 bg-stone-100 border-b border-stone-200 p-2">
        <Btn variant="ghost" onClick={onClose}><X size={14} /> Close</Btn>
        <Btn onClick={() => window.print()}><FileText size={14} /> Print / Download</Btn>
      </div>

      <div id="print-agreement" className="max-w-2xl mx-auto p-8 text-[12px] leading-relaxed">
        {/* ===== PAGE 1 ===== */}
        <Letterhead businessName={businessName} businessAddress={businessAddress} settings={settings} />

        <h2 className="text-center text-base font-bold my-3">SCHOOL UNIFORM ORDER CONFIRMATION &amp; SUPPLY AGREEMENT</h2>

        <div className="flex justify-between text-xs mb-3">
          <span>Agreement Date: {agreement.agreement_date}</span>
          <span>Order / PO No.: {order.order_number}</span>
        </div>
        <div className="flex justify-between text-xs mb-3">
          <span>Quotation No.: {agreement.quotation_no || "—"}</span>
          <span>Expected Delivery: {order.due_date || "—"}</span>
        </div>

        <p className="font-bold mt-3 mb-1">1. PARTIES</p>
        <div className="grid grid-cols-2 gap-4 text-xs mb-3">
          <div>
            <p className="font-semibold">SUPPLIER / MANUFACTURER</p>
            <p>{businessName}</p>
            <p>{businessAddress}</p>
            <p>GSTIN: {agreement.supplier_gstin || "—"}</p>
            <p>Contact: {agreement.supplier_contact || "—"}</p>
          </div>
          <div>
            <p className="font-semibold">CUSTOMER / SCHOOL</p>
            <p>School Name: {order.customer_name}</p>
            <p>Address: {agreement.school_address || "—"}</p>
            <p>Contact Person: {agreement.contact_person || "—"}</p>
            <p>Mobile: {agreement.mobile || "—"} {agreement.customer_gstin ? `· GSTIN: ${agreement.customer_gstin}` : ""}</p>
          </div>
        </div>

        <p className="font-bold mb-1">2. ORDER CONFIRMATION</p>
        <table className="w-full border border-stone-500 border-collapse text-xs mb-1">
          <thead>
            <tr className="bg-stone-100">
              <th className="border border-stone-500 px-1.5 py-1 text-left">Item</th>
              <th className="border border-stone-500 px-1.5 py-1 text-right">Qty</th>
              <th className="border border-stone-500 px-1.5 py-1 text-right">Rate</th>
              <th className="border border-stone-500 px-1.5 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.description}>
                <td className="border border-stone-500 px-1.5 py-1">{it.description}</td>
                <td className="border border-stone-500 px-1.5 py-1 text-right">{it.quantity}</td>
                <td className="border border-stone-500 px-1.5 py-1 text-right">{fmtMoney(rateFor(it.description))}</td>
                <td className="border border-stone-500 px-1.5 py-1 text-right">{fmtMoney((Number(it.quantity) || 0) * rateFor(it.description))}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-stone-50">
              <td className="border border-stone-500 px-1.5 py-1">TOTAL</td>
              <td className="border border-stone-500 px-1.5 py-1 text-right">{totalQty}</td>
              <td className="border border-stone-500 px-1.5 py-1"></td>
              <td className="border border-stone-500 px-1.5 py-1 text-right">{fmtMoney(subtotal)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs mb-3">GST: {agreement.gst_percent}% ({fmtMoney(gstAmount)}) &nbsp; Grand Total: <b>{fmtMoney(grandTotal)}</b></p>
        <p className="text-[11px] text-stone-500 mb-3">The quotation / purchase order, approved sample and order/size schedule form part of this Agreement.</p>

        <Clause n="3" title="DESIGN AND SAMPLE APPROVAL">
          Uniforms will be manufactured according to the approved design, fabric, colour, logo, embroidery/printing, stitching pattern and specifications. Where
          applicable, a sample will be provided for approval before bulk production. Bulk production will follow the approved sample; changes after approval may
          cause additional cost and/or delay.
        </Clause>
        <Clause n="4" title="FABRIC, COLOUR AND SPECIFICATIONS">
          Minor variations in fabric texture, colour, printing, embroidery and dye lots may occur. The Supplier will make reasonable efforts to maintain consistency
          with the approved sample.
        </Clause>
        <Clause n="5" title="SIZE AND QUANTITY">
          The Customer shall provide final size-wise quantities before bulk production and is responsible for verifying them. Changes after production starts are
          subject to availability and may incur additional charges. Customized uniforms may not be returnable merely due to a change of requirement.
        </Clause>
        <Clause n="6" title="PAYMENT TERMS">
          Advance: {agreement.advance_pct}% &nbsp; Before/At Dispatch: {agreement.before_dispatch_pct}% &nbsp; Balance: {agreement.balance_pct}% within{" "}
          {agreement.balance_days} days of delivery. Production may commence after receipt of the agreed advance. The Supplier may hold production/delivery for
          delayed payments.
        </Clause>
        <Clause n="7" title="DELIVERY">
          Delivery depends on timely approval, size confirmation, quantity and payment. Customer-caused delays may extend delivery. The Supplier is not responsible
          for delays beyond reasonable control, including transport disruption, natural disasters, strikes, government restrictions, material shortages or force
          majeure.
        </Clause>
        <Clause n="8" title="INSPECTION AND ACCEPTANCE">
          The Customer shall inspect goods within 7 days of delivery. Shortage, manufacturing defect or discrepancy must be reported in writing with reasonable
          details and photographs where applicable. Otherwise goods will be considered accepted, except defects not reasonably identifiable on inspection.
        </Clause>
        <Clause n="9" title="DEFECTIVE GOODS">
          For a genuine manufacturing defect, the Supplier may repair, replace or provide an appropriate adjustment/credit. Normal wear and tear, improper washing,
          misuse, alteration or incorrect handling are excluded.
        </Clause>
        <Clause n="10" title="CANCELLATION OF ORDER">
          Once bulk production has commenced, cancellation requires written consent. For customized uniforms, the Customer shall be responsible for fabric,
          printing, embroidery, stitching, production and other costs already incurred if cancelled or substantially reduced. Advance may be adjusted against such
          costs.
        </Clause>
        <Clause n="11" title="PRICE CHANGES">
          Prices are based on confirmed specifications and quantities. Changes to design, fabric, quantity, printing, embroidery, accessories or specifications may
          result in revised pricing.
        </Clause>
        <Clause n="12" title="LOGO, DESIGN AND CUSTOMER MATERIAL">
          The Customer confirms it has the right to provide and authorize use of the school's name, logo, emblem, artwork and other materials. The Customer is
          responsible for third-party claims arising from Customer-supplied materials.
        </Clause>
        <Clause n="13" title="TRANSPORTATION">
          Transportation: {agreement.transportation}. Responsibility after delivery to the Customer or its authorized transporter shall be as mutually agreed.
        </Clause>
        <Clause n="14" title="UNCLAIMED / DELAYED GOODS">
          If completed goods remain uncollected for more than {agreement.unclaimed_goods_days} days after notification, the Supplier may charge reasonable storage
          and handling costs.
        </Clause>
        <Clause n="15" title="CONFIDENTIALITY">
          Both Parties shall keep commercially sensitive information, pricing, designs and business information confidential, except where disclosure is required
          by law.
        </Clause>
        <Clause n="16" title="DISPUTE RESOLUTION">
          The Parties shall first attempt to resolve disputes through mutual discussion. If unresolved, the matter shall be subject to applicable Indian law and
          courts having appropriate jurisdiction at Nellore, Andhra Pradesh.
        </Clause>
        <Clause n="17" title="ENTIRE AGREEMENT">
          This Agreement, quotation, purchase order, approved sample, size schedule and written specifications constitute the understanding between the Parties.
          Amendments should be made in writing and acknowledged by both Parties.
        </Clause>

        {/* ===== PAGE 2 ===== */}
        <div className="page-break" />
        <Letterhead businessName={businessName} businessAddress={businessAddress} settings={settings} />
        <h2 className="text-center text-base font-bold my-3">ORDER / SIZE SCHEDULE &amp; SIGNATURE PAGE</h2>

        <p className="font-bold mb-1">A. CUSTOMER &amp; ORDER DETAILS</p>
        <div className="text-xs mb-3 space-y-0.5">
          <p>School Name: {order.customer_name}</p>
          <p>School Address: {agreement.school_address || "—"}</p>
          <p>Contact Person: {agreement.contact_person || "—"} &nbsp; Mobile: {agreement.mobile || "—"}</p>
          <p>PO / Order No.: {order.order_number} &nbsp; Order Date: {order.order_date}</p>
          <p>Quotation No.: {agreement.quotation_no || "—"} &nbsp; Delivery Date: {order.due_date || "—"}</p>
        </div>

        <p className="font-bold mb-1">B. SIZE-WISE ORDER SCHEDULE</p>
        <table className="w-full border border-stone-500 border-collapse text-[10px] mb-3">
          <thead>
            <tr className="bg-stone-100">
              <th className="border border-stone-500 px-1 py-1">Item</th>
              <th className="border border-stone-500 px-1 py-1">2XS</th>
              <th className="border border-stone-500 px-1 py-1">XS</th>
              <th className="border border-stone-500 px-1 py-1">S</th>
              <th className="border border-stone-500 px-1 py-1">M</th>
              <th className="border border-stone-500 px-1 py-1">L</th>
              <th className="border border-stone-500 px-1 py-1">XL</th>
              <th className="border border-stone-500 px-1 py-1">2XL</th>
              <th className="border border-stone-500 px-1 py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.description}>
                <td className="border border-stone-500 px-1 py-2">{it.description}</td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2"></td>
                <td className="border border-stone-500 px-1 py-2 text-right">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-stone-500 mb-3">Size-wise breakdown to be filled in by hand and attached, or completed before bulk production.</p>

        <p className="font-bold mb-1">C. SPECIFICATION / APPROVAL CHECKLIST</p>
        <div className="grid grid-cols-2 gap-1 text-xs mb-4">
          <p>Fabric approved ☐ Yes ☐ No</p>
          <p>Colour approved ☐ Yes ☐ No</p>
          <p>Sample approved ☐ Yes ☐ No</p>
          <p>Logo/artwork approved ☐ Yes ☐ No</p>
          <p>Size chart approved ☐ Yes ☐ No</p>
          <p>Quantity confirmed ☐ Yes ☐ No</p>
          <p>Printing / embroidery ☐ Included ☐ N/A</p>
          <p>Transport ☐ Included ☐ Extra</p>
        </div>

        <p className="font-bold mb-1">D. CUSTOMER CONFIRMATION</p>
        <p className="text-xs mb-4">
          I/We confirm that the order details, quantities, sizes, specifications, prices, payment terms and delivery conditions have been reviewed and accepted.
          The approved sample and this schedule shall be treated as the basis for bulk production.
        </p>

        <div className="grid grid-cols-2 gap-8 text-xs mt-6">
          <div>
            <p className="font-semibold mb-6">FOR {businessName.toUpperCase()}</p>
            <p className="border-t border-stone-400 pt-1">Signature</p>
            <p className="mt-4">Name: _______________________</p>
            <p>Designation: _______________________</p>
            <p>Date: ___ / ___ / ______</p>
            <p className="mt-2 text-stone-400">Company Seal</p>
          </div>
          <div>
            <p className="font-semibold mb-6">FOR CUSTOMER / SCHOOL</p>
            <p className="border-t border-stone-400 pt-1">Signature</p>
            <p className="mt-4">Authorized Person: _______________________</p>
            <p>Designation: _______________________</p>
            <p>Date: ___ / ___ / ______</p>
            <p className="mt-2 text-stone-400">School Seal</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Letterhead({ businessName, businessAddress, settings }) {
  return (
    <div className="text-center border-b-2 border-stone-800 pb-2 mb-2">
      <img src="/logo-mark-navy.png" alt="" className="h-10 mx-auto mb-1" />
      <h1 className="text-lg font-extrabold">{businessName}</h1>
      <p className="text-[11px] text-stone-600">School Uniforms • Garment Manufacturing • Custom Uniform Solutions</p>
      <p className="text-[11px] text-stone-600">{businessAddress}</p>
      <p className="text-[11px] text-stone-600">
        GSTIN: {settings?.gstin || "—"} {settings?.phone ? `| Contact: ${settings.phone}` : ""}
      </p>
    </div>
  );
}

function Clause({ n, title, children }) {
  return (
    <div className="mb-2">
      <p><span className="font-bold">{n}. {title}.</span> <span>{children}</span></p>
    </div>
  );
}
