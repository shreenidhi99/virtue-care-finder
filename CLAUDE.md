
```markdown
# Project: Virtue Care Finder (Databricks App, Streamlit)

Goal: given a health service and an Indian location, recommend facilities with
quoted evidence (WHY) and a transparent score (HOW), and say clearly when the
records don't mention the service. Users: ASHA workers, NGO coordinators,
district planners, often on phones.

Platform: Databricks Free Edition. Data in Unity Catalog schema `workspace.virtue_finder`
(facility_profile, facility_service_evidence, facility_service_evidence_v2,
node_stats, facility_location_trust, concept_embeddings, v2_concept_lookup).
Raw facility columns include unique_id, name, officialPhone, phone_numbers,
address_city, address_zipOrPostcode, latitude, longitude, capacity,
numberDoctors, facilityTypeId, operatorTypeId, specialties, procedure,
equipment, capability, description.

Planner tables (read by finder/planner.py): facility_nfhs5_district_burden_supply (master),
facility_nfhs5_district_underserved_score, facility_nfhs5_district_service_distance,
facility_nfhs5_facility_context (facility pins + has_* service flags), facility_geo_polygon_qa
(district_match), district_polygon_map (polygon -> NFHS-5 district). Known data problems are in ISSUES.md.

Architecture (current app):
- Streamlit app, deployed twice from the same code: as a Databricks App (workspace sign-in) AND publicly on Streamlit Community Cloud so anyone with the link can use it.
- Two modes, switched at the top of app.py:
  - **Find care**: a plain chat with the Genie agent (finder/genie.py, Genie Conversation API). The user's text goes to the agent as typed, with service and place in one message. Follow-ups and answers to the agent's clarifying questions continue the same conversation, and Genie's suggested questions show as reply buttons. No location picker or maps.
  - **District planner** (finder/planner.py + planner_charts.py): four tabs: National overview, District drill-down, Distance to care, Compare.
- Ranking should come from the deterministic SQL table function `recommend_facilities(...)`, registered in the Genie space as a trusted asset. The app does not re-rank: it renders the agent's table (finder/results.py).
- finder/cards.py, ranking.py, location.py, i18n.py are from the earlier direct-ranking design and currently unused.

Rules:
- Facility results are cards (finder/results.py), never raw tables. Each card shows its evidence quotes with their source column, parsed from the agent's `best_receipts` JSON.
- Users never see intermediate data: no JSON, ids, keys, model fields (p, mode, service_level, expected_km), "All columns" tables or SQL.
- Confidence badge from `p` (0-1, shown as %): green > 80, orange 60-80, red < 60.
- If no facility matches the exact service, show the yellow honesty banner and mark cards "Broadened".
- Never claim a service is available; say "mentioned in records" and add "Verify by phone".
- Planner display rules: thin_sample / low_confidence estimates drawn faded; suppressed or unmatched districts grey; 0 facilities = "none mapped" (never "none exist"); NULL beds = "no reliable bed data" (never 0); distances are straight-line, same-state only; credit "geoBoundaries.org (ODbL 1.0)".
- District boundaries ship as data/india_districts.geojson, built by scripts/build_district_geojson.py. Outer rings must be CLOCKWISE for Plotly (d3-geo); otherwise the map renders as one solid rectangle. Never join districts by name string alone: 7 names repeat across states, so use the `STATE|District` feature id.
- Keep secrets out of code. Auth comes from the Databricks App environment, a local CLI profile, or (public host) DATABRICKS_HOST + DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET of a least-privilege service principal set as host secrets. Warehouse/Genie IDs are not secrets (defaults in run_local.ps1, overridable by env var).
- All SQL uses named parameters; only the validated VF_SCHEMA is interpolated.
- Public app: rate-limit per session and cache SQL/Genie results so link traffic cannot burn the Free Edition compute quota.
- Languages (planned, not built yet): English, Hindi, Tamil, behind env var VF_LANGS (default "en,hi,ta"); setting VF_LANGS=en must cleanly remove the other languages. Evidence quotes always stay in the original English.
- Python 3.11+, streamlit, databricks-sdk, pandas, plotly. Altair is allowed because it ships with streamlit. No other heavy deps (no geopandas/shapely in the app; geometry work stays in notebooks or scripts/).
- Run locally with start_app.bat. Restart it after changing anything under finder/: a browser refresh doesn't reload imported modules.
```

> **Note:** Steps 1–11 below are the original build plan, kept for reference. Some of it has been superseded by the architecture above: the location picker, pydeck map and direct-ranking UI were removed.

---

## Step 1. Confirm Free Edition supports what we need (10 minutes, do this before coding)

Free Edition changes often, so check rather than assume.

1. **Apps**: In the workspace, open **Compute → Apps** (or **New → App**). If you can create an app, you're fine. Free Edition limits how many apps you can run and may stop them when idle, so plan to start the app before your demo.
2. **SQL warehouse**: Free Edition gives you one small serverless warehouse. Note its **warehouse ID** (SQL Warehouses → your warehouse → Connection details; the ID is the last part of the HTTP path).
3. **Genie space ID**: open your Genie space; the ID is in the URL after `/genie/rooms/`.
4. **Genie Conversation API**: run the smoke test below in a notebook in the workspace. If it returns text, the API is available to you.

```python
# Notebook cell: smoke test for the Genie Conversation API
from databricks.sdk import WorkspaceClient
w = WorkspaceClient()
msg = w.genie.start_conversation_and_wait(
    space_id="<YOUR_GENIE_SPACE_ID>",
    content="How many facilities are in Tirunelveli?",
)
print(msg.status)
for a in msg.attachments or []:
    print("TEXT:", a.text.content if a.text else None)
    print("SQL :", a.query.query if a.query else None)
```

If the call fails with "not enabled" or a 404, tell me and we'll switch the chat to a fallback (the app parses service + location itself and calls the SQL function directly; Step 6 already builds that path).

**Prompt for Claude Code:** none for this step. It's manual.

---

## Step 2. Scaffold the project

**Prompt for Claude Code:**
> Create the project structure below for a Databricks App in Streamlit. Fill `requirements.txt` and `app.yaml` as shown. Create empty modules with docstrings describing each one's job. Don't write business logic yet.

```
care-finder/
├── CLAUDE.md
├── app.yaml
├── requirements.txt
├── app.py                 # Streamlit entry: layout, session state, tabs
├── finder/
│   ├── __init__.py
│   ├── config.py          # env vars: GENIE_SPACE_ID, DATABRICKS_WAREHOUSE_ID, CATALOG/SCHEMA
│   ├── db.py              # WorkspaceClient + run_sql(statement, params) -> DataFrame
│   ├── genie.py           # ask(question, conversation_id) -> GenieAnswer(text, df, sql, conversation_id)
│   ├── ranking.py         # recommend(service, lat, lon, urgent, radius_km) -> DataFrame (direct call)
│   ├── location.py        # resolve("Kallidaikurichi" | "627416" | "8.68,77.47") -> (lat, lon, label, confidence)
│   ├── cards.py           # DataFrame -> list[Facility]; render_card(), why_dialog()
│   ├── map_view.py        # pydeck deck from facilities + user point
│   └── i18n.py            # English/Hindi UI strings + Hindi service keywords
├── sql/
│   ├── 01_resolve_location.sql
│   └── 02_recommend_facilities.sql
└── tests/
    └── test_cards.py      # parsing tests on a saved sample result
```

`requirements.txt`
```
streamlit>=1.38
databricks-sdk>=0.40
pydeck>=0.9
pandas>=2.0
plotly>=5.20
folium>=0.17
streamlit-folium>=0.22
```

`app.yaml`
```yaml
command: ["streamlit", "run", "app.py"]
env:
  - name: GENIE_SPACE_ID
    valueFrom: genie-space        # resource key you add in the App UI (Step 9)
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse      # resource key you add in the App UI (Step 9)
  - name: VF_SCHEMA
    value: "workspace.virtue_finder"
  - name: STREAMLIT_BROWSER_GATHER_USAGE_STATS
    value: "false"
```

If the App UI on Free Edition doesn't offer a "Genie space" resource type, replace the `valueFrom` line with `value: "<your space id>"`. A space ID is not a secret.

---

## Step 3. Auth and the SQL helper

Inside a Databricks App, `WorkspaceClient()` picks up the app's **service principal** credentials automatically. Locally, it uses your Databricks CLI profile (`databricks auth login --host <workspace-url>`, then `export DATABRICKS_CONFIG_PROFILE=<profile>`).

The service principal needs its own grants (Step 9). That's the most common reason a deployed app works locally and fails in the cloud.

**Prompt for Claude Code:**
> Implement `finder/config.py` and `finder/db.py`. `run_sql(statement, params: dict)` must use named parameters (never string formatting), execute on the warehouse from config through the Statement Execution API, wait up to 30 s, and return a pandas DataFrame with correct column names. Cache the WorkspaceClient with `st.cache_resource`.

Reference:
```python
# finder/db.py
import pandas as pd, streamlit as st
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem, StatementState
from finder.config import WAREHOUSE_ID

@st.cache_resource
def client() -> WorkspaceClient:
    return WorkspaceClient()

def run_sql(statement: str, params: dict | None = None) -> pd.DataFrame:
    p = [StatementParameterListItem(name=k, value=None if v is None else str(v))
         for k, v in (params or {}).items()]
    r = client().statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID, statement=statement, parameters=p,
        wait_timeout="30s")
    if r.status.state != StatementState.SUCCEEDED:
        raise RuntimeError(f"SQL failed: {r.status.state} {r.status.error}")
    cols = [c.name for c in r.manifest.schema.columns]
    return pd.DataFrame(r.result.data_array or [], columns=cols)
```
Values come back as strings, so cast numeric columns (`pd.to_numeric`) in `cards.py`.

---

## Step 4. The deterministic SQL functions (the "HOW")

These make answers repeatable: same inputs, same order, every time. Genie writes the sentence; this function decides the ranking.

**Prompt for Claude Code:**
> First run `DESCRIBE TABLE` on `workspace.virtue_finder.facility_profile`, `facility_service_evidence_v2`, `facility_location_trust`, `v2_concept_lookup`, and `node_stats`, and show me the columns. Then adapt `sql/01_resolve_location.sql` and `sql/02_recommend_facilities.sql` below to the real column names. Keep the output columns of `recommend_facilities` exactly as listed, because the app depends on them. Give me the final SQL to run in the SQL editor.

The column names below marked `-- ADAPT` are guesses. Claude Code should fix them after the DESCRIBE.

### 4a. `resolve_location`: place name, PIN or "lat,lon" → a point

```sql
CREATE OR REPLACE FUNCTION workspace.virtue_finder.resolve_location(q STRING)
RETURNS TABLE (lat DOUBLE, lon DOUBLE, label STRING, confidence STRING)
COMMENT 'Turns a village/city, 6-digit PIN or "lat,lon" into a point. Uses medians of trusted facility pins.'
RETURN
  WITH parsed AS (
    SELECT
      CASE WHEN q RLIKE '^\\s*-?[0-9.]+\\s*,\\s*-?[0-9.]+\\s*$'
           THEN CAST(trim(split(q, ',')[0]) AS DOUBLE) END AS in_lat,
      CASE WHEN q RLIKE '^\\s*-?[0-9.]+\\s*,\\s*-?[0-9.]+\\s*$'
           THEN CAST(trim(split(q, ',')[1]) AS DOUBLE) END AS in_lon,
      CASE WHEN trim(q) RLIKE '^[0-9]{6}$' THEN trim(q) END AS pin,
      lower(trim(q)) AS place
  ),
  trusted AS (
    SELECT p.address_city, p.address_zipOrPostcode, p.latitude, p.longitude
    FROM workspace.virtue_finder.facility_profile p
    JOIN workspace.virtue_finder.facility_location_trust t USING (unique_id)
    WHERE t.trust_level IN ('high','medium')                -- ADAPT
      AND p.latitude BETWEEN 6 AND 37 AND p.longitude BETWEEN 68 AND 98   -- inside India
  )
  SELECT in_lat, in_lon, q, 'exact' FROM parsed WHERE in_lat IS NOT NULL
  UNION ALL
  SELECT percentile(latitude, 0.5), percentile(longitude, 0.5),
         concat('PIN ', pin), CASE WHEN count(*) >= 3 THEN 'high' ELSE 'low' END
  FROM trusted, parsed
  WHERE parsed.pin IS NOT NULL AND address_zipOrPostcode = parsed.pin
  GROUP BY pin
  UNION ALL
  SELECT percentile(latitude, 0.5), percentile(longitude, 0.5),
         initcap(place), CASE WHEN count(*) >= 3 THEN 'medium' ELSE 'low' END
  FROM trusted, parsed
  WHERE parsed.pin IS NULL AND parsed.in_lat IS NULL AND lower(address_city) = parsed.place
  GROUP BY place;
```

Small villages such as Kallidaikurichi may have no facility rows of their own. If the result is empty, `location.py` should ask the user for the PIN or district, or let them drop a pin. A PIN directory (lat/lon per PIN) would fix this properly; load one if you can get it.

### 4b. `recommend_facilities`: the ranking

Scoring (all components shown in the "Why" panel and summing to the total):

| Component | Urgent ON | Urgent OFF | Meaning |
|---|---|---|---|
| service_match | 0.45 | 0.35 | 1.0 exact concept, 0.6 child/parent concept, 0.4 broadened to general emergency |
| evidence_strength | 0.20 | 0.15 | Strong 1.0 / Moderate 0.6 / Weak 0.3 (from your evidence tiering) |
| distance | 0.15 | 0.35 | `1 - distance_km / radius_km`, floored at 0 |
| size_type | 0.10 | 0.05 | hospital > clinic; beds/doctors when present, capped to ignore outliers |
| location_trust | 0.10 | 0.10 | high 1.0 / medium 0.6 / low 0.2 |

```sql
CREATE OR REPLACE FUNCTION workspace.virtue_finder.recommend_facilities(
  service STRING, lat DOUBLE, lon DOUBLE,
  urgent BOOLEAN DEFAULT false, radius_km DOUBLE DEFAULT 60, top_n INT DEFAULT 10)
RETURNS TABLE (
  rank INT, unique_id STRING, name STRING, facility_type STRING, operator STRING,
  phone STRING, latitude DOUBLE, longitude DOUBLE, distance_km DOUBLE,
  tier STRING, best_quote STRING, quote_source STRING, matched_concept STRING,
  broadened BOOLEAN, rare BOOLEAN, location_confidence STRING,
  s_match DOUBLE, s_evidence DOUBLE, s_distance DOUBLE, s_size DOUBLE, s_location DOUBLE,
  score DOUBLE)
COMMENT 'Deterministic facility ranking for a service near a point. Use this for every recommendation question.'
RETURN
  WITH concept AS (                          -- map free text to ontology concepts
    SELECT concept_id, concept_name, match_level            -- ADAPT
    FROM workspace.virtue_finder.v2_concept_lookup
    WHERE lower(term) = lower(service) OR lower(concept_name) = lower(service)
  ),
  exact AS (
    SELECT e.unique_id, e.tier, e.evidence_text, e.source_column,  -- ADAPT
           c.concept_name, CASE c.match_level WHEN 'exact' THEN 1.0 ELSE 0.6 END AS m
    FROM workspace.virtue_finder.facility_service_evidence_v2 e
    JOIN concept c ON e.concept_id = c.concept_id
  ),
  -- Fallback when no exact evidence exists anywhere nearby: general emergency
  fallback AS (
    SELECT e.unique_id, e.tier, e.evidence_text, e.source_column,
           'emergency care' AS concept_name, 0.4 AS m
    FROM workspace.virtue_finder.facility_service_evidence_v2 e
    WHERE e.concept_name IN ('emergency', 'casualty', 'icu')       -- ADAPT
  ),
  geo AS (
    SELECT p.*, t.trust_level,                                     -- ADAPT
      2 * 6371 * asin(sqrt(
        pow(sin(radians(p.latitude - lat) / 2), 2) +
        cos(radians(lat)) * cos(radians(p.latitude)) *
        pow(sin(radians(p.longitude - lon) / 2), 2))) AS distance_km
    FROM workspace.virtue_finder.facility_profile p
    LEFT JOIN workspace.virtue_finder.facility_location_trust t USING (unique_id)
    WHERE p.latitude IS NOT NULL
  ),
  near_exact AS (
    SELECT g.*, x.* EXCEPT (unique_id), false AS broadened
    FROM geo g JOIN exact x USING (unique_id) WHERE g.distance_km <= radius_km
  ),
  candidates AS (
    SELECT * FROM near_exact
    UNION ALL
    SELECT g.*, f.* EXCEPT (unique_id), true AS broadened
    FROM geo g JOIN fallback f USING (unique_id)
    WHERE g.distance_km <= radius_km AND NOT EXISTS (SELECT 1 FROM near_exact)
  ),
  best AS (   -- one row per facility: its strongest quote
    SELECT * FROM candidates
    QUALIFY row_number() OVER (PARTITION BY unique_id
            ORDER BY CASE tier WHEN 'Strong' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,
                     length(evidence_text)) = 1
  ),
  scored AS (
    SELECT b.*,
      m AS c_match,
      CASE tier WHEN 'Strong' THEN 1.0 WHEN 'Moderate' THEN 0.6 ELSE 0.3 END AS c_ev,
      greatest(0, 1 - distance_km / radius_km) AS c_dist,
      LEAST(1.0, CASE WHEN facilityTypeId = 'hospital' THEN 0.6 ELSE 0.3 END
                 + 0.4 * LEAST(coalesce(try_cast(capacity AS DOUBLE), 0), 500) / 500) AS c_size,
      CASE trust_level WHEN 'high' THEN 1.0 WHEN 'medium' THEN 0.6 ELSE 0.2 END AS c_loc
    FROM best b
  ),
  weighted AS (
    SELECT *,
      round(c_match * IF(urgent, 0.45, 0.35), 3) AS w_match,
      round(c_ev    * IF(urgent, 0.20, 0.15), 3) AS w_ev,
      round(c_dist  * IF(urgent, 0.15, 0.35), 3) AS w_dist,
      round(c_size  * IF(urgent, 0.10, 0.05), 3) AS w_size,
      round(c_loc   * 0.10, 3)                   AS w_loc
    FROM scored
  )
  SELECT
    CAST(row_number() OVER (ORDER BY w_match + w_ev + w_dist + w_size + w_loc DESC,
                            distance_km, unique_id) AS INT) AS rank,  -- unique_id breaks ties: deterministic
    unique_id, name, facilityTypeId, operatorTypeId,
    coalesce(officialPhone, phone_numbers) AS phone,
    latitude, longitude, round(distance_km, 1),
    tier, evidence_text, source_column, concept_name,
    broadened,
    false AS rare,    -- ADAPT: e.g. node_stats.facility_count < 20 for this concept
    coalesce(trust_level, 'low'),
    w_match, w_ev, w_dist, w_size, w_loc,
    round(w_match + w_ev + w_dist + w_size + w_loc, 3) AS score
  FROM weighted
  ORDER BY rank
  LIMIT top_n;
```

Test it in the SQL editor:
```sql
SELECT * FROM workspace.virtue_finder.recommend_facilities('snakebite', 8.68, 77.47, true);
```
**Expected demo result:** Govt. Tirunelveli Medical College Hospital at rank 1 (about 31 km, Strong), `broadened = true` because no nearby record mentions anti-venom, and Lakshmi Hospital (PIN 627401, merged record with a pin far from its PIN) ranked lower with `location_confidence = 'low'`. If Lakshmi comes first, the location-trust weight is too low or its trust level isn't being joined.

**Add to the Genie space:** Genie space → **Instructions → SQL functions / trusted assets** → add `recommend_facilities` and `resolve_location`. Then add a general instruction:

> For any question asking where to get a service near a place, first call `resolve_location` on the place, then call `recommend_facilities` with the service, lat, lon, and urgent = true if the user says urgent, emergency, bite, bleeding, labour or accident. Return all columns. In your text answer, name the rank-1 facility and its distance in one sentence, then say plainly if `broadened` is true that no nearby record mentions the exact service. Never say a service is available; say it is mentioned in records.

---

## Step 5. Genie client

**Prompt for Claude Code:**
> Implement `finder/genie.py`. `ask(question, conversation_id=None)` starts a new conversation or continues one, waits for completion (timeout 60 s), and returns a dataclass `GenieAnswer(text, sql, df, conversation_id, message_id, error)`. For the query attachment, fetch the result rows and build a DataFrame with column names from the manifest. Handle FAILED / CANCELLED and timeouts by returning `error` instead of raising. Check which attachment-result method exists in the installed databricks-sdk version and use it.

Reference (method names differ slightly between SDK versions, which is why the prompt asks Claude Code to check):
```python
# finder/genie.py
from dataclasses import dataclass
import datetime as dt, pandas as pd
from finder.db import client
from finder.config import GENIE_SPACE_ID

@dataclass
class GenieAnswer:
    text: str | None; sql: str | None; df: pd.DataFrame | None
    conversation_id: str | None; message_id: str | None; error: str | None = None

def ask(question: str, conversation_id: str | None = None) -> GenieAnswer:
    w = client()
    try:
        if conversation_id:
            msg = w.genie.create_message_and_wait(GENIE_SPACE_ID, conversation_id, question,
                                                  timeout=dt.timedelta(seconds=60))
        else:
            msg = w.genie.start_conversation_and_wait(GENIE_SPACE_ID, question,
                                                      timeout=dt.timedelta(seconds=60))
    except Exception as e:
        return GenieAnswer(None, None, None, conversation_id, None, error=str(e))

    text = sql = None; df = None
    for a in msg.attachments or []:
        if a.text and a.text.content:
            text = a.text.content
        if a.query:
            sql = a.query.query
            text = text or a.query.description
            res = w.genie.get_message_attachment_query_result(   # older SDKs: get_message_query_result_by_attachment
                GENIE_SPACE_ID, msg.conversation_id, msg.id, a.attachment_id)
            sr = res.statement_response
            cols = [c.name for c in sr.manifest.schema.columns]
            df = pd.DataFrame(sr.result.data_array or [], columns=cols)
    return GenieAnswer(text, sql, df, msg.conversation_id, msg.id)
```

Rule for the app: **if `df` has the `recommend_facilities` columns (`rank`, `score`, `best_quote`…), render cards from it. If Genie returned some other shape**, show Genie's text only, and offer a "Rank with the standard method" button that calls `ranking.recommend()` directly. That keeps every card backed by the deterministic function.

---

## Step 6. Direct ranking path and location parsing

This is the repeatable path and also the fallback if Genie is slow or unavailable.

**Prompt for Claude Code:**
> Implement `finder/location.py` (calls `resolve_location` via `run_sql`; returns None when empty) and `finder/ranking.py` (calls `recommend_facilities` with named parameters). Add a small `finder/i18n.py` with English/Hindi UI strings and a dict of common Hindi service words mapped to English concepts (प्रसव→delivery, सांप का काटना→snakebite, डायलिसिस→dialysis, आपातकाल→emergency, सीज़ेरियन→c-section, नवजात आईसीयू→nicu). If the user's text is in Devanagari, translate known words before sending to Genie and before the direct call.

```python
# finder/ranking.py
from finder.db import run_sql
from finder.config import SCHEMA

def recommend(service, lat, lon, urgent=False, radius_km=60, top_n=10):
    return run_sql(
        f"SELECT * FROM {SCHEMA}.recommend_facilities("
        f":service, CAST(:lat AS DOUBLE), CAST(:lon AS DOUBLE), "
        f"CAST(:urgent AS BOOLEAN), CAST(:radius AS DOUBLE), CAST(:top_n AS INT))",
        {"service": service, "lat": lat, "lon": lon,
         "urgent": str(urgent).lower(), "radius": radius_km, "top_n": top_n})
```
(`SCHEMA` comes from config, not from user input, so the f-string is safe. User values go through parameters.)

---

## Step 7. Cards, tiers, honesty banner, and the "Why this facility?" panel

**Prompt for Claude Code:**
> Implement `finder/cards.py` following Frames A and B of the wireframe. `to_facilities(df)` casts numeric columns and returns a list of `Facility` dataclasses. `render_banner(facilities, service)` shows `st.warning` when any card is broadened ("No facility nearby mentions {service}. Showing general emergency care."). `render_card(f, expanded)` shows rank, name, distance, type; badges for tier (Strong green, Moderate amber, Weak red), "Verify by phone" (always), "Broadened", "Rare", and a location chip ("Location verified" / "Location uncertain"); one quoted line with its source column; a primary Call link (`tel:`), Directions (Google Maps `dir/?api=1&destination=lat,lon`), WhatsApp share (`https://wa.me/?text=...` with name, phone, quote), and a "Why this facility?" button. Only rank 1 is expanded; others are compact. `why_dialog(f, service)` uses `@st.dialog` and shows: a one-line verdict, the quote with matched words in bold, a "Not found" box when broadened listing the terms searched, a score breakdown (horizontal bars for s_match, s_evidence, s_distance, s_size, s_location that add to score), three confidence chips, and the exact function call used. Write tests in `tests/test_cards.py` against a saved sample DataFrame.

Notes:
- Streamlit badges: use small HTML spans via `st.markdown(..., unsafe_allow_html=True)` with a few CSS classes injected once at the top of `app.py`. Keep colours to the five tier/warning colours in the wireframe.
- Score bars: `st.progress` per component works and is simple; the label is the component name and value.
- `tel:` links work on phones. On desktop they may do nothing, so also show the number as text.

---

## Step 8. Map and main layout

**Prompt for Claude Code:**
> Implement `finder/map_view.py` with pydeck: a ScatterplotLayer of facilities coloured by tier (Strong green, Moderate amber, Weak red), a TextLayer with the rank number on each pin, a larger translucent ring for `location_confidence = 'low'`, a teal dot for the user's location, and a 60 km radius circle. Tooltip shows name, distance, tier. Use the default Carto basemap (no Mapbox token needed). Then build `app.py`: `st.set_page_config(layout="wide")`, top tabs "Find care" and "District planner", a 38/62 column split. Left: chat history from `st.session_state`, an Urgent `st.toggle`, a radius selectbox, an optional "lat, lon" text input, example prompt buttons, and `st.chat_input`. Right: banner, map, then cards. Store `conversation_id`, last facilities and last service in session state. Use `st.spinner("Searching facility records…")` while Genie runs. On a narrow screen the columns stack, which is acceptable for v1.

```python
# finder/map_view.py (core)
import pydeck as pdk
TIER_RGB = {"Strong": [29,122,70], "Moderate": [154,100,0], "Weak": [163,57,46]}

def deck(facilities, user_lat, user_lon, radius_km=60):
    rows = [dict(name=f.name, lat=f.latitude, lon=f.longitude, rank=str(f.rank),
                 color=TIER_RGB.get(f.tier, [120,120,120]), tier=f.tier,
                 dist=f.distance_km, low=f.location_confidence == "low")
            for f in facilities]
    layers = [
        pdk.Layer("ScatterplotLayer", [{"lat": user_lat, "lon": user_lon}],
                  get_position="[lon, lat]", get_radius=radius_km * 1000,
                  get_fill_color=[15,107,92,18], stroked=True, get_line_color=[15,107,92,140],
                  line_width_min_pixels=1),
        pdk.Layer("ScatterplotLayer", [r for r in rows if r["low"]],
                  get_position="[lon, lat]", get_radius=2500, get_fill_color=[163,57,46,40]),
        pdk.Layer("ScatterplotLayer", rows, get_position="[lon, lat]", get_fill_color="color",
                  radius_min_pixels=9, pickable=True),
        pdk.Layer("TextLayer", rows, get_position="[lon, lat]", get_text="rank",
                  get_color=[255,255,255], get_size=12),
        pdk.Layer("ScatterplotLayer", [{"lat": user_lat, "lon": user_lon}],
                  get_position="[lon, lat]", get_fill_color=[15,107,92], radius_min_pixels=7),
    ]
    view = pdk.ViewState(latitude=user_lat, longitude=user_lon, zoom=8.5)
    return pdk.Deck(layers=layers, initial_view_state=view,
                    tooltip={"text": "{rank}. {name}\n{dist} km · {tier}"})
```
Render with `st.pydeck_chart(deck(...), use_container_width=True)`.

**Request flow inside `app.py`:**
1. User types a message (Hindi words translated via `i18n`).
2. Prefix the Urgent and radius settings so Genie sees them: `f"{text} (urgent={urgent}, radius_km={radius})"`, plus `(location: lat, lon)` if the lat/lon box is filled.
3. `genie.ask(...)`. If `df` has the expected columns → cards. Otherwise show the text plus the "Rank with the standard method" button.
4. If Genie errors → show "The assistant is unavailable. Showing the standard ranking." and run the direct path, which needs a service and location. Add two small fields (Service, Location) under the chat as the fallback form.

---

## Step 9. Run locally, then deploy

**Local run**
```bash
pip install -r requirements.txt
databricks auth login --host https://<your-workspace>.cloud.databricks.com
export DATABRICKS_CONFIG_PROFILE=<profile-name>
export GENIE_SPACE_ID=<space-id> DATABRICKS_WAREHOUSE_ID=<warehouse-id> VF_SCHEMA=workspace.virtue_finder
streamlit run app.py
```

**Create the app (UI, once)**
1. **Compute → Apps → Create app → Custom**, name it `care-finder`.
2. Under **App resources**, add:
   - SQL warehouse → your warehouse, permission **Can use**, key `sql-warehouse`.
   - Genie space → your space, permission **Can run**, key `genie-space` (if this resource type isn't offered, use the plain `value:` in app.yaml as noted in Step 2).
3. Create. Note the app's **service principal** name shown on the app page.

**Grant the service principal data access** (SQL editor, as yourself):
```sql
GRANT USE CATALOG ON CATALOG workspace TO `<app-service-principal>`;
GRANT USE SCHEMA, SELECT, EXECUTE ON SCHEMA workspace.virtue_finder TO `<app-service-principal>`;
```
Genie runs queries as whoever calls it, which here is the app's service principal, so it needs these grants too. Also share the Genie space with the service principal (Share → Can run) if the resource step didn't.

**Deploy code (CLI)**
```bash
databricks sync . /Workspace/Users/<you>/care-finder
databricks apps deploy care-finder --source-code-path /Workspace/Users/<you>/care-finder
```
Then open the app URL from the Apps page. Logs are under the app's **Logs** tab; that's where permission errors show up.

**Prompt for Claude Code:**
> Add a `Makefile` (or `deploy.sh`) with `run`, `sync`, and `deploy` targets using the commands above, reading the workspace user path from an env var. Add a `.databricksignore`-style exclusion so tests and `.venv` aren't synced.

---

## Step 10. Optional: District planner tab (Frame D)

Only if time allows, and only once an NFHS-5 district file is loaded (it isn't in the project yet).

**Prompt for Claude Code:**
> Add a "District planner" tab: selectors for service, state and NFHS-5 indicator; a SQL query that counts Strong-tier facilities per district for the service and joins NFHS-5 need by district; a pydeck GeoJsonLayer choropleth of need (needs a district boundary GeoJSON, loaded from a Volume) with Strong facilities as dots; and a table sorted by gap with `st.download_button` for CSV.

---

## Step 11. Demo checklist

- [ ] App is started before the demo (Free Edition may stop idle apps).
- [ ] Kallidaikurichi snakebite, Urgent ON: TVMC rank 1, yellow banner shows, Lakshmi Hospital shows "Location uncertain".
- [ ] Same query twice gives the same order (deterministic function).
- [ ] Urgent OFF: a closer, smaller facility can move up. Explain the weight change in the "Why" panel.
- [ ] One Hindi query works (e.g. "तिरुनेलवेली के पास प्रसव अस्पताल").
- [ ] A lat/lon query works ("8.68, 77.47").
- [ ] Turn off Genie (bad space ID) and show the fallback still ranks.

## Free Edition caveats to state honestly

- Apps, Genie, and serverless SQL are offered on Free Edition, but limits (number of apps, idle shutdown, warehouse size, daily compute) change. Step 1 confirms what your workspace allows.
- Genie can occasionally write its own SQL instead of calling the trusted function. The app checks the result columns and falls back to the direct call, so cards are always from the deterministic ranking.
- "Not mentioned in records" is not "not available". The UI says so every time.
- Location for small villages depends on facility pins; a PIN directory would make it reliable.
