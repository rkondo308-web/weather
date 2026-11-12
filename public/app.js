const DEFAULT_PLACE = {
  name: "Boston, Massachusetts",
  latitude: 42.3601,
  longitude: -71.0589,
};

const STORAGE_KEYS = {
  place: "weather.place",
  units: "weather.units",
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const SENSOR_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 350;

const WEATHER_CODES = {
  0: { label: "Clear sky", icon: "☀️", theme: "clear" },
  1: { label: "Mainly clear", icon: "🌤️", theme: "clear" },
  2: { label: "Partly cloudy", icon: "⛅", theme: "cloud" },
  3: { label: "Overcast", icon: "☁️", theme: "cloud" },
  45: { label: "Fog", icon: "🌫️", theme: "fog" },
  48: { label: "Depositing rime fog", icon: "🌫️", theme: "fog" },
  51: { label: "Light drizzle", icon: "🌦️", theme: "rain" },
  53: { label: "Drizzle", icon: "🌦️", theme: "rain" },
  55: { label: "Dense drizzle", icon: "🌧️", theme: "rain" },
  56: { label: "Freezing drizzle", icon: "🌧️", theme: "rain" },
  57: { label: "Dense freezing drizzle", icon: "🌧️", theme: "rain" },
  61: { label: "Light rain", icon: "🌦️", theme: "rain" },
  63: { label: "Rain", icon: "🌧️", theme: "rain" },
  65: { label: "Heavy rain", icon: "🌧️", theme: "rain" },
  66: { label: "Freezing rain", icon: "🌧️", theme: "rain" },
  67: { label: "Heavy freezing rain", icon: "🌧️", theme: "rain" },
  71: { label: "Light snow", icon: "🌨️", theme: "snow" },
  73: { label: "Snow", icon: "🌨️", theme: "snow" },
  75: { label: "Heavy snow", icon: "❄️", theme: "snow" },
  77: { label: "Snow grains", icon: "❄️", theme: "snow" },
  80: { label: "Light rain showers", icon: "🌦️", theme: "rain" },
  81: { label: "Rain showers", icon: "🌧️", theme: "rain" },
  82: { label: "Violent rain showers", icon: "🌧️", theme: "rain" },
  85: { label: "Snow showers", icon: "🌨️", theme: "snow" },
  86: { label: "Heavy snow showers", icon: "🌨️", theme: "snow" },
  95: { label: "Thunderstorm", icon: "⛈️", theme: "storm" },
  96: { label: "Thunderstorm with hail", icon: "⛈️", theme: "storm" },
  99: { label: "Thunderstorm with heavy hail", icon: "⛈️", theme: "storm" },
};

const dom = {
  body: document.body,
  placeName: document.getElementById("place-name"),
  observed: document.getElementById("observed"),
  temperature: document.getElementById("temperature"),
  unitLabel: document.getElementById("unit-label"),
  condition: document.getElementById("condition"),
  icon: document.getElementById("condition-icon"),
  humidity: document.getElementById("humidity"),
  apparent: document.getElementById("apparent"),
  wind: document.getElementById("wind"),
  status: document.getElementById("status"),
  card: document.querySelector(".card"),
  refresh: document.getElementById("refresh"),
  unitToggle: document.getElementById("unit-toggle"),
  locate: document.getElementById("locate"),
  form: document.getElementById("search-form"),
  input: document.getElementById("search-input"),
  results: document.getElementById("search-results"),
  sensorStatus: document.getElementById("sensor-status"),
  sensorDevice: document.getElementById("sensor-device"),
  sensorTemperature: document.getElementById("sensor-temperature"),
  sensorHumidity: document.getElementById("sensor-humidity"),
  sensorMeta: document.getElementById("sensor-meta"),
  historyPlace: document.getElementById("history-place"),
  historyBody: document.getElementById("history-body"),
};

const state = {
  place: DEFAULT_PLACE,
  units: "celsius",
  lastUpdated: 0,
  statusError: false,
  weatherRequest: null,
  searchRequest: null,
  searchTimer: null,
  sensorReading: null,
  sensorLoading: true,
  sensorUnavailable: false,
  sensorMessage: "",
  sensorTimer: null,
  historyRequest: null,
  historyLoaded: false,
};

/* ---------- storage + URL ---------- */

function safeRead(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable in private modes */
  }
}

function loadStoredState() {
  const units = safeRead(STORAGE_KEYS.units);
  if (units === "fahrenheit" || units === "celsius") {
    state.units = units;
  }

  const stored = safeRead(STORAGE_KEYS.place);
  if (!stored) return;

  try {
    const place = JSON.parse(stored);
    if (isValidPlace(place)) {
      state.place = {
        name: String(place.name).slice(0, 120),
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
      };
    }
  } catch {
    /* ignore malformed storage */
  }
}

function readPlaceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const latParam = params.get("lat");
  const lonParam = params.get("lon");
  if (latParam === null || lonParam === null) return null;
  if (latParam.trim() === "" || lonParam.trim() === "") return null;

  const latitude = Number(latParam);
  const longitude = Number(lonParam);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const name = (params.get("name") || "").trim().slice(0, 120);
  return {
    name: name || formatCoordinates(latitude, longitude),
    latitude,
    longitude,
  };
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set("lat", state.place.latitude.toFixed(4));
  params.set("lon", state.place.longitude.toFixed(4));
  params.set("name", state.place.name);
  window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
}

function isValidPlace(place) {
  return Boolean(
    place &&
      typeof place.name === "string" &&
      Number.isFinite(place.latitude) &&
      Number.isFinite(place.longitude) &&
      Math.abs(place.latitude) <= 90 &&
      Math.abs(place.longitude) <= 180,
  );
}

function formatCoordinates(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

/* ---------- formatting ---------- */

function formatValue(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

// The API returns the observation time already local to the place, so we
// format the wall-clock parts directly instead of shifting by a timezone again.
function formatClock(localIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso || "");
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(wallClock);
  } catch {
    return "";
  }
}

function describeUpdated(secondsAgo) {
  if (secondsAgo < 60) return "just now";
  if (secondsAgo < 3600) return `${Math.round(secondsAgo / 60)} min ago`;
  return `${Math.round(secondsAgo / 3600)} h ago`;
}

/* ---------- weather ---------- */

async function loadWeather() {
  if (state.weatherRequest) state.weatherRequest.abort();
  const controller = new AbortController();
  state.weatherRequest = controller;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12000);

  dom.card.classList.add("is-loading");
  dom.refresh.classList.add("is-busy");
  dom.card.setAttribute("aria-busy", "true");
  setStatus("Fetching current conditions…");

  const query = new URLSearchParams({
    latitude: state.place.latitude.toFixed(4),
    longitude: state.place.longitude.toFixed(4),
    units: state.units,
  });

  try {
    const response = await fetch(`/api/weather?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.current) {
      throw new Error(
        (data && typeof data.error === "string" && data.error) ||
          `Weather service returned ${response.status}.`,
      );
    }

    renderWeather(data);
    state.lastUpdated = Date.now();
  } catch (error) {
    if (error.name === "AbortError") {
      if (timedOut && state.weatherRequest === controller) {
        setStatus("The weather service took too long to respond. Try again.", true);
      }
      return;
    }
    setStatus(
      `Couldn't load the weather. ${error.message || "Check your connection and try again."}`,
      true,
    );
  } finally {
    window.clearTimeout(timeout);
    if (state.weatherRequest === controller) {
      state.weatherRequest = null;
      dom.card.classList.remove("is-loading");
      dom.refresh.classList.remove("is-busy");
      dom.card.removeAttribute("aria-busy");
    }
  }
}

function renderWeather(data) {
  const { current, units } = data;
  const code = WEATHER_CODES[current.weatherCode] || {
    label: "Current conditions",
    icon: "🌡️",
    theme: "clear",
  };

  dom.placeName.textContent = state.place.name;
  dom.temperature.textContent = formatValue(current.temperature, 0);
  dom.condition.textContent = code.label;
  dom.icon.textContent = code.icon;
  dom.humidity.textContent = Number.isFinite(current.humidity)
    ? `${Math.round(current.humidity)}%`
    : "--";
  dom.apparent.textContent = Number.isFinite(current.apparentTemperature)
    ? `${formatValue(current.apparentTemperature, 0)}${units.temperature}`
    : "--";
  dom.wind.textContent = Number.isFinite(current.windSpeed)
    ? `${formatValue(current.windSpeed, 0)} ${units.windSpeed}`
    : "--";

  const clock = formatClock(current.time);
  dom.observed.textContent = clock ? `Observed ${clock} local time` : "";

  dom.body.dataset.theme = code.theme;
  document.documentElement.style.setProperty("--accent", accentFor(code.theme));
  setStatus("Updated just now · Open-Meteo");
  document.title = `${formatValue(current.temperature, 0)}${units.temperature} · ${state.place.name}`;
}

function accentFor(theme) {
  switch (theme) {
    case "rain":
      return "#2a6f97";
    case "snow":
      return "#3d6f96";
    case "storm":
      return "#575ba6";
    case "fog":
      return "#55707f";
    case "cloud":
      return "#3a6b92";
    default:
      return "#1b6ca8";
  }
}

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle("is-error", Boolean(isError));
  state.statusError = Boolean(isError);
}

/* ---------- indoor sensor ---------- */

function sensorUnit() {
  return state.units === "fahrenheit" ? "°F" : "°C";
}

function sensorTemperatureText(celsius) {
  if (!Number.isFinite(celsius)) return "--";
  const value = state.units === "fahrenheit" ? (celsius * 9) / 5 + 32 : celsius;
  return `${value.toFixed(1)}${sensorUnit()}`;
}

function sensorAgeSeconds() {
  const reading = state.sensorReading;
  if (!reading || !reading.recordedAt) return null;
  const timestamp = Date.parse(reading.recordedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 1000);
}

function describeAge(seconds) {
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

function formatSensorTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function setSensorStatus(label, stateName) {
  if (dom.sensorStatus.textContent !== label) dom.sensorStatus.textContent = label;
  if (dom.sensorStatus.dataset.state !== stateName) {
    dom.sensorStatus.dataset.state = stateName;
  }
}

function renderSensor() {
  const reading = state.sensorReading;

  if (!reading) {
    dom.sensorDevice.textContent = "ESP32";
    dom.sensorTemperature.textContent = "--";
    dom.sensorHumidity.textContent = "--";

    if (state.sensorUnavailable) {
      setSensorStatus("Unavailable", "unavailable");
      dom.sensorMeta.textContent = state.sensorMessage;
    } else if (state.sensorLoading) {
      setSensorStatus("Connecting…", "loading");
      dom.sensorMeta.textContent = "Waiting for the first reading…";
    } else {
      setSensorStatus("No data", "empty");
      dom.sensorMeta.textContent = "Waiting for the first reading…";
    }
    return;
  }

  const age = sensorAgeSeconds();
  dom.sensorDevice.textContent = reading.deviceId || "ESP32";
  dom.sensorTemperature.textContent = sensorTemperatureText(reading.temperature);
  dom.sensorHumidity.textContent = Number.isFinite(reading.humidity)
    ? `${reading.humidity.toFixed(1)}%`
    : "--";

  if (state.sensorUnavailable) {
    setSensorStatus("Unavailable", "unavailable");
    dom.sensorMeta.textContent = Number.isFinite(age)
      ? `${state.sensorMessage} Last reading ${describeAge(age)}.`
      : state.sensorMessage;
    return;
  }

  const freshness =
    age === null ? "offline" : age <= 30 ? "live" : age <= 300 ? "stale" : "offline";
  setSensorStatus(
    freshness === "live" ? "Live" : freshness === "stale" ? "Stale" : "Offline",
    freshness,
  );

  const clock = formatSensorTime(reading.recordedAt);
  const parts = [];
  if (Number.isFinite(age)) parts.push(`Updated ${describeAge(age)}`);
  if (clock) parts.push(clock);
  dom.sensorMeta.textContent = parts.join(" · ") || "Waiting for the first reading…";
}

async function loadSensor() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("/api/readings", {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);

    if (response.status === 503) {
      state.sensorUnavailable = true;
      state.sensorMessage = (data && data.error) || "Database not configured.";
      state.sensorReading = null;
      return;
    }

    if (!response.ok || !data) {
      throw new Error(
        (data && data.error) || `Sensor API returned ${response.status}.`,
      );
    }

    state.sensorUnavailable = false;
    state.sensorMessage = "";
    state.sensorReading = data.reading || null;
  } catch (error) {
    state.sensorUnavailable = true;
    state.sensorMessage =
      error.name === "AbortError"
        ? "The sensor API timed out."
        : "Couldn't reach the sensor API.";
  } finally {
    window.clearTimeout(timeout);
    state.sensorLoading = false;
    renderSensor();
  }
}

async function pollSensor() {
  if (document.visibilityState === "visible") await loadSensor();
  window.clearTimeout(state.sensorTimer);
  state.sensorTimer = window.setTimeout(pollSensor, SENSOR_POLL_MS);
}

/* ---------- hourly weather history ---------- */

function formatHistoryHour(localIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso || "");
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      timeZone: "UTC",
    }).format(wallClock);
  } catch {
    return "";
  }
}

function showHistoryMessage(message) {
  const row = document.createElement("tr");
  row.className = "history__message";
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = message;
  row.append(cell);
  dom.historyBody.replaceChildren(row);
}

function historyReadingCell(text) {
  const cell = document.createElement("td");
  cell.className = "is-numeric";
  cell.textContent = text;
  return cell;
}

function renderHistory(data) {
  dom.historyPlace.textContent = state.place.name;

  const hours = Array.isArray(data.hours) ? data.hours : [];
  if (!hours.length) {
    showHistoryMessage("No hourly data available for this location.");
    return;
  }

  const unit =
    (data.units && data.units.temperature) ||
    (state.units === "fahrenheit" ? "°F" : "°C");
  const fragment = document.createDocumentFragment();

  hours
    .slice()
    .reverse()
    .forEach((row, index) => {
      const isNow = index === 0;
      const tr = document.createElement("tr");
      if (isNow) tr.className = "history__row-now";

      const timeCell = document.createElement("td");
      timeCell.className = "history__time";
      const time = document.createElement("time");
      time.dateTime = row.time || "";
      time.textContent = isNow ? "Now" : formatHistoryHour(row.time);
      timeCell.append(time);

      const conditionCell = document.createElement("td");
      const condition = WEATHER_CODES[row.weatherCode];
      const conditionWrap = document.createElement("span");
      conditionWrap.className = "history__condition";
      const icon = document.createElement("span");
      icon.className = "history__condition-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = condition ? condition.icon : "—";
      const label = document.createElement("span");
      label.className = "history__condition-label";
      label.textContent = condition ? condition.label : "Unknown";
      conditionWrap.append(icon, label);
      conditionCell.append(conditionWrap);

      const temperature = Number.isFinite(row.temperature)
        ? `${row.temperature.toFixed(1)}${unit}`
        : "—";
      const humidity = Number.isFinite(row.humidity)
        ? `${Math.round(row.humidity)}%`
        : "—";

      tr.append(
        timeCell,
        conditionCell,
        historyReadingCell(temperature),
        historyReadingCell(humidity),
      );
      fragment.append(tr);
    });

  dom.historyBody.replaceChildren(fragment);
}

async function loadHistory() {
  if (state.historyRequest) state.historyRequest.abort();
  const controller = new AbortController();
  state.historyRequest = controller;
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  dom.historyPlace.textContent = state.place.name;
  if (!state.historyLoaded) showHistoryMessage("Loading history…");

  const query = new URLSearchParams({
    latitude: state.place.latitude.toFixed(4),
    longitude: state.place.longitude.toFixed(4),
    units: state.units,
  });

  try {
    const response = await fetch(`/api/history?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      throw new Error(
        (data && typeof data.error === "string" && data.error) ||
          `History service returned ${response.status}.`,
      );
    }

    renderHistory(data);
    state.historyLoaded = true;
  } catch (error) {
    if (error.name === "AbortError") return;
    if (!state.historyLoaded) {
      showHistoryMessage("Couldn't load the past 24 hours. It will retry shortly.");
    }
  } finally {
    window.clearTimeout(timeout);
    if (state.historyRequest === controller) state.historyRequest = null;
  }
}

/* ---------- search ---------- */

function closeResults() {
  if (state.searchRequest) {
    state.searchRequest.abort();
    state.searchRequest = null;
  }
  dom.results.hidden = true;
  dom.results.textContent = "";
}

function showMessage(message) {
  const item = document.createElement("li");
  item.className = "results__empty";
  item.textContent = message;
  dom.results.replaceChildren(item);
  dom.results.hidden = false;
}

function renderResults(results) {
  if (!results.length) {
    showMessage("No matching places found.");
    return;
  }

  const items = results.map((result) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";

    const name = document.createElement("span");
    name.className = "result__name";
    name.textContent = result.label;

    const meta = document.createElement("span");
    meta.className = "result__meta";
    meta.textContent = result.region
      ? `${result.region} · ${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`
      : `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`;

    button.append(name, meta);
    button.addEventListener("click", () => {
      selectPlace(result);
    });

    item.append(button);
    return item;
  });

  dom.results.replaceChildren(...items);
  dom.results.hidden = false;
}

async function runSearch(term) {
  const query = term.trim();
  if (query.length < 2) {
    closeResults();
    return;
  }

  if (state.searchRequest) state.searchRequest.abort();
  const controller = new AbortController();
  state.searchRequest = controller;

  showMessage("Searching…");

  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error((data && data.error) || `Search failed (${response.status}).`);
    }
    if (state.searchRequest !== controller) return;
    renderResults(Array.isArray(data.results) ? data.results : []);
  } catch (error) {
    if (error.name === "AbortError") return;
    if (state.searchRequest !== controller) return;
    showMessage(error.message || "Search failed. Try again.");
  } finally {
    if (state.searchRequest === controller) state.searchRequest = null;
  }
}

function selectPlace(place) {
  state.place = {
    name: place.label || place.name,
    latitude: place.latitude,
    longitude: place.longitude,
  };
  safeWrite(STORAGE_KEYS.place, JSON.stringify(state.place));
  dom.placeName.textContent = state.place.name;
  dom.input.value = "";
  closeResults();
  syncUrl();
  state.historyLoaded = false;
  loadWeather();
  loadHistory();
}

/* ---------- location ---------- */

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus("This browser doesn't support location access.", true);
    return;
  }

  dom.locate.disabled = true;
  setStatus("Finding your location…");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.place = {
        name: "My location",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      safeWrite(STORAGE_KEYS.place, JSON.stringify(state.place));
      syncUrl();
      state.historyLoaded = false;
      loadHistory();
      loadWeather().finally(() => {
        dom.locate.disabled = false;
      });
    },
    (error) => {
      dom.locate.disabled = false;
      const message =
        error.code === error.PERMISSION_DENIED
          ? "Location permission denied. Search for a city instead."
          : "Couldn't determine your location. Search for a city instead.";
      setStatus(message, true);
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

/* ---------- units ---------- */

function applyUnits() {
  const isMetric = state.units === "celsius";
  dom.unitLabel.textContent = isMetric ? "°C" : "°F";
  dom.unitToggle.textContent = isMetric ? "°C" : "°F";
  dom.unitToggle.setAttribute(
    "aria-label",
    isMetric ? "Show temperatures in Fahrenheit" : "Show temperatures in Celsius",
  );
}

function toggleUnits() {
  state.units = state.units === "celsius" ? "fahrenheit" : "celsius";
  safeWrite(STORAGE_KEYS.units, state.units);
  applyUnits();
  renderSensor();
  loadWeather();
  loadHistory();
}

/* ---------- init ---------- */

function updateRelativeStatus() {
  if (!state.lastUpdated || state.statusError) return;
  const seconds = (Date.now() - state.lastUpdated) / 1000;
  if (seconds < 60) return;
  dom.status.textContent = `Updated ${describeUpdated(seconds)} · Open-Meteo`;
}

function init() {
  loadStoredState();
  const fromUrl = readPlaceFromUrl();
  if (fromUrl) state.place = fromUrl;

  dom.placeName.textContent = state.place.name;
  applyUnits();
  syncUrl();

  dom.refresh.addEventListener("click", loadWeather);
  dom.unitToggle.addEventListener("click", toggleUnits);
  dom.locate.addEventListener("click", useMyLocation);

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(state.searchTimer);
    runSearch(dom.input.value);
  });

  dom.input.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    const value = dom.input.value;
    if (value.trim().length < 2) {
      closeResults();
      return;
    }
    state.searchTimer = window.setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  });

  dom.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeResults();
      dom.input.blur();
    }
  });

  dom.input.addEventListener("focus", () => {
    if (dom.input.value.trim().length >= 2) {
      runSearch(dom.input.value);
    }
  });

  document.addEventListener("click", (event) => {
    if (!dom.results.contains(event.target) && event.target !== dom.input) {
      closeResults();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.lastUpdated > REFRESH_INTERVAL_MS) {
      loadWeather();
    }
    if (document.visibilityState === "visible") {
      loadSensor();
      loadHistory();
    }
  });

  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      loadWeather();
      loadHistory();
    }
  }, REFRESH_INTERVAL_MS);

  window.setInterval(updateRelativeStatus, 30 * 1000);
  window.setInterval(renderSensor, 1000);

  renderSensor();
  pollSensor();

  loadWeather();
  loadHistory();
}

init();
