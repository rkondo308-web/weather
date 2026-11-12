# Current Weather

A small [Vercel](https://vercel.com) app that shows the current temperature and
humidity for a place of your choosing. No framework, no build step, no API key.

## What it does

- Current temperature, humidity, feels-like temperature, wind, and condition
- City search with type-ahead results (Open-Meteo geocoding)
- "Use my location" via the browser Geolocation API
- °C / °F toggle that persists in `localStorage`
- Remembers your last place, and supports shareable URLs
  (`/?lat=42.3601&lon=-71.0589&name=Boston`)
- Auto-refreshes every 10 minutes and when the tab becomes visible again

On a first visit there is no saved place, so the app opens on Boston,
Massachusetts. Search for a city or use the location button to change it.

## How it is built

```
public/            Static site (served as-is)
  index.html
  styles.css
  app.js
api/
  weather.js       GET /api/weather?latitude=&longitude=&units=celsius|fahrenheit
  geocode.js       GET /api/geocode?q=city
```

The two functions proxy and normalize the [Open-Meteo](https://open-meteo.com/)
APIs, so the browser only ever talks to this deployment. Weather responses are
cached at the edge for 5 minutes; geocoding results for a day. Both upstream
calls time out after 8 seconds and return a JSON `error` message on failure.

Open-Meteo is free for non-commercial use and needs no API key. If you plan to
put this in front of heavy traffic, check their
[terms](https://open-meteo.com/en/terms).

## Run it locally

You need Node.js 18 or newer.

```bash
npm install -g vercel   # once
vercel dev              # http://localhost:3000
```

Or without installing anything globally:

```bash
npx vercel dev
```

`vercel dev` serves `public/` and runs the `api/` functions, which is why a
plain static server (for example `python3 -m http.server`) will show the UI but
not the weather.

## Deploy

**From the repo (recommended):** import this repository in the Vercel
dashboard, or run `npx vercel --prod` from the project root.

**Git deploys:** once the project is connected to this GitHub repository, every
push to `main` ships to production automatically.

No environment variables are required.
