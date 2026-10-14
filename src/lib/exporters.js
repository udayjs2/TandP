// Download a report as PDF, PowerPoint or Excel.
//
// A report is plain data, so the same object feeds all three formats:
// {
//   title, subtitle, filename,
//   sections: [{
//     heading,
//     kpis?:    [{ label, value }],                       // value already formatted
//     bullets?: [string],
//     charts?:  [chartSpec],                              // see lib/charts.js
//     table?:   { columns: [{ label, type }], rows: [[...]] }   // type: text | money | pct | int | num
//   }]
// }
// The export libraries are loaded only when a button is clicked, so they don't
// slow down the rest of the app.
import { chartToDataUrl } from "./charts";

const inr = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const formatCell = (type, v) => {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money") return inr(v);
  if (type === "pct") return `${Number(v).toFixed(1)}%`;
  if (type === "int") return Math.round(Number(v)).toLocaleString("en-IN");
  if (type === "num") return (Math.round(Number(v) * 10) / 10).toLocaleString("en-IN");
  return String(v);
};

// jsPDF's built-in fonts only cover basic Latin, so swap a few common symbols.
const pdfSafe = (s) =>
  String(s ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7E -ÿ\n]/g, "?");

const download = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

// ---------------------------------------------------------------- PDF
export async function exportPDF(report) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = 0;

  const space = (h) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };

  doc.setFillColor(30, 27, 75);
  doc.rect(0, 0, W, 74, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(pdfSafe(report.title), M, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(pdfSafe(report.subtitle || ""), M, 54);
  y = 96;

  for (const sec of report.sections || []) {
    space(40);
    doc.setTextColor(30, 27, 75);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(pdfSafe(sec.heading), M, y);
    y += 16;

    if (sec.kpis?.length) {
      const perRow = 4;
      const gap = 8;
      const bw = (W - 2 * M - gap * (perRow - 1)) / perRow;
      for (let i = 0; i < sec.kpis.length; i += perRow) {
        space(52);
        sec.kpis.slice(i, i + perRow).forEach((k, j) => {
          const x = M + j * (bw + gap);
          doc.setFillColor(245, 245, 244);
          doc.roundedRect(x, y, bw, 44, 4, 4, "F");
          doc.setTextColor(120, 113, 108);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(pdfSafe(k.label).toUpperCase(), x + 8, y + 15, { maxWidth: bw - 16 });
          doc.setTextColor(28, 25, 23);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(13);
          doc.text(pdfSafe(k.value), x + 8, y + 34, { maxWidth: bw - 16 });
        });
        y += 52;
      }
    }

    if (sec.bullets?.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(60, 56, 52);
      for (const b of sec.bullets) {
        const lines = doc.splitTextToSize(pdfSafe(b), W - 2 * M - 14);
        space(lines.length * 12 + 4);
        doc.text("-", M, y);
        doc.text(lines, M + 12, y);
        y += lines.length * 12 + 4;
      }
      y += 4;
    }

    for (const spec of sec.charts || []) {
      const iw = W - 2 * M;
      const ih = (iw * 520) / 1100;
      space(ih + 10);
      doc.addImage(chartToDataUrl(spec, 1100, 520), "PNG", M, y, iw, ih);
      y += ih + 12;
    }

    if (sec.table?.rows?.length) {
      space(60);
      autoTable(doc, {
        startY: y,
        head: [sec.table.columns.map((c) => pdfSafe(c.label))],
        body: sec.table.rows.map((r) => r.map((v, i) => pdfSafe(formatCell(sec.table.columns[i].type, v)))),
        styles: { fontSize: 8, cellPadding: 3, textColor: [41, 37, 36] },
        headStyles: { fillColor: [67, 56, 202], textColor: 255 },
        alternateRowStyles: { fillColor: [250, 250, 249] },
        margin: { left: M, right: M, bottom: M },
        columnStyles: Object.fromEntries(
          sec.table.columns.map((c, i) => [i, { halign: c.type && c.type !== "text" ? "right" : "left" }])
        ),
      });
      y = doc.lastAutoTable.finalY + 16;
    }
    y += 6;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`T&P Textiles - page ${p} of ${pages}`, W / 2, H - 18, { align: "center" });
  }
  doc.save(`${report.filename}.pdf`);
}

// ---------------------------------------------------------------- PowerPoint
export async function exportPPTX(report) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = report.title;

  const cover = pptx.addSlide();
  cover.background = { color: "1E1B4B" };
  cover.addText(report.title, { x: 0.7, y: 2.4, w: 12, h: 1.2, fontSize: 36, bold: true, color: "FFFFFF" });
  cover.addText(report.subtitle || "", { x: 0.7, y: 3.7, w: 12, h: 0.6, fontSize: 16, color: "C7D2FE" });
  cover.addText("T&P Textiles", { x: 0.7, y: 6.6, w: 6, h: 0.4, fontSize: 12, color: "A5B4FC" });

  const head = (slide, text) =>
    slide.addText(text, { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 24, bold: true, color: "1E1B4B" });

  for (const sec of report.sections || []) {
    if (sec.kpis?.length || sec.bullets?.length) {
      const s = pptx.addSlide();
      head(s, sec.heading);
      let y = 1.2;
      if (sec.kpis?.length) {
        sec.kpis.slice(0, 8).forEach((k, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          s.addText(
            [
              { text: `${k.label}\n`, options: { fontSize: 11, color: "78716C" } },
              { text: String(k.value), options: { fontSize: 22, bold: true, color: "1C1917" } },
            ],
            { x: 0.5 + col * 3.1, y: y + row * 1.15, w: 2.95, h: 1.0, fill: { color: "F5F5F4" }, margin: 8, valign: "middle" }
          );
        });
        y += Math.ceil(Math.min(sec.kpis.length, 8) / 4) * 1.15 + 0.2;
      }
      if (sec.bullets?.length) {
        s.addText(
          sec.bullets.slice(0, 9).map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })),
          { x: 0.5, y, w: 12.3, h: 7.0 - y, fontSize: 14, color: "44403C", valign: "top" }
        );
      }
    }

    for (const spec of sec.charts || []) {
      const s = pptx.addSlide();
      head(s, sec.heading);
      const data = chartToDataUrl(spec, 1100, 520).replace(/^data:/, "");
      s.addImage({ data, x: 0.5, y: 1.1, w: 12.3, h: (12.3 * 520) / 1100 });
    }

    if (sec.table?.rows?.length) {
      const PER = 12;
      for (let i = 0; i < sec.table.rows.length; i += PER) {
        const s = pptx.addSlide();
        head(s, i === 0 ? sec.heading : `${sec.heading} (cont.)`);
        const header = sec.table.columns.map((c) => ({
          text: c.label,
          options: { bold: true, color: "FFFFFF", fill: { color: "4338CA" }, fontSize: 11 },
        }));
        const body = sec.table.rows.slice(i, i + PER).map((r) =>
          r.map((v, ci) => ({
            text: formatCell(sec.table.columns[ci].type, v),
            options: { fontSize: 10.5, color: "292524", align: sec.table.columns[ci].type && sec.table.columns[ci].type !== "text" ? "right" : "left" },
          }))
        );
        s.addTable([header, ...body], { x: 0.5, y: 1.2, w: 12.3, border: { type: "solid", pt: 0.5, color: "D6D3D1" } });
      }
    }
  }
  await pptx.writeFile({ fileName: `${report.filename}.pptx` });
}

// ---------------------------------------------------------------- Excel
const NUMFMT = { money: '"₹"#,##0', pct: '0.0"%"', int: "#,##0", num: "#,##0.0" };

export async function exportXLSX(report) {
  const mod = await import("exceljs/dist/exceljs.min.js");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "T&P Textiles ERP";

  // Summary sheet
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 38 }, { width: 28 }];
  sum.addRow([report.title]).font = { bold: true, size: 16 };
  sum.addRow([report.subtitle || ""]).font = { color: { argb: "FF78716C" } };
  sum.addRow([]);
  for (const sec of report.sections || []) {
    if (!sec.kpis?.length && !sec.bullets?.length) continue;
    const h = sum.addRow([sec.heading]);
    h.font = { bold: true, size: 12, color: { argb: "FF1E1B4B" } };
    (sec.kpis || []).forEach((k) => sum.addRow([k.label, k.value]));
    (sec.bullets || []).forEach((b) => {
      const r = sum.addRow([b]);
      r.alignment = { wrapText: true, vertical: "top" };
      sum.mergeCells(r.number, 1, r.number, 2);
      r.height = Math.max(15, Math.ceil(String(b).length / 70) * 15);
    });
    sum.addRow([]);
  }

  // One sheet per table
  const used = new Set(["Summary", "Charts"]);
  for (const sec of report.sections || []) {
    if (!sec.table?.rows?.length) continue;
    let name = String(sec.heading).replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Data";
    let n = 2;
    while (used.has(name)) name = `${name.slice(0, 25)} ${n++}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    const cols = sec.table.columns;
    const headRow = ws.addRow(cols.map((c) => c.label));
    headRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
    sec.table.rows.forEach((r) => {
      const row = ws.addRow(r.map((v, i) => (cols[i].type && cols[i].type !== "text" && v !== null && v !== "" ? Number(v) : v ?? "")));
      cols.forEach((c, i) => {
        if (NUMFMT[c.type]) row.getCell(i + 1).numFmt = NUMFMT[c.type];
      });
    });
    cols.forEach((c, i) => {
      const longest = Math.max(String(c.label).length, ...sec.table.rows.map((r) => String(formatCell(c.type, r[i])).length));
      ws.getColumn(i + 1).width = Math.min(42, Math.max(10, longest + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  // Charts sheet (pictures of the same charts shown in the PDF / PPT)
  const charts = (report.sections || []).flatMap((s) => s.charts || []);
  if (charts.length) {
    const ws = wb.addWorksheet("Charts");
    let row = 0;
    charts.forEach((spec) => {
      const id = wb.addImage({ base64: chartToDataUrl(spec, 1100, 520), extension: "png" });
      ws.addImage(id, { tl: { col: 0, row }, ext: { width: 880, height: 416 } });
      row += 22;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${report.filename}.xlsx`);
}
