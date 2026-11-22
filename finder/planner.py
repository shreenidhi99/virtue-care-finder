"""District planner: NFHS-5 burden vs facility supply, by district.

Four sub-tabs, following the plot menu:
  1. National overview: choropleth, underserved leaderboard, burden-vs-supply scatter, distributions
  2. District drill-down: facility map, burden radar, need-vs-supply bars, bed-data coverage
  3. Distance to care: distance choropleth, per-service distance bars, far-and-sick bubble
  4. Compare: state strip plot, beds vs burden, data-quality panel, correlation heatmap

Display rules (from the data QA):
- thin_sample / low_confidence estimates are drawn faded and say so on hover.
- Suppressed NFHS-5 estimates and districts without an NFHS-5 match are grey.
- 0 facilities reads "none mapped", never "none exist".
- NULL beds reads "no reliable bed data", never 0.
- Distances are straight-line, same-state only.
"""
import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from finder import planner_charts as charts
from finder.config import SCHEMA
from finder.db import run_sql

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "data" / "india_districts.geojson"
CHART_CFG = {"displayModeBar": False}


@dataclass(frozen=True)
class Metric:
    label: str
    unit: str            # "%", "km", "" ...
    worse_when: str      # "high" or "low": colour always goes darker towards worse
    status_col: str | None = None   # per-metric NFHS-5 status (ok / low_confidence / suppressed)
    thin_flag: bool = False          # use thin_sample as the confidence flag


METRICS: dict[str, Metric] = {
    "underserved_score": Metric("Underserved score (burden vs supply)", "", "high", thin_flag=True),
    "child_6_59m_anaemia_pct": Metric("Child anaemia, 6–59 months", "%", "high", "child_anaemia_status"),
    "fully_vaccinated_either_pct": Metric("Children fully vaccinated", "%", "low", "full_vax_status"),
    "institutional_birth_pct": Metric("Institutional births", "%", "low", "inst_birth_status"),
    "men_15plus_tobacco_pct": Metric("Men 15+ using tobacco", "%", "high", "men_tobacco_status"),
    "men_15plus_alcohol_pct": Metric("Men 15+ drinking alcohol", "%", "high", "men_alcohol_status"),
    "facilities_per_10k_households": Metric("Facilities mapped per 10k households", "", "low"),
    "beds_per_10k_households": Metric("Beds per 10k households (reported)", "", "low"),
}
DISTANCE_METRICS: dict[str, Metric] = {
    "avg_km_to_nearest_facility": Metric("Avg km to nearest facility (any)", "km", "high"),
    "avg_km_to_nearest_maternal": Metric("Avg km to nearest maternal care", "km", "high"),
    "avg_km_to_nearest_vaccination": Metric("Avg km to nearest vaccination", "km", "high"),
    "avg_km_to_nearest_deaddiction": Metric("Avg km to nearest de-addiction", "km", "high"),
    "avg_km_to_nearest_ncd": Metric("Avg km to nearest NCD care", "km", "high"),
    "avg_km_to_nearest_delivery_surgical": Metric("Avg km to nearest delivery / surgical", "km", "high"),
}
ALL_METRICS = {**METRICS, **DISTANCE_METRICS}
NO_DATA_AREA = "DATA NOT AVAILABLE"   # geoBoundaries' unnamed northern polygon (PoK / Gilgit-Baltistan / Aksai Chin)
EXCLUDED_DISTANCE = {("Ladakh", "Leh"), ("Ladakh", "Kargil"), ("Lakshadweep", "Lakshadweep"),
                     ("Puducherry", "Yanam")}
BURDEN_AXES = {"child_6_59m_anaemia_pct": "Child anaemia", "noninstitutional_birth_pct": "Home births",
               "nonvaccination_pct": "Not fully vaccinated", "men_15plus_tobacco_pct": "Tobacco (men)",
               "men_15plus_alcohol_pct": "Alcohol (men)", "ncd_pct": "High BP / sugar"}
SERVICE_FLAGS = {"has_maternal": "Maternal", "has_vaccination": "Vaccination", "has_deaddiction": "De-addiction",
                 "has_ncd": "NCD", "has_delivery_surgical": "Delivery / surgical"}

_STATUS_COLS = ["child_anaemia_status", "full_vax_status", "inst_birth_status",
                "men_tobacco_status", "men_alcohol_status"]
_BURDEN_NUM = ["households_surveyed", "child_6_59m_anaemia_pct", "fully_vaccinated_either_pct",
               "institutional_birth_pct", "men_15plus_tobacco_pct", "men_15plus_alcohol_pct",
               "women_high_bp_pct", "men_high_bp_pct", "women_high_sugar_pct", "men_high_sugar_pct",
               "facilities_per_10k_households", "beds_per_10k_households", "total_beds", "n_facilities",
               "n_maternal_facilities", "n_vaccination_facilities", "n_deaddiction_facilities",
               "n_ncd_facilities", "n_delivery_surgical_facilities"]
_UNDERSERVED_NUM = ["underserved_score", "anaemia_percentile", "substance_percentile",
                    "nonvaccination_percentile", "noninstitutional_birth_percentile", "supply_percentile"]


# ---------- data ----------

@st.cache_data(ttl=6 * 3600, show_spinner=False)
def load_districts() -> pd.DataFrame:
    """One row per NFHS-5 district with burden, supply, underserved score and distance to care."""
    b = ", ".join(f"b.{c}" for c in _BURDEN_NUM + _STATUS_COLS)
    u = ", ".join(f"u.{c}" for c in _UNDERSERVED_NUM)
    dist = ", ".join(f"d.{c}" for c in DISTANCE_METRICS)
    df = run_sql(
        f"SELECT b.state, b.district, b.thin_sample, {b}, {u}, {dist} "
        f"FROM {SCHEMA}.facility_nfhs5_district_burden_supply b "
        f"LEFT JOIN {SCHEMA}.facility_nfhs5_district_underserved_score u "
        f"  ON u.state = b.state AND u.district = b.district "
        f"LEFT JOIN {SCHEMA}.facility_nfhs5_district_service_distance d "
        f"  ON d.state = b.state AND d.district = b.district")
    for c in _BURDEN_NUM + _UNDERSERVED_NUM + list(DISTANCE_METRICS):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["thin_sample"] = df["thin_sample"].astype(str).str.lower().eq("true")
    return _derive(df)


def _derive(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["label"] = df["district"] + ", " + df["state"]
    vax = df["fully_vaccinated_either_pct"].where(df["full_vax_status"] != "suppressed")
    df["nonvaccination_pct"] = 100 - vax
    df["noninstitutional_birth_pct"] = 100 - df["institutional_birth_pct"]
    df["substance_pct"] = df[["men_15plus_tobacco_pct", "men_15plus_alcohol_pct"]].mean(axis=1)
    df["ncd_pct"] = df[["women_high_bp_pct", "men_high_bp_pct",
                        "women_high_sugar_pct", "men_high_sugar_pct"]].mean(axis=1)
    # Per-service supply on the same per-10k-households scale as facilities_per_10k_households.
    per_fac = df["facilities_per_10k_households"] / df["n_facilities"].where(df["n_facilities"] > 0)
    for _, (_, cnt, _) in charts.SERVICE_FAMILIES.items():
        df[f"{cnt}_per10k"] = (df[cnt] * per_fac).fillna(0)
    dims = {"anaemia_percentile": "Anaemia", "substance_percentile": "Substance use",
            "nonvaccination_percentile": "Non-vaccination", "noninstitutional_birth_percentile": "Home births"}
    df["dominant_burden"] = df[list(dims)].idxmax(axis=1, skipna=True).map(dims)
    return df


def percentiles(df: pd.DataFrame) -> pd.DataFrame:
    """Percentile rank (0-1) of each district for radar / need-vs-supply."""
    cols = list(BURDEN_AXES) + ["substance_pct"] + \
        [f"{cnt}_per10k" for _, cnt, _ in charts.SERVICE_FAMILIES.values()]
    out = df[["state", "district"]].copy()
    for c in dict.fromkeys(cols):
        out[c] = df[c].rank(pct=True)
    return out


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def load_facilities(state: str, district: str) -> pd.DataFrame:
    flags = ", ".join(f"f.{c}" for c in SERVICE_FLAGS)
    df = run_sql(
        f"SELECT f.unique_id, f.name, f.latitude, f.longitude, f.capacity_beds, {flags}, q.district_match "
        f"FROM {SCHEMA}.facility_nfhs5_facility_context f "
        f"LEFT JOIN {SCHEMA}.facility_geo_polygon_qa q ON q.unique_id = f.unique_id "
        f"WHERE f.nfhs5_state = :state AND f.nfhs5_district = :district",
        {"state": state, "district": district})
    for c in ["latitude", "longitude", "capacity_beds", *SERVICE_FLAGS]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["district_match"] = df["district_match"].map({"true": True, "false": False})
    return df


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def load_geo_quality() -> pd.DataFrame:
    df = run_sql(
        f"SELECT coalesce(nfhs5_state, initcap(polygon_state)) AS state, count(*) AS n, "
        f"100 * avg(CASE WHEN district_match THEN 1 ELSE 0 END) AS pct_confirmed "
        f"FROM {SCHEMA}.facility_geo_polygon_qa GROUP BY 1")
    df["n"] = pd.to_numeric(df["n"])
    df["pct_confirmed"] = pd.to_numeric(df["pct_confirmed"])
    return df


@st.cache_resource(show_spinner=False)
def load_geojson() -> dict:
    return json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))


def state_of(feature: dict) -> str:
    p = feature["properties"]
    return p["nfhs_state"] or p["state"].title()


def states(geo: dict) -> list[str]:
    return sorted({state_of(f) for f in geo["features"]})


# ---------- choropleth ----------

def _fmt(v, unit: str) -> str:
    if pd.isna(v):
        return "n/a"
    return {"%": f"{v:.1f}%", "km": f"{v:.1f} km"}.get(unit, f"{v:.2f}")


def _feature_table(geo: dict, data: pd.DataFrame, metric_key: str) -> pd.DataFrame:
    """One row per polygon: value to shade, opacity, hover text."""
    m = ALL_METRICS[metric_key]
    idx = data.set_index(["state", "district"])
    rows = []
    for f in geo["features"]:
        p = f["properties"]
        name, st_name = p["district"], state_of(f)
        key = (p["nfhs_state"], p["nfhs_district"])
        lines = [f"<b>{name}</b>, {st_name}"]
        value, low_conf = None, False
        if p["nfhs_district"] and key in idx.index:
            r = idx.loc[key]
            status = r[m.status_col] if m.status_col else None
            low_conf = (m.thin_flag and bool(r["thin_sample"])) or status == "low_confidence"
            if status == "suppressed":
                lines.append(f"{m.label}: estimate suppressed by NFHS-5")
            elif metric_key == "beds_per_10k_households" and pd.isna(r[metric_key]):
                lines.append("Beds: no reliable bed data")
            elif pd.isna(r[metric_key]):
                lines.append(f"{m.label}: no data")
            else:
                value = r[metric_key]
                lines.append(f"{m.label}: <b>{_fmt(value, m.unit)}</b>")
            nf = r["n_facilities"]
            lines.append("Facilities: none mapped" if pd.isna(nf) or nf == 0
                         else f"Facilities mapped: {int(nf)}")
            if low_conf:
                lines.append("⚠ Low-confidence estimate (thin NFHS-5 sample)")
            if p["nfhs_district"] != name:
                lines.append(f"NFHS-5 figures for <i>{p['nfhs_district']}</i> "
                             "(boundary or name changed since the survey)")
        elif name == NO_DATA_AREA:
            lines = ["<b>Northern area with no survey or facility data</b>",
                     "NFHS-5 and our facility records don't cover this area,",
                     "and the boundary file leaves it unnamed. Not a gap in J&K's districts."]
        else:
            lines.append("No NFHS-5 estimate: district formed after the survey or not matched")
        if metric_key in DISTANCE_METRICS and key in EXCLUDED_DISTANCE:
            lines.append("Distance left out: no facility in the same state/UT")
        rows.append({"id": f["id"], "value": value, "low_conf": low_conf,
                     "state": st_name, "hover": "<br>".join(lines),
                     "nfhs_state": key[0], "nfhs_district": key[1]})
    df = pd.DataFrame(rows)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df


def build_figure(geo: dict, data: pd.DataFrame, metric_key: str, state: str | None = None,
                 height: int = 620) -> go.Figure:
    m = ALL_METRICS[metric_key]
    ft = ft_all = _feature_table(geo, data, metric_key)
    if state:
        ft = ft[ft["state"] == state]
        geo = {"type": "FeatureCollection",
               "features": [f for f in geo["features"] if state_of(f) == state]}
    shaded = ft[ft["value"].notna()]

    if metric_key == "underserved_score":
        # Diverging around 0: red = more underserved, blue = better served than typical.
        scale, zmid, zmin, zmax = "RdBu_r", 0.0, None, None
    else:
        scale, zmid = ("YlOrRd" if m.worse_when == "high" else "YlOrRd_r"), None
        # Clip the colour range to the 2nd-98th percentile (national, so states stay comparable):
        # a few outliers (Nicobars 400 km, the Gujarat distance bug) would otherwise wash out the map.
        zmin, zmax = ft_all["value"].quantile(0.02), ft_all["value"].quantile(0.98)

    fig = go.Figure()
    # Base layer: every polygon in grey, so unmatched/suppressed districts still show.
    fig.add_trace(go.Choropleth(
        geojson=geo, locations=ft["id"], featureidkey="id",
        z=[1 if i.endswith("|" + NO_DATA_AREA) else 0 for i in ft["id"]],
        zmin=0, zmax=1, colorscale=[[0, "#c8c8c8"], [0.5, "#c8c8c8"], [0.5, "#efefef"], [1, "#efefef"]],
        showscale=False,
        marker_line_color="white", marker_line_width=0.3,
        text=ft["hover"], hovertemplate="%{text}<extra></extra>"))
    fig.add_trace(go.Choropleth(
        geojson=geo, locations=shaded["id"], z=shaded["value"], featureidkey="id",
        colorscale=scale, zmid=zmid, zmin=zmin, zmax=zmax,
        marker_opacity=[0.4 if lc else 1.0 for lc in shaded["low_conf"]],
        marker_line_color="white", marker_line_width=0.3,
        colorbar=dict(title=dict(text=m.unit or "score", side="top"), thickness=12, len=0.6),
        customdata=shaded[["nfhs_state", "nfhs_district"]].values,
        text=shaded["hover"], hovertemplate="%{text}<extra></extra>"))
    fig.update_geos(fitbounds="locations", visible=False, bgcolor="rgba(0,0,0,0)",
                    projection_type="mercator")
    fig.update_layout(margin=dict(l=0, r=0, t=0, b=0), height=height,
                      paper_bgcolor="rgba(0,0,0,0)", dragmode=False, clickmode="event+select")
    return fig


def _clicked(event) -> tuple[str, str] | None:
    try:
        pts = event.selection.points
    except AttributeError:
        return None
    for pt in pts or []:
        cd = pt.get("customdata")
        if cd and cd[1]:
            return cd[0], cd[1]
    return None


def _count(v) -> str | int:
    return "none mapped" if pd.isna(v) or v == 0 else int(v)


def _choropleth_block(geo, data, metrics: dict[str, Metric], key: str) -> tuple[str, tuple | None]:
    c1, c2 = st.columns([3, 2])
    metric_key = c1.selectbox("Shade districts by", list(metrics), format_func=lambda k: metrics[k].label,
                              key=f"{key}_metric")
    state = c2.selectbox("State", ["All India", *states(geo)], key=f"{key}_state")
    state = None if state == "All India" else state
    m = metrics[metric_key]
    worse = "Redder = more underserved; blue = better served than the typical district." \
        if metric_key == "underserved_score" else \
        f"Darker = worse ({'higher' if m.worse_when == 'high' else 'lower'} is worse)."
    st.caption(f"{worse} Faded = low-confidence estimate. Grey = no estimate for that district. "
               "Very light grey in the far north = area with no survey or facility data. "
               "Tap a district to open it in **District drill-down**.")
    event = st.plotly_chart(build_figure(geo, data, metric_key, state), width="stretch",
                            on_select="rerun", selection_mode="points", key=f"{key}_map",
                            config={**CHART_CFG, "scrollZoom": True})
    # Plotly keeps its selection across reruns: only treat a *new* tap as a selection,
    # so the drill-down dropdown isn't overridden by an old tap.
    picked, last = _clicked(event), st.session_state.get(f"{key}_last_click")
    st.session_state[f"{key}_last_click"] = picked
    return metric_key, picked if picked != last else None


# ---------- tabs ----------

def _select(key: tuple[str, str]) -> None:
    st.session_state["planner_sel"] = f"{key[1]}, {key[0]}"


def _selected(data: pd.DataFrame) -> tuple[str, str] | None:
    label = st.session_state.get("planner_sel")
    r = data[data["label"] == label]
    return (r.iloc[0]["state"], r.iloc[0]["district"]) if not r.empty else None


def tab_overview(geo, data) -> None:
    _, picked = _choropleth_block(geo, data, METRICS, "ov")
    if picked:
        _select(picked)
        st.success(f"Selected **{picked[1]}, {picked[0]}**. Open the District drill-down tab for details.")
    sel = _selected(data)
    st.divider()
    state_f = st.selectbox("Leaderboard: filter by state", ["All India", *sorted(data["state"].unique())],
                           key="ov_lb_state")
    lb = data if state_f == "All India" else data[data["state"] == state_f]
    st.plotly_chart(charts.leaderboard(lb), width="stretch", config=CHART_CFG)
    st.caption("Colour = the burden dimension with the highest percentile in that district.")
    st.divider()
    x = st.selectbox("Burden on the x-axis", list(BURDEN_AXES), format_func=BURDEN_AXES.get, key="ov_bx")
    st.plotly_chart(charts.burden_vs_supply(data, x, BURDEN_AXES[x], sel), width="stretch", config=CHART_CFG)
    st.plotly_chart(charts.distributions(data, {"child_6_59m_anaemia_pct": "Child anaemia %",
                                                "noninstitutional_birth_pct": "Home births %",
                                                "nonvaccination_pct": "Not fully vaccinated %",
                                                "substance_pct": "Tobacco/alcohol (men) %"}, sel),
                    width="stretch", config=CHART_CFG)


def tab_district(geo, data, pct) -> None:
    labels = sorted(data["label"])
    st.selectbox("District", labels, index=None, key="planner_sel",
                 placeholder="Search a district, or tap one on the map in National overview")
    sel = _selected(data)
    if not sel:
        st.info("Pick a district to see its facilities and burden profile.")
        return
    r = data[(data["state"] == sel[0]) & (data["district"] == sel[1])].iloc[0]
    p = pct[(pct["state"] == sel[0]) & (pct["district"] == sel[1])].iloc[0]
    if r["thin_sample"]:
        st.warning("Thin NFHS-5 sample: treat this district's survey figures as low-confidence estimates.")
    c = st.columns(4)
    c[0].metric("Underserved score", _fmt(r["underserved_score"], ""))
    c[1].metric("Facilities mapped", _count(r["n_facilities"]))
    beds = r["beds_per_10k_households"]
    c[2].metric("Beds / 10k households", "no reliable data" if pd.isna(beds) else f"{beds:.1f}")
    c[3].metric("Avg km to any facility", _fmt(r["avg_km_to_nearest_facility"], "km"))

    try:
        fac = load_facilities(*sel)
    except Exception as e:  # noqa: BLE001
        st.error(f"Couldn't load facilities: {e}")
        fac = None
    if fac is not None:
        svc = st.selectbox("Highlight facilities whose records mention", list(SERVICE_FLAGS),
                           format_func=SERVICE_FLAGS.get, key="dd_svc")
        outline = [f for f in geo["features"]
                   if (f["properties"]["nfhs_state"], f["properties"]["nfhs_district"]) == sel]
        if fac.empty:
            st.info("No facilities mapped in this district. That means none are in our records, "
                    "not that none exist.")
        else:
            st.plotly_chart(charts.facility_map(fac, outline, svc, SERVICE_FLAGS[svc]), width="stretch",
                            config={**CHART_CFG, "scrollZoom": True})
            n_border = int((fac["district_match"] == False).sum())  # noqa: E712 - NaN-safe count
            if n_border:
                st.caption(f"⚠ {n_border} facilities are assigned to this district by PIN code, but their "
                           "pin falls outside its boundary (common on metro borders).")
    col1, col2 = st.columns(2)
    col1.plotly_chart(charts.radar(r, p), width="stretch", config=CHART_CFG)
    col2.plotly_chart(charts.need_vs_supply(p), width="stretch", config=CHART_CFG)
    if fac is not None and not fac.empty:
        st.plotly_chart(charts.beds_reporting(fac), width="stretch", config=CHART_CFG)


def tab_distance(geo, data) -> None:
    _, picked = _choropleth_block(geo, data, DISTANCE_METRICS, "dist")
    if picked:
        _select(picked)
    sel = _selected(data)
    st.divider()
    if sel:
        st.plotly_chart(charts.distance_bars(data, sel), width="stretch", config=CHART_CFG)
    else:
        st.info("Tap a district on the map to compare its distance to each service with the national median.")
    c1, c2 = st.columns(2)
    d = c1.selectbox("Distance", list(DISTANCE_METRICS), format_func=lambda k: DISTANCE_METRICS[k].label,
                     key="dist_x")
    b = c2.selectbox("Burden", list(BURDEN_AXES), format_func=BURDEN_AXES.get, key="dist_y")
    st.plotly_chart(charts.distance_vs_burden(data, d, b, BURDEN_AXES[b], sel), width="stretch", config=CHART_CFG)
    n_dist = int(data["avg_km_to_nearest_facility"].notna().sum())
    st.caption("Distances are straight-line from each post office to the nearest mapped facility, within the "
               f"same state only. {n_dist} of {len(data)} districts have distance data. Left out on purpose: "
               "Leh, Kargil and Lakshadweep (no facility in the same state/UT) and Yanam (an enclave, where "
               "same-state distance would be ~630 km).")


def tab_compare(data) -> None:
    opts = {**BURDEN_AXES, "underserved_score": "Underserved score",
            "facilities_per_10k_households": "Facilities / 10k households"}
    col = st.selectbox("Metric", list(opts), format_func=opts.get, key="cmp_strip")
    st.plotly_chart(charts.state_strip(data, col, opts[col]), width="stretch", config=CHART_CFG)
    st.divider()
    b = st.selectbox("Burden for beds comparison", list(BURDEN_AXES), format_func=BURDEN_AXES.get, key="cmp_beds")
    st.plotly_chart(charts.beds_vs_burden(data, b, BURDEN_AXES[b]), width="stretch", config=CHART_CFG)
    st.divider()
    try:
        q = load_geo_quality()
        thin = data.groupby("state")["thin_sample"].sum().rename("thin").reset_index()
        q = q.merge(thin, on="state", how="left").fillna({"thin": 0})
        q["thin"] = q["thin"].astype(int)
        st.plotly_chart(charts.data_quality(q), width="stretch", config=CHART_CFG)
        st.caption(f"{int(data['thin_sample'].sum())} of {len(data)} districts have a thin NFHS-5 sample.")
    except Exception as e:  # noqa: BLE001
        st.error(f"Couldn't load data-quality figures: {e}")
    st.divider()
    supply = {"facilities_per_10k_households": "All facilities / 10k",
              "n_maternal_facilities_per10k": "Maternal / 10k",
              "n_vaccination_facilities_per10k": "Vaccination / 10k",
              "n_deaddiction_facilities_per10k": "De-addiction / 10k",
              "n_ncd_facilities_per10k": "NCD / 10k",
              "beds_per_10k_households": "Beds / 10k"}
    st.plotly_chart(charts.correlation(data, BURDEN_AXES, supply), width="stretch", config=CHART_CFG)
    st.caption("Correlation is not causation. Supply counts come from the records we hold.")


def render() -> None:
    try:
        data = load_districts()
    except Exception as e:  # noqa: BLE001 - warehouse asleep / permissions
        st.error(f"Couldn't load district data: {e}")
        return
    geo = load_geojson()
    pct = percentiles(data)
    t1, t2, t3, t4 = st.tabs(["National overview", "District drill-down", "Distance to care", "Compare"])
    with t1:
        tab_overview(geo, data)
    with t3:   # before t2 so a map tap here updates the drill-down selector in the same run
        tab_distance(geo, data)
    with t2:
        tab_district(geo, data, pct)
    with t4:
        tab_compare(data)
    st.caption("Facility counts come from the records we hold: “none mapped” does not mean none exist. "
               "Only about 25% of facilities report beds. Administrative boundaries courtesy of "
               "geoBoundaries.org (ODbL 1.0; source: lgdirectory.gov.in). Some districts were split after "
               "NFHS-5; those show the parent district's figures.")
