// Helpers for the Measurements module: reading Excel / CSV sheets, guessing which column is which,
// and counting students by size.

// ---- CSV (quotes and commas handled)
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => String(x).trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => String(x).trim() !== "")) rows.push(row);
  return rows;
}

// a sheet (array of rows) -> { headers, rows } using the first non-empty row as headers
export function sheetToTable(matrix) {
  const rows = (matrix || []).filter((r) => r && r.some((c) => String(c ?? "").trim() !== ""));
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  return { headers, rows: rows.slice(1).map((r) => headers.map((_, i) => r[i] ?? "")) };
}

export async function readTableFromFile(file) {
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return sheetToTable(parseCsv(await file.text()));
  const mod = await import("exceljs/dist/exceljs.min.js");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const matrix = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      let v = cell.value;
      if (v && typeof v === "object") v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join("") : "");
      vals[col - 1] = v;
    });
    matrix.push(Array.from(vals, (x) => x ?? ""));
  });
  return sheetToTable(matrix);
}

// ---- tidy values
export const normSize = (v) => {
  let s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d+(\.0+)?$/.test(s)) s = String(parseInt(s, 10));
  return s.toUpperCase();
};
export const cleanText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const normClass = (v) => {
  const s = cleanText(v).replace(/\.0+$/, "");
  return s;
};
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---- guess what each column means
// kinds: name | class | section | roll | gender | size (of an item) | field (a measurement of an item) | ignore
export function autoMap(headers, items) {
  const itemKeys = (items || []).map((it) => ({ it, k: key(it.name), alias: aliases(it.name) }));
  let last = null; // a bare "Length" / "Chest" column belongs to the item named in the column before it
  const fieldOf = (it, rest) => (it.fields || []).find((x) => key(x) === rest || (rest.length >= 4 && rest.startsWith(key(x))));
  return headers.map((h) => {
    const k = key(h);
    if (!k) return { kind: "ignore" };
    if (/^(student)?name$|^studentsname$|^nameofthestudent$|^pupil/.test(k) || k === "student") return { kind: "name" };
    if (/^(class|std|standard|grade|classname)$/.test(k)) return { kind: "class" };
    if (/^(section|sec|div|division)$/.test(k)) return { kind: "section" };
    if (/^(rollno|roll|rollnumber|admno|admissionno|sno|slno)$/.test(k)) return { kind: "roll" };
    if (/^(gender|sex|boygirl)$/.test(k)) return { kind: "gender" };
    // an item named in the header; the longest alias wins so "T-Shirt" is not taken for "Shirt" and "Pants" is not "Pant" + "s"
    let best = null;
    itemKeys.forEach((x) => x.alias.forEach((a) => { if (k.startsWith(a) && (!best || a.length > best.a.length)) best = { it: x.it, a }; }));
    if (best) {
      last = best.it;
      let rest = k.slice(best.a.length);
      if (rest === "s") rest = ""; else if (rest.startsWith("s") && ["size", "sz"].includes(rest.slice(1))) rest = rest.slice(1);
      if (!rest || rest === "size" || rest === "sz") return { kind: "size", item: best.it.name };
      const f = fieldOf(best.it, rest);
      if (f) return { kind: "field", item: best.it.name, field: f };
      return { kind: "ignore" };
    }
    if (last) {
      const f = fieldOf(last, k);
      if (f) return { kind: "field", item: last.name, field: f };
    }
    return { kind: "ignore" };
  });
}
function aliases(name) {
  const k = key(name);
  const out = [k];
  if (k === "pant") out.push("trouser");
  if (k === "tshirt") out.push("tee");
  if (k === "coat") out.push("overcoat");
  return out;
}

// rows + mapping -> [{ student: {...}, records: [{ item, size, m }] }]
export function buildEntries(rows, mapping) {
  const out = [];
  rows.forEach((r) => {
    const st = { name: "", class_name: "", section: "", roll_no: "", gender: "" };
    const byItem = {};
    mapping.forEach((m, i) => {
      const v = r[i];
      if (m.kind === "name") st.name = cleanText(v);
      else if (m.kind === "class") st.class_name = normClass(v);
      else if (m.kind === "section") st.section = cleanText(v).toUpperCase();
      else if (m.kind === "roll") st.roll_no = cleanText(v).replace(/\.0+$/, "");
      else if (m.kind === "gender") st.gender = cleanText(v);
      else if (m.kind === "size" && m.item) { (byItem[m.item] = byItem[m.item] || { item: m.item, size: "", m: {} }).size = normSize(v); }
      else if (m.kind === "field" && m.item) {
        const x = (byItem[m.item] = byItem[m.item] || { item: m.item, size: "", m: {} });
        const t = cleanText(v);
        if (t) x.m[m.field] = t;
      }
    });
    if (!st.name) return;
    const records = Object.values(byItem).filter((x) => x.size || Object.keys(x.m).length);
    out.push({ student: st, records });
  });
  return out;
}

// ---- counts
const sizeSort = (a, b) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const order = ["2XS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"];
  const ia = order.indexOf(a), ib = order.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  return String(a).localeCompare(String(b));
};
export const sortSizes = (list) => [...list].sort(sizeSort);

// { size: count } for one item
export function sizeCounts(records, item, studentIds = null) {
  const out = {};
  records.forEach((r) => {
    if (r.item !== item || !r.size) return;
    if (studentIds && !studentIds.has(r.student_id)) return;
    out[r.size] = (out[r.size] || 0) + 1;
  });
  return out;
}

// the sheet to hand out for filling in
export const TEMPLATE_HEADERS = (items) => ["Student name", "Class", "Section", "Roll no", ...items.flatMap((it) => [`${it.name} size`, ...(it.fields || []).map((f) => `${it.name} ${f}`)])];
