# Issues found while building the District planner map

Found on 2026-11-22 while building the India choropleth. The source is `workspace.virtue_finder` and the geoBoundaries IND ADM2 file in `/Volumes/workspace/virtue_finder/geodata/`.

Status key: **Fixed in app** = worked around in this repo. **Open** = needs a fix in the data pipeline, or a decision.

## Status after the 2026-11-22 pipeline update (checked live)

- ✅ Name-first rebuild of `district_polygon_map` is live (e.g. Raisen and Ashoknagar map correctly).
- ✅ Distance backfill is live: `facility_nfhs5_district_service_distance` has 701 rows and all 20 J&K districts are shaded. Only Leh, Kargil, Lakshadweep and Yanam are left out, as documented.
- ❌ **The three corrections are not in the table yet:** Rangareddy is still Sangareddy, Warangal (U) still Warangal Rural, and Chengalputtu still Chennai. The same goes for `district_polygon_metrics`. The app's build script overrides them, and each override switches itself off once the table holds a different value.
- ⚠ `beds_per_10k_households` now peaks at ~256,000 and `facilities_per_10k_households` at ~4,268, so the denominator problem (C6) is still there.

## A. Wrong or missing rows in `district_polygon_map`

| # | Polygon | Problem | Status |
|---|---|---|---|
| A1 | Rangareddy (Telangana) | `fuzzy_name` matched it to **Sangareddy**, a different district. Its NFHS-5 row is "Ranga Reddy". | Fixed in app (override in `scripts/build_district_geojson.py`) |
| A2 | Warangal (U) (Telangana) | `bridge` sent it to **Warangal Rural**. NFHS-5 has a separate "Warangal Urban" row. | Fixed in app (override) |
| A3 | Unokoti | `polygon_state` is **ASSAM**, but Unakoti is in **Tripura**. The row is also unmapped. | Fixed in app (override) |
| A4 | Janjgir-Champa | Unmapped because of punctuation. NFHS-5 spells it "Janjgir - Champa". | Fixed in app (override) |
| A5 | East Jaintia Hills | Unmapped because of spelling. NFHS-5 spells it "East Jantia Hills". | Fixed in app (override) |
| A6 | South Salmara-Mankachar | Unmapped because of spelling. NFHS-5 spells it "South Salmara Mancachar". | Fixed in app (override) |
| A7 | Chandel | I first thought NFHS-5 had Chandel only under Mizoram. It has both rows (see C10), so the Manipur mapping is correct. | No override needed |
| A8 | Lower Siang (Arunachal) | `fuzzy_name` matched it to **Siang**, which is a different district (Siang has its own polygon). It probably has no NFHS-5 estimate. | **Open:** left as is because I'm not sure. Recommend setting it to unmapped. |
| A9 | 18 districts created after NFHS-5 (Manipur: Kangpokpi, Pherzawl, Noney, Tengnoupal, Kamjong, Kakching, Jiribam; Mizoram: Hnahthial, Saitual, Khawzawl; Arunachal: Pakke Kessang, Kamle, Shi Yomi, Leparada; plus Jhargram, Narayanpet, Mulugu, Niwari, Gaurella Pendra Marwahi, Saiha) | No NFHS-5 row of their own. | Shown grey: "No NFHS-5 estimate". **Open:** could fall back to the parent district, the way Tenkasi uses Tirunelveli. |
| A10 | "DATA NOT AVAILABLE" (J&K) | A geoBoundaries placeholder polygon. | Shown grey |
| A11 | Charkhi Dadri (Haryana) | Has an NFHS-5 row but no polygon. The boundary file folds it into Bhiwani, so its data never appears on the map. | **Open** |

Result: 714 of 735 polygons are shaded, and 21 are grey.

## B. Geometry and boundary file

| # | Problem | Status |
|---|---|---|
| B1 | GeoJSON features have only `shapeName`, with no state. 7 names appear twice (Bilaspur, Hamirpur, Aurangabad, Balrampur, Bijapur, Raigarh, Pratapgarh), so joining on name alone breaks. | Fixed: the build script picks the state by the nearest `district_centroids` point and writes a unique `STATE\|District` id. |
| B2 | The full GeoJSON is 48 MB and the "simplified" one is 8 MB, both too heavy for phones. | Fixed: pure-Python Douglas-Peucker plus rounding gives `data/india_districts.geojson` at **1.56 MB**. |
| B6 | **All-India map rendered as one solid blue rectangle.** geoBoundaries rings are counter-clockwise (the GeoJSON spec), but Plotly's map engine (d3-geo) needs clockwise outer rings. It read each district as "the whole globe minus this district". | Fixed: the build script rewinds outer rings to clockwise and holes to counter-clockwise. Checked by rendering images. |
| B3 | Each polygon is simplified on its own, so tiny gaps or slivers can appear on shared borders at high zoom. | Accepted for district-level shading |
| B4 | The license is **ODbL 1.0**, not CC BY. Attribution "Administrative boundaries courtesy of geoBoundaries.org" is required. | Attribution added to the map caption |
| B5 | geoBoundaries shows disputed areas (J&K) as de facto boundaries, which may not match India's official map. This matters for a public app aimed at Indian users. | **Open:** consider DataMeet or Survey of India boundaries for the public deploy. |

## C. Data meaning and display

| # | Problem | Status |
|---|---|---|
| C1 | Child districts (Tenkasi, Ranipet, Tirupathur, Lower Siang…) show the **parent district's** score and facility count. Tenkasi says "29 facilities", but those are Tirunelveli's facilities. | The hover text says "NFHS-5 figures for Tirunelveli". **Open:** recompute facility counts per polygon instead of per NFHS district. |
| C2 | 325 districts have `thin_sample = TRUE`. Plotly can't draw dashed outlines on choropleths. | These districts are drawn **faded** (40% opacity), and the hover says "Low-confidence estimate" |
| C3 | 22 districts have `full_vax_status = 'suppressed'`, yet 9 of them still have a numeric value. | The app treats suppressed as no value (grey) and ignores the number |
| C4 | `underserved_score` ranges from −0.94 to +0.95, centred near 0. | Diverging colour scale centred at 0 (red = underserved, blue = better served) |
| C6 | `facilities_per_10k_households` goes up to **~1,600** and `beds_per_10k_households` up to **~19,000** (Tirunelveli). The denominator looks like `households_surveyed` (the NFHS-5 sample, a few hundred per district), not the district's actual households, so the numbers aren't real rates. The ranking is still usable, but the absolute values mislead. | **Open (pipeline):** use a Census household count. The burden-vs-supply scatter caps its y-axis at the 98th percentile for now. |
| C7 | A few facility pins sit on a state or city centroid far outside their district (e.g. one Tirunelveli facility sits on Tamil Nadu's centre). | The district map frames the district boundary, not the pins. `district_match = FALSE` pins are flagged in the hover and caption. |
| C8 | `district_polygon_map` maps several polygons to one NFHS-5 district (Tirunelveli + Tenkasi, Vellore + Ranipet + Tirupathur…), so the drill-down outline covers the whole pre-split area. | Expected: it matches the NFHS-5 district. |
| C9 | **Gujarat distance values look broken:** Vadodara 279 km, Chhota Udaipur 314 km and Patan 273 km to the nearest facility. Vadodara is a major city, so these can't be real. Nicobars (405 km) and Diu (200 km) are plausible island/enclave artifacts. Median is 20 km and the 98th percentile 99 km. | **Open (pipeline):** check the Gujarat rows in `facility_nfhs5_district_service_distance`, possibly a state-name mismatch like the J&K "AND" vs "&" bug. The map clips its colour scale to the 2nd–98th percentile so outliers don't wash it out, and the hover still shows the real value. |
| C10 | `facility_nfhs5_district_burden_supply` has Chandel under **both** Manipur and Mizoram (a stray duplicate). | The app uses Manipur\|Chandel (the polygon's own mapping). **Open:** drop the Mizoram\|Chandel row. |
| C5 | 8 rows in `facility_nfhs5_district_underserved_score` didn't match any polygon key: Chandel, East Jantia Hills, Unakoti, Warangal Urban, Charkhi Dadri, South Salmara Mancachar, Janjgir - Champa, Ranga Reddy. | All are fixed by A1–A7 except Charkhi Dadri (A11) |

## D. Build and environment

| # | Problem | Status |
|---|---|---|
| D1 | `plotly` was not installed or listed in the requirements. | Added to `requirements.txt` and to the CLAUDE.md dependency rule |
| D2 | Streamlit 1.67 warns that `use_container_width` will be removed after 2025-12-31. The existing Find-care code (`app.py`, `cards.py`) still uses it. | Planner uses `width="stretch"`. **Open:** update the remaining calls. |
| D3 | The Windows console (cp1252) can't print ⚠ when debugging from a terminal. | Not an app bug. Set `PYTHONIOENCODING=utf-8` for scripts. |
| D4 | The project CLAUDE.md is out of date: it lists one user type and only the old tables, and Step 10 says NFHS-5 isn't loaded. | **Open** |
