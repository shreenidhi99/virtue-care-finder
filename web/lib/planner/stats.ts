// Small numeric helpers that match pandas defaults, so the charts agree with the Streamlit app.

export type Num = number | null | undefined;

export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function nums(xs: Num[]): number[] {
  return xs.filter(isNum);
}

/** pandas Series.quantile (linear interpolation), skipping missing values. */
export function quantile(xs: Num[], q: number): number | null {
  const s = nums(xs).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: Num[]) => quantile(xs, 0.5);

/** pandas Series.rank(pct=True): average rank of ties / count of non-missing; missing stays null. */
export function pctRank(xs: Num[]): (number | null)[] {
  const idx = xs.map((x, i) => [x, i] as const).filter(([x]) => isNum(x)) as [number, number][];
  idx.sort((a, b) => a[0] - b[0]);
  const out: (number | null)[] = xs.map(() => null);
  const n = idx.length;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = avg / n;
    i = j + 1;
  }
  return out;
}

/** Pearson r on pairwise-complete observations (pandas DataFrame.corr). */
export function pearson(a: Num[], b: Num[]): number | null {
  const pairs: [number, number][] = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (isNum(x) && isNum(y)) pairs.push([x, y]);
  });
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export const max = (xs: Num[]) => {
  const s = nums(xs);
  return s.length ? Math.max(...s) : null;
};
