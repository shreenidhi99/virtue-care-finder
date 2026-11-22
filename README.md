# Virtue Care Finder

A Streamlit app (deployed as a Databricks App) with two modes:

- **Find care**: a chat with our Genie agent. Ask for a service and a place, e.g. *"snakebite treatment near Kallidaikurichi"*. The agent answers with facility cards: evidence quotes and their source column, a confidence badge (green >80%, orange 60–80%, red <60%), and Call / Directions buttons. Its clarifying questions show up in the chat, and suggested replies appear as buttons.
- **District planner**: NFHS-5 burden vs facility supply by district. It has four tabs: National overview (choropleth, underserved leaderboard, burden-vs-supply), District drill-down (facility map, radar, need-vs-supply), Distance to care, and Compare.

Data lives in Unity Catalog, schema `workspace.virtue_finder`. Project rules for Claude Code are in [CLAUDE.md](CLAUDE.md), and known data issues are in [ISSUES.md](ISSUES.md).

## Run it locally

You need Python 3.11+ and the [Databricks CLI](https://docs.databricks.com/dev-tools/cli/install.html), plus access to the team workspace (`https://dbc-a2638f61-0f88.cloud.databricks.com`). Ask Shreenidhi to add you.

```powershell
git clone https://github.com/shreenidhi99/virtue-care-finder.git
cd virtue-care-finder
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

# One-time sign-in. The profile name must be "care-finder" (run_local.ps1 uses it)
databricks auth login --host https://dbc-a2638f61-0f88.cloud.databricks.com --profile care-finder
```

Then **double-click `start_app.bat`**, or run `.\run_local.ps1`. The app opens at http://localhost:8501.

After changing code under `finder/`, restart with `start_app.bat`. A browser refresh doesn't reload changed modules.

No secrets live in this repo. The warehouse ID and Genie space ID in `run_local.ps1` aren't secrets, and auth comes from your own CLI login.

## Layout

```
app.py                      Streamlit entry: mode switch, Find care chat
finder/genie.py             Genie Conversation API client (answer text, table, suggested replies)
finder/results.py           Facility cards built from the agent's table (JSON evidence parsed, internals hidden)
finder/planner.py           District planner: data loading, choropleth, the four tabs
finder/planner_charts.py    Plotly chart builders for the planner
finder/db.py, config.py     SQL warehouse access (named parameters only) and env settings
data/india_districts.geojson  Simplified district boundaries shipped with the app (1.6 MB)
scripts/build_district_geojson.py  Rebuilds that file from geoBoundaries + district_polygon_map
sql/                        Table functions (resolve_location, recommend_facilities)
```

`finder/cards.py`, `ranking.py`, `location.py` and `i18n.py` belong to the earlier direct-ranking design and aren't used by the app at the moment.

## Rebuild the district boundaries

Only needed when `district_polygon_map` changes. Download `geoBoundaries-IND-ADM2-all.zip` from the Volume `/Volumes/workspace/virtue_finder/geodata/`, unzip it into `data/raw/gb/` (git ignores that folder), then:

```powershell
$env:DATABRICKS_CONFIG_PROFILE="care-finder"
.venv\Scripts\python scripts\build_district_geojson.py data\raw\gb\geoBoundaries-IND-ADM2_simplified.geojson
```

The script prints which hand-made mapping overrides are still in use. An override stops applying once the table is fixed.

## Deploy as a Databricks App

The app is named `care-finder`. Resources and env vars are defined in `app.yaml`.

```powershell
databricks sync . /Workspace/Users/<you>/care-finder --profile care-finder
databricks apps deploy care-finder --source-code-path /Workspace/Users/<you>/care-finder --profile care-finder
```

Boundaries: geoBoundaries.org (ODbL 1.0).
