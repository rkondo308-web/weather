-- Schema for ESP32 temperature/humidity readings.
-- The API creates this automatically on first use; run it manually with:
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS readings (
  id BIGSERIAL PRIMARY KEY,
  temperature DOUBLE PRECISION NOT NULL,
  humidity DOUBLE PRECISION NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'esp32',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS readings_recorded_at_idx
  ON readings (recorded_at DESC, id DESC);

-- Optional: keep only the last 30 days of readings.
-- DELETE FROM readings WHERE recorded_at < now() - interval '30 days';
