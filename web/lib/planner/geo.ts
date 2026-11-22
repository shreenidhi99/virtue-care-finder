// District boundaries (public/india_districts.geojson, built by scripts/build_district_geojson.py).
// Features are keyed by the unique "STATE|District" id: never join by district name alone,
// because 7 names repeat across states.

export type DistrictFeature = {
  type: "Feature";
  id: string;
  properties: { district: string; state: string; nfhs_state: string | null; nfhs_district: string | null };
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
};
export type DistrictGeo = { type: "FeatureCollection"; features: DistrictFeature[] };

export const stateOf = (f: DistrictFeature) => f.properties.nfhs_state ?? titleCase(f.properties.state);

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function states(geo: DistrictGeo): string[] {
  return [...new Set(geo.features.map(stateOf))].sort();
}

function polygons(f: DistrictFeature): number[][][][] {
  return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
}

/** Outer-ring coordinates of every polygon, [lon, lat]. */
export function* outerCoords(f: DistrictFeature): Generator<number[]> {
  for (const p of polygons(f)) yield* p[0];
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The district polygon containing a point (holes respected), or null (sea, outside India). */
export function districtAt(geo: DistrictGeo, lat: number, lon: number): DistrictFeature | null {
  for (const f of geo.features) {
    for (const [outer, ...holes] of polygons(f)) {
      if (inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h))) return f;
    }
  }
  return null;
}
