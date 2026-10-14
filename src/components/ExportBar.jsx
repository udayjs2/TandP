import { useState } from "react";
import { FileText, Presentation, FileSpreadsheet, Loader2 } from "lucide-react";
import { exportPDF, exportPPTX, exportXLSX } from "../lib/exporters";

// Three download buttons. `buildReport` is called at click time so the file
// always reflects what is on screen.
export default function ExportBar({ buildReport, disabled }) {
  const [busy, setBusy] = useState("");

  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn(buildReport());
    } catch (e) {
      console.error(e);
      alert(`Couldn't create the ${kind} file:\n${e?.message || e}`);
    }
    setBusy("");
  };

  const btn = (kind, label, Icon, fn) => (
    <button
      type="button"
      disabled={disabled || !!busy}
      onClick={() => run(kind, fn)}
      className="inline-flex items-center gap-1.5 text-xs font-medium border border-stone-300 bg-white hover:bg-stone-50 rounded-lg px-3 py-1.5 disabled:opacity-50"
    >
      {busy === kind ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {label}
    </button>
  );

  return (
    <div className="flex gap-2 flex-wrap">
      {btn("PDF", "PDF", FileText, exportPDF)}
      {btn("PowerPoint", "PowerPoint", Presentation, exportPPTX)}
      {btn("Excel", "Excel", FileSpreadsheet, exportXLSX)}
    </div>
  );
}
