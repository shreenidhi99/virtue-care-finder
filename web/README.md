# Virtue Care Finder: Next.js version

A port of the Streamlit app (repo root) to Next.js + TypeScript. Same data and Genie agent, plus:

- **Find care** shows the agent's own text answer, the way the Genie app does, with its reasoning steps live while it works. Facility cards sit in their own scrollable box, and a new question scrolls to the top of the screen and stays there while the answer arrives.
- **District planner** has the same four tabs and charts (plotly.js), plus **Ask about an area**: tap the map to drop a pin, then ask the agent about that place.

## Run it locally

Needs Node 20.9+ and the Databricks CLI signed in as the `care-finder` profile (see the root README).

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

The team's warehouse, Genie space and schema are the defaults in `lib/server/config.ts`. To use others, set `DATABRICKS_CONFIG_PROFILE`, `DATABRICKS_WAREHOUSE_ID`, `GENIE_SPACE_ID` or `VF_SCHEMA` before `npm run dev`. Next.js reloads code changes by itself; there's no need to restart.

```bash
npm test               # results shaping, stats, point-in-district
npm run typecheck
npm run build && npm start   # production build, as Databricks runs it
```

## Layout

```
app/page.tsx, components/App.tsx   Mode switch: Find care / District planner
components/Chat.tsx                Conversation with the agent (follow-ups, suggested replies, "Why this facility?")
components/Answer.tsx              Agent text (markdown), live reasoning box, facility cards in a scroll box
components/planner/                The planner tabs, and AreaAsk.tsx (pin + question)
lib/planner/charts.ts              Plotly figures (port of finder/planner_charts.py + the choropleth)
lib/results.ts                     Agent table -> cards; strips ids, keys and model fields
app/api/genie/route.ts             Streams the agent's progress, then the answer (NDJSON)
app/api/planner/*                  District, facility and data-quality data (cached 6 h)
lib/server/                        Auth, SQL (named parameters only), Genie client, cache + rate limits
public/india_districts.geojson     Copy of ../data/india_districts.geojson (refreshed by `npm run dev`/`build`)
```

Browsers only receive what users see. The server turns the agent's table into cards and doesn't send SQL, ids or model fields.

## Auth and limits

- **Databricks App**: the app's service principal (env vars injected by the platform).
- **Public host**: set `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` of a least-privilege service principal as host secrets.
- **Local**: your Databricks CLI profile.

Each browser session may ask the agent 20 questions per 10 minutes (`VF_GENIE_PER_SESSION`), and the whole app 300 per hour (`VF_GENIE_PER_HOUR`). Planner queries are cached for 6 hours and limited to 120 uncached requests per session per 10 minutes (`VF_SQL_PER_SESSION`). The cache and limits live in server memory, so they reset when the app restarts.

## Deploy as a Databricks App

Deploy this folder. `app.yaml` uses the same resource keys as the Streamlit app (`sql-warehouse`, `genie-space`). The platform runs `npm install` and `npm run build`, then `npm run start`, which binds to `DATABRICKS_APP_PORT`.

```bash
databricks sync web /Workspace/Users/<you>/care-finder-web --profile care-finder
databricks apps deploy care-finder-web --source-code-path /Workspace/Users/<you>/care-finder-web --profile care-finder
```

Create the `care-finder-web` app first (Compute → Apps), and give its service principal the same grants as in the root README.

Streamlit Community Cloud can't host Next.js. For a public link, use a Node host such as Vercel or Render, with the service-principal secrets above.
