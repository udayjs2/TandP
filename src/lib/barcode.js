// Code 128 (subset B) encoder — no dependency. Handles printable ASCII 32..126.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104, STOP = 106;

export function code128Modules(text) {
  const s = String(text ?? "");
  const vals = [START_B];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    vals.push(c >= 32 && c <= 126 ? c - 32 : 0);
  }
  let sum = START_B;
  vals.slice(1).forEach((v, i) => { sum += v * (i + 1); });
  vals.push(sum % 103, STOP);
  // widths: bar, space, bar, space ... starting with a bar
  return vals.map((v) => PATTERNS[v]).join("").split("").map(Number);
}

// SVG markup string for a barcode (used for screen and for printing labels)
export function barcodeSvg(text, { height = 50, module = 2, quiet = 10 } = {}) {
  const widths = code128Modules(text);
  const total = widths.reduce((a, b) => a + b, 0) * module + quiet * 2;
  let x = quiet, bars = "";
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w * module}" height="${height}" fill="#000"/>`;
    x += w * module;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total}" height="${height}" role="img" aria-label="${String(text).replace(/"/g, "")}"><rect width="${total}" height="${height}" fill="#fff"/>${bars}</svg>`;
}

// ---------- label printing for the iDPRT SP410 (203 dpi direct-thermal, 4-inch / max 108 mm print width, TSPL) ----------
export const DPMM = 8; // 203 dpi = 8 dots per mm
export const LABEL_SIZES = [
  { id: "50x25", w: 50, h: 25, name: "50 × 25 mm (small tag)" },
  { id: "50x30", w: 50, h: 30, name: "50 × 30 mm" },
  { id: "60x40", w: 60, h: 40, name: "60 × 40 mm" },
  { id: "75x50", w: 75, h: 50, name: "75 × 50 mm" },
  { id: "100x50", w: 100, h: 50, name: "100 × 50 mm" },
  { id: "100x100", w: 100, h: 100, name: "100 × 100 mm" },
  { id: "100x150", w: 100, h: 150, name: "100 × 150 mm (4×6 in)" },
];
export const sizeById = (id) => {
  const m = /^custom:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(id || "");
  if (m) return { id, w: Math.min(108, Math.max(20, Number(m[1]))), h: Math.max(15, Number(m[2])), name: "Custom" };
  return LABEL_SIZES.find((x) => x.id === id) || LABEL_SIZES[2];
};

// widest bar width (whole printer dots) that still fits the label: scanners need >= 2 dots (0.25 mm) to be reliable
export function fitModuleDots(text, widthMm, marginMm = 3) {
  const modules = code128Modules(text).reduce((a, b) => a + b, 0);
  const avail = (widthMm - marginMm * 2) * DPMM;
  return Math.max(1, Math.min(4, Math.floor(avail / modules)));
}

const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// HTML for one label page, sized in millimetres so the driver prints it 1:1
export function labelHtml(l, size) {
  const dots = fitModuleDots(l.code, size.w);
  const modules = code128Modules(l.code);
  const total = modules.reduce((a, b) => a + b, 0);
  const modMm = dots / DPMM;
  let x = 0, bars = "";
  modules.forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="10" fill="#000"/>`; x += w; });
  const barH = Math.min(16, Math.max(8, size.h - (l.sub ? 15 : 11) - 6));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 10" preserveAspectRatio="none" shape-rendering="crispEdges" style="width:${(total * modMm).toFixed(3)}mm;height:${barH}mm">${bars}</svg>`;
  return `<div class="l"><div class="t">${esc(l.title)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ""}${svg}<div class="c">${esc(l.code)}</div></div>`;
}

// Opens the print dialog with one label per page. Choose "iDPRT SP410" (or the label printer) and paper = the label size.
export function printLabels(labels, size = sizeById("60x40")) {
  const w = window.open("", "_blank", "width=700,height=700");
  if (!w) { alert("Allow pop-ups to print the labels."); return; }
  const cells = labels.flatMap((l) => Array.from({ length: Math.max(1, Number(l.copies) || 1) }, () => labelHtml(l, size))).join("");
  w.document.write(`<html><head><title>Barcode labels</title><style>
    @page{size:${size.w}mm ${size.h}mm;margin:0}
    *{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;color:#000}
    .l{width:${size.w}mm;height:${size.h}mm;padding:1.5mm 2mm;overflow:hidden;text-align:center;page-break-after:always;break-after:page;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .t{font-size:${size.h <= 25 ? 7 : 9}pt;font-weight:bold;line-height:1.1;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .s{font-size:${size.h <= 25 ? 6 : 7.5}pt;line-height:1.1;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .c{font-family:'Courier New',monospace;font-size:${size.h <= 25 ? 7 : 8.5}pt;line-height:1.1;margin-top:.6mm}
    svg{display:block;margin:.8mm auto 0}
    @media screen{body{background:#eee}.l{background:#fff;margin:6px auto;border:1px dashed #999}}
  </style></head><body>${cells}<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
  w.document.close();
}

// A test page in the chosen size: a border + 10 mm ruler. If all four borders print inside the label, the size is right.
export function printTestLabel(size) {
  const w = window.open("", "_blank", "width=600,height=600");
  if (!w) { alert("Allow pop-ups to print."); return; }
  let ticks = "";
  for (let x = 10; x < size.w; x += 10) ticks += `<i style="left:${x}mm;top:0;width:0;height:${x % 50 === 0 ? 4 : 2.5}mm"></i>`;
  for (let y = 10; y < size.h; y += 10) ticks += `<i style="top:${y}mm;left:0;height:0;width:${y % 50 === 0 ? 4 : 2.5}mm"></i>`;
  w.document.write(`<html><head><title>Label size test</title><style>
    @page{size:${size.w}mm ${size.h}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
    .l{position:relative;width:${size.w}mm;height:${size.h}mm;border:0.6mm solid #000;font-family:Arial,sans-serif;text-align:center;padding-top:${Math.max(3, size.h / 2 - 8)}mm;page-break-after:avoid;overflow:hidden}
    i{position:absolute;border-left:.3mm solid #000;border-top:.3mm solid #000}.b{font-size:12pt;font-weight:bold}.s{font-size:7pt;margin-top:1mm}
    @media screen{body{background:#eee}.l{background:#fff;margin:8px}}</style></head>
    <body><div class="l">${ticks}<div class="b">${size.w} × ${size.h} mm</div><div class="s">All 4 borders printed inside the label = size is right</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
  w.document.close();
}

// ---------- native TSPL (the SP410's own command language) ----------
const clip = (t, n) => { const s = String(t ?? "").replace(/·/g, "-").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, " "); return s.length > n ? s.slice(0, n - 1) + "." : s; };

export function tsplFor(labels, size = sizeById("60x40")) {
  const W = size.w * DPMM, H = size.h * DPMM;
  const out = [];
  labels.forEach((l) => {
    const copies = Math.max(1, Number(l.copies) || 1);
    const narrow = fitModuleDots(l.code, size.w);
    const modules = code128Modules(l.code).reduce((a, b) => a + b, 0);
    const bw = modules * narrow;
    const x = Math.max(8, Math.floor((W - bw) / 2));
    const chars = Math.floor((W - 16) / 12);          // font "2" is 12 dots wide
    let y = 6;
    out.push("SIZE " + size.w + " mm," + size.h + " mm", "GAP 2 mm,0 mm", "DIRECTION 1", "REFERENCE 0,0", "CLS");
    out.push(`TEXT ${Math.max(8, Math.floor((W - Math.min(String(l.title).length, chars) * 12) / 2))},${y},"2",0,1,1,"${clip(l.title, chars)}"`);
    y += 24;
    if (l.sub) { out.push(`TEXT ${Math.max(8, Math.floor((W - Math.min(String(l.sub).length, chars) * 12) / 2))},${y},"2",0,1,1,"${clip(l.sub, chars)}"`); y += 24; }
    const bh = Math.max(40, Math.min(H - y - 38, 120));
    out.push(`BARCODE ${x},${y},"128",${bh},1,0,${narrow},${narrow * 2},"${clip(l.code, 40)}"`);
    out.push(`PRINT ${copies},1`);
  });
  return out.join("\r\n") + "\r\n";
}

// saves the TSPL commands as a .prn file that can be sent straight to the printer
export function downloadTspl(labels, size, name = "barcode-labels") {
  const blob = new Blob([tsplFor(labels, size)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.prn`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
