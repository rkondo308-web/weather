const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HISTORY_HOURS = 24;

function parseCoordinate(value, limit) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  return number;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const latitude = parseCoordinate(req.query.latitude, 90);
  const longitude = parseCoordinate(req.query.longitude, 180);

  if (latitude === null || longitude === null) {
    res.status(400).json({
      error: "Provide numeric latitude (-90 to 90) and longitude (-180 to 180).",
    });
    return;
  }

  const units = req.query.units === "fahrenheit" ? "fahrenheit" : "celsius";

  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,weather_code");
  url.searchParams.set("current", "temperature_2m");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", units);
  url.searchParams.set("past_days", "2");
  url.searchParams.set("forecast_days", "1");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: "The weather service is unavailable right now." });
      return;
    }

    const data = await upstream.json();
    const hourly = data && data.hourly;
    const times = hourly && Array.isArray(hourly.time) ? hourly.time : [];

    if (!times.length) {
      res.status(502).json({ error: "The weather service returned an unexpected response." });
      return;
    }

    const anchor =
      (data.current && data.current.time) || times[times.length - 1];

    const hours = times
      .map((time, index) => ({
        time,
        temperature: Number.isFinite(hourly.temperature_2m[index])
          ? hourly.temperature_2m[index]
          : null,
        humidity: Number.isFinite(hourly.relative_humidity_2m[index])
          ? hourly.relative_humidity_2m[index]
          : null,
        weatherCode: Number.isFinite(hourly.weather_code[index])
          ? hourly.weather_code[index]
          : null,
      }))
      .filter((row) => row.time <= anchor)
      .slice(-HISTORY_HOURS);

    const upstreamUnits = data.hourly_units || {};

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=600, stale-while-revalidate=1800",
    );
    res.status(200).json({
      hours,
      units: {
        temperature:
          upstreamUnits.temperature_2m || (units === "fahrenheit" ? "°F" : "°C"),
      },
      timezone: data.timezone || null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    res
      .status(timedOut ? 504 : 502)
      .json({
        error: timedOut
          ? "The weather service took too long to respond."
          : "Couldn't reach the weather service.",
      });
  } finally {
    clearTimeout(timeout);
  }
};
