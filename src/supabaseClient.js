import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env and fill in your project URL and anon key."
  );
}

export const supabase = createClient(url, key);
