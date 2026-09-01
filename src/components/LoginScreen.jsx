import { useState } from "react";
import { Ruler, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Field, inputCls, Btn } from "./ui";

export default function LoginScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message);
  };

  const signUp = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!name.trim()) return setError("Enter your name.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    });
    setLoading(false);
    if (error) return setError(error.message);
    setInfo(
      "Account created. If email confirmation is enabled on your Supabase project, check your inbox before signing in. New accounts start as Staff — ask an admin to upgrade your role in Supabase if needed."
    );
    setMode("signin");
  };

  return (
    <div className="min-h-screen bg-indigo-950 text-stone-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo-full-white.png" alt="T&P Textiles" className="h-20 w-auto mb-2" />
          <p className="text-indigo-300 text-sm mt-0.5">Workshop management sign in</p>
        </div>

        <div className="bg-white text-stone-900 rounded-xl shadow-xl p-5">
          <div className="flex text-sm font-medium mb-4 border border-stone-200 rounded-lg overflow-hidden">
            <button
              onClick={() => { setMode("signin"); setError(""); setInfo(""); }}
              className={`flex-1 py-2 ${mode === "signin" ? "bg-indigo-900 text-white" : "bg-white text-stone-600"}`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setMode("signup"); setError(""); setInfo(""); }}
              className={`flex-1 py-2 ${mode === "signup" ? "bg-indigo-900 text-white" : "bg-white text-stone-600"}`}
            >
              Create account
            </button>
          </div>

          {info && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{info}</p>}

          {mode === "signin" ? (
            <form onSubmit={signIn}>
              <Field label="Email">
                <input type="email" required autoFocus className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password">
                <input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
              <Btn type="submit" className="w-full justify-center mt-1" disabled={loading}>
                {loading ? <Loader2 size={15} className="animate-spin" /> : null} Sign in
              </Btn>
            </form>
          ) : (
            <form onSubmit={signUp}>
              <Field label="Your name">
                <input required autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" />
              </Field>
              <Field label="Email">
                <input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password">
                <input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Confirm password">
                <input type="password" required className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
              <p className="text-xs text-stone-500 mb-3">
                New accounts start as <b>Staff</b> (invoices only). An existing admin can upgrade your role from the Supabase dashboard.
              </p>
              <Btn type="submit" className="w-full justify-center" disabled={loading}>
                {loading ? <Loader2 size={15} className="animate-spin" /> : null} Create account
              </Btn>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
