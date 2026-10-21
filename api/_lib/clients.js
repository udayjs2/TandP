import { createClient } from "@supabase/supabase-js";

const url = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// a client that acts as the signed-in user (row-level security applies)
export async function userContext(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Sign in first.", status: 401 };
  if (!url() || !anon()) return { error: "Server is missing SUPABASE_URL / SUPABASE_ANON_KEY.", status: 503 };
  const sb = createClient(url(), anon(), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) return { error: "Your session has expired. Sign in again.", status: 401 };
  const { data: p } = await sb.from("profiles").select("name, role").eq("id", u.user.id).single();
  if (!p) return { error: "No profile found for your login.", status: 403 };
  return { sb, role: p.role, name: p.name, userId: u.user.id, svc: false };
}

// a service-role client for scheduled reports and WhatsApp (bypasses row-level security: callers must limit `role`)
export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url() || !key) return null;
  return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const AI_ROLES = ["admin", "gm", "pm"];
