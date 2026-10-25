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
