"use client";
// District planner: NFHS-5 burden vs facility supply, by district (port of finder/planner.py),
// plus "Ask about an area": drop a pin and ask the agent about that place.
import { useMemo, useRef, useState } from "react";
import type { DistrictGeo } from "@/lib/planner/geo";
import type { District } from "@/lib/planner/metrics";
import { percentiles } from "@/lib/planner/percentiles";
import AreaAsk from "./AreaAsk";
import { useJson, useKept, type Key } from "./common";
import { Compare, Distance, Drilldown, Overview } from "./Tabs";

const TABS = ["National overview", "District drill-down", "Distance to care", "Compare", "Ask about an area"] as const;
type Tab = (typeof TABS)[number];

export default function Planner() {
  const districts = useJson<District[]>("/api/planner/districts");
  const geo = useJson<DistrictGeo>("/india_districts.geojson");
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const tabsRef = useRef<HTMLElement>(null);
  const [sel, setSel] = useKept<Key | null>("planner_sel", null);
  const pct = useMemo(() => (districts.data ? percentiles(districts.data) : null), [districts.data]);

  if (districts.error) return <div className="banner red">Couldn&apos;t load district data: {districts.error}</div>;
  if (geo.error) return <div className="banner red">Couldn&apos;t load district boundaries: {geo.error}</div>;
  if (!districts.data || !geo.data || !pct) {
    return <p className="muted"><span className="spinner" /> Loading district data… (the data warehouse may take ~30 s to wake up)</p>;
  }
  const props = { geo: geo.data, data: districts.data, sel, setSel };
  const openDrilldown = (k: Key) => {
    setSel(k);
    setTab("District drill-down");
    tabsRef.current?.scrollIntoView({ block: "start" }); // the map may have been scrolled far down
  };
  return (
    <>
      <nav className="tabs" role="tablist" ref={tabsRef}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "National overview" && <Overview {...props} openDrilldown={openDrilldown} />}
        {tab === "District drill-down" && <Drilldown {...props} pct={pct} />}
        {tab === "Distance to care" && <Distance {...props} />}
        {tab === "Compare" && <Compare data={districts.data} />}
        {tab === "Ask about an area" && (
          <AreaAsk geo={geo.data} data={districts.data} setSel={openDrilldown} />
        )}
      </div>
      <p className="caption footer">
        Facility counts come from the records we hold: “none mapped” does not mean none exist. Only about 25% of facilities report beds.
        Administrative boundaries courtesy of geoBoundaries.org (ODbL 1.0; source: lgdirectory.gov.in). Some districts were split after
        NFHS-5; those show the parent district&apos;s figures. Distances are straight-line, same-state only.
      </p>
    </>
  );
}
