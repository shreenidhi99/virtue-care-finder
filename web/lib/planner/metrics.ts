// Planner metric definitions and data shapes (port of the constants in finder/planner.py
// and finder/planner_charts.py). Safe to import from both server and browser.

export type District = {
  state: string;
  district: string;
  label: string;
  thin_sample: boolean;
  [k: string]: string | number | boolean | null;
};

export type Facility = {
  name: string;
  latitude: number | null;
  longitude: number | null;
  capacity_beds: number | null;
  district_match: boolean | null;
  [k: string]: string | number | boolean | null;
};

export type GeoQuality = { state: string; n: number; pct_confirmed: number | null };

export type Metric = {
  label: string;
  unit: string; // "%", "km", ""
  worseWhen: "high" | "low"; // colour always goes darker towards worse
  statusCol?: string; // per-metric NFHS-5 status (ok / low_confidence / suppressed)
  thinFlag?: boolean; // use thin_sample as the confidence flag
};

export const METRICS: Record<string, Metric> = {
  underserved_score: { label: "Underserved score (burden vs supply)", unit: "", worseWhen: "high", thinFlag: true },
  child_6_59m_anaemia_pct: { label: "Child anaemia, 6–59 months", unit: "%", worseWhen: "high", statusCol: "child_anaemia_status" },
  fully_vaccinated_either_pct: { label: "Children fully vaccinated", unit: "%", worseWhen: "low", statusCol: "full_vax_status" },
  institutional_birth_pct: { label: "Institutional births", unit: "%", worseWhen: "low", statusCol: "inst_birth_status" },
  men_15plus_tobacco_pct: { label: "Men 15+ using tobacco", unit: "%", worseWhen: "high", statusCol: "men_tobacco_status" },
  men_15plus_alcohol_pct: { label: "Men 15+ drinking alcohol", unit: "%", worseWhen: "high", statusCol: "men_alcohol_status" },
  facilities_per_10k_households: { label: "Facilities mapped per 10k households", unit: "", worseWhen: "low" },
  beds_per_10k_households: { label: "Beds per 10k households (reported)", unit: "", worseWhen: "low" },
};

export const DISTANCE_METRICS: Record<string, Metric> = {
  avg_km_to_nearest_facility: { label: "Avg km to nearest facility (any)", unit: "km", worseWhen: "high" },
  avg_km_to_nearest_maternal: { label: "Avg km to nearest maternal care", unit: "km", worseWhen: "high" },
  avg_km_to_nearest_vaccination: { label: "Avg km to nearest vaccination", unit: "km", worseWhen: "high" },
  avg_km_to_nearest_deaddiction: { label: "Avg km to nearest de-addiction", unit: "km", worseWhen: "high" },
  avg_km_to_nearest_ncd: { label: "Avg km to nearest NCD care", unit: "km", worseWhen: "high" },
  avg_km_to_nearest_delivery_surgical: { label: "Avg km to nearest delivery / surgical", unit: "km", worseWhen: "high" },
};

export const ALL_METRICS: Record<string, Metric> = { ...METRICS, ...DISTANCE_METRICS };

export const NO_DATA_AREA = "DATA NOT AVAILABLE"; // geoBoundaries' unnamed northern polygon
export const EXCLUDED_DISTANCE = new Set(["Ladakh|Leh", "Ladakh|Kargil", "Lakshadweep|Lakshadweep", "Puducherry|Yanam"]);

export const BURDEN_AXES: Record<string, string> = {
  child_6_59m_anaemia_pct: "Child anaemia",
  noninstitutional_birth_pct: "Home births",
  nonvaccination_pct: "Not fully vaccinated",
  men_15plus_tobacco_pct: "Tobacco (men)",
  men_15plus_alcohol_pct: "Alcohol (men)",
  ncd_pct: "High BP / sugar",
};

export const SERVICE_FLAGS: Record<string, string> = {
  has_maternal: "Maternal", has_vaccination: "Vaccination", has_deaddiction: "De-addiction",
  has_ncd: "NCD", has_delivery_surgical: "Delivery / surgical",
};

// family -> [burden column for the "need" side, facility count column, distance column]
export const SERVICE_FAMILIES: Record<string, [string, string, string]> = {
  Maternal: ["noninstitutional_birth_pct", "n_maternal_facilities", "avg_km_to_nearest_maternal"],
  Vaccination: ["nonvaccination_pct", "n_vaccination_facilities", "avg_km_to_nearest_vaccination"],
  "De-addiction": ["substance_pct", "n_deaddiction_facilities", "avg_km_to_nearest_deaddiction"],
  NCD: ["ncd_pct", "n_ncd_facilities", "avg_km_to_nearest_ncd"],
  "Delivery / surgical": ["noninstitutional_birth_pct", "n_delivery_surgical_facilities", "avg_km_to_nearest_delivery_surgical"],
};

export const RADAR_SPOKES: Record<string, string> = {
  child_6_59m_anaemia_pct: "Child anaemia", men_15plus_tobacco_pct: "Tobacco (men)",
  men_15plus_alcohol_pct: "Alcohol (men)", nonvaccination_pct: "Not fully vaccinated",
  noninstitutional_birth_pct: "Home births", ncd_pct: "High BP / sugar",
};

// Bubble size = facilities whose records mention the service that answers this burden / distance.
export const BUBBLE_COUNT: Record<string, [string, string]> = {
  child_6_59m_anaemia_pct: ["n_facilities", "facilities (any)"],
  noninstitutional_birth_pct: ["n_maternal_facilities", "maternal facilities"],
  nonvaccination_pct: ["n_vaccination_facilities", "vaccination facilities"],
  men_15plus_tobacco_pct: ["n_deaddiction_facilities", "de-addiction facilities"],
  men_15plus_alcohol_pct: ["n_deaddiction_facilities", "de-addiction facilities"],
  substance_pct: ["n_deaddiction_facilities", "de-addiction facilities"],
  ncd_pct: ["n_ncd_facilities", "NCD facilities"],
  avg_km_to_nearest_facility: ["n_facilities", "facilities (any)"],
  avg_km_to_nearest_maternal: ["n_maternal_facilities", "maternal facilities"],
  avg_km_to_nearest_vaccination: ["n_vaccination_facilities", "vaccination facilities"],
  avg_km_to_nearest_deaddiction: ["n_deaddiction_facilities", "de-addiction facilities"],
  avg_km_to_nearest_ncd: ["n_ncd_facilities", "NCD facilities"],
  avg_km_to_nearest_delivery_surgical: ["n_delivery_surgical_facilities", "delivery / surgical facilities"],
};

export const DIMENSION_COLORS: Record<string, string> = {
  Anaemia: "#d6604d", "Substance use": "#8073ac", "Non-vaccination": "#e08214", "Home births": "#4393c3",
};
