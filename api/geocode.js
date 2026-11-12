const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const MAX_RESULTS = 5;

function normalizeResult(result) {
  if (!result || typeof result.name !== "string") return null;
  if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
    return null;
  }

  const region = [result.admin1, result.country].filter(Boolean).join(", ");

  return {
    name: result.name,
    label: result.name,
    region,
    country: result.country || "",
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (query.length < 2) {
    res.status(400).json({ error: "Type at least two characters to search." });
    return;
  }

  if (query.length > 80) {
    res.status(400).json({ error: "That search is too long." });
    return;
  }

  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      res.status(502).json({ error: "Location search is unavailable right now." });
      return;
    }

    const data = await upstream.json();
    const rawResults = data && Array.isArray(data.results) ? data.results : [];
    const results = rawResults
      .map(normalizeResult)
      .filter(Boolean)
      .slice(0, MAX_RESULTS);

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ results });
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "Location search took too long." : "Couldn't reach the location service." });
  } finally {
    clearTimeout(timeout);
  }
};
