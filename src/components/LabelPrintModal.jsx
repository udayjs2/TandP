import { useState } from "react";
import { Printer, FileDown } from "lucide-react";
import { Modal, Field, inputCls, Btn } from "./ui";
import BarcodeView from "./BarcodeView";
import { LABEL_SIZES, sizeById, printLabels, printTestLabel, downloadTspl } from "../lib/barcode";

const KEY = "tp_label_size";
const readSize = () => { try { return localStorage.getItem(KEY) || "60x40"; } catch { return "60x40"; } };

// lines: [{ code, title, sub, copies }] — pick the label size loaded in the iDPRT SP410, set copies, then print
export default function LabelPrintModal({ lines: initial, onClose }) {
  const [lines, setLines] = useState(initial);
  const [sizeId, setSizeId] = useState(readSize);
  const custom = /^custom:/.test(sizeId);
  const [cw, ch] = custom ? sizeId.slice(7).split("x") : ["70", "40"];
  const size = sizeById(sizeId);
  const pick = (id) => { setSizeId(id); try { localStorage.setItem(KEY, id); } catch { /* private mode */ } };
  const total = lines.reduce((s, l) => s + (Number(l.copies) || 0), 0);
  const active = lines.filter((l) => Number(l.copies) > 0);
  return (
    <Modal title="Print barcode labels" onClose={onClose}>
      <Field label="Label size (the labels loaded in the SP410)">
        <select className={inputCls} value={sizeId} onChange={(e) => pick(e.target.value)} aria-label="Label size">
          {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={custom ? sizeId : "custom:70x40"}>Other size…</option>
        </select>
      </Field>
      {custom && (
        <div className="grid grid-cols-2 gap-3 -mt-1">
          <Field label="Width (mm, max 108)"><input type="number" min="20" max="108" className={inputCls} value={cw} aria-label="Label width" onChange={(e) => pick(`custom:${e.target.value || 0}x${ch}`)} /></Field>
          <Field label="Height (mm)"><input type="number" min="15" className={inputCls} value={ch} aria-label="Label height" onChange={(e) => pick(`custom:${cw}x${e.target.value || 0}`)} /></Field>
        </div>
      )}
      <p className="text-xs text-stone-500 -mt-1 mb-3">
        Not sure of the size? Measure the label (width × height), or tap <b>Test label</b> for different sizes — the size where all four borders print inside the label is right.
        <button type="button" onClick={() => printTestLabel(size)} className="ml-1 underline text-indigo-700">Test label ({size.w} × {size.h})</button>
      </p>
      <div className="space-y-2 mb-3">
        {lines.map((l, i) => (
          <div key={l.code} className="flex items-center gap-3 border border-stone-200 rounded-lg p-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{l.title}</div>
              <BarcodeView code={l.code} height={28} module={1.2} />
              <div className="font-mono text-[11px] text-stone-500">{l.code}</div>
            </div>
            <label className="text-xs text-stone-500">Copies
              <input type="number" min="0" className={inputCls + " w-20"} value={l.copies} aria-label={`Copies of ${l.code}`}
                onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, copies: e.target.value } : x)))} />
            </label>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-500 mb-3">
        <b>Print:</b> in the print window choose the <b>iDPRT SP410</b>, paper size {size.w} × {size.h} mm, margins <b>None</b>, scale <b>100%</b>.
        <br /><b>TSPL file:</b> the printer's own command file (.prn) for direct/raw printing — best sharpness. Total {total} label{total === 1 ? "" : "s"}.
      </p>
      <div className="flex justify-end gap-2 flex-wrap">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
        <Btn variant="ghost" disabled={!active.length} onClick={() => downloadTspl(active, size, "barcode-labels")}><FileDown size={14} /> Download TSPL (.prn)</Btn>
        <Btn disabled={!active.length} onClick={() => printLabels(active, size)}><Printer size={14} /> Print</Btn>
      </div>
    </Modal>
  );
}
