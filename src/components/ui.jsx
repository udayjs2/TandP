import { X } from "lucide-react";

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white border border-stone-200 rounded-xl shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub, tone = "slate", icon: Icon }) {
  const tones = {
    slate: "text-stone-900",
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-rose-700",
  };
  return (
    <Card className="p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between text-stone-500">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={16} strokeWidth={1.75} />}
      </div>
      <div className={`text-2xl font-semibold font-mono ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </Card>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-stone-900/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400";

export function Btn({ children, onClick, variant = "primary", type = "button", className = "", disabled = false }) {
  const variants = {
    primary: "bg-indigo-900 text-white hover:bg-indigo-800",
    ghost: "bg-transparent text-stone-600 hover:bg-stone-100",
    danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
