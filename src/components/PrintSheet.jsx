import { createPortal } from "react-dom";

// Full-screen preview that prints as REAL multi-page A4 paper. The sheet is rendered into <body> (outside the app's
// scroll containers) and, when printing, everything else is hidden and the sheet flows across as many pages as it needs.
// Previously the preview was a fixed, scrolling box, so only the part visible on screen was printed (and repeated on every page).
const CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.print-portal) { display: none !important; }
  .print-portal { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; background: #fff !important; }
  .no-print { display: none !important; }
  .print-page { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box; }
  .print-page tr, .print-page .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .print-page thead { display: table-header-group; }
  .print-page .print-tight { padding: 5mm !important; }
  .print-page .mb-5 { margin-bottom: 9px !important; }
  .print-page .mb-4 { margin-bottom: 7px !important; }
  .print-page .py-2 { padding-top: 4px !important; padding-bottom: 4px !important; }
  .print-page .py-1\.5 { padding-top: 3px !important; padding-bottom: 3px !important; }
  .print-wrap { width: 100%; border-collapse: collapse; }
  .print-wrap > thead { display: table-header-group; }
  .print-wrap > thead > tr > td, .print-wrap > tbody > tr > td { padding: 0; }
  .print-page .print-wrap > tbody > tr { break-inside: auto; page-break-inside: auto; }
  .print-page h2, .print-page h3 { break-after: avoid; }
  .print-border { display: block !important; position: fixed; top: 0; left: 0; right: 0; bottom: 0; border: 1.4px solid #1f2a5c; outline: 0.5px solid #1f2a5c; outline-offset: -3.5px; pointer-events: none; z-index: 0; }
  .print-frame-box { border: 0 !important; }
  .print-wrap > tfoot { display: table-footer-group; }
  .print-pad { padding: 0 8mm !important; }
}
`;

export default function PrintSheet({ children }) {
  return createPortal(
    <div className="print-portal fixed inset-0 bg-white text-stone-900 z-50 overflow-auto">
      <style>{CSS}</style>
      {children}
    </div>,
    document.body
  );
}

// Letterhead like the company's offer-letter header: boxed, logo on the left, centred name/address/contact, thick navy bar.
export function PrintHeader({ name = "T AND P TEXTILES", address, phone, gstin, subtitle }) {
  return (
    <div data-letterhead style={{ background: "#fff" }}>
      <div style={{ position: "relative", border: "1.4px solid #1f2a5c", borderBottom: "2px solid #111", padding: "8px 12px 8px 12px", textAlign: "center" }}>
        <img src="/logo-mark-navy.png" alt="T&P" data-invoice-logo style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", height: 54, width: "auto" }} />
        <div style={{ padding: "0 150px" }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1.2 }}>{name}</div>
          {subtitle && <div style={{ fontSize: 11, letterSpacing: "0.12em", color: "#555" }}>{subtitle}</div>}
          {address && <div style={{ fontSize: 12.5, color: "#333", marginTop: 3, lineHeight: 1.35 }}>{address}</div>}
          {(phone || gstin) && <div style={{ fontSize: 12.5, color: "#333", marginTop: 2 }}>{phone && <>Mobile: {phone}</>}{phone && gstin && "  |  "}{gstin && <>GSTIN: {gstin}</>}</div>}
        </div>
      </div>
      <div style={{ height: 9, background: "#2b3a8c", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }} />
    </div>
  );
}

// Wraps a document so `header` is repeated at the top of EVERY printed page, with a border frame on every page
// and breathing room at the bottom so text never runs into the border.
export function PrintFrame({ header, children }) {
  return (
    <>
      <div className="print-border" style={{ display: "none" }} />
      <div className="print-frame-box" style={{ border: "1.4px solid #1f2a5c" }}>
        <table className="print-wrap w-full" style={{ borderCollapse: "collapse" }}>
          <thead><tr><td>{header}</td></tr></thead>
          <tbody><tr><td style={{ verticalAlign: "top" }}><div className="print-pad" style={{ padding: "10px 16px 0" }}>{children}</div></td></tr></tbody>
          <tfoot><tr><td><div style={{ height: "9mm" }} /></td></tr></tfoot>
        </table>
      </div>
    </>
  );
}
