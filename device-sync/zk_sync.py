"""
zk_sync.py — pulls punch logs from a ZKTeco biometric device on your local
network and pushes them into the T&P Textiles app.

Run this on any always-on PC on the SAME local network as the device
(the device is not reachable from the internet, so this can't run in the
cloud — it has to run somewhere on your factory's network).

SETUP
-----
1. Install Python 3.8+ if you don't have it: https://www.python.org/downloads/
2. Open a terminal in this folder and run:
     pip install pyzk requests
3. Fill in the CONFIG section below:
   - DEVICE_IP: the ZKTeco device's IP address on your local network
                (check the device's menu: Comm. / Network settings)
   - DEVICE_PORT: usually 4370 (ZKTeco's default) — leave as-is unless you
                  changed it on the device
   - SUPABASE_URL / SUPABASE_ANON_KEY: from your Supabase project settings
                  (Project Settings -> API) — the ANON key, never the
                  service_role key
   - SYNC_API_KEY: generate this from the app itself — Attendance tab ->
                   "Live device sync setup" -> Generate key
4. IMPORTANT — matching employees: this script identifies people by the
   "employee_number" you set for them in the Employees tab of the app. Set
   each employee's Employee Number to match their User ID as enrolled on
   the ZKTeco device (visible in the device's menu or its bundled software).
   If they don't match, that person's punches will be skipped and reported
   as "not found".
5. Test it once manually:
     python zk_sync.py
   It will print what it found and synced. Check the Attendance tab in the
   app to confirm today's punches appear.
6. Once it's working, schedule it to run automatically every few minutes:
   - Windows: Task Scheduler -> Create Basic Task -> trigger "when the
     computer starts" + repeat every 5-15 minutes -> action: run
     "python" with argument "C:/path/to/zk_sync.py"
   - Linux/Mac: add a cron job, e.g. */10 * * * * (every 10 minutes):
     crontab -e
     */10 * * * * /usr/bin/python3 /path/to/zk_sync.py >> /path/to/sync.log 2>&1

NOTES ON COMPATIBILITY
-----------------------
pyzk supports most common ZKTeco models (K40, MB360/460, iClock series,
uFace, SpeedFace, and many others) over their standard TCP protocol. A few
newer/higher-security models use a different protocol pyzk doesn't support
yet — if this script can't connect, tell me your exact device model number
and I'll help figure out the right approach for it.
"""

import sys
from datetime import datetime, date
from collections import defaultdict

try:
    from zk import ZK
except ImportError:
    print("Missing dependency. Run: pip install pyzk requests")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Missing dependency. Run: pip install pyzk requests")
    sys.exit(1)

# ============ CONFIG — fill these in ============
DEVICE_IP = "192.168.1.201"      # <-- your ZKTeco device's IP address
DEVICE_PORT = 4370               # <-- usually 4370, leave unless changed

SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"   # <-- from Supabase Project Settings -> API
SUPABASE_ANON_KEY = "YOUR-ANON-KEY-HERE"                # <-- the anon/public key, NOT service_role
SYNC_API_KEY = "PASTE-THE-KEY-FROM-LIVE-DEVICE-SYNC-SETUP-HERE"

ONLY_SYNC_TODAY = True   # set False to sync ALL history stored on the device (only needed once, first run)
# ==================================================


def connect_device():
    zk = ZK(DEVICE_IP, port=DEVICE_PORT, timeout=10)
    print(f"Connecting to ZKTeco device at {DEVICE_IP}:{DEVICE_PORT} ...")
    conn = zk.connect()
    print("Connected.")
    return conn


def fetch_punches(conn):
    """Returns list of (user_id, datetime) punch records from the device."""
    records = conn.get_attendance()
    print(f"Found {len(records)} punch record(s) on the device.")
    if ONLY_SYNC_TODAY:
        today = date.today()
        records = [r for r in records if r.timestamp.date() == today]
        print(f"Filtered to {len(records)} record(s) from today ({today}).")
    return records


def group_into_days(records):
    """
    Groups raw punches by (user_id, date) and takes the earliest punch as
    check-in and the latest as check-out for that day. Most ZKTeco setups
    don't reliably distinguish "in" vs "out" punch types, so first/last is
    the standard, robust approach.
    """
    by_day = defaultdict(list)
    for r in records:
        key = (str(r.user_id), r.timestamp.date().isoformat())
        by_day[key].append(r.timestamp)

    days = []
    for (user_id, day), timestamps in by_day.items():
        timestamps.sort()
        check_in = timestamps[0].strftime("%H:%M:%S")
        check_out = timestamps[-1].strftime("%H:%M:%S") if len(timestamps) > 1 else None
        days.append({"employee_number": user_id, "date": day, "check_in": check_in, "check_out": check_out})
    return days


def push_to_app(day_record):
    url = f"{SUPABASE_URL}/rest/v1/rpc/sync_attendance_punch"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "p_api_key": SYNC_API_KEY,
        "p_employee_number": day_record["employee_number"],
        "p_date": day_record["date"],
        "p_check_in": day_record["check_in"],
        "p_check_out": day_record["check_out"],
    }
    resp = requests.post(url, json=payload, headers=headers, timeout=15)
    if resp.status_code != 200:
        print(f"  ERROR ({resp.status_code}): {resp.text}")
        return False
    result = resp.json()
    if not result.get("ok"):
        print(f"  Skipped {day_record['employee_number']} on {day_record['date']}: {result.get('error')}")
        return False
    print(f"  Synced {day_record['employee_number']} on {day_record['date']} -> {result.get('status')} ({result.get('hours')} hrs)")
    return True


def main():
    conn = None
    try:
        conn = connect_device()
        records = fetch_punches(conn)
        if not records:
            print("No punches to sync.")
            return
        days = group_into_days(records)
        print(f"\nSyncing {len(days)} employee-day record(s) to the app...")
        synced = 0
        for d in days:
            if push_to_app(d):
                synced += 1
        print(f"\nDone. {synced}/{len(days)} record(s) synced successfully.")
    except Exception as e:
        print(f"Failed: {e}")
        print("If this is a connection error, double-check DEVICE_IP and that this PC can reach the device on the network.")
    finally:
        if conn:
            conn.disconnect()


if __name__ == "__main__":
    main()
