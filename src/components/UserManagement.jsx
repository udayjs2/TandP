import { useEffect, useState } from "react";
import { UserPlus, Trash2, Copy, Check, KeyRound, LayoutGrid } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { ROLE_LABELS, LOGIN_ROLES, MODULE_ROLES, GRANTABLE_MODULES } from "../lib/helpers";

export default function UserManagement({ profile }) {
  const canManageRoles = profile?.role === "admin" || profile?.role === "hr";
  const [profiles, setProfiles] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteModal, setInviteModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetSentFor, setResetSentFor] = useState(null);
  const isAdminOnly = profile?.role === "admin"; // deletion and module access are Admin-only (HR cannot)
  const [access, setAccess] = useState({}); // user_id -> extra modules granted by the Admin
  const [accessFor, setAccessFor] = useState(null);

  const load = async () => {
    const [{ data: profs }, { data: invites }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
      canManageRoles ? supabase.from("role_invitations").select("*").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    if (isAdminOnly) {
      const { data: acc } = await supabase.from("user_module_access").select("user_id, modules");
      setAccess(Object.fromEntries((acc || []).map((a) => [a.user_id, a.modules || []])));
    }
    setProfiles(profs || []);
    setInvitations(invites || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("user-management-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "role_invitations" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_module_access" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRole = async (id, role) => {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) alert(error.message);
    load();
  };

  const cancelInvite = async (email) => {
    await supabase.from("role_invitations").delete().eq("email", email);
    load();
  };

  const sendPasswordReset = async (p) => {
    if (!p.email) {
      alert("No email on file for this account — they signed up before email tracking was added. Ask them to use 'Forgot password' on the login screen themselves.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(p.email);
    if (error) {
      alert(`Couldn't send reset email:\n${error.message}`);
      return;
    }
    setResetSentFor(p.id);
    setTimeout(() => setResetSentFor(null), 3000);
  };

  const deleteUser = async (p) => {
    if (!window.confirm(`Permanently delete the login account for ${p.name || p.email}?\n\nThey will no longer be able to sign in. Their employee record (if any) is kept.`)) return;
    const { data, error } = await supabase.rpc("delete_user_account", { p_user_id: p.id });
    if (error || data?.ok === false) {
      alert(`Couldn't delete account:\n${error?.message || data?.error}`);
      return;
    }
    load();
  };

  const signupUrl = `${window.location.origin}/`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(signupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">User management</h2>
        <p className="text-xs text-stone-500">
          {canManageRoles
            ? "Admin, HR, and other logins are separate from Employee records — an admin doesn't need to be an employee."
            : "You can send a password reset link to anyone below. Role changes are handled by Admin/HR."}
        </p>
      </div>

      {canManageRoles && (
        <Card className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <h3 className="font-semibold text-sm">Invite someone with a specific role</h3>
            <Btn onClick={() => setInviteModal(true)}>
              <UserPlus size={15} /> New invitation
            </Btn>
          </div>
          <p className="text-xs text-stone-500 mb-3">
            This app can't set someone's password for them directly — that needs extra server infrastructure. Instead:
            pre-assign a role to their email below, then send them the app link. When they use "Create account" with that
            exact email, they'll land with the role you chose instead of the default Staff role.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-xs font-mono break-all">{signupUrl}</div>
            <Btn variant="ghost" onClick={copyLink}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
            </Btn>
          </div>

          {invitations.length > 0 && (
            <div className="border-t border-stone-100 pt-3">
              <div className="text-xs font-semibold text-stone-600 uppercase mb-2">Pending invitations</div>
              <div className="space-y-1.5">
                {invitations.map((inv) => (
                  <div key={inv.email} className="flex items-center justify-between text-sm bg-stone-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="font-medium">{inv.email}</span>
                      <span className="text-stone-400 ml-2 text-xs">→ {ROLE_LABELS[inv.intended_role]}{inv.name_hint ? ` · ${inv.name_hint}` : ""}</span>
                    </div>
                    <button onClick={() => cancelInvite(inv.email)} className="text-stone-400 hover:text-rose-700 p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <div>
        <h3 className="font-semibold text-sm mb-2">Existing accounts</h3>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {profiles.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">
                    {p.name}
                    {p.email && <div className="text-xs text-stone-400 font-normal">{p.email}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    {canManageRoles ? (
                      <select className="text-xs border border-stone-300 rounded px-2 py-1" value={p.role} onChange={(e) => setRole(p.id, e.target.value)}>
                        {LOGIN_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">{ROLE_LABELS[p.role] || p.role}</span>
                    )}
                    {(access[p.id] || []).filter((m) => !(MODULE_ROLES[m] || []).includes(p.role)).length > 0 && (
                      <div className="text-[11px] text-indigo-700 mt-1">
                        + {(access[p.id] || []).filter((m) => !(MODULE_ROLES[m] || []).includes(p.role)).map((m) => GRANTABLE_MODULES.find((g) => g.id === m)?.label || m).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {isAdminOnly && p.role !== "admin" && (
                      <button onClick={() => setAccessFor(p)} className="mr-3 text-xs text-indigo-700 hover:underline inline-flex items-center gap-1">
                        <LayoutGrid size={12} /> Module access
                      </button>
                    )}
                    <button onClick={() => sendPasswordReset(p)} className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1">
                      <KeyRound size={12} /> {resetSentFor === p.id ? "Sent!" : "Reset password"}
                    </button>
                    {isAdminOnly && p.id !== profile?.id && (
                      <button onClick={() => deleteUser(p)} className="ml-3 text-xs text-rose-700 hover:underline inline-flex items-center gap-1">
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && profiles.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-stone-400">No login accounts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-stone-400 mt-2">
          <b>Reset password</b> sends the account's own email a standard password-reset link — nobody (including you) ever sees or sets their password directly.
        </p>
      </div>

      {accessFor && <ModuleAccessModal person={accessFor} granted={access[accessFor.id] || []} adminName={profile?.name} onClose={() => setAccessFor(null)} onSaved={load} />}
      {inviteModal && <InviteModal onClose={() => setInviteModal(false)} onSaved={load} />}
    </div>
  );
}

// Admin only: grant extra modules to one person, on top of what their role already opens.
function ModuleAccessModal({ person, granted, adminName, onClose, onSaved }) {
  const included = (m) => (MODULE_ROLES[m] || []).includes(person.role); // already open through the role
  const [sel, setSel] = useState(() => new Set(granted.filter((m) => !included(m))));
  const [saving, setSaving] = useState(false);

  const toggle = (m) => {
    const n = new Set(sel);
    n.has(m) ? n.delete(m) : n.add(m);
    setSel(n);
  };

  const save = async () => {
    setSaving(true);
    const modules = [...sel];
    const { error } = modules.length
      ? await supabase.from("user_module_access").upsert({ user_id: person.id, modules, updated_by: adminName || null, updated_at: new Date().toISOString() })
      : await supabase.from("user_module_access").delete().eq("user_id", person.id);
    setSaving(false);
    if (error) return alert(`Couldn't save:\n${error.message}`);
    onSaved();
    onClose();
  };

  return (
    <Modal title={`Module access — ${person.name || person.email}`} onClose={onClose}>
      <p className="text-xs text-stone-500 mb-3">
        Role: <b>{ROLE_LABELS[person.role] || person.role}</b>. Tick the extra modules this person should see in their menu. Modules their role already opens are marked and stay on.
      </p>
      <div className="space-y-1.5 mb-3">
        {GRANTABLE_MODULES.map((m) => {
          const inc = included(m.id);
          return (
            <label key={m.id} className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 ${inc ? "bg-stone-50 border-stone-200 text-stone-500" : "border-stone-200 cursor-pointer hover:bg-stone-50"}`}>
              <input type="checkbox" checked={inc || sel.has(m.id)} disabled={inc} onChange={() => toggle(m.id)} />
              <span className="flex-1">{m.label}</span>
              {inc && <span className="text-[11px] text-stone-400">included with role</span>}
            </label>
          );
        })}
      </div>
      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
        This controls which modules appear in their menu. What they can see or change inside a module is still limited by their role's permissions in the database, and approvals stay with the approving roles.
        If they need full rights in a module, change their role instead.
      </p>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={saving}>{saving ? "Saving…" : "Save access"}</Btn>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose, onSaved }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [nameHint, setNameHint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("role_invitations").upsert({
      email: email.trim().toLowerCase(),
      intended_role: role,
      name_hint: nameHint || null,
    });
    setSaving(false);
    if (err) return setError(err.message);
    onSaved();
    onClose();
  };

  return (
    <Modal title="Invite with a specific role" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Email">
          <input type="email" required autoFocus className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
        </Field>
        <Field label="Role they should get">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
            {LOGIN_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>
        <Field label="Name (optional, just a reminder for you)">
          <input className={inputCls} value={nameHint} onChange={(e) => setNameHint(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
        <p className="text-xs text-stone-400 mb-3">
          Share the app link with this person and ask them to sign up using this exact email address.
        </p>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save invitation"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
