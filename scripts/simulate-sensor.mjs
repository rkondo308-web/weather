/**
 * Simulates an ESP32 posting readings every 5 seconds.
 *
 *   API_URL=http://localhost:3000/api/readings \
 *   SENSOR_API_KEY=... DEVICE_ID=esp32-sim npm run simulate
 */

const API_URL = process.env.API_URL || "http://localhost:3000/api/readings";
const SENSOR_API_KEY = process.env.SENSOR_API_KEY || "";
const DEVICE_ID = process.env.DEVICE_ID || "esp32-sim";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000);

let temperature = 21.5;
let humidity = 45;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function jitter(value, step) {
  return value + (Math.random() - 0.5) * 2 * step;
}

async function sendReading() {
  temperature = clamp(jitter(temperature, 0.3), 15, 30);
  humidity = clamp(jitter(humidity, 1.5), 20, 90);

  const reading = {
    temperature: Number(temperature.toFixed(2)),
    humidity: Number(humidity.toFixed(2)),
    deviceId: DEVICE_ID,
  };

  const headers = { "Content-Type": "application/json" };
  if (SENSOR_API_KEY) headers["x-sensor-key"] = SENSOR_API_KEY;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(reading),
    });
    const body = await response.text();
    const time = new Date().toLocaleTimeString();

    if (response.ok) {
      console.log(`[${time}] ${response.status} saved`, reading);
    } else {
      console.error(`[${time}] ${response.status} failed: ${body}`);
    }
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] request failed:`, error.message);
  }
}

console.log(`Posting to ${API_URL} as ${DEVICE_ID} every ${INTERVAL_MS} ms`);
console.log("Press Ctrl+C to stop.\n");

await sendReading();
setInterval(sendReading, INTERVAL_MS);
