const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "weather_code",
  "wind_speed_10m",
].join(",");

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
  url.searchParams.set("current", CURRENT_FIELDS);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", units);
  url.searchParams.set("wind_speed_unit", units === "fahrenheit" ? "mph" : "kmh");
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
    const current = data && data.current;

    if (!current || !Number.isFinite(current.temperature_2m)) {
      res.status(502).json({ error: "The weather service returned an unexpected response." });
      return;
    }

    const upstreamUnits = data.current_units || {};

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      place: {
        latitude,
        longitude,
        timezone: data.timezone || null,
        timezoneAbbreviation: data.timezone_abbreviation || null,
        elevation: Number.isFinite(data.elevation) ? data.elevation : null,
      },
      current: {
        time: current.time,
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        weatherCode: current.weather_code,
        windSpeed: current.wind_speed_10m,
      },
      units: {
        temperature: upstreamUnits.temperature_2m || (units === "fahrenheit" ? "°F" : "°C"),
        windSpeed: units === "fahrenheit" ? "mph" : "km/h",
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "The weather service took too long to respond." : "Couldn't reach the weather service." });
  } finally {
    clearTimeout(timeout);
  }
};
