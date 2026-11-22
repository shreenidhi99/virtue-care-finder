// Plotly figure builders for the District planner (port of finder/planner_charts.py and the
// choropleth in finder/planner.py). Pure functions: rows in, {data, layout} out.
//
// Display rules: thin_sample / low_confidence estimates are faded; suppressed or unmatched
// districts are grey; 0 facilities = "none mapped"; NULL beds = "no reliable bed data";
// distances are straight-line, same-state only.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { outerCoords, stateOf, type DistrictFeature, type DistrictGeo } from "./geo";
import {
  ALL_METRICS, BUBBLE_COUNT, DIMENSION_COLORS, DISTANCE_METRICS, EXCLUDED_DISTANCE, NO_DATA_AREA,
  RADAR_SPOKES, SERVICE_FAMILIES, type District, type Facility, type GeoQuality,
} from "./metrics";
import { isNum, max, median, pearson, quantile, type Num } from "./stats";

export type Fig = { data: any[]; layout: any };

export const RED = "#b2182b", BLUE = "#2166ac", GREY = "#bdbdbd", AMBER = "#e08214", TEAL = "#0f6b5c";
const LOWCONF_NOTE = "Faded points = thin NFHS-5 sample (low-confidence estimate).";

// Python plotly's scales, spelled out: plotly.js's built-in "YlOrRd"/"RdBu" run the other way.
const YLORRD = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
const RDBU = ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"];
const scale = (cols: string[]) => cols.map((c, i) => [i / (cols.length - 1), c]);
const rev = (cols: string[]) => [...cols].reverse();

const n = (r: District | Facility, k: string): number | null => (isNum(r[k]) ? (r[k] as number) : null);
const col = (rows: (District | Facility)[], k: string) => rows.map((r) => n(r, k));
const countTxt = (v: Num) => (!isNum(v) || v === 0 ? "none mapped" : String(Math.trunc(v)));
const sameKey = (r: District, key: [string, string] | null) => !!key && r.state === key[0] && r.district === key[1];

export function fmt(v: Num, unit: string): string {
  if (!isNum(v)) return "n/a";
  return unit === "%" ? `${v.toFixed(1)}%` : unit === "km" ? `${v.toFixed(1)} km` : v.toFixed(2);
}

function layout(height = 420, extra: Record<string, any> = {}): any {
  const { margin, ...rest } = extra;
  return {
    height,
    margin: { l: 60, r: 10, t: 50, b: 10, ...margin },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    legend: { orientation: "h", y: -0.15 },
    font: { family: "system-ui, sans-serif", size: 12 },
    ...rest,
    xaxis: { automargin: true, ...(rest.xaxis ?? {}) },
  };
}
const title = (text: string) => ({ text, x: 0.02, xanchor: "left" });

/** Area-proportional size; 0 facilities still gets a small visible dot. */
function bubble(rows: District[], countCol: string, cap: number): number[] {
  return rows.map((r) => Math.sqrt(Math.min(n(r, countCol) ?? 0, cap) / cap) * 30 + 4);
}

function highlight(rows: District[], x: string, y: string, key: [string, string] | null): any[] {
  const s = rows.filter((r) => sameKey(r, key));
  if (!s.length) return [];
  return [{
    type: "scatter", x: col(s, x), y: col(s, y), mode: "markers+text", text: s.map((r) => r.district),
    textposition: "top center", name: "selected", hoverinfo: "skip",
    marker: { size: 16, color: "rgba(0,0,0,0)", line: { width: 3, color: AMBER } },
  }];
}

const dotLines = (xm: number, ym: number) => [
  { type: "line", xref: "x", yref: "paper", x0: xm, x1: xm, y0: 0, y1: 1, line: { dash: "dot", color: GREY } },
  { type: "line", xref: "paper", yref: "y", x0: 0, x1: 1, y0: ym, y1: ym, line: { dash: "dot", color: GREY } },
];

// ---------- choropleth ----------

type FeatureRow = { id: string; value: number | null; lowConf: boolean; state: string; hover: string; nfhs: [string, string] | null };

function featureTable(geo: DistrictGeo, data: District[], metricKey: string): FeatureRow[] {
  const m = ALL_METRICS[metricKey];
  const idx = new Map(data.map((r) => [`${r.state}|${r.district}`, r]));
  return geo.features.map((f) => {
    const p = f.properties;
    const name = p.district, stName = stateOf(f);
    const key = `${p.nfhs_state}|${p.nfhs_district}`;
    let lines = [`<b>${name}</b>, ${stName}`];
    let value: number | null = null, lowConf = false;
    const r = p.nfhs_district ? idx.get(key) : undefined;
    if (r) {
      const status = m.statusCol ? r[m.statusCol] : null;
      lowConf = (!!m.thinFlag && r.thin_sample) || status === "low_confidence";
      const v = n(r, metricKey);
      if (status === "suppressed") lines.push(`${m.label}: estimate suppressed by NFHS-5`);
      else if (metricKey === "beds_per_10k_households" && v === null) lines.push("Beds: no reliable bed data");
      else if (v === null) lines.push(`${m.label}: no data`);
      else {
        value = v;
        lines.push(`${m.label}: <b>${fmt(v, m.unit)}</b>`);
      }
      const nf = n(r, "n_facilities");
      lines.push(!nf ? "Facilities: none mapped" : `Facilities mapped: ${Math.trunc(nf)}`);
      if (lowConf) lines.push("⚠ Low-confidence estimate (thin NFHS-5 sample)");
      if (p.nfhs_district !== name) lines.push(`NFHS-5 figures for <i>${p.nfhs_district}</i> (boundary or name changed since the survey)`);
    } else if (name === NO_DATA_AREA) {
      lines = ["<b>Northern area with no survey or facility data</b>",
        "NFHS-5 and our facility records don't cover this area,",
        "and the boundary file leaves it unnamed. Not a gap in J&K's districts."];
    } else {
      lines.push("No NFHS-5 estimate: district formed after the survey or not matched");
    }
    if (metricKey in DISTANCE_METRICS && EXCLUDED_DISTANCE.has(key)) lines.push("Distance left out: no facility in the same state/UT");
    return { id: f.id, value, lowConf, state: stName, hover: lines.join("<br>"),
      nfhs: p.nfhs_state && p.nfhs_district ? [p.nfhs_state, p.nfhs_district] : null };
  });
}

export function choropleth(geo: DistrictGeo, data: District[], metricKey: string, state: string | null, height = 620): Fig {
  const m = ALL_METRICS[metricKey];
  const all = featureTable(geo, data, metricKey);
  const ft = state ? all.filter((r) => r.state === state) : all;
  const g: DistrictGeo = state ? { type: "FeatureCollection", features: geo.features.filter((f) => stateOf(f) === state) } : geo;
  const shaded = ft.filter((r) => r.value !== null);

  let colorscale: any, zmid: number | undefined, zmin: number | undefined, zmax: number | undefined;
  if (metricKey === "underserved_score") {
    // Diverging around 0: red = more underserved, blue = better served than typical.
    colorscale = scale(rev(RDBU));
    zmid = 0;
  } else {
    colorscale = scale(m.worseWhen === "high" ? YLORRD : rev(YLORRD));
    // Clip to the national 2nd-98th percentile so a few outliers don't wash out the map.
    zmin = quantile(all.map((r) => r.value), 0.02) ?? undefined;
    zmax = quantile(all.map((r) => r.value), 0.98) ?? undefined;
  }
  return {
    data: [
      { // base layer: every polygon grey, so unmatched / suppressed districts still show
        type: "choropleth", geojson: g, featureidkey: "id", locations: ft.map((r) => r.id),
        z: ft.map((r) => (r.id.endsWith(`|${NO_DATA_AREA}`) ? 1 : 0)), zmin: 0, zmax: 1, showscale: false,
        colorscale: [[0, "#c8c8c8"], [0.5, "#c8c8c8"], [0.5, "#efefef"], [1, "#efefef"]],
        marker: { line: { color: "white", width: 0.3 } },
        text: ft.map((r) => r.hover), hovertemplate: "%{text}<extra></extra>", customdata: ft.map(() => null),
      },
      {
        type: "choropleth", geojson: g, featureidkey: "id", locations: shaded.map((r) => r.id),
        z: shaded.map((r) => r.value), colorscale, zmid, zmin, zmax,
        marker: { opacity: shaded.map((r) => (r.lowConf ? 0.4 : 1)), line: { color: "white", width: 0.3 } },
        colorbar: { title: { text: m.unit || "score", side: "top" }, thickness: 12, len: 0.6 },
        customdata: shaded.map((r) => r.nfhs), text: shaded.map((r) => r.hover), hovertemplate: "%{text}<extra></extra>",
      },
    ],
    layout: {
      height, margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", dragmode: false,
      geo: { fitbounds: "locations", visible: false, bgcolor: "rgba(0,0,0,0)", projection: { type: "mercator" } },
    },
  };
}

// ---------- Tab 1: national overview ----------

export function leaderboard(df: District[], top = 25): Fig {
  const rows = df.filter((r) => n(r, "underserved_score") !== null)
    .sort((a, b) => n(b, "underserved_score")! - n(a, "underserved_score")!).slice(0, top).reverse();
  const order = rows.map((r) => r.label);
  const groups = [...new Set(rows.map((r) => (r.dominant_burden as string) ?? "Unknown"))];
  return {
    data: groups.map((g) => {
      const s = rows.filter((r) => ((r.dominant_burden as string) ?? "Unknown") === g);
      return {
        type: "bar", orientation: "h", name: g, x: col(s, "underserved_score"), y: s.map((r) => r.label),
        marker: { color: DIMENSION_COLORS[g] ?? GREY }, customdata: s.map((r) => countTxt(n(r, "n_facilities"))),
        hovertemplate: "%{y}<br>Underserved score: %{x:.2f}<br>Main burden: " + g + "<br>Facilities mapped: %{customdata}<extra></extra>",
      };
    }),
    layout: layout(Math.max(420, 22 * rows.length), {
      title: title(`Top ${rows.length} underserved districts`), margin: { l: 230 }, barmode: "relative",
      yaxis: { categoryorder: "array", categoryarray: order, automargin: true },
      xaxis: { title: { text: "Underserved score" } }, legend: { orientation: "h", y: -0.12, title: { text: "Main burden " } },
    }),
  };
}

function bubbleScatter(d: District[], x: string, y: string, cnt: string, cntLabel: string, hover: string): any[] {
  const cap = Math.max(quantile(col(d, cnt), 0.98) ?? 1, 1);
  return [false, true].map((thin) => {
    const s = d.filter((r) => r.thin_sample === thin);
    return {
      type: "scatter", mode: "markers", x: col(s, x), y: col(s, y), opacity: thin ? 0.3 : 0.7,
      name: thin ? "thin sample" : "district",
      marker: { size: bubble(s, cnt, cap), color: BLUE, line: { width: 0.5, color: "white" } },
      text: s.map((r) => `${r.label}<br>${cntLabel[0].toUpperCase()}${cntLabel.slice(1)}: ${countTxt(n(r, cnt))}`),
      hovertemplate: hover,
    };
  });
}

export function burdenVsSupply(df: District[], x: string, xLabel: string, sel: [string, string] | null): Fig {
  const y = "facilities_per_10k_households";
  const d = df.filter((r) => n(r, x) !== null && n(r, y) !== null);
  const xm = median(col(d, x))!, ym = median(col(d, y))!, xmax = max(col(d, x))!;
  const [cnt, cntLabel] = BUBBLE_COUNT[x] ?? ["n_facilities", "facilities (any)"];
  // A handful of metro districts have very high supply; cap the axis so the rest stay readable.
  const ycap = quantile(col(d, y), 0.98)! * 1.15;
  const nOff = d.filter((r) => n(r, y)! > ycap).length;
  const note = nOff ? ` · ${nOff} high-supply districts above the chart` : "";
  return {
    data: [
      ...bubbleScatter(d, x, y, cnt, cntLabel, `%{text}<br>${xLabel}: %{x:.1f}%<br>Facilities / 10k households: %{y:.2f}<extra></extra>`),
      ...highlight(d, x, y, sel),
    ],
    layout: layout(420, {
      title: title(`Burden vs supply · bubble = number of ${cntLabel}${note}<br><sup>${LOWCONF_NOTE}</sup>`),
      margin: { l: 70, t: 60 },
      xaxis: { title: { text: `${xLabel} (%)` } },
      yaxis: { title: { text: "Facilities mapped per 10k households" }, range: [-0.05 * ycap, ycap] },
      shapes: [
        // Quadrant shading: high burden (right) and low supply (bottom).
        { type: "rect", xref: "x", yref: "y", x0: xm, x1: xmax * 1.02, y0: 0, y1: ym, fillcolor: RED, opacity: 0.08, line: { width: 0 }, layer: "below" },
        ...dotLines(xm, ym),
      ],
      annotations: [{ x: xmax, y: 0, xanchor: "right", yanchor: "bottom", showarrow: false, text: "high burden · low supply", font: { color: RED, size: 11 } }],
    }),
  };
}

export function distributions(df: District[], metrics: Record<string, string>, sel: [string, string] | null): Fig {
  const keys = Object.keys(metrics);
  const gap = 0.04, w = (1 - gap * (keys.length - 1)) / keys.length;
  const picked = df.find((r) => sameKey(r, sel));
  const lay: any = layout(280, { title: title("Where districts sit nationally" + (sel ? ` · orange line = ${sel[1]}` : "")), showlegend: false, margin: { t: 70 } });
  lay.annotations = [];
  lay.shapes = [];
  const data = keys.map((k, i) => {
    const ax = i === 0 ? "" : String(i + 1);
    const x0 = i * (w + gap);
    lay[`xaxis${ax}`] = { domain: [x0, x0 + w], anchor: `y${ax}` };
    lay[`yaxis${ax}`] = { anchor: `x${ax}` };
    lay.annotations.push({ text: metrics[k], x: x0 + w / 2, y: 1.0, xref: "paper", yref: "paper", xanchor: "center", yanchor: "bottom", showarrow: false, font: { size: 12 } });
    const v = picked ? n(picked, k) : null;
    if (v !== null) lay.shapes.push({ type: "line", xref: `x${ax}`, yref: `y${ax} domain`, x0: v, x1: v, y0: 0, y1: 1, line: { color: AMBER, width: 3 } });
    return { type: "histogram", x: col(df, k), nbinsx: 30, marker: { color: BLUE }, opacity: 0.75, xaxis: `x${ax}`, yaxis: `y${ax}`, hovertemplate: "%{x}: %{y} districts<extra></extra>" };
  });
  return { data, layout: lay };
}

// ---------- Tab 2: district drill-down ----------

export function radar(row: District, pct: Record<string, number | null>): Fig {
  const labels = Object.values(RADAR_SPOKES);
  const vals = Object.keys(RADAR_SPOKES).map((k) => (isNum(pct[k]) ? Math.round(100 * pct[k]!) : 0));
  return {
    data: [
      { type: "scatterpolar", r: [...labels.map(() => 50), 50], theta: [...labels, labels[0]], name: "National median", line: { color: GREY, dash: "dash" }, hoverinfo: "skip" },
      { type: "scatterpolar", r: [...vals, vals[0]], theta: [...labels, labels[0]], fill: "toself", name: row.district, line: { color: RED }, fillcolor: "rgba(178,24,43,0.25)", hovertemplate: "%{theta}: %{r:.0f}th percentile<extra></extra>" },
    ],
    layout: layout(400, {
      title: title("Burden profile (percentile among districts; outer = worse)"),
      polar: { radialaxis: { range: [0, 100], tickvals: [25, 50, 75, 100] }, bgcolor: "rgba(0,0,0,0)" },
      margin: { l: 40, r: 40, t: 70 },
    }),
  };
}

export function needVsSupply(pct: Record<string, number | null>): Fig {
  const fams: string[] = [], need: (number | null)[] = [], supply: (number | null)[] = [];
  for (const [fam, [needCol, cntCol]] of Object.entries(SERVICE_FAMILIES)) {
    if (fam === "Delivery / surgical") continue;
    fams.push(fam);
    need.push(isNum(pct[needCol]) ? 100 * pct[needCol]! : null);
    supply.push(isNum(pct[`${cntCol}_per10k`]) ? 100 * pct[`${cntCol}_per10k`]! : null);
  }
  return {
    data: [
      { type: "bar", name: "Need (burden percentile)", x: fams, y: need, marker: { color: RED }, hovertemplate: "%{x} need: %{y:.0f}th pct<extra></extra>" },
      { type: "bar", name: "Supply (facilities / 10k households percentile)", x: fams, y: supply, marker: { color: BLUE }, hovertemplate: "%{x} supply: %{y:.0f}th pct<extra></extra>" },
    ],
    layout: layout(380, { barmode: "group", title: title("Need vs supply: a red bar far above blue is a gap"), yaxis: { range: [0, 100], title: { text: "Percentile among districts" } } }),
  };
}

export function facilityMap(fac: Facility[], outline: DistrictFeature[], serviceCol: string, serviceLabel: string): Fig {
  const d = fac.filter((f) => f.latitude !== null && f.longitude !== null);
  const size = (f: Facility) => Math.sqrt(Math.min(f.capacity_beds ?? 0, 500)) + 7;
  const beds = (f: Facility) => (f.capacity_beds === null ? "beds not reported" : `${Math.trunc(f.capacity_beds)} beds`);
  const border = (f: Facility) => (f.district_match === false ? "<br>⚠ Pin falls outside this district's boundary (assigned by PIN code)" : "");
  const groups: [Facility[], string, string, number][] = [
    [d.filter((f) => f[serviceCol] === 1), `Records mention ${serviceLabel.toLowerCase()}`, TEAL, 0.9],
    [d.filter((f) => f[serviceCol] !== 1), "Other facilities", "#888888", 0.55],
  ];
  // Frame the district boundary, not the pins: a few pins sit on a state/city centroid far away.
  const pts = outline.flatMap((f) => [...outerCoords(f)]);
  const lats = pts.length ? pts.map((c) => c[1]) : d.map((f) => f.latitude!);
  const lons = pts.length ? pts.map((c) => c[0]) : d.map((f) => f.longitude!);
  const center = lats.length ? { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 } : { lat: 22, lon: 79 };
  const span = lats.length ? Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons)) : 20;
  const zoom = span < 0.6 ? 9 : span < 1.2 ? 8 : span < 2.5 ? 7 : span < 5 ? 6 : 4.5;
  return {
    data: groups.map(([g, name, color, op]) => ({
      type: "scattermap", lat: g.map((f) => f.latitude), lon: g.map((f) => f.longitude), mode: "markers",
      name: `${name} (${g.length})`, marker: { size: g.map(size), color, opacity: op },
      text: g.map((f) => `${f.name}<br>${beds(f)}${border(f)}`), hovertemplate: "%{text}<extra></extra>",
    })),
    layout: layout(520, {
      title: title("Facilities in the district · size = beds (when reported)"),
      map: { style: "carto-positron", center, zoom, layers: [{ source: { type: "FeatureCollection", features: outline }, type: "line", color: RED, line: { width: 2 } }] },
    }),
  };
}

export function bedsReporting(fac: Facility[]): Fig {
  const total = fac.length, rep = fac.filter((f) => f.capacity_beds !== null).length;
  return {
    data: [{
      type: "bar", orientation: "h", x: [rep, total - rep], y: ["Report beds", "Don't report beds"],
      marker: { color: [BLUE, GREY] }, text: [rep, total - rep], textposition: "auto",
      hovertemplate: "%{y}: %{x} facilities<br>Nationally only ~25% of facilities report beds<extra></extra>",
    }],
    layout: layout(200, { title: title(`Bed data coverage: ${rep} of ${total} facilities`), margin: { l: 120 }, showlegend: false }),
  };
}

// ---------- Tab 3: distance to care ----------

export function distanceBars(df: District[], key: [string, string]): Fig {
  const r = df.find((x) => sameKey(x, key));
  const fams = Object.keys(SERVICE_FAMILIES);
  const nat = fams.map((f) => median(col(df, SERVICE_FAMILIES[f][2])));
  const sel = fams.map((f) => (r ? n(r, SERVICE_FAMILIES[f][2]) : null));
  return {
    data: [
      { type: "bar", name: key[1], x: fams, y: sel, marker: { color: RED }, hovertemplate: "%{x}: %{y:.1f} km<extra></extra>" },
      { type: "bar", name: "National median", x: fams, y: nat, marker: { color: GREY }, hovertemplate: "%{x}: %{y:.1f} km<extra></extra>" },
    ],
    layout: layout(380, { barmode: "group", title: title(`Distance to care by service: ${key[1]} vs national`), yaxis: { title: { text: "Avg straight-line km to nearest facility" } } }),
  };
}

export function distanceVsBurden(df: District[], distCol: string, burdenCol: string, burdenLabel: string, sel: [string, string] | null): Fig {
  const d = df.filter((r) => n(r, distCol) !== null && n(r, burdenCol) !== null);
  const xm = median(col(d, distCol))!, ym = median(col(d, burdenCol))!;
  const xmax = max(col(d, distCol))!, ymax = max(col(d, burdenCol))!;
  const [cnt, cntLabel] = BUBBLE_COUNT[distCol] ?? ["n_facilities", "facilities (any)"];
  return {
    data: [
      ...bubbleScatter(d, distCol, burdenCol, cnt, cntLabel, `%{text}<br>%{x:.1f} km<br>${burdenLabel}: %{y:.1f}%<extra></extra>`),
      ...highlight(d, distCol, burdenCol, sel),
    ],
    layout: layout(420, {
      title: title(`Double disadvantage: far from care and high burden · bubble = number of ${cntLabel}<br><sup>Small bubble far right = few facilities and far away. ${LOWCONF_NOTE}</sup>`),
      margin: { t: 60 },
      xaxis: { title: { text: "Avg straight-line km to nearest facility" } },
      yaxis: { title: { text: `${burdenLabel} (%)` } },
      shapes: [
        { type: "rect", xref: "x", yref: "y", x0: xm, x1: xmax * 1.02, y0: ym, y1: ymax * 1.02, fillcolor: RED, opacity: 0.08, line: { width: 0 }, layer: "below" },
        ...dotLines(xm, ym),
      ],
      annotations: [{ x: xmax, y: ymax, xanchor: "right", yanchor: "top", showarrow: false, text: "far AND high burden", font: { color: RED, size: 11 } }],
    }),
  };
}

// ---------- Tab 4: comparisons ----------

export function stateStrip(df: District[], c: string, label: string): Fig {
  const d = df.filter((r) => n(r, c) !== null);
  const byState = new Map<string, District[]>();
  for (const r of d) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const order = [...byState.keys()].sort((a, b) => median(col(byState.get(b)!, c))! - median(col(byState.get(a)!, c))!);
  return {
    data: [{
      type: "box", orientation: "h", x: col(d, c), y: d.map((r) => r.state), text: d.map((r) => r.label),
      boxpoints: "all", jitter: 0.6, pointpos: 0, fillcolor: "rgba(255,255,255,0)", line: { color: "rgba(255,255,255,0)" },
      marker: { color: BLUE, size: 6, opacity: 0.6 }, hoveron: "points", hovertemplate: `%{text}<br>${label}: %{x}<extra></extra>`, showlegend: false,
    }],
    layout: layout(Math.max(500, 18 * order.length), {
      title: title(`${label}: every district, grouped by state (sorted by state median)`), margin: { l: 180 },
      // Python's px.strip lists the first category at the top.
      yaxis: { categoryorder: "array", categoryarray: [...order].reverse(), automargin: true },
      xaxis: { title: { text: label } },
    }),
  };
}

export function bedsVsBurden(df: District[], burdenCol: string, burdenLabel: string): Fig {
  const d = df.filter((r) => n(r, burdenCol) !== null);
  const has = d.filter((r) => n(r, "beds_per_10k_households") !== null && n(r, "beds_per_10k_households")! > 0);
  const none = d.filter((r) => n(r, "beds_per_10k_households") === null);
  // A log axis can't show 0, so districts without bed data sit on a strip just below the lowest
  // reported value. They are labelled "no reliable bed data", never 0.
  const floor = (Math.min(...col(has, "beds_per_10k_households").filter(isNum)) || 1) / 3;
  return {
    data: [
      { type: "scatter", mode: "markers", name: "reported beds", x: col(has, burdenCol), y: col(has, "beds_per_10k_households"), marker: { color: BLUE, size: 7, opacity: 0.6 }, text: has.map((r) => r.label), hovertemplate: "%{text}<br>%{x:.1f}%<br>%{y:.1f} beds / 10k households<extra></extra>" },
      { type: "scatter", mode: "markers", name: "no reliable bed data", x: col(none, burdenCol), y: none.map(() => floor), marker: { color: GREY, size: 7, symbol: "x" }, text: none.map((r) => r.label), hovertemplate: "%{text}<br>%{x:.1f}%<br>no reliable bed data<extra></extra>" },
    ],
    layout: layout(420, {
      title: title("Beds vs burden (log scale; grey × along the bottom = no reliable bed data, not zero)"),
      xaxis: { title: { text: `${burdenLabel} (%)` } },
      yaxis: { title: { text: "Reported beds per 10k households" }, type: "log" },
    }),
  };
}

export function dataQuality(q: (GeoQuality & { thin: number })[]): Fig {
  const s = [...q].sort((a, b) => (a.pct_confirmed ?? 0) - (b.pct_confirmed ?? 0));
  return {
    data: [{
      type: "bar", orientation: "h", x: s.map((r) => r.pct_confirmed), y: s.map((r) => r.state), marker: { color: TEAL },
      customdata: s.map((r) => [r.n, r.thin]),
      hovertemplate: "%{y}<br>%{x:.0f}% of %{customdata[0]} facility pins inside their district polygon<br>%{customdata[1]} thin-sample districts<extra></extra>",
    }],
    layout: layout(Math.max(450, 18 * s.length), {
      title: title("How much to trust the map, by state"), margin: { l: 180 }, showlegend: false,
      xaxis: { range: [0, 100], title: { text: "% facilities with polygon-confirmed location" } }, yaxis: { automargin: true },
    }),
  };
}

export function correlation(df: District[], burden: Record<string, string>, supply: Record<string, string>): Fig {
  const z = Object.keys(burden).map((b) => Object.keys(supply).map((s) => pearson(col(df, b), col(df, s))));
  return {
    data: [{
      type: "heatmap", z, x: Object.values(supply), y: Object.values(burden), zmin: -1, zmax: 1, colorscale: scale(RDBU),
      text: z.map((row) => row.map((v) => (v === null ? "" : v.toFixed(2)))), texttemplate: "%{text}",
      hovertemplate: "%{y} × %{x}: r = %{z:.2f}<extra></extra>",
    }],
    layout: layout(420, { title: title("Burden × supply correlation across districts (Pearson r)"), margin: { l: 140, b: 60 } }),
  };
}
