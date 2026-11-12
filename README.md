# Current Weather + Indoor Sensor

A [Vercel](https://vercel.com) weather dashboard with a Neon-backed ESP32
sensor. It shows current conditions for any city and the latest temperature and
humidity posted by the ESP32. No framework, no build step.

## What it does

- Current temperature, humidity, feels-like temperature, wind, and condition
- City search with type-ahead results (Open-Meteo geocoding)
- "Use my location" via the browser Geolocation API
- °C / °F toggle that persists in `localStorage`
- Remembers your last place, and supports shareable URLs
  (`/?lat=42.3601&lon=-71.0589&name=Boston`)
- Auto-refreshes weather every 10 minutes
- **Indoor sensor card** polls Neon every 5 seconds for the latest ESP32 reading,
  shows a Live / Stale / Offline badge, and follows the °C / °F toggle
- `POST /api/readings` stores sensor readings in Neon; `GET /api/readings`
  returns the newest one

On a first visit there is no saved place, so the app opens on Boston,
Massachusetts. Search for a city or use the location button to change it.

## How it is built

```
public/                    Static site (served as-is)
  index.html
  styles.css
  app.js                   Weather, search, and sensor polling
api/
  weather.js               GET  /api/weather?latitude=&longitude=&units=
  geocode.js               GET  /api/geocode?q=city
  readings.js              POST /api/readings  (store)
                           GET  /api/readings  (latest)
db/schema.sql              readings table + index (created automatically)
firmware/esp32_weather/    Arduino sketch + secrets.example.h
scripts/simulate-sensor.mjs  Posts fake readings every 5 s for testing
```

The two weather functions proxy and normalize the
[Open-Meteo](https://open-meteo.com/) APIs, so the browser only talks to this
deployment. Weather responses are cached at the edge for 5 minutes; geocoding
results for a day. Sensor responses are never cached.

Open-Meteo is free for non-commercial use and needs no API key. If you plan to
put this in front of heavy traffic, check their
[terms](https://open-meteo.com/en/terms).

## Sensor data (Neon)

The API uses [`@neondatabase/serverless`](https://github.com/neondatabase/serverless)
and the pooled `DATABASE_URL` that the Vercel Neon integration provides. It also
accepts `POSTGRES_URL` or `NEON_DATABASE_URL`. The table is created on the first
request:

```sql
CREATE TABLE IF NOT EXISTS readings (
  id BIGSERIAL PRIMARY KEY,
  temperature DOUBLE PRECISION NOT NULL,
  humidity DOUBLE PRECISION NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'esp32',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

You can also run `db/schema.sql` yourself with `psql "$DATABASE_URL" -f db/schema.sql`.
Readings are timestamped by the server, so a wrong ESP32 clock does not matter.

### Environment variables

| Variable         | Required | Purpose                                   |
| ---------------- | -------- | ----------------------------------------- |
| `DATABASE_URL`   | yes      | Neon pooled Postgres connection string     |
| `SENSOR_API_KEY` | yes      | Shared secret for `POST /api/readings`     |

Set both in **Vercel → Project → Settings → Environment Variables** (Production,
Preview, and Development). Locally, copy `.env.example` to `.env.local`.

Generate a key with `openssl rand -hex 32`.

### API

`POST /api/readings` — JSON body, `x-sensor-key` header required:

```bash
curl -X POST "https://your-project.vercel.app/api/readings" \
  -H "Content-Type: application/json" \
  -H "x-sensor-key: $SENSOR_API_KEY" \
  -d '{"temperature":21.4,"humidity":45.2,"deviceId":"esp32-1"}'
```

```json
{
  "reading": {
    "id": 42,
    "temperature": 21.4,
    "humidity": 45.2,
    "deviceId": "esp32-1",
    "recordedAt": "2026-11-12T21:10:05.123Z"
  }
}
```

- `temperature` is Celsius, accepted range `-60..80`
- `humidity` is a percentage, accepted range `0..100`
- `deviceId` is optional (default `esp32`, max 64 characters)
- Errors are JSON: `400` bad input, `401` bad key, `405` wrong method,
  `500` database error, `503` missing configuration
- `Authorization: Bearer <key>` works as an alternative to `x-sensor-key`

`GET /api/readings` returns `{ "reading": {...} }`, or `{ "reading": null }` when
the table is empty. It needs no key, which is what the dashboard polls.

Protected with a shared key, the endpoint is safe to leave public. Anyone
without `SENSOR_API_KEY` gets a `401` and cannot write rows. If the variable is
missing entirely, writes are disabled with a `503`.

## ESP32 firmware

`firmware/esp32_weather/esp32_weather.ino` reads a DHT22 every **5 seconds** and
POSTs to the endpoint. It reconnects Wi-Fi automatically and logs the HTTP
status to the serial monitor.

1. Install the **DHT sensor library** (Adafruit) and **Adafruit Unified Sensor**
   from the Arduino Library Manager.
2. Wire the DHT22: VCC → 3V3, DATA → GPIO 4 (with a 10k pull-up to 3V3),
   GND → GND.
3. Copy `firmware/esp32_weather/secrets.example.h` to `secrets.h` and fill in
   the Wi-Fi credentials, your Vercel URL, the sensor key, and the device ID.
   `secrets.h` is gitignored.
4. Select your ESP32 board and upload.

The sketch uses `setInsecure()` for TLS so it works without a certificate bundle.
For a production device, pin a root CA with `setCACert()` instead.

## Run it locally

You need Node.js 20 or newer and a Vercel account with this repo linked.

```bash
npm install
npx vercel link
npx vercel env pull .env.local   # brings down DATABASE_URL and SENSOR_API_KEY
npm run dev                      # http://localhost:3000
```

Post fake readings to see the sensor card update:

```bash
SENSOR_API_KEY=... npm run simulate
```

`API_URL` defaults to `http://localhost:3000/api/readings`; override it or
`DEVICE_ID` / `INTERVAL_MS` as needed.

`vercel dev` serves `public/` and runs the `api/` functions, which is why a plain
static server will show the UI but not live data.

## Deploy

Import this repository in the Vercel dashboard, or run `npx vercel --prod`. The
Vercel Neon integration injects `DATABASE_URL`; add `SENSOR_API_KEY` yourself.
Once connected to this GitHub repository, every push to `main` ships to
production.
