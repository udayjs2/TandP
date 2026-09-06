-- Migration 15b — run this too if you already ran migration_13.sql before
-- this fix. It's safe to run even if already applied (Postgres will just
-- say device_sync_keys is already a member, which you can ignore).
--
-- This was a small oversight on my part: device_sync_keys was missing from
-- the realtime publication in the master schema file. It doesn't affect
-- the device sync feature itself (that works fine either way) — it only
-- means the app wouldn't get a LIVE UI refresh if you revoke/add a sync key
-- in one browser tab while another tab is open. Harmless either way, but
-- worth including for consistency.

alter publication supabase_realtime add table device_sync_keys;
