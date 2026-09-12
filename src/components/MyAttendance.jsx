import { useEffect, useState } from "react";
import { MapPin, Clock, CheckCircle2, AlertTriangle, LogIn, LogOut } from "lucide-react";
import { supabase } from "../supabaseClient";
import { Card, Btn } from "./ui";
import { todayStr, computeShiftStats, reverseGeocode, googleMapsLink } from "../lib/helpers";

export default function MyAttendance({ profile }) {
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [radius, setRadius] = useState(200);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    if (!profile?.employee_id) {
      setLoading(false);
      return;
    }
    const [{ data: todayRow }, { data: recent }, { data: settings }] = await Promise.all([
      supabase.from("attendance").select("*").eq("employee_id", profile.employee_id).eq("date", todayStr()).maybeSingle(),
      supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", profile.employee_id)
        .order("date", { ascending: false })
        .limit(7),
      supabase.from("settings").select("geofence_radius_meters").eq("id", 1).single(),
    ]);
    setToday(todayRow || null);
    setHistory(recent || []);
    setRadius(Number(settings?.geofence_radius_meters) || 200);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.employee_id]);

  const getLocation = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Your browser doesn't support location. Try a different browser or device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error("Location permission denied. Please allow location access and try again."));
          } else {
            reject(new Error("Couldn't get your location. Make sure GPS/location is turned on."));
          }
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });

  const handleCheckIn = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const { lat, lng } = await getLocation();
      const locationName = await reverseGeocode(lat, lng);
      const { data, error } = await supabase.rpc("self_check_in", { p_lat: lat, p_lng: lng, p_location: locationName });
      if (error) throw error;
      if (!data.ok) {
        setMessage({ type: "error", text: data.error === "already_checked_in" ? "You're already checked in today." : "Couldn't check in." });
      } else {
        const outside = data.distance_meters !== null && data.distance_meters > radius;
        setMessage({
          type: outside ? "warn" : "success",
          text: outside
            ? `Checked in at ${locationName || "your location"} — but that's ${Math.round(data.distance_meters)}m from the factory (outside the usual ${radius}m range). This has been noted.`
            : `Checked in successfully at ${locationName || "your location"}!`,
        });
        load();
      }
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    }
    setWorking(false);
  };

  const handleCheckOut = async () => {
    setWorking(true);
    setMessage(null);
    try {
      const { lat, lng } = await getLocation();
      const locationName = await reverseGeocode(lat, lng);
      const { data, error } = await supabase.rpc("self_check_out", { p_lat: lat, p_lng: lng, p_location: locationName });
      if (error) throw error;
      if (!data.ok) {
        setMessage({ type: "error", text: "Couldn't check out." });
      } else {
        const outside = data.distance_meters !== null && data.distance_meters > radius;
        setMessage({
          type: outside ? "warn" : "success",
          text: outside
            ? `Checked out at ${locationName || "your location"} — ${data.hours.toFixed(1)} hours worked. That's ${Math.round(data.distance_meters)}m from the factory — noted.`
            : `Checked out at ${locationName || "your location"} — ${data.hours.toFixed(1)} hours worked (${data.status}).`,
        });
        load();
      }
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    }
    setWorking(false);
  };

  if (loading) return <p className="text-sm text-stone-500">Loading…</p>;

  if (!profile?.employee_id) {
    return (
      <Card className="p-6 text-sm text-stone-600">
        Your login isn't linked to an employee record yet, so self check-in isn't available here. Ask your admin to
        link your account (Payroll tab → admin).
      </Card>
    );
  }

  const stats = today ? computeShiftStats(today.check_in, today.check_out) : {};

  return (
    <div className="space-y-4 max-w-md">
      <h2 className="text-lg font-semibold">My Attendance</h2>

      <Card className="p-5 text-center">
        <div className="text-xs text-stone-500 uppercase mb-3">{todayStr()}</div>

        {!today?.check_in ? (
          <>
            <p className="text-sm text-stone-600 mb-4">You haven't checked in today.</p>
            <Btn onClick={handleCheckIn} disabled={working} className="w-full justify-center py-3">
              <LogIn size={18} /> {working ? "Getting location…" : "Check In"}
            </Btn>
          </>
        ) : !today?.check_out ? (
          <>
            <div className="flex items-center justify-center gap-1.5 text-emerald-700 mb-1">
              <CheckCircle2 size={16} /> <span className="text-sm font-medium">Checked in at {today.check_in}</span>
            </div>
            {today.check_in_location && (
              <a href={googleMapsLink(today.check_in_lat, today.check_in_lng)} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 hover:underline block mb-1">
                {today.check_in_location}
              </a>
            )}
            <p className="text-xs text-stone-400 mb-4">Don't forget to check out at the end of your shift.</p>
            <Btn onClick={handleCheckOut} disabled={working} className="w-full justify-center py-3">
              <LogOut size={18} /> {working ? "Getting location…" : "Check Out"}
            </Btn>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1.5 text-emerald-700 mb-2">
              <CheckCircle2 size={16} /> <span className="text-sm font-medium">Day complete</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-2">
              <div>
                <div className="text-stone-400 text-xs">Check-in</div>
                <div className="font-mono">{today.check_in}</div>
                {today.check_in_location && (
                  <a href={googleMapsLink(today.check_in_lat, today.check_in_lng)} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-700 hover:underline">
                    {today.check_in_location}
                  </a>
                )}
              </div>
              <div>
                <div className="text-stone-400 text-xs">Check-out</div>
                <div className="font-mono">{today.check_out}</div>
                {today.check_out_location && (
                  <a href={googleMapsLink(today.check_out_lat, today.check_out_lng)} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-700 hover:underline">
                    {today.check_out_location}
                  </a>
                )}
              </div>
            </div>
            {stats.hoursWorked !== null && (
              <div className="flex items-center justify-center gap-1.5 flex-wrap text-xs">
                <span className="bg-stone-100 rounded-full px-2 py-0.5 font-mono">{stats.hoursWorked.toFixed(1)}h worked</span>
                {stats.isLate && <span className="bg-rose-100 text-rose-800 rounded-full px-2 py-0.5">Late arrival</span>}
                {stats.overtimeHours > 0 && <span className="bg-sky-100 text-sky-800 rounded-full px-2 py-0.5">+{stats.overtimeHours.toFixed(1)}h overtime</span>}
              </div>
            )}
          </>
        )}

        {message && (
          <div
            className={`mt-4 text-xs rounded-lg p-2.5 flex items-start gap-1.5 text-left ${
              message.type === "success" ? "bg-emerald-50 text-emerald-800" : message.type === "warn" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"
            }`}
          >
            {message.type === "success" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <p className="text-[11px] text-stone-400 mt-3 flex items-center justify-center gap-1">
          <MapPin size={11} /> Your location is checked against the factory when you check in/out.
        </p>
      </Card>

      <div>
        <h3 className="text-xs font-semibold text-stone-600 uppercase mb-1.5 flex items-center gap-1">
          <Clock size={12} /> Recent days
        </h3>
        <Card className="divide-y divide-stone-100">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-2 text-sm gap-2">
              <span className="text-stone-500 whitespace-nowrap">{h.date}</span>
              <span className="font-mono text-xs whitespace-nowrap">
                {h.check_in || "—"} → {h.check_out || "—"}
              </span>
              <span className="text-xs text-stone-400 truncate flex-1 text-right">{h.check_in_location || ""}</span>
              <span className="text-xs whitespace-nowrap">{h.status}</span>
            </div>
          ))}
          {history.length === 0 && <div className="px-4 py-4 text-center text-stone-400 text-sm">No history yet.</div>}
        </Card>
      </div>
    </div>
  );
}
