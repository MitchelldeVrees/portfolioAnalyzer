export function alignByDate<T extends { date: string }>(arrays: T[][]): string[] {
  const sets = arrays.map(a => new Set(a.map(x => x.date)));
  const base = arrays[0]?.map(x => x.date) ?? [];
  return base.filter(d => sets.every(s => s.has(d)));
}

export function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  let sa=0, sb=0, ssa=0, ssb=0, sab=0;
  for (let i=0;i<n;i++){ sa+=a[i]; sb+=b[i]; ssa+=a[i]*a[i]; ssb+=b[i]*b[i]; sab+=a[i]*b[i]; }
  const cov = sab/n - (sa/n)*(sb/n);
  const va = ssa/n - (sa/n)*(sa/n);
  const vb = ssb/n - (sb/n)*(sb/n);
  if (va<=0 || vb<=0) return NaN;
  return cov / Math.sqrt(va*vb);
}

export function stddev(a: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const mean = a.reduce((s,x)=>s+x,0)/n;
  const v = a.reduce((s,x)=>s+(x-mean)*(x-mean),0)/(n-1);
  return Math.sqrt(v);
}

export function harmonicMean(values: number[], weights?: number[]): number | null {
  const n = values.length;
  if (!n) return null;
  let wsum = 0, denom = 0;
  for (let i=0;i<n;i++){
    const v = values[i];
    const w = weights ? weights[i] : 1;
    if (typeof v === "number" && v > 0 && isFinite(v) && w > 0) {
      wsum += w;
      denom += w / v;
    }
  }
  if (denom <= 0) return null;
  return wsum / denom;
}