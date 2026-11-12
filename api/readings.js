const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const MAX_DEVICE_ID_LENGTH = 64;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS readings (
    id BIGSERIAL PRIMARY KEY,
    temperature DOUBLE PRECISION NOT NULL,
    humidity DOUBLE PRECISION NOT NULL,
    device_id TEXT NOT NULL DEFAULT 'esp32',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS readings_recorded_at_idx
    ON readings (recorded_at DESC, id DESC)
`;

let schemaPromise = null;

function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    ""
  );
}

function getSql() {
  const url = connectionString();
  if (!url) return null;
  return neon(url);
}

function ensureSchema(sql) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql.query(CREATE_TABLE_SQL);
      await sql.query(CREATE_INDEX_SQL);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function isAuthorized(req) {
  const expected = process.env.SENSOR_API_KEY;
  if (!expected) return false;

  const headerKey = req.headers && req.headers["x-sensor-key"];
  if (typeof headerKey === "string" && headerKey && safeEqual(headerKey, expected)) {
    return true;
  }

  const authorization = req.headers && req.headers.authorization;
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match && safeEqual(match[1].trim(), expected)) return true;
  }

  return false;
}

function parseBody(req) {
  const body = req.body;
  if (body == null) return null;

  if (typeof body === "object" && !Buffer.isBuffer(body)) return body;

  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  if (!text.trim()) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    /* try form encoding below */
  }

  const form = new URLSearchParams(text);
  const values = {};
  for (const [key, value] of form) values[key] = value;
  return Object.keys(values).length ? values : null;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function normalizeDeviceId(value) {
  if (value == null) return "esp32";
  const text = String(value).trim().slice(0, MAX_DEVICE_ID_LENGTH);
  return text || "esp32";
}

function toIso(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value !== "string") return null;

  // Postgres may return "2026-11-12 21:10:05+00"; make it ISO-friendly.
  let text = value.trim().replace(" ", "T");
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(text)) text += "Z";

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapReading(row) {
  return {
    id: Number(row.id),
    temperature: Number(row.temperature),
    humidity: Number(row.humidity),
    deviceId: row.device_id,
    recordedAt: toIso(row.recorded_at),
  };
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

async function handlePost(req, res) {
  if (!process.env.SENSOR_API_KEY) {
    sendError(
      res,
      503,
      "Sensor writes are disabled: set SENSOR_API_KEY in the environment.",
    );
    return;
  }

  if (!isAuthorized(req)) {
    sendError(res, 401, "Missing or invalid x-sensor-key header.");
    return;
  }

  const body = parseBody(req);
  if (!body) {
    sendError(res, 400, "Send a JSON body with temperature and humidity.");
    return;
  }

  const temperature = toNumber(body.temperature ?? body.temp);
  const humidity = toNumber(body.humidity ?? body.hum ?? body.relative_humidity);

  if (temperature === null || humidity === null) {
    sendError(res, 400, "temperature and humidity must be numbers.");
    return;
  }

  if (temperature < -60 || temperature > 80) {
    sendError(res, 400, "temperature must be between -60 and 80 °C.");
    return;
  }

  if (humidity < 0 || humidity > 100) {
    sendError(res, 400, "humidity must be between 0 and 100 %.");
    return;
  }

  const sql = getSql();
  if (!sql) {
    sendError(
      res,
      503,
      "Database not configured. Set DATABASE_URL (Neon) in the Vercel project.",
    );
    return;
  }

  const deviceId = normalizeDeviceId(body.deviceId ?? body.device_id ?? body.device);

  try {
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO readings (temperature, humidity, device_id)
      VALUES (${Number(temperature.toFixed(2))}, ${Number(humidity.toFixed(2))}, ${deviceId})
      RETURNING id, temperature, humidity, device_id, recorded_at
    `;

    if (!rows.length) throw new Error("Insert returned no rows.");
    res.status(201).json({ reading: mapReading(rows[0]) });
  } catch (error) {
    console.error("[readings] insert failed:", error.message);
    sendError(res, 500, "Couldn't save the reading. Try again shortly.");
  }
}

async function handleGet(res) {
  const sql = getSql();
  if (!sql) {
    sendError(
      res,
      503,
      "Database not configured. Set DATABASE_URL (Neon) in the Vercel project.",
    );
    return;
  }

  try {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT id, temperature, humidity, device_id, recorded_at
      FROM readings
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1
    `;

    res.status(200).json({ reading: rows.length ? mapReading(rows[0]) : null });
  } catch (error) {
    console.error("[readings] latest query failed:", error.message);
    sendError(res, 500, "Couldn't load the latest reading.");
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "POST") {
    await handlePost(req, res);
    return;
  }

  if (req.method === "GET") {
    await handleGet(res);
    return;
  }

  res.setHeader("Allow", "GET, POST");
  sendError(res, 405, "Method not allowed.");
};
