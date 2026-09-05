# ZKTeco → T&P Textiles attendance sync

This folder contains a small script that connects to your ZKTeco biometric
device over your factory's local network, reads today's punches, and pushes
them into the app automatically.

## Why this has to run on a local PC, not in the cloud

Your ZKTeco device lives on your factory's local network (LAN/WiFi) and is
not reachable from the internet — that's normal and expected for these
devices. So the sync script needs to run on a computer that's on the *same*
local network as the device: an office PC, a small always-on mini-PC, or
even a Raspberry Pi. It reaches out to the device locally, then pushes the
result up to your app over the internet.

## Steps

1. **Find your device's IP address.** On the ZKTeco device itself: Menu →
   Comm. → Network (or similar, varies by model). Note the IP address
   (e.g. `192.168.1.201`).

2. **Set each employee's Employee Number to match their device User ID.**
   This is how the script knows which punch belongs to which person in the
   app. Check the device's menu or its bundled software for each person's
   enrolled User ID, then set that same value as their "Employee number" in
   the app's Employees tab.

3. **Generate a sync key in the app.** Log in as Admin → Attendance tab →
   "Live device sync setup" → Generate key. Copy it — it's shown in full
   only once.

4. **Install Python** (3.8 or newer) on the PC that will run this, if it's
   not already installed: https://www.python.org/downloads/

5. **Install dependencies.** Open a terminal/command prompt in this folder
   and run:
   ```
   pip install -r requirements.txt
   ```

6. **Edit `zk_sync.py`** and fill in the CONFIG section near the top:
   - `DEVICE_IP` — from step 1
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` — from your Supabase project
     (Project Settings → API — use the **anon** key, never `service_role`)
   - `SYNC_API_KEY` — from step 3

7. **Test it once:**
   ```
   python zk_sync.py
   ```
   You should see it connect, list punches found, and confirm what synced.
   Check the app's Attendance tab to see today's check-in/check-out appear.

8. **Schedule it to run automatically** every 5–15 minutes so attendance
   stays current through the day — see the comments at the top of
   `zk_sync.py` for exact Windows Task Scheduler / Linux cron instructions.

## If it doesn't connect

`pyzk` (the library this uses) supports most common ZKTeco models, but a
few newer or higher-security ones use a different protocol it doesn't
support yet. If you get a connection error, tell me your device's exact
model number (usually printed on a label on the back/bottom of the unit)
and I'll help figure out the right path for it.

## Security note

This script only ever holds two things: your Supabase **anon** key (public
by design — it can't read or change anything on its own) and the sync key
you generate in the app (which can *only* write attendance punches, nothing
else — it was built specifically to avoid ever needing to put your full
database credentials on a factory PC). If this PC is ever lost or
compromised, just revoke the sync key from the app and generate a new one.
