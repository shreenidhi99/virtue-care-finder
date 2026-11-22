"use client";
// "Ask about an area": drop a pin on the map, then ask the Genie agent about that place.
//
// The pin is resolved to its district polygon in the browser (public/india_districts.geojson), and
// the first question is sent as "<question> near <lat>, <lon> in <District> district, <State>".
// Follow-ups continue the same conversation; moving the pin starts a new one.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibre } from "maplibre-gl";
import { districtAt, stateOf, type DistrictGeo } from "@/lib/planner/geo";
import type { District } from "@/lib/planner/metrics";
import * as charts from "@/lib/planner/charts";
import Chat from "../Chat";
import { fmtCount, useKept, type Key } from "./common";

type Pin = { lat: number; lon: number };

const EXAMPLES = [
  "Where can a pregnant woman deliver safely?",
  "Nearest snakebite treatment, urgent",
  "Which facilities offer dialysis?",
  "How underserved is this area for vaccination?",
];

export default function AreaAsk({ geo, data, setSel }: { geo: DistrictGeo; data: District[]; setSel: (k: Key) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [pin, setPin] = useKept<Pin | null>("area_pin", null);
  const [ready, setReady] = useState(false);

  const feature = useMemo(() => (pin ? districtAt(geo, pin.lat, pin.lon) : null), [geo, pin]);
  const row = useMemo(() => {
    const p = feature?.properties;
    return p?.nfhs_district ? data.find((d) => d.state === p.nfhs_state && d.district === p.nfhs_district) : undefined;
  }, [feature, data]);

  // Create the map once (MapLibre needs `window`, so it is loaded in the browser only).
  // Basemap: CARTO's free Positron vector style, the same one the drill-down map uses.
  // (CARTO's raster tiles now need an API key; the vector style does not.)
  useEffect(() => {
    let alive = true;
    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!alive || !box.current || map.current) return;
      const m = new maplibregl.Map({
        container: box.current,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        center: [80, 22.5], zoom: 3.8, minZoom: 3, maxBounds: [[60, 2], [104, 40]],
        attributionControl: { compact: false, customAttribution: "Boundaries: geoBoundaries.org (ODbL 1.0)" },
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      m.getCanvas().style.cursor = "crosshair";
      m.on("load", () => {
        const empty = { type: "FeatureCollection" as const, features: [] };
        m.addSource("district", { type: "geojson", data: empty });
        m.addLayer({ id: "district-fill", type: "fill", source: "district", paint: { "fill-color": "#b2182b", "fill-opacity": 0.05 } });
        m.addLayer({ id: "district-line", type: "line", source: "district", paint: { "line-color": "#b2182b", "line-width": 2 } });
        m.addSource("pin", { type: "geojson", data: empty });
        m.addLayer({ id: "pin", type: "circle", source: "pin",
          paint: { "circle-radius": 8, "circle-color": "#0f6b5c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        setReady(true);
      });
      m.on("click", (e) => setPin({ lat: +e.lngLat.lat.toFixed(4), lon: +e.lngLat.lng.toFixed(4) }));
      map.current = m;
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw the pin and the district it falls in.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const fc = (features: unknown[]) => ({ type: "FeatureCollection", features }) as GeoJSON.FeatureCollection;
    (m.getSource("pin") as GeoJSONSource).setData(
      fc(pin ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pin.lon, pin.lat] } }] : []));
    (m.getSource("district") as GeoJSONSource).setData(fc(feature ? [feature] : []));
  }, [pin, feature, ready]);

  const place = feature ? `${feature.properties.district}, ${stateOf(feature)}` : null;
  // Send the pin's exact coordinates plus the district name. Coordinates, not the name alone: the pincode
  // directory's district centres can be far off (Gautam Buddha Nagar resolves near Agra, ~180 km from Noida).
  const wrap = (q: string) =>
    pin ? `${q} near ${pin.lat}, ${pin.lon}${feature ? ` in ${feature.properties.district} district, ${stateOf(feature)}` : ""}` : q;

  return (
    <div className="area">
      <div className="area-map">
        <div ref={box} className="pin-map" role="application" aria-label="Map: tap to drop a pin" />
        <p className="caption">Tap the map to drop a pin. Zoom in to place it on a village or town.</p>
      </div>
      <div className="area-side">
        {!pin && <div className="banner blue">Drop a pin on the map to ask about that area.</div>}
        {pin && (
          <div className="pin-info">
            <div><b>📍 {place ?? "Outside the mapped districts"}</b></div>
            <div className="muted">{pin.lat}, {pin.lon}</div>
            {row ? (
              <div className="mini-metrics">
                <span>Underserved score <b>{charts.fmt(row.underserved_score as number, "")}</b></span>
                <span>Facilities mapped <b>{fmtCount(row.n_facilities)}</b></span>
                <span>Avg km to any facility <b>{charts.fmt(row.avg_km_to_nearest_facility as number, "km")}</b></span>
                {row.thin_sample && <span className="badge yellow">Thin NFHS-5 sample</span>}
                <button className="btn ghost" onClick={() => setSel([row.state, row.district])}>Open in District drill-down</button>
              </div>
            ) : feature ? (
              <div className="muted">No NFHS-5 estimate for this district.</div>
            ) : null}
          </div>
        )}
        <Chat
          examples={EXAMPLES}
          placeholder="Ask about this area, e.g. nearest maternity hospital"
          disabledReason={pin ? null : "Drop a pin on the map first"}
          wrap={wrap}
          chip={place ?? (pin ? `${pin.lat}, ${pin.lon}` : undefined)}
          resetKey={pin ? `${pin.lat},${pin.lon}` : "none"}
          intro="Records only say a service is mentioned; always verify by phone."
        />
      </div>
    </div>
  );
}
