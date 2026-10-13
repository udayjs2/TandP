import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Field, inputCls, Btn } from "./ui";

// Shown after someone opens the link in a password-reset email.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    onDone();
  };

  return (
    <div className="min-h-screen bg-indigo-950 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white text-stone-900 rounded-xl shadow-xl p-5">
        <h2 className="font-semibold mb-1">Choose a new password</h2>
        <p className="text-xs text-stone-500 mb-3">You'll stay signed in after saving.</p>
        <Field label="New password">
          <input type="password" required autoFocus className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input type="password" required className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
        <Btn type="submit" className="w-full justify-center" disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : null} Save password
        </Btn>
      </form>
    </div>
  );
}
