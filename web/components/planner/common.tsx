"use client";
import { useEffect, useMemo, useState } from "react";
import { choropleth } from "@/lib/planner/charts";
import { states, type DistrictGeo } from "@/lib/planner/geo";
import type { District, Metric } from "@/lib/planner/metrics";
import Plot from "../Plot";

export type Key = [string, string]; // [NFHS-5 state, NFHS-5 district]

// Widget choices survive tab switches (like Streamlit widget keys) without keeping hidden charts mounted.
const kept = new Map<string, unknown>();
export function useKept<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  return [v, (x: T) => { kept.set(key, x); setV(x); }];
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Server error (${r.status})`);
  return j as T;
}

export function useJson<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [s, setS] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) return setS({ data: null, error: null, loading: false });
    let alive = true;
    setS({ data: null, error: null, loading: true });
    getJson<T>(url).then(
      (data) => alive && setS({ data, error: null, loading: false }),
      (e: Error) => alive && setS({ data: null, error: e.message, loading: false }),
    );
    return () => { alive = false; };
  }, [url]);
  return s;
}

export function Select<T extends string>({ label, value, options, onChange, format }: {
  label: string; value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o} value={o}>{format ? format(o) : o}</option>)}
      </select>
    </label>
  );
}

export function ChoroplethBlock({ geo, data, metrics, id, onPick, tapHint }: {
  geo: DistrictGeo; data: District[]; metrics: Record<string, Metric>; id: string; onPick: (k: Key) => void; tapHint: React.ReactNode;
}) {
  const keys = Object.keys(metrics);
  const [metric, setMetric] = useKept(`${id}_metric`, keys[0]);
  const [state, setState] = useKept(`${id}_state`, "All India");
  const m = metrics[metric];
  const worse = metric === "underserved_score"
    ? "Redder = more underserved; blue = better served than the typical district."
    : `Darker = worse (${m.worseWhen === "high" ? "higher" : "lower"} is worse).`;
  const fig = useMemo(() => choropleth(geo, data, metric, state === "All India" ? null : state), [geo, data, metric, state]);
  return (
    <>
      <div className="row">
        <Select label="Shade districts by" value={metric} options={keys} onChange={setMetric} format={(k) => metrics[k].label} />
        <Select label="State" value={state} options={["All India", ...states(geo)]} onChange={setState} />
      </div>
      <p className="caption">
        {worse} Faded = low-confidence estimate. Grey = no estimate for that district. Very light grey in the far north =
        area with no survey or facility data. {tapHint}
      </p>
      <Plot fig={fig} scrollZoom onClick={(cd) => Array.isArray(cd) && cd[1] && onPick([cd[0], cd[1]])} />
    </>
  );
}

export const fmtCount = (v: unknown) => (typeof v !== "number" || v === 0 ? "none mapped" : String(Math.trunc(v)));
