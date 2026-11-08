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

// Opens a print window with one label per copy: [{ code, title, sub, copies }]
export function printLabels(labels) {
  const w = window.open("", "_blank", "width=800,height=700");
  if (!w) { alert("Allow pop-ups to print the labels."); return; }
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const cells = labels.flatMap((l) => Array.from({ length: Math.max(1, Number(l.copies) || 1) }, () =>
    `<div class="l"><div class="t">${esc(l.title)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ""}${barcodeSvg(l.code, { height: 46, module: 1.6 })}<div class="c">${esc(l.code)}</div></div>`)).join("");
  w.document.write(`<html><head><title>Barcode labels</title><style>
    body{font-family:Arial,sans-serif;margin:8mm}.g{display:flex;flex-wrap:wrap;gap:4mm}
    .l{width:60mm;border:1px dashed #aaa;padding:2mm;text-align:center;page-break-inside:avoid}
    .t{font-size:11px;font-weight:bold}.s{font-size:10px;color:#444}.c{font-size:10px;font-family:monospace}svg{max-width:100%;height:auto}
    @media print{.l{border:none}}</style></head><body><div class="g">${cells}</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`);
  w.document.close();
}
