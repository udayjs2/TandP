// Public holidays. The list below is the built-in default (also seeded into the `holidays` table by migration_62.sql);
// the app replaces it with the table's rows after login, so HR can add / remove dates under Attendance → Holidays.
// kind: "public" = paid day off (nothing is deducted, no attendance needed); "optional" = shown on the calendar only.
export const DEFAULT_HOLIDAYS = [
  { date: "2026-12-25", name: "Christmas", kind: "public" },
  { date: "2027-01-14", name: "Bhogi", kind: "optional" },
  { date: "2027-01-15", name: "Makara Sankranti", kind: "public" },
  { date: "2027-01-26", name: "Republic Day", kind: "public" },
  { date: "2027-04-07", name: "Ugadi", kind: "optional" },
  { date: "2027-08-13", name: "Varalakshmi Vratham", kind: "optional" },
  { date: "2027-08-15", name: "Independence Day & Eid-e-Milad (tentative)", kind: "public" },
  { date: "2027-09-04", name: "Vinayaka Chavithi", kind: "public" },
  { date: "2027-10-02", name: "Mahatma Gandhi Jayanti", kind: "public" },
  { date: "2027-10-09", name: "Vijaya Dashami (Dussehra)", kind: "public" },
  { date: "2027-10-29", name: "Deepavali", kind: "public" },
  { date: "2027-12-25", name: "Christmas", kind: "public" },
];

let current = Object.fromEntries(DEFAULT_HOLIDAYS.map((h) => [h.date, h]));

export const setHolidays = (rows) => {
  if (Array.isArray(rows) && rows.length) current = Object.fromEntries(rows.map((h) => [String(h.date).slice(0, 10), { date: String(h.date).slice(0, 10), name: h.name, kind: h.kind || "public" }]));
};
export const holidayOn = (date) => current[date] || null;
export const publicHolidayOn = (date) => (current[date] && current[date].kind !== "optional" ? current[date] : null);
export const holidaysInMonth = (mk) => Object.values(current).filter((h) => h.date.startsWith(mk)).sort((a, b) => a.date.localeCompare(b.date));
export const allHolidays = () => Object.values(current).sort((a, b) => a.date.localeCompare(b.date));

export const loadHolidays = async (supabase) => {
  try {
    const { data } = await supabase.from("holidays").select("date, name, kind");
    if (data && data.length) setHolidays(data);
  } catch { /* the built-in list stays */ }
};
