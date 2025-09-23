import type { OHLCPoint } from "./market-data";

export function annualizedVolatility(series: number[]): number {
  const rets = pctReturns(series);
  const avg = mean(rets);
  const variance = mean(rets.map(r => Math.pow(r - avg, 2)));
  // monthly -> annualize by sqrt(12)
  return Math.sqrt(variance) * Math.sqrt(12);
}

export function pctReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i=1;i<series.length;i++) out.push(series[i]/series[i-1]-1);
  return out;
}

export function mean(arr: number[]) {
  return arr.reduce((s,x)=>s+x,0)/(arr.length || 1);
}

export function maxDrawdown(series: number[]): number {
  let peak = series[0];
  let mdd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return Math.abs(mdd);
}

// Estimate beta via regression on returns: portfolio vs benchmark
export function estimateBeta(portfolio: number[], benchmark: number[]): number {
  const rp = pctReturns(portfolio);
  const rb = pctReturns(benchmark);
  const n = Math.min(rp.length, rb.length);
  const p = rp.slice(-n), b = rb.slice(-n);
  const meanB = mean(b);
  const cov = mean(p.map((x,i)=> (x - mean(p))*(b[i]-meanB)));
  const varB = mean(b.map(x => Math.pow(x - meanB,2)));
  return varB === 0 ? 1 : cov/varB;
}
