import { Card, StatCard } from "./ui";
import ChartCanvas from "./ChartCanvas";
import ExportBar from "./ExportBar";
import { fmtMoney } from "../lib/helpers";

export const fmtCell = (type, v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "money") return fmtMoney(v);
  if (type === "pct") return `${Math.round(Number(v) * 10) / 10}%`;
  if (type === "int") return String(Math.round(Number(v)));
  if (type === "num") return (Math.round(Number(v) * 100) / 100).toLocaleString("en-IN");
  return String(v);
};

// One reusable report page: stat cards, notes, charts, tables and PDF / PowerPoint / Excel export.
//   kpis:   [{ label, value, sub?, tone?, icon? }]  (value already formatted)
//   tables: [{ heading, columns: [{label, type}], rows: [[...]] }]
export default function ReportView({ title, subtitle, filename, controls, kpis = [], bullets = [], charts = [], tables = [], footnote, empty }) {
  const buildReport = () => ({
    title,
    subtitle: subtitle || "T&P Textiles",
    filename: filename || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    sections: [
      { heading: "Summary", kpis: kpis.map((k) => ({ label: k.label, value: String(k.value) })), bullets },
      ...(charts.length ? [{ heading: "Charts", charts }] : []),
      ...tables.map((t) => ({ heading: t.heading, table: { columns: t.columns, rows: t.rows } })),
    ],
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">{controls}</div>
        <ExportBar buildReport={buildReport} />
      </div>
      {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} sub={k.sub} tone={k.tone} icon={k.icon} />)}
        </div>
      )}
      {bullets.length > 0 && (
        <Card className="p-4">
          <ul className="text-sm text-stone-700 space-y-1.5 list-disc pl-5">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </Card>
      )}
      {charts.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {charts.map((c) => <ChartCanvas key={c.title} spec={c} height={Math.max(280, c.type === "hbar" ? 60 + c.labels.length * 30 : 300)} />)}
        </div>
      )}
      {tables.map((t) => (
        <div key={t.heading}>
          <h3 className="text-sm font-semibold text-stone-800 mb-2">{t.heading}</h3>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase">
                <tr>{t.columns.map((c, i) => <th key={i} className={`px-3 py-2.5 ${c.type && c.type !== "text" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {t.rows.map((r, ri) => (
                  <tr key={ri} className="hover:bg-stone-50">
                    {r.map((v, ci) => (
                      <td key={ci} className={`px-3 py-2 ${t.columns[ci].type && t.columns[ci].type !== "text" ? "text-right font-mono" : ""}`}>{fmtCell(t.columns[ci].type, v)}</td>
                    ))}
                  </tr>
                ))}
                {t.rows.length === 0 && <tr><td colSpan={t.columns.length} className="px-4 py-6 text-center text-stone-400">{empty || "No data for this period."}</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      ))}
      {footnote && <p className="text-xs text-stone-400">{footnote}</p>}
    </div>
  );
}
