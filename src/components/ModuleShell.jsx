import { useState } from "react";

// A module = a page with a row of sub-tabs. `tabs` is [{ id, label, icon, render }] and is
// already filtered for the signed-in role by the caller.
export default function ModuleShell({ title, subtitle, tabs, initial }) {
  const [sub, setSub] = useState(initial || tabs[0]?.id);
  const active = tabs.find((t) => t.id === sub) || tabs[0];
  if (!active) return <p className="text-sm text-stone-500">Nothing available for your role in this module.</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
      </div>
      {tabs.length > 1 && (
        <div className="subtab-bar">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={`subtab ${active.id === t.id ? "subtab-active" : ""}`}
              >
                {Icon && <Icon size={14} />} {t.label}
              </button>
            );
          })}
        </div>
      )}
      <div key={active.id}>{active.render()}</div>
    </div>
  );
}
