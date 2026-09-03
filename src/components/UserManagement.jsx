import { useEffect, useState } from "react";
import { UserPlus, Trash2, Copy, Check } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Modal, Field, inputCls, Btn } from "./ui";
import { ROLE_LABELS } from "../lib/helpers";

const LOGIN_ROLES = ["admin", "hr", "user"];

export default function UserManagement() {
  const [profiles, setProfiles] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteModal, setInviteModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const [{ data: profs }, { data: invites }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
      supabase.from("role_invitations").select("*").order("created_at", { ascending: false }),
    ]);
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
      .subscribe();
    return () => supabase.removeChannel(ch);
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
          Admin, HR, and Staff logins are separate from Employee records — an admin doesn't need to be an employee.
        </p>
      </div>

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

      <div>
        <h3 className="font-semibold text-sm mb-2">Existing accounts</h3>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {profiles.map((p) => (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5">
                    <select className="text-xs border border-stone-300 rounded px-2 py-1" value={p.role} onChange={(e) => setRole(p.id, e.target.value)}>
                      {LOGIN_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {!loading && profiles.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-stone-400">No login accounts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-stone-400 mt-2">
          <b>Admin</b> — full access. <b>HR</b> — Dashboard + Attendance only. <b>Staff</b> — Invoices, their own Payroll, and (if linked to a Sales-role employee) their own Sales Team expense claims.
        </p>
      </div>

      {inviteModal && <InviteModal onClose={() => setInviteModal(false)} onSaved={load} />}
    </div>
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
