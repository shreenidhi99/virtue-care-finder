"""Plotly figure builders for the District planner (no Streamlit calls here).

Every function takes plain DataFrames and returns a go.Figure, so they can be
tested or rendered to images outside the app.
"""
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# One palette for the whole planner.
RED, BLUE, GREY, AMBER, TEAL = "#b2182b", "#2166ac", "#bdbdbd", "#e08214", "#0f6b5c"
DIMENSION_COLORS = {"Anaemia": "#d6604d", "Substance use": "#8073ac",
                    "Non-vaccination": "#e08214", "Home births": "#4393c3"}
SERVICE_FAMILIES = {   # family -> (burden column for the "need" side, facility count column, distance column)
    "Maternal": ("noninstitutional_birth_pct", "n_maternal_facilities", "avg_km_to_nearest_maternal"),
    "Vaccination": ("nonvaccination_pct", "n_vaccination_facilities", "avg_km_to_nearest_vaccination"),
    "De-addiction": ("substance_pct", "n_deaddiction_facilities", "avg_km_to_nearest_deaddiction"),
    "NCD": ("ncd_pct", "n_ncd_facilities", "avg_km_to_nearest_ncd"),
    "Delivery / surgical": ("noninstitutional_birth_pct", "n_delivery_surgical_facilities",
                            "avg_km_to_nearest_delivery_surgical"),
}
RADAR_SPOKES = {"child_6_59m_anaemia_pct": "Child anaemia", "men_15plus_tobacco_pct": "Tobacco (men)",
                "men_15plus_alcohol_pct": "Alcohol (men)", "nonvaccination_pct": "Not fully vaccinated",
                "noninstitutional_birth_pct": "Home births", "ncd_pct": "High BP / sugar"}
LOWCONF_NOTE = "Faded points = thin NFHS-5 sample (low-confidence estimate)."
# Bubble size = facilities whose records mention the service that answers this burden / distance.
BUBBLE_COUNT = {
    "child_6_59m_anaemia_pct": ("n_facilities", "facilities (any)"),
    "noninstitutional_birth_pct": ("n_maternal_facilities", "maternal facilities"),
    "nonvaccination_pct": ("n_vaccination_facilities", "vaccination facilities"),
    "men_15plus_tobacco_pct": ("n_deaddiction_facilities", "de-addiction facilities"),
    "men_15plus_alcohol_pct": ("n_deaddiction_facilities", "de-addiction facilities"),
    "substance_pct": ("n_deaddiction_facilities", "de-addiction facilities"),
    "ncd_pct": ("n_ncd_facilities", "NCD facilities"),
    "avg_km_to_nearest_facility": ("n_facilities", "facilities (any)"),
    "avg_km_to_nearest_maternal": ("n_maternal_facilities", "maternal facilities"),
    "avg_km_to_nearest_vaccination": ("n_vaccination_facilities", "vaccination facilities"),
    "avg_km_to_nearest_deaddiction": ("n_deaddiction_facilities", "de-addiction facilities"),
    "avg_km_to_nearest_ncd": ("n_ncd_facilities", "NCD facilities"),
    "avg_km_to_nearest_delivery_surgical": ("n_delivery_surgical_facilities", "delivery / surgical facilities"),
}


def _bubble(s: pd.DataFrame, count_col: str, cap: float) -> pd.Series:
    """Area-proportional size; 0 facilities still gets a small visible dot."""
    return (s[count_col].fillna(0).clip(upper=cap) / cap).pow(0.5) * 30 + 4


def _count_txt(v) -> str:
    return "none mapped" if pd.isna(v) or v == 0 else str(int(v))


def _layout(fig: go.Figure, height: int = 420, **kw) -> go.Figure:
    fig.update_layout(height=height, margin=dict(l=60, r=10, t=50, b=10),
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      legend=dict(orientation="h", y=-0.15), **kw)
    return fig


# ---------- Tab 1: national overview ----------

def leaderboard(df: pd.DataFrame, n: int = 25) -> go.Figure:
    top = df.dropna(subset=["underserved_score"]).nlargest(n, "underserved_score").iloc[::-1]
    fig = px.bar(top, x="underserved_score", y="label", color="dominant_burden", orientation="h",
                 color_discrete_map=DIMENSION_COLORS, hover_data={"label": False, "n_facilities": True},
                 labels={"underserved_score": "Underserved score", "label": "", "dominant_burden": "Main burden",
                         "n_facilities": "Facilities mapped"})
    fig.update_yaxes(categoryorder="array", categoryarray=top["label"].tolist(), automargin=True)
    fig = _layout(fig, height=max(420, 22 * len(top)), title=f"Top {len(top)} underserved districts")
    fig.update_layout(margin=dict(l=230))
    return fig


def burden_vs_supply(df: pd.DataFrame, x: str, x_label: str, highlight: tuple | None = None) -> go.Figure:
    d = df.dropna(subset=[x, "facilities_per_10k_households"]).copy()
    xm, ym = d[x].median(), d["facilities_per_10k_households"].median()
    fig = go.Figure()
    # Quadrant shading: high burden (right) and low supply (bottom).
    fig.add_shape(type="rect", xref="x", yref="y", x0=xm, x1=d[x].max() * 1.02, y0=0, y1=ym,
                  fillcolor=RED, opacity=0.08, line_width=0, layer="below")
    fig.add_annotation(x=d[x].max(), y=0, xanchor="right", yanchor="bottom", showarrow=False,
                       text="high burden · low supply", font=dict(color=RED, size=11))
    cnt, cnt_label = BUBBLE_COUNT.get(x, ("n_facilities", "facilities (any)"))
    cap = max(d[cnt].quantile(0.98), 1)
    for thin, op in ((False, 0.7), (True, 0.3)):
        s = d[d["thin_sample"] == thin]
        fig.add_trace(go.Scatter(
            x=s[x], y=s["facilities_per_10k_households"], mode="markers", opacity=op,
            name="thin sample" if thin else "district",
            marker=dict(size=_bubble(s, cnt, cap), color=BLUE, line=dict(width=0.5, color="white")),
            text=s["label"] + "<br>" + cnt_label.capitalize() + ": " + s[cnt].map(_count_txt),
            hovertemplate="%{text}<br>" + x_label + ": %{x:.1f}%<br>"
                          "Facilities / 10k households: %{y:.2f}<extra></extra>"))
    _highlight(fig, d, x, "facilities_per_10k_households", highlight)
    fig.add_vline(x=xm, line_dash="dot", line_color=GREY)
    fig.add_hline(y=ym, line_dash="dot", line_color=GREY)
    fig.update_xaxes(title=x_label + " (%)")
    # A handful of metro districts have very high supply; cap the axis so the rest stay readable.
    ycap = d["facilities_per_10k_households"].quantile(0.98) * 1.15
    n_off = int((d["facilities_per_10k_households"] > ycap).sum())
    fig.update_yaxes(title="Facilities mapped per 10k households", range=[-0.05 * ycap, ycap])
    note = f" · {n_off} high-supply districts above the chart" if n_off else ""
    fig = _layout(fig, title=f"Burden vs supply · bubble = number of {cnt_label}{note}<br>"
                             f"<sup>{LOWCONF_NOTE}</sup>")
    fig.update_layout(margin=dict(l=70, t=60))
    return fig


def _highlight(fig, d, x, y, key):
    if not key:
        return
    s = d[(d["state"] == key[0]) & (d["district"] == key[1])]
    if not s.empty:
        fig.add_trace(go.Scatter(x=s[x], y=s[y], mode="markers+text", text=s["district"],
                                 textposition="top center", name="selected",
                                 marker=dict(size=16, color="rgba(0,0,0,0)", line=dict(width=3, color=AMBER)),
                                 hoverinfo="skip"))


def distributions(df: pd.DataFrame, metrics: dict[str, str], highlight: tuple | None = None) -> go.Figure:
    from plotly.subplots import make_subplots
    keys = list(metrics)
    fig = make_subplots(rows=1, cols=len(keys), subplot_titles=[metrics[k] for k in keys])
    sel = None
    if highlight:
        r = df[(df["state"] == highlight[0]) & (df["district"] == highlight[1])]
        sel = r.iloc[0] if not r.empty else None
    for i, k in enumerate(keys, start=1):
        fig.add_trace(go.Histogram(x=df[k], nbinsx=30, marker_color=BLUE, opacity=0.75, showlegend=False,
                                   hovertemplate="%{x}: %{y} districts<extra></extra>"), row=1, col=i)
        if sel is not None and pd.notna(sel[k]):
            fig.add_vline(x=sel[k], line_color=AMBER, line_width=3, row=1, col=i)
    return _layout(fig, height=280, title="Where districts sit nationally"
                   + (f" · orange line = {highlight[1]}" if highlight else ""))


# ---------- Tab 2: district drill-down ----------

def radar(row: pd.Series, pct: pd.Series) -> go.Figure:
    labels = list(RADAR_SPOKES.values())
    vals = [round(100 * pct[k], 0) if pd.notna(pct[k]) else 0 for k in RADAR_SPOKES]
    fig = go.Figure()
    fig.add_trace(go.Scatterpolar(r=[50] * len(labels) + [50], theta=labels + labels[:1], name="National median",
                                  line=dict(color=GREY, dash="dash"), hoverinfo="skip"))
    fig.add_trace(go.Scatterpolar(r=vals + vals[:1], theta=labels + labels[:1], fill="toself", name=row["district"],
                                  line=dict(color=RED), fillcolor="rgba(178,24,43,0.25)",
                                  hovertemplate="%{theta}: %{r:.0f}th percentile<extra></extra>"))
    fig.update_polars(radialaxis=dict(range=[0, 100], ticksuffix="", tickvals=[25, 50, 75, 100]),
                      bgcolor="rgba(0,0,0,0)")
    return _layout(fig, height=400, title="Burden profile (percentile among districts; outer = worse)")


def need_vs_supply(pct: pd.Series) -> go.Figure:
    fams, need, supply = [], [], []
    for fam, (need_col, cnt_col, _) in SERVICE_FAMILIES.items():
        if fam == "Delivery / surgical":
            continue
        fams.append(fam)
        need.append(100 * pct.get(need_col, float("nan")))
        supply.append(100 * pct.get(f"{cnt_col}_per10k", float("nan")))
    fig = go.Figure([
        go.Bar(name="Need (burden percentile)", x=fams, y=need, marker_color=RED,
               hovertemplate="%{x} need: %{y:.0f}th pct<extra></extra>"),
        go.Bar(name="Supply (facilities / 10k households percentile)", x=fams, y=supply, marker_color=BLUE,
               hovertemplate="%{x} supply: %{y:.0f}th pct<extra></extra>"),
    ])
    fig.update_yaxes(range=[0, 100], title="Percentile among districts")
    return _layout(fig, height=380, barmode="group", title="Need vs supply: a red bar far above blue is a gap")


def facility_map(fac: pd.DataFrame, outline: list[dict], service_col: str, service_label: str) -> go.Figure:
    d = fac.dropna(subset=["latitude", "longitude"]).copy()
    d["size"] = d["capacity_beds"].clip(upper=500).fillna(0).pow(0.5).add(7)
    d["beds_txt"] = d["capacity_beds"].map(lambda b: "beds not reported" if pd.isna(b) else f"{int(b)} beds")
    d["border_txt"] = d["district_match"].map(
        lambda m: "<br>⚠ Pin falls outside this district's boundary (assigned by PIN code)" if m is False else "")
    groups = [(d[d[service_col] == 1], f"Records mention {service_label.lower()}", TEAL, 0.9),
              (d[d[service_col] != 1], "Other facilities", "#888888", 0.55)]
    fig = go.Figure()
    for g, name, color, op in groups:
        fig.add_trace(go.Scattermap(
            lat=g["latitude"], lon=g["longitude"], mode="markers", name=f"{name} ({len(g)})",
            marker=dict(size=g["size"], color=color, opacity=op),
            text=g["name"] + "<br>" + g["beds_txt"] + g["border_txt"],
            hovertemplate="%{text}<extra></extra>"))
    # Frame the district boundary, not the pins: a few pins sit on a state/city centroid far away.
    lats = [c[1] for f in outline for c in _coords(f)] or d["latitude"].tolist()
    lons = [c[0] for f in outline for c in _coords(f)] or d["longitude"].tolist()
    centre = dict(lat=(min(lats) + max(lats)) / 2, lon=(min(lons) + max(lons)) / 2) if lats else dict(lat=22, lon=79)
    span = max(max(lats) - min(lats), max(lons) - min(lons)) if lats else 20
    zoom = 9 if span < 0.6 else 8 if span < 1.2 else 7 if span < 2.5 else 6 if span < 5 else 4.5
    fig.update_layout(map=dict(style="carto-positron", center=centre, zoom=zoom,
                               layers=[{"source": {"type": "FeatureCollection", "features": outline},
                                        "type": "line", "color": RED, "line": {"width": 2}}]))
    return _layout(fig, height=520, title="Facilities in the district · size = beds (when reported)")


def _coords(feature: dict):
    g = feature["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for p in polys:
        yield from p[0]


def beds_reporting(fac: pd.DataFrame) -> go.Figure:
    n, rep = len(fac), int(fac["capacity_beds"].notna().sum())
    fig = go.Figure(go.Bar(x=[rep, n - rep], y=["Report beds", "Don't report beds"], orientation="h",
                           marker_color=[BLUE, GREY], text=[rep, n - rep], textposition="auto",
                           hovertemplate="%{y}: %{x} facilities<br>Nationally only ~25% of facilities "
                                         "report beds<extra></extra>"))
    return _layout(fig, height=200, title=f"Bed data coverage: {rep} of {n} facilities")


# ---------- Tab 3: distance to care ----------

def distance_bars(df: pd.DataFrame, key: tuple) -> go.Figure:
    r = df[(df["state"] == key[0]) & (df["district"] == key[1])]
    fams = list(SERVICE_FAMILIES)
    nat = [df[SERVICE_FAMILIES[f][2]].median() for f in fams]
    sel = [r.iloc[0][SERVICE_FAMILIES[f][2]] if not r.empty else None for f in fams]
    fig = go.Figure([
        go.Bar(name=key[1], x=fams, y=sel, marker_color=RED, hovertemplate="%{x}: %{y:.1f} km<extra></extra>"),
        go.Bar(name="National median", x=fams, y=nat, marker_color=GREY,
               hovertemplate="%{x}: %{y:.1f} km<extra></extra>"),
    ])
    fig.update_yaxes(title="Avg straight-line km to nearest facility")
    return _layout(fig, height=380, barmode="group", title=f"Distance to care by service: {key[1]} vs national")


def distance_vs_burden(df: pd.DataFrame, dist_col: str, burden_col: str, burden_label: str,
                       highlight: tuple | None = None) -> go.Figure:
    d = df.dropna(subset=[dist_col, burden_col]).copy()
    xm, ym = d[dist_col].median(), d[burden_col].median()
    fig = go.Figure()
    fig.add_shape(type="rect", x0=xm, x1=d[dist_col].max() * 1.02, y0=ym, y1=d[burden_col].max() * 1.02,
                  fillcolor=RED, opacity=0.08, line_width=0, layer="below")
    fig.add_annotation(x=d[dist_col].max(), y=d[burden_col].max(), xanchor="right", yanchor="top",
                       showarrow=False, text="far AND high burden", font=dict(color=RED, size=11))
    cnt, cnt_label = BUBBLE_COUNT.get(dist_col, ("n_facilities", "facilities (any)"))
    cap = max(d[cnt].quantile(0.98), 1)
    for thin, op in ((False, 0.7), (True, 0.3)):
        s = d[d["thin_sample"] == thin]
        fig.add_trace(go.Scatter(
            x=s[dist_col], y=s[burden_col], mode="markers", opacity=op,
            name="thin sample" if thin else "district",
            marker=dict(size=_bubble(s, cnt, cap), color=BLUE, line=dict(width=0.5, color="white")),
            text=s["label"] + "<br>" + cnt_label.capitalize() + ": " + s[cnt].map(_count_txt),
            hovertemplate="%{text}<br>%{x:.1f} km<br>" + burden_label + ": %{y:.1f}%<extra></extra>"))
    _highlight(fig, d, dist_col, burden_col, highlight)
    fig.add_vline(x=xm, line_dash="dot", line_color=GREY)
    fig.add_hline(y=ym, line_dash="dot", line_color=GREY)
    fig.update_xaxes(title="Avg straight-line km to nearest facility")
    fig.update_yaxes(title=burden_label + " (%)")
    return _layout(fig, title=f"Double disadvantage: far from care and high burden · bubble = number of "
                              f"{cnt_label}<br><sup>Small bubble far right = few facilities and far away. "
                              f"{LOWCONF_NOTE}</sup>")


# ---------- Tab 4: comparisons ----------

def state_strip(df: pd.DataFrame, col: str, label: str) -> go.Figure:
    d = df.dropna(subset=[col])
    order = d.groupby("state")[col].median().sort_values(ascending=False).index.tolist()
    fig = px.strip(d, x=col, y="state", hover_name="label", category_orders={"state": order},
                   color_discrete_sequence=[BLUE], labels={col: label, "state": ""})
    fig.update_traces(marker=dict(size=6, opacity=0.6), jitter=0.6)
    fig = _layout(fig, height=max(500, 18 * len(order)),
                  title=f"{label}: every district, grouped by state (sorted by state median)")
    fig.update_layout(margin=dict(l=180))
    return fig


def beds_vs_burden(df: pd.DataFrame, burden_col: str, burden_label: str) -> go.Figure:
    d = df.dropna(subset=[burden_col])
    has, none = d[d["beds_per_10k_households"].notna()], d[d["beds_per_10k_households"].isna()]
    fig = go.Figure([
        go.Scatter(x=has[burden_col], y=has["beds_per_10k_households"], mode="markers", name="reported beds",
                   marker=dict(color=BLUE, size=7, opacity=0.6), text=has["label"],
                   hovertemplate="%{text}<br>%{x:.1f}%<br>%{y:.1f} beds / 10k households<extra></extra>"),
        go.Scatter(x=none[burden_col], y=[0] * len(none), mode="markers", name="no reliable bed data",
                   marker=dict(color=GREY, size=7, symbol="x"), text=none["label"],
                   hovertemplate="%{text}<br>%{x:.1f}%<br>no reliable bed data<extra></extra>"),
    ])
    fig.update_xaxes(title=burden_label + " (%)")
    fig.update_yaxes(title="Reported beds per 10k households", type="log")
    return _layout(fig, title="Beds vs burden (log scale; grey × = no reliable bed data, not zero)")


def data_quality(q: pd.DataFrame) -> go.Figure:
    q = q.sort_values("pct_confirmed")
    fig = go.Figure(go.Bar(x=q["pct_confirmed"], y=q["state"], orientation="h", marker_color=TEAL,
                           customdata=q[["n", "thin"]].values,
                           hovertemplate="%{y}<br>%{x:.0f}% of %{customdata[0]} facility pins inside their "
                                         "district polygon<br>%{customdata[1]} thin-sample districts"
                                         "<extra></extra>"))
    fig.update_xaxes(range=[0, 100], title="% facilities with polygon-confirmed location")
    fig = _layout(fig, height=max(450, 18 * len(q)), title="How much to trust the map, by state")
    fig.update_layout(margin=dict(l=180))
    return fig


def correlation(df: pd.DataFrame, burden: dict[str, str], supply: dict[str, str]) -> go.Figure:
    c = df[list(burden) + list(supply)].corr().loc[list(burden), list(supply)]
    fig = go.Figure(go.Heatmap(z=c.values, x=list(supply.values()), y=list(burden.values()),
                               zmin=-1, zmax=1, colorscale="RdBu", text=c.round(2).values,
                               texttemplate="%{text}", hovertemplate="%{y} × %{x}: r = %{z:.2f}<extra></extra>"))
    return _layout(fig, height=420, title="Burden × supply correlation across districts (Pearson r)")
