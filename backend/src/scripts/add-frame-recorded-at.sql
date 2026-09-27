-- The device's own timestamp on every raw frame.
--
-- Harsh manoeuvres were timed by server arrival, which trails the reading by a
-- variable 1-3 s. Dividing a speed change by that jitter turned ordinary turns
-- and pull-aways into "harsh" events. Frames that produced a telemetry row get
-- the reading time back from it; the rest stay NULL and are timed by
-- src/scripts/rederive-harsh-events.ts instead.
--
-- Apply BEFORE deploying the code that writes the column:
--   psql "$DATABASE_URL" -f src/scripts/add-frame-recorded-at.sql
ALTER TABLE device_frames
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP;

UPDATE device_frames f
SET recorded_at = t.recorded_at
FROM telemetry t
WHERE t.id = f.telemetry_id
  AND f.recorded_at IS NULL;
