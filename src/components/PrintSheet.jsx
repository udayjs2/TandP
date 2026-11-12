import { createPortal } from "react-dom";

// Full-screen preview that prints as REAL multi-page A4 paper. The sheet is rendered into <body> (outside the app's
// scroll containers) and, when printing, everything else is hidden and the sheet flows across as many pages as it needs.
// Previously the preview was a fixed, scrolling box, so only the part visible on screen was printed (and repeated on every page).
const CSS = `
@page { size: A4; margin: 0; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.print-portal) { display: none !important; }
  .print-portal { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; background: #fff !important; }
  .no-print { display: none !important; }
  .print-page { max-width: none !important; width: 100% !important; margin: 0 !important; padding: 8mm 10mm !important; box-sizing: border-box; }
  .print-page tr, .print-page .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .print-page thead { display: table-header-group; }
  .print-page .print-tight { padding: 5mm !important; }
  .print-page .mb-5 { margin-bottom: 9px !important; }
  .print-page .mb-4 { margin-bottom: 7px !important; }
  .print-page .py-2 { padding-top: 4px !important; padding-bottom: 4px !important; }
  .print-page .py-1\.5 { padding-top: 3px !important; padding-bottom: 3px !important; }
  .print-page h2, .print-page h3 { break-after: avoid; }
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
