// Tiny canvas chart drawer shared by the on-screen charts AND the PDF /
// PowerPoint / Excel exports, so a chart looks the same everywhere.
//
// spec = {
//   type: "bar" | "hbar" | "line" | "pie",
//   title?: string,
//   labels: string[],
//   series: [{ name, values: number[], color?: string, colors?: string[] }],
//   format?: (n) => string      // value formatter for axis / labels
//   signColors?: boolean        // bar: green when >= 0, red when < 0
// }

export const PALETTE = ["#4338ca", "#d97706", "#059669", "#e11d48", "#0284c7", "#7c3aed", "#0d9488", "#ea580c"];
const GOOD = "#059669";
const BAD = "#e11d48";
const INK = "#44403c";
const GRID = "#e7e5e4";

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
};

const compact = (n) => {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}${Math.round(a * 10) / 10}`;
};

const trunc = (ctx, text, maxW) => {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
};

export function drawChart(canvas, spec, width = 720, height = 320, scale = 1) {
  const ctx = canvas.getContext("2d");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  const fmt = spec.format || compact;
  const labels = spec.labels || [];
  const series = spec.series || [];
  let top = 12;

  if (spec.title) {
    ctx.fillStyle = INK;
    ctx.font = "600 14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(spec.title, 12, 16);
    top = 34;
  }

  const hasData = series.some((s) => (s.values || []).some((v) => Number(v) !== 0));
  if (!labels.length || !series.length || !hasData) {
    ctx.fillStyle = "#a8a29e";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data for this period", width / 2, height / 2 + 6);
    return canvas;
  }

  // legend (multi-series) along the bottom
  const showLegend = series.length > 1 && spec.type !== "pie";
  const bottomPad = showLegend ? 26 : 8;
  const colorOf = (s, i) => s.color || PALETTE[i % PALETTE.length];

  if (spec.type === "pie") {
    const vals = series[0].values.map((v) => Math.max(0, Number(v) || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = width * 0.3;
    const cy = top + (height - top) / 2;
    const r = Math.min(width * 0.26, (height - top - 16) / 2);
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = (series[0].colors && series[0].colors[i]) || PALETTE[i % PALETTE.length];
      ctx.fill();
      a0 = a1;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    labels.forEach((l, i) => {
      const y = top + 10 + i * 20;
      if (y > height - 10) return;
      ctx.fillStyle = (series[0].colors && series[0].colors[i]) || PALETTE[i % PALETTE.length];
      ctx.fillRect(width * 0.62, y - 6, 12, 12);
      ctx.fillStyle = INK;
      ctx.fillText(trunc(ctx, `${l} — ${fmt(vals[i])} (${Math.round((vals[i] / total) * 100)}%)`, width * 0.36), width * 0.62 + 18, y);
    });
    return canvas;
  }

  const all = series.flatMap((s) => s.values.map((v) => Number(v) || 0));
  const dataMax = Math.max(...all, 0);
  const dataMin = Math.min(...all, 0);

  if (spec.type === "hbar") {
    ctx.font = "11px sans-serif";
    const labelW = Math.min(150, Math.max(...labels.map((l) => ctx.measureText(String(l)).width)) + 8);
    const left = 12 + labelW;
    const right = width - 56;
    const rows = labels.length;
    const plotH = height - top - bottomPad;
    const rowH = plotH / rows;
    const max = niceMax(dataMax);
    const min = dataMin < 0 ? -niceMax(-dataMin) : 0;
    const x0 = left + ((0 - min) / (max - min)) * (right - left);
    labels.forEach((l, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = INK;
      ctx.textAlign = "right";
      ctx.font = "11px sans-serif";
      ctx.fillText(trunc(ctx, l, labelW - 6), left - 6, y + rowH / 2);
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        const bh = Math.max(4, Math.min(22, (rowH - 6) / series.length));
        const by = y + (rowH - bh * series.length) / 2 + si * bh;
        const x1 = left + ((v - min) / (max - min)) * (right - left);
        ctx.fillStyle = spec.signColors ? (v >= 0 ? GOOD : BAD) : (s.colors && s.colors[i]) || colorOf(s, si);
        ctx.fillRect(Math.min(x0, x1), by, Math.max(1, Math.abs(x1 - x0)), bh - 2);
        ctx.fillStyle = INK;
        ctx.textAlign = v >= 0 ? "left" : "right";
        ctx.fillText(fmt(v), v >= 0 ? x1 + 4 : x1 - 4, by + (bh - 2) / 2);
      });
    });
    ctx.strokeStyle = "#a8a29e";
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x0, top + plotH);
    ctx.stroke();
  } else {
    // vertical bar or line
    const left = 52;
    const right = width - 14;
    const labelRowH = 30;
    const plotTop = top + 6;
    const plotBottom = height - bottomPad - labelRowH;
    const max = niceMax(dataMax);
    const min = dataMin < 0 ? -niceMax(-dataMin) : 0;
    const yOf = (v) => plotBottom - ((v - min) / (max - min)) * (plotBottom - plotTop);

    // grid + y labels
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    for (let g = 0; g <= 4; g++) {
      const v = min + ((max - min) * g) / 4;
      const y = yOf(v);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = "#78716c";
      ctx.fillText(fmt(v), left - 6, y);
    }
    const slot = (right - left) / labels.length;
    const zeroY = yOf(0);

    if (spec.type === "line") {
      series.forEach((s, si) => {
        const c = colorOf(s, si);
        ctx.strokeStyle = c;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let pen = false; // null / undefined values leave a gap in the line
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) { pen = false; return; }
          const x = left + slot * i + slot / 2;
          const y = yOf(Number(v) || 0);
          if (!pen) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          pen = true;
        });
        ctx.stroke();
        ctx.fillStyle = c;
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) return;
          const x = left + slot * i + slot / 2;
          ctx.beginPath();
          ctx.arc(x, yOf(Number(v) || 0), 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    } else {
      const groupW = slot * 0.72;
      const bw = groupW / series.length;
      series.forEach((s, si) => {
        s.values.forEach((raw, i) => {
          const v = Number(raw) || 0;
          const x = left + slot * i + (slot - groupW) / 2 + si * bw;
          const y = yOf(v);
          ctx.fillStyle = spec.signColors ? (v >= 0 ? GOOD : BAD) : (s.colors && s.colors[i]) || colorOf(s, si);
          ctx.fillRect(x, Math.min(y, zeroY), Math.max(1, bw - 2), Math.max(1, Math.abs(zeroY - y)));
          if (labels.length <= 14 && series.length <= 2) {
            ctx.fillStyle = INK;
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(fmt(v), x + (bw - 2) / 2, v >= 0 ? y - 7 : y + 9);
          }
        });
      });
    }
    ctx.strokeStyle = "#a8a29e";
    ctx.beginPath();
    ctx.moveTo(left, zeroY);
    ctx.lineTo(right, zeroY);
    ctx.stroke();

    // x labels (rotate-free: alternate / skip if crowded)
    ctx.font = "11px sans-serif";
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    const every = Math.ceil(labels.length / Math.max(1, Math.floor((right - left) / 56)));
    labels.forEach((l, i) => {
      if (i % every !== 0) return;
      ctx.fillText(trunc(ctx, l, Math.max(40, slot * every - 4)), left + slot * i + slot / 2, plotBottom + 16 + (spec.type === "bar" ? 0 : 0));
    });
  }

  if (showLegend) {
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    let x = 12;
    series.forEach((s, i) => {
      ctx.fillStyle = colorOf(s, i);
      ctx.fillRect(x, height - 17, 11, 11);
      ctx.fillStyle = INK;
      ctx.fillText(s.name, x + 16, height - 11);
      x += 16 + ctx.measureText(s.name).width + 18;
    });
  }
  return canvas;
}

// PNG data URL for the exports
export function chartToDataUrl(spec, width = 1100, height = 520) {
  const c = document.createElement("canvas");
  drawChart(c, spec, width, height, 1);
  return c.toDataURL("image/png");
}
