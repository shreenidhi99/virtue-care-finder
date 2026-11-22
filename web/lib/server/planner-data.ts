// District planner data (port of the loaders in finder/planner.py). Cached for 6 hours.
import "server-only";
import { DISTANCE_METRICS, SERVICE_FAMILIES, SERVICE_FLAGS, type District, type Facility, type GeoQuality } from "../planner/metrics";
import { SCHEMA } from "./config";
import { cached } from "./guard";
import { runSql, type Row } from "./sql";

const TTL = 6 * 3600 * 1000;
const STATUS_COLS = ["child_anaemia_status", "full_vax_status", "inst_birth_status", "men_tobacco_status", "men_alcohol_status"];
const BURDEN_NUM = [
  "households_surveyed", "child_6_59m_anaemia_pct", "fully_vaccinated_either_pct", "institutional_birth_pct",
  "men_15plus_tobacco_pct", "men_15plus_alcohol_pct", "women_high_bp_pct", "men_high_bp_pct",
  "women_high_sugar_pct", "men_high_sugar_pct", "facilities_per_10k_households", "beds_per_10k_households",
  "total_beds", "n_facilities", "n_maternal_facilities", "n_vaccination_facilities", "n_deaddiction_facilities",
  "n_ncd_facilities", "n_delivery_surgical_facilities",
];
const UNDERSERVED_NUM = ["underserved_score", "anaemia_percentile", "substance_percentile",
  "nonvaccination_percentile", "noninstitutional_birth_percentile", "supply_percentile"];
const DIMS: Record<string, string> = {
  anaemia_percentile: "Anaemia", substance_percentile: "Substance use",
  nonvaccination_percentile: "Non-vaccination", noninstitutional_birth_percentile: "Home births",
};

const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const mean = (xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

function derive(r: Row): District {
  const d: District = { state: r.state!, district: r.district!, label: `${r.district}, ${r.state}`,
    thin_sample: String(r.thin_sample).toLowerCase() === "true" };
  for (const c of STATUS_COLS) d[c] = r[c];
  for (const c of [...BURDEN_NUM, ...UNDERSERVED_NUM, ...Object.keys(DISTANCE_METRICS)]) d[c] = num(r[c]);
  const n = (k: string) => d[k] as number | null;
  const vax = d.full_vax_status === "suppressed" ? null : n("fully_vaccinated_either_pct");
  d.nonvaccination_pct = vax === null ? null : 100 - vax;
  d.noninstitutional_birth_pct = n("institutional_birth_pct") === null ? null : 100 - n("institutional_birth_pct")!;
  d.substance_pct = mean([n("men_15plus_tobacco_pct"), n("men_15plus_alcohol_pct")]);
  d.ncd_pct = mean([n("women_high_bp_pct"), n("men_high_bp_pct"), n("women_high_sugar_pct"), n("men_high_sugar_pct")]);
  // Per-service supply on the same per-10k-households scale as facilities_per_10k_households.
  const nf = n("n_facilities");
  const perFac = nf && nf > 0 && n("facilities_per_10k_households") !== null ? n("facilities_per_10k_households")! / nf : null;
  for (const [, cnt] of Object.values(SERVICE_FAMILIES)) {
    const c = n(cnt);
    d[`${cnt}_per10k`] = perFac === null || c === null ? 0 : c * perFac;
  }
  let best: string | null = null;
  for (const k of Object.keys(DIMS)) if (n(k) !== null && (best === null || n(k)! > n(best)!)) best = k;
  d.dominant_burden = best ? DIMS[best] : null;
  return d;
}

export function loadDistricts(): Promise<District[]> {
  return cached("districts", TTL, async () => {
    const b = [...BURDEN_NUM, ...STATUS_COLS].map((c) => `b.${c}`).join(", ");
    const u = UNDERSERVED_NUM.map((c) => `u.${c}`).join(", ");
    const dist = Object.keys(DISTANCE_METRICS).map((c) => `d.${c}`).join(", ");
    const rows = await runSql(
      `SELECT b.state, b.district, b.thin_sample, ${b}, ${u}, ${dist} ` +
        `FROM ${SCHEMA}.facility_nfhs5_district_burden_supply b ` +
        `LEFT JOIN ${SCHEMA}.facility_nfhs5_district_underserved_score u ON u.state = b.state AND u.district = b.district ` +
        `LEFT JOIN ${SCHEMA}.facility_nfhs5_district_service_distance d ON d.state = b.state AND d.district = b.district`,
    );
    return rows.map(derive);
  });
}

export function loadFacilities(state: string, district: string): Promise<Facility[]> {
  return cached(`fac|${state}|${district}`, TTL, async () => {
    const flags = Object.keys(SERVICE_FLAGS).map((c) => `f.${c}`).join(", ");
    const rows = await runSql(
      `SELECT f.name, f.latitude, f.longitude, f.capacity_beds, ${flags}, q.district_match ` +
        `FROM ${SCHEMA}.facility_nfhs5_facility_context f ` +
        `LEFT JOIN ${SCHEMA}.facility_geo_polygon_qa q ON q.unique_id = f.unique_id ` +
        `WHERE f.nfhs5_state = :state AND f.nfhs5_district = :district`,
      { state, district },
    );
    return rows.map((r) => {
      const f: Facility = {
        name: r.name ?? "Facility", latitude: num(r.latitude), longitude: num(r.longitude),
        capacity_beds: num(r.capacity_beds),
        district_match: r.district_match === "true" ? true : r.district_match === "false" ? false : null,
      };
      for (const c of Object.keys(SERVICE_FLAGS)) f[c] = num(r[c]);
      return f;
    });
  });
}

export function loadGeoQuality(): Promise<GeoQuality[]> {
  return cached("geoq", TTL, async () => {
    const rows = await runSql(
      `SELECT coalesce(nfhs5_state, initcap(polygon_state)) AS state, count(*) AS n, ` +
        `100 * avg(CASE WHEN district_match THEN 1 ELSE 0 END) AS pct_confirmed ` +
        `FROM ${SCHEMA}.facility_geo_polygon_qa GROUP BY 1`,
    );
    return rows.map((r) => ({ state: r.state ?? "", n: num(r.n) ?? 0, pct_confirmed: num(r.pct_confirmed) }));
  });
}
