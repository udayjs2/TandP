import { Loader2 } from "lucide-react";

export default function Header({ tabs, tab, setTab, profile, onLogout, saving }) {
  return (
    <header className="bg-indigo-950 text-stone-100 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 pt-3 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <img src="/logo-mark-white.png" alt="T&P Textiles" className="h-7 w-auto" />
            <div>
              <div className="text-[11px] text-indigo-300 leading-tight">Girls &amp; Women's Wear</div>
              <div className="text-[11px] text-indigo-300 leading-tight">Workshop management</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-indigo-300">
            {saving && (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> saving
              </span>
            )}
            <span className="text-stone-100">
              {profile?.name} <span className="text-indigo-400">· {profile?.role === "admin" ? "Admin" : "Staff"}</span>
            </span>
            <button onClick={onLogout} className="hover:text-white underline underline-offset-2">
              Log out
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-indigo-800/60">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active ? "border-amber-400 text-white" : "border-transparent text-indigo-300 hover:text-white"
                }`}
              >
                <Icon size={14} strokeWidth={1.75} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
