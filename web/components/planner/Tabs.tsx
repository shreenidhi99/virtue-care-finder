"use client";
// The four District planner tabs (port of tab_overview / tab_district / tab_distance / tab_compare).
import { useMemo } from "react";
import * as charts from "@/lib/planner/charts";
import type { DistrictGeo } from "@/lib/planner/geo";
import { BURDEN_AXES, DISTANCE_METRICS, METRICS, SERVICE_FLAGS, type District, type Facility, type GeoQuality } from "@/lib/planner/metrics";
import type { Percentiles } from "@/lib/planner/percentiles";
import Plot from "../Plot";
import { ChoroplethBlock, fmtCount, Select, useJson, useKept, type Key } from "./common";

type Props = { geo: DistrictGeo; data: District[]; sel: Key | null; setSel: (k: Key | null) => void };

export function Overview({ geo, data, sel, openDrilldown }: Props & { openDrilldown: (k: Key) => void }) {
  const stateList = useMemo(() => ["All India", ...[...new Set(data.map((d) => d.state))].sort()], [data]);
  const [lbState, setLbState] = useKept("ov_lb_state", "All India");
  const [bx, setBx] = useKept("ov_bx", Object.keys(BURDEN_AXES)[0]);
  const lb = lbState === "All India" ? data : data.filter((d) => d.state === lbState);
  return (
    <>
      {/* Tapping a district opens it in District drill-down straight away. */}
      <ChoroplethBlock geo={geo} data={data} metrics={METRICS} id="ov" onPick={openDrilldown}
        tapHint={<>Tap a district to open it in <b>District drill-down</b>.</>} />
      <hr />
      <Select label="Leaderboard: filter by state" value={lbState} options={stateList} onChange={setLbState} />
      <Plot fig={charts.leaderboard(lb)} />
      <p className="caption">Colour = the burden dimension with the highest percentile in that district.</p>
      <hr />
      <Select label="Burden on the x-axis" value={bx} options={Object.keys(BURDEN_AXES)} onChange={setBx} format={(k) => BURDEN_AXES[k]} />
      <Plot fig={charts.burdenVsSupply(data, bx, BURDEN_AXES[bx], sel)} />
      <Plot fig={charts.distributions(data, {
        child_6_59m_anaemia_pct: "Child anaemia %", noninstitutional_birth_pct: "Home births %",
        nonvaccination_pct: "Not fully vaccinated %", substance_pct: "Tobacco/alcohol (men) %",
      }, sel)} />
    </>
  );
}

export function Drilldown({ geo, data, sel, setSel, pct }: Props & { pct: Percentiles }) {
  const labels = useMemo(() => [...data].sort((a, b) => a.label.localeCompare(b.label)), [data]);
  const [svc, setSvc] = useKept("dd_svc", Object.keys(SERVICE_FLAGS)[0]);
  const r = sel ? data.find((d) => d.state === sel[0] && d.district === sel[1]) : undefined;
  const fac = useJson<Facility[]>(r ? `/api/planner/facilities?state=${encodeURIComponent(r.state)}&district=${encodeURIComponent(r.district)}` : null);
  const outline = useMemo(
    () => (sel ? geo.features.filter((f) => f.properties.nfhs_state === sel[0] && f.properties.nfhs_district === sel[1]) : []),
    [geo, sel],
  );
  const picker = (
    <label className="field wide">
      <span>District</span>
      <select value={r ? `${r.state}|${r.district}` : ""} onChange={(e) => {
        const [s, d] = e.target.value.split("|");
        setSel(s ? [s, d] : null);
      }}>
        <option value="">Search a district, or tap one on the map in National overview</option>
        {labels.map((d) => <option key={`${d.state}|${d.district}`} value={`${d.state}|${d.district}`}>{d.label}</option>)}
      </select>
    </label>
  );
  if (!r) return <>{picker}<div className="banner blue">Pick a district to see its facilities and burden profile.</div></>;
  const p = pct.get(`${r.state}|${r.district}`)!;
  const beds = r.beds_per_10k_households;
  const nBorder = fac.data?.filter((f) => f.district_match === false).length ?? 0;
  return (
    <>
      {picker}
      {r.thin_sample && <div className="banner yellow">Thin NFHS-5 sample: treat this district&apos;s survey figures as low-confidence estimates.</div>}
      <div className="metrics">
        <div><span>Underserved score</span><b>{charts.fmt(r.underserved_score as number, "")}</b></div>
        <div><span>Facilities mapped</span><b>{fmtCount(r.n_facilities)}</b></div>
        <div><span>Beds / 10k households</span><b>{typeof beds === "number" && Number(r.n_facilities) > 0 ? beds.toFixed(1) : "no reliable data"}</b></div>
        <div><span>Avg km to any facility</span><b>{charts.fmt(r.avg_km_to_nearest_facility as number, "km")}</b></div>
      </div>
      {fac.loading && <p className="muted"><span className="spinner" /> Loading facilities…</p>}
      {fac.error && <div className="banner red">Couldn&apos;t load facilities: {fac.error}</div>}
      {fac.data && (
        <>
          <Select label="Highlight facilities whose records mention" value={svc} options={Object.keys(SERVICE_FLAGS)} onChange={setSvc} format={(k) => SERVICE_FLAGS[k]} />
          {fac.data.length === 0 ? (
            <div className="banner blue">No facilities mapped in this district. That means none are in our records, not that none exist.</div>
          ) : (
            <>
              <Plot fig={charts.facilityMap(fac.data, outline, svc, SERVICE_FLAGS[svc])} scrollZoom />
              {nBorder > 0 && <p className="caption">⚠ {nBorder} facilities are assigned to this district by PIN code, but their pin falls outside its boundary (common on metro borders).</p>}
            </>
          )}
        </>
      )}
      <div className="cols">
        <Plot fig={charts.radar(r, p)} />
        <Plot fig={charts.needVsSupply(p)} />
      </div>
      {fac.data && fac.data.length > 0 && <Plot fig={charts.bedsReporting(fac.data)} />}
    </>
  );
}

export function Distance({ geo, data, sel, setSel }: Props) {
  const [d, setD] = useKept("dist_x", Object.keys(DISTANCE_METRICS)[0]);
  const [b, setB] = useKept("dist_y", Object.keys(BURDEN_AXES)[0]);
  const nDist = data.filter((r) => typeof r.avg_km_to_nearest_facility === "number").length;
  return (
    <>
      <ChoroplethBlock geo={geo} data={data} metrics={DISTANCE_METRICS} id="dist" onPick={setSel}
        tapHint="Tap a district to compare its distance to each service with the national median, below." />
      <hr />
      {sel ? <Plot fig={charts.distanceBars(data, sel)} /> : <div className="banner blue">Tap a district on the map to compare its distance to each service with the national median.</div>}
      <div className="row">
        <Select label="Distance" value={d} options={Object.keys(DISTANCE_METRICS)} onChange={setD} format={(k) => DISTANCE_METRICS[k].label} />
        <Select label="Burden" value={b} options={Object.keys(BURDEN_AXES)} onChange={setB} format={(k) => BURDEN_AXES[k]} />
      </div>
      <Plot fig={charts.distanceVsBurden(data, d, b, BURDEN_AXES[b], sel)} />
      <p className="caption">
        Distances are straight-line from each post office to the nearest mapped facility, within the same state only. {nDist} of {data.length} districts
        have distance data. Left out on purpose: Leh, Kargil and Lakshadweep (no facility in the same state/UT) and Yanam (an enclave, where same-state
        distance would be ~630 km).
      </p>
    </>
  );
}

export function Compare({ data }: { data: District[] }) {
  const opts: Record<string, string> = { ...BURDEN_AXES, underserved_score: "Underserved score", facilities_per_10k_households: "Facilities / 10k households" };
  const [c, setC] = useKept("cmp_strip", Object.keys(opts)[0]);
  const [b, setB] = useKept("cmp_beds", Object.keys(BURDEN_AXES)[0]);
  const gq = useJson<GeoQuality[]>("/api/planner/geo-quality");
  const quality = useMemo(() => {
    if (!gq.data) return null;
    const thin = new Map<string, number>();
    for (const r of data) if (r.thin_sample) thin.set(r.state, (thin.get(r.state) ?? 0) + 1);
    return gq.data.map((q) => ({ ...q, thin: thin.get(q.state) ?? 0 }));
  }, [gq.data, data]);
  const nThin = data.filter((r) => r.thin_sample).length;
  return (
    <>
      <Select label="Metric" value={c} options={Object.keys(opts)} onChange={setC} format={(k) => opts[k]} />
      <Plot fig={charts.stateStrip(data, c, opts[c])} />
      <hr />
      <Select label="Burden for beds comparison" value={b} options={Object.keys(BURDEN_AXES)} onChange={setB} format={(k) => BURDEN_AXES[k]} />
      <Plot fig={charts.bedsVsBurden(data, b, BURDEN_AXES[b])} />
      <hr />
      {gq.error && <div className="banner red">Couldn&apos;t load data-quality figures: {gq.error}</div>}
      {gq.loading && <p className="muted"><span className="spinner" /> Loading data-quality figures…</p>}
      {quality && (
        <>
          <Plot fig={charts.dataQuality(quality)} />
          <p className="caption">{nThin} of {data.length} districts have a thin NFHS-5 sample.</p>
        </>
      )}
      <hr />
      <Plot fig={charts.correlation(data, BURDEN_AXES, {
        facilities_per_10k_households: "All facilities / 10k", n_maternal_facilities_per10k: "Maternal / 10k",
        n_vaccination_facilities_per10k: "Vaccination / 10k", n_deaddiction_facilities_per10k: "De-addiction / 10k",
        n_ncd_facilities_per10k: "NCD / 10k", beds_per_10k_households: "Beds / 10k",
      })} />
      <p className="caption">Correlation is not causation. Supply counts come from the records we hold.</p>
    </>
  );
}
