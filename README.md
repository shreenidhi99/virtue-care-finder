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

## Workspace settings

The app needs four settings. `run_local.ps1` fills in the team defaults, so on the team workspace you only need the `databricks auth login` step above.

| Setting | Team default | What it is / where to find it |
|---|---|---|
| Workspace URL | `https://dbc-a2638f61-0f88.cloud.databricks.com` | The address you see in the browser when signed in to Databricks. It's stored in your CLI profile by `databricks auth login --host <url> --profile <name>`, not in the code. |
| `DATABRICKS_CONFIG_PROFILE` | `care-finder` | The profile name you gave in `databricks auth login`. List yours with `databricks auth profiles`. |
| `DATABRICKS_WAREHOUSE_ID` | `0d88dd62ca1e1fec` | **SQL Warehouses** → your warehouse → **Connection details**. It's the last part of the HTTP path (`/sql/1.0/warehouses/<id>`). |
| `GENIE_SPACE_ID` | `01f1e5d2ef9711989854a6d1fb63067c` | Open the Genie space. It's the part of the URL after `/genie/rooms/`. |
| `VF_SCHEMA` | `workspace.virtue_finder` | Unity Catalog `catalog.schema` holding the tables. |

To use a different value, set it in PowerShell before starting (it only lasts for that window):

```powershell
$env:DATABRICKS_CONFIG_PROFILE = "my-profile"   # e.g. if you logged in under another profile name
.\run_local.ps1
```

`run_local.ps1` prints the values it's using when it starts. Your Databricks user also needs permission to use the warehouse, run the Genie space, and read `workspace.virtue_finder` (ask the workspace owner). If the app shows "PERMISSION_DENIED" or "not found", check those first.

In the deployed Databricks App, these come from `app.yaml` and the app's resources instead (`sql-warehouse`, `genie-space`).

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
