"""Build the light district GeoJSON the planner map ships with.

Offline, one-time step (needs the Databricks CLI profile, not run by the app):

    .venv/Scripts/python.exe scripts/build_district_geojson.py data/raw/gb/geoBoundaries-IND-ADM2_simplified.geojson

Input: geoBoundaries IND ADM2 (from /Volumes/workspace/virtue_finder/geodata/).
Output: data/india_districts.geojson, with each feature carrying
  id            "<POLYGON_STATE>|<polygon district>"  (unique key)
  district      polygon name (as drawn)
  state         polygon state
  nfhs_state / nfhs_district   NFHS-5 key from district_polygon_map (+ fixes below),
                               null when the district has no NFHS-5 estimate.

Geometry is simplified (Douglas-Peucker, pure Python) and rounded so the file
is small enough for phones. No geopandas/shapely needed.
"""
import json
import math
import os
import sys
from pathlib import Path

from databricks.sdk import WorkspaceClient

SCHEMA = os.getenv("VF_SCHEMA", "workspace.virtue_finder")
WAREHOUSE_ID = os.getenv("DATABRICKS_WAREHOUSE_ID", "0d88dd62ca1e1fec")
TOLERANCE_DEG = 0.006   # about 600 m; fine for district-level shading
DECIMALS = 3            # about 100 m

# Corrections to district_polygon_map, keyed by (polygon_state, polygon_district):
#   value = (wrong mapped_district currently in the table, correct NFHS-5 state, correct NFHS-5 district)
# An override is applied only while the table still holds that wrong value, so once the
# pipeline fixes a row the table wins and the override goes quiet (the script reports it).
OVERRIDES = {
    ("ASSAM", "Unokoti"): (None, "Tripura", "Unakoti"),                         # polygon state was wrong
    ("CHHATTISGARH", "Janjgir-Champa"): (None, "Chhattisgarh", "Janjgir - Champa"),
    ("MEGHALAYA", "East Jaintia Hills"): (None, "Meghalaya", "East Jantia Hills"),
    ("ASSAM", "South Salmara-Mankachar"): (None, "Assam", "South Salmara Mancachar"),
    ("TELANGANA", "Rangareddy"): ("Sangareddy", "Telangana", "Ranga Reddy"),    # fuzzy grabbed the neighbour
    ("TELANGANA", "Warangal (U)"): ("Warangal Rural", "Telangana", "Warangal Urban"),  # bridge took the twin
    ("TAMIL NADU", "Chengalputtu"): ("Chennai", "Tamil Nadu", "Kancheepuram"),  # 4 facility votes beat 117 PO votes
}


def apply_override(key, mapped_state, mapped_district):
    ov = OVERRIDES.get(key)
    if ov and (mapped_district == ov[0] or (ov[0] is None and mapped_district is None)):
        return ov[1], ov[2], True
    return mapped_state, mapped_district, False


def sql(w: WorkspaceClient, stmt: str) -> list[dict]:
    r = w.statement_execution.execute_statement(warehouse_id=WAREHOUSE_ID, statement=stmt, wait_timeout="50s")
    if r.status.error:
        raise RuntimeError(r.status.error.message)
    cols = [c.name for c in r.manifest.schema.columns]
    return [dict(zip(cols, row)) for row in (r.result.data_array or [])]


# ---------- geometry ----------

def _perp(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def rdp(pts, eps):
    """Iterative Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        dmax, idx = 0.0, None
        for i in range(s + 1, e):
            d = _perp(pts[i], pts[s], pts[e])
            if d > dmax:
                dmax, idx = d, i
        if idx is not None and dmax > eps:
            keep[idx] = True
            stack += [(s, idx), (idx, e)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring):
    out = []
    for x, y in rdp(ring, TOLERANCE_DEG):
        q = [round(x, DECIMALS), round(y, DECIMALS)]
        if not out or q != out[-1]:
            out.append(q)
    if out and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def _signed_area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def _wind(ring, clockwise: bool):
    """Plotly's map engine (d3-geo) wants outer rings CLOCKWISE and holes counter-clockwise:
    the opposite of the GeoJSON spec geoBoundaries follows. A counter-clockwise outer ring
    is read as 'the whole globe except this district' and paints over everything."""
    return ring[::-1] if (_signed_area(ring) < 0) != clockwise else ring


def simplify_polygon(rings):
    shell = simplify_ring(rings[0])
    if shell is None:
        return None
    holes = [_wind(h, False) for h in (simplify_ring(r) for r in rings[1:]) if h]
    return [_wind(shell, True), *holes]


def simplify_geometry(g):
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    out = [p for p in (simplify_polygon(p) for p in polys) if p]
    if not out:  # tiny district: keep the largest original part unsimplified but rounded
        biggest = max(polys, key=lambda p: len(p[0]))
        out = [[_wind([[round(x, DECIMALS), round(y, DECIMALS)] for x, y in biggest[0]], True)]]
    return {"type": "Polygon", "coordinates": out[0]} if len(out) == 1 else \
           {"type": "MultiPolygon", "coordinates": out}


def bbox_centre(g):
    xs, ys = [], []
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for p in polys:
        for x, y in p[0]:
            xs.append(x)
            ys.append(y)
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


# ---------- main ----------

def main(src: str, dst: str = "data/india_districts.geojson") -> None:
    w = WorkspaceClient()
    pmap = sql(w, f"SELECT polygon_district, polygon_state, mapped_state, mapped_district "
                  f"FROM {SCHEMA}.district_polygon_map")
    cents = sql(w, f"SELECT current_state, latitude, longitude FROM {SCHEMA}.district_centroids")
    by_name: dict[str, list[dict]] = {}
    for r in pmap:
        by_name.setdefault(r["polygon_district"], []).append(r)

    def nearest_state(lon, lat, states):
        best, best_d = None, float("inf")
        for c in cents:
            if c["current_state"] in states:
                d = (float(c["latitude"]) - lat) ** 2 + (float(c["longitude"]) - lon) ** 2
                if d < best_d:
                    best, best_d = c["current_state"], d
        return best

    gj = json.loads(Path(src).read_text(encoding="utf-8"))
    feats, seen, unmatched, applied = [], set(), [], []
    for f in gj["features"]:
        name = f["properties"]["shapeName"]
        rows = by_name.get(name, [])
        if len(rows) > 1:  # duplicate district names (e.g. Bilaspur HP / CG): pick by position
            st_name = nearest_state(*bbox_centre(f["geometry"]), {r["polygon_state"] for r in rows})
            rows = [r for r in rows if r["polygon_state"] == st_name]
        if not rows:
            unmatched.append(name)
            continue
        r = rows[0]
        key = (r["polygon_state"], name)
        if key in seen:
            raise SystemExit(f"duplicate polygon key {key}")
        seen.add(key)
        ns, nd, used = apply_override(key, r["mapped_state"], r["mapped_district"])
        if used:
            applied.append(f"{key[1]}: {r['mapped_district']} -> {nd}")
        feats.append({
            "type": "Feature",
            "id": f"{key[0]}|{key[1]}",
            "properties": {"district": name, "state": key[0], "nfhs_state": ns, "nfhs_district": nd},
            "geometry": simplify_geometry(f["geometry"]),
        })

    if unmatched:
        print("WARNING: polygons not in district_polygon_map:", unmatched)
    print(f"overrides applied ({len(applied)}/{len(OVERRIDES)}):", *applied, sep="\n  ")
    stale = len(OVERRIDES) - len(applied)
    if stale:
        print(f"{stale} override(s) not needed any more: the table has been fixed (or changed) for those rows.")
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                    separators=(",", ":")), encoding="utf-8")
    mapped = sum(1 for f in feats if f["properties"]["nfhs_district"])
    print(f"wrote {dst}: {len(feats)} districts ({mapped} with NFHS-5 key), "
          f"{Path(dst).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:])
