// Percentile rank (0-1) of each district for the radar and need-vs-supply charts (port of planner.percentiles).
import { BURDEN_AXES, SERVICE_FAMILIES, type District } from "./metrics";
import { isNum, pctRank } from "./stats";

export type Percentiles = Map<string, Record<string, number | null>>; // "state|district" -> column -> pct

export function percentiles(data: District[]): Percentiles {
  const cols = [...new Set([...Object.keys(BURDEN_AXES), "substance_pct",
    ...Object.values(SERVICE_FAMILIES).map(([, cnt]) => `${cnt}_per10k`)])];
  const out: Percentiles = new Map(data.map((r) => [`${r.state}|${r.district}`, {}]));
  for (const c of cols) {
    const ranks = pctRank(data.map((r) => (isNum(r[c]) ? (r[c] as number) : null)));
    data.forEach((r, i) => (out.get(`${r.state}|${r.district}`)![c] = ranks[i]));
  }
  return out;
}
