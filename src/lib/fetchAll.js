import { supabase } from "../supabaseClient";

// Supabase returns at most 1000 rows per request. This keeps asking for the
// next page until everything is loaded. `build` must return a fresh query each
// time, e.g. () => supabase.from("order_progress").select("*").gte("date", d).order("id")
export async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export { supabase };
