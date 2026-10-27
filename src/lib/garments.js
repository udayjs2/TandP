import { supabase } from "../supabaseClient";

// Garment master helpers. Cutting counts are stored as "<SIZE_PREFIX>-<size>" (e.g. KURTI-XL),
// so the prefix of a garment never changes once it has been used.
const names = {}; // size_prefix -> garment name

export const registerGarmentNames = (rows) => {
  (rows || []).forEach((r) => { if (r.size_prefix) names[r.size_prefix] = r.name; });
};
export const garmentNameForPrefix = (p) => names[p];

export async function loadGarmentNames() {
  const { data } = await supabase.from("garment_types").select("size_prefix, name");
  registerGarmentNames(data);
  return data || [];
}

export const sizeKey = (prefix, sz) => (prefix ? `${prefix}-${sz}` : sz);
export const sizeRangeText = (g) => (g.start_size || g.end_size ? `${g.start_size || "?"} – ${g.end_size || "?"}` : "—");

export const LETTER_ORDER = ["2XS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
export const lettersBetween = (a, b) => {
  const i = LETTER_ORDER.indexOf(a), j = LETTER_ORDER.indexOf(b);
  return i < 0 || j < 0 || j < i ? [] : LETTER_ORDER.slice(i, j + 1);
};
export const numbersBetween = (from, to, step = 1) => {
  const a = Number(from), b = Number(to), st = Number(step) || 1;
  if (!isFinite(a) || !isFinite(b) || b < a || st <= 0 || (b - a) / st > 200) return [];
  const out = [];
  for (let x = a; x <= b + 1e-9; x += st) out.push(String(Math.round(x * 100) / 100));
  return out;
};
// Garment sizes on an order are even numbers only (10, 12, 14 …): a range like 10 to 40 skips the odd ones.
export const evenNumbersBetween = (from, to) => {
  let a = Math.ceil(Number(from)), b = Math.floor(Number(to));
  if (!isFinite(a) || !isFinite(b)) return [];
  if (a % 2) a += 1;
  if (b % 2) b -= 1;
  return numbersBetween(a, b, 2);
};
export const KID_SIZES = ["0–3 M", "3–6 M", "6–9 M", "9–12 M", ...Array.from({ length: 16 }, (_, i) => `${i + 1} Y`)];

// "T-shirts" -> the garment whose name best matches the item description (used for orders that were
// created before items were linked to a garment).
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const guessGarment = (desc, garments) => {
  const d = norm(desc);
  if (!d) return null;
  let best = null, bestLen = 0;
  for (const g of garments || []) {
    const alts = String(g.name).split("/").map(norm).filter((x) => x.length >= 4);
    for (const a of alts) {
      if (d.includes(a) && a.length > bestLen) { best = g; bestLen = a.length; }
    }
  }
  return best;
};

// the garment an order item belongs to: explicit link first, then a name guess
export const garmentOfItem = (item, garments) =>
  (garments || []).find((g) => g.id === item?.garment_type_id) || guessGarment(item?.description, garments);

// ---- Size range defined on an order item (stored in the item itself: size_mode / size_from / size_to / size_custom)
export const SIZE_MODES = [["", "No size range"], ["num", "Numbers (e.g. 10 to 40 — even sizes only)"], ["let", "Letters (XS to 5XL)"], ["custom", "Custom range / names"]];
export const parseCustomSizes = (text) => {
  const out = [];
  String(text || "").split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean).forEach((tok) => {
    const m = tok.match(/^(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)$/i);
    const list = m ? evenNumbersBetween(m[1], m[2]) : [tok];
    list.forEach((x) => { if (!out.includes(x)) out.push(x); });
  });
  return out.slice(0, 200);
};
export const itemSizes = (it) => {
  if (!it || !it.size_mode) return [];
  if (it.size_mode === "num") return evenNumbersBetween(it.size_from, it.size_to);
  if (it.size_mode === "let") return lettersBetween(it.size_from, it.size_to);
  if (it.size_mode === "custom") return parseCustomSizes(it.size_custom);
  return [];
};
export const itemSizeText = (it) => {
  const l = itemSizes(it);
  if (!l.length) return "";
  return it.size_mode === "custom" ? l.join(", ") : `${l[0]} – ${l[l.length - 1]}`;
};
