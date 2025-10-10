// /app/api/portfolio/[id]/holdings/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchQuotesBatch, fetchHistoryMonthlyClose } from "@/lib/market-data";
import yahooFinance from "yahoo-finance2";

type Holding = {
  id: string;
  ticker: string;
  weight: number;
  shares?: number;
  purchase_price?: number | null;
  
};

const DEFAULT_BENCH = "^GSPC"; // Yahoo/our layer supports this

// ------------ generic helpers ------------
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function scoreLinear(value: number, low: number, high: number, invert = false) {
  // maps [low..high] to [0..100] (or inverted)
  if (value == null || !Number.isFinite(value)) return null;
  const t = clamp((value - low) / (high - low), 0, 1);
  const s = Math.round((invert ? (1 - t) : t) * 100);
  return s;
}
function maxDrawdownPct(closes: number[]): number | null {
  if (!closes?.length) return null;
  let peak = closes[0];
  let mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, c / peak - 1);
  }
  return Math.abs(mdd) * 100; // % drawdown
}
function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// ------------ sector helper ------------
// --- Drop-in replacement (paste over your current getSectorForTicker) ---
// Requires: `import yahooFinance from "yahoo-finance2";` already present in the file.

function getSectorForTicker(ticker: string): string {
  const t = (ticker || "").toUpperCase().trim();
  if (!t) return "Other";

  // 1) Fast path: built-in map for common names (keeps current behavior instant)
  const BUILTIN: Record<string, string> = {
    AAPL: "Technology",
    MSFT: "Technology",
    GOOGL: "Technology",
    NVDA: "Technology",
    META: "Technology",
    AMZN: "Consumer Discretionary",
    TSLA: "Consumer Discretionary",
    JPM: "Financial Services",
    V: "Financial Services",
    JNJ: "Healthcare",
  };
  if (BUILTIN[t]) return BUILTIN[t];

  // 2) Try cache (populated by a background Yahoo fetch)
  const hit = _sectorCache.get(t);
  const now = Date.now();
  if (hit && (now - hit.ts) < SECTOR_TTL_MS && typeof hit.sector === "string") {
    return hit.sector;
  }

  // 3) If no fresh cache, kick off a background fetch (non-blocking) and return "Other" for now.
  //    Next request for the same ticker should hit the cache with the real sector.
  if (!hit?.inflight) {
    const inflight = _fetchSectorFromYahoo(t)
      .then((sector) => {
        _sectorCache.set(t, { sector: sector || "Other", ts: Date.now(), inflight: null });
      })
      .catch(() => {
        _sectorCache.set(t, { sector: "Other", ts: Date.now(), inflight: null });
      });
    _sectorCache.set(t, { sector: hit?.sector ?? "Other", ts: hit?.ts ?? 0, inflight });
  }

  return "Other";
}

// --- Internal cache & helpers ---
const SECTOR_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
type SectorEntry = { sector: string; ts: number; inflight: Promise<void> | null };
const _sectorCache: Map<string, SectorEntry> = new Map();

async function _fetchSectorFromYahoo(ticker: string): Promise<string | null> {
  try {
    // Ask Yahoo for sector info (equities: assetProfile/summaryProfile; ETFs: label as "ETF")
    const qs: any = await yahooFinance.quoteSummary(ticker, {
      modules: ["assetProfile", "summaryProfile", "price"],
    });

    // Prefer assetProfile.sector, then summaryProfile.sector
    const fromAsset = qs?.assetProfile?.sector;
    const fromSummary = qs?.summaryProfile?.sector;

    // Simple ETF detection
    const quoteType = qs?.price?.quoteType || qs?.price?.quoteType?.raw;
    const isETF = (typeof quoteType === "string") && quoteType.toUpperCase() === "ETF";
    if (isETF) return "ETF";

    const sector = (typeof fromAsset === "string" && fromAsset) || (typeof fromSummary === "string" && fromSummary);
    return sector || null;
  } catch {
    return null;
  }
}

// --- Optional: pre-warm cache in one shot (call before building tables if you want fresh sectors immediately) ---
export async function warmSectorCache(tickers: string[]) {
  const uniq = Array.from(new Set((tickers || []).map(t => (t || "").toUpperCase().trim()).filter(Boolean)));
  await Promise.all(
    uniq.map(async (t) => {
      const hit = _sectorCache.get(t);
      const fresh = hit && (Date.now() - hit.ts) < SECTOR_TTL_MS && typeof hit.sector === "string";
      if (!fresh) {
        const s = await _fetchSectorFromYahoo(t);
        _sectorCache.set(t, { sector: s || "Other", ts: Date.now(), inflight: null });
      }
    })
  );
}


// ------------ math helpers (monthly fallback) ------------
function pctReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] / series[i - 1] - 1);
  return out;
}
function mean(arr: number[]) {
  return arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
}
function annualizedVolatilityFromIndex(indexSeries: number[]): number {
  // indexSeries is normalized (e.g., 100-based or raw) — we convert to returns and annualize (monthly->annual)
  const rets = pctReturns(indexSeries.map(v => v / (typeof v === "number" ? 100 : 1)));
  const avg = mean(rets);
  const variance = mean(rets.map(r => Math.pow(r - avg, 2)));
  return Math.sqrt(variance) * Math.sqrt(12);
}
function estimateBeta(aIndex: number[], bIndex: number[]): number {
  const ra = pctReturns(aIndex);
  const rb = pctReturns(bIndex);
  const n = Math.min(ra.length, rb.length);
  const a = ra.slice(-n), b = rb.slice(-n);
  const ma = mean(a), mb = mean(b);
  const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb)));
  const varB = mean(b.map(x => Math.pow(x - mb, 2)));
  return varB === 0 ? 1 : cov / varB;
}

// ------------ yahoo helpers (robust risk) ------------
async function fetchHistRisk(symbol: string): Promise<{ vol12mPct: number | null; mdd12mPct: number | null }> {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(end.getFullYear() - 1);

    const rows = await yahooFinance.historical(symbol, {
      period1: start,
      period2: end,
      interval: "1d",
    });

    const closes = rows?.map(r => r.adjClose ?? r.close).filter((v): v is number => Number.isFinite(v));
    if (!closes || closes.length < 60) return { vol12mPct: null, mdd12mPct: null };

    // daily log-return vol → annualized
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const r = Math.log(closes[i] / closes[i - 1]);
      if (Number.isFinite(r)) rets.push(r);
    }
    if (rets.length < 30) return { vol12mPct: null, mdd12mPct: null };

    const mu = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance = rets.reduce((s, x) => s + (x - mu) ** 2, 0) / rets.length;
    const vol12mPct = Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(1));

    const mdd12mPct = Number((maxDrawdownPct(closes) ?? 0).toFixed(1));
    return { vol12mPct, mdd12mPct };
  } catch {
    return { vol12mPct: null, mdd12mPct: null };
  }
}

async function fetchFundamentals(symbol: string) {
  const modules = [
    "defaultKeyStatistics",
    "financialData",
    "summaryDetail",
    "price",
    "calendarEvents",
    "incomeStatementHistory",
  ] as const;

  type QS = any;
  try {
    const qs: QS = await yahooFinance.quoteSummary(symbol, { modules: modules as any });

    const price = qs?.price;
    const fin = qs?.financialData;
    const dks = qs?.defaultKeyStatistics;
    const sd  = qs?.summaryDetail;
    const cal = qs?.calendarEvents;
    const inc = qs?.incomeStatementHistory?.incomeStatementHistory?.[0];

    const safeNum = (x: any): number | null => {
      if (x == null) return null;
      if (typeof x === "number") return x;
      if (typeof x?.raw === "number") return x.raw;
      return null;
    };

    const beta = safeNum(dks?.beta);
    const trailingPE = safeNum(sd?.trailingPE);
    const ps = safeNum(sd?.priceToSalesTrailing12Months);
    const peg = safeNum(dks?.pegRatio) ?? safeNum(fin?.pegRatio);
    const freeCashflow = safeNum(fin?.freeCashflow);
    const marketCap = safeNum(price?.marketCap);
    const currentPrice = safeNum(fin?.currentPrice) ?? safeNum(price?.regularMarketPrice);
    const adv10 = safeNum(sd?.averageDailyVolume10Day);
    const avgDollarVol = (adv10 && currentPrice) ? adv10 * currentPrice : null;

    const debtToEquity = safeNum(fin?.debtToEquity);
    const ebit = safeNum(inc?.ebit) ?? safeNum(inc?.operatingIncome);
    const interestExpense = Math.abs(safeNum(inc?.interestExpense) ?? 0) || null;
    const interestCoverage = (ebit && interestExpense) ? (ebit / interestExpense) : null;

    const shortPctFloat = safeNum(dks?.shortPercentOfFloat);
    const shortRatio = safeNum(dks?.shortRatio);

    const parseYahooDate = (d: any): Date | null => {
      if (!d) return null;
      if (d instanceof Date) return d;
      if (typeof d === "string" || typeof d === "number") return new Date(d);
      if (typeof d?.raw === "number") return new Date(d.raw * 1000);
      return null;
    };
    const edates = cal?.earnings?.earningsDate;
    const earningsDate: Date | null =
      Array.isArray(edates) && edates.length ? parseYahooDate(edates[0]) : parseYahooDate(edates);
    const dte = daysUntil(earningsDate);

    // FCF yield (%)
    const fcfYieldPct = (freeCashflow && marketCap) ? (freeCashflow / marketCap) * 100 : null;

    return {
      beta,
      trailingPE,
      ps,
      peg,
      fcfYieldPct,
      debtToEquity,
      interestCoverage,
      avgDollarVol,
      shortPctFloat,
      shortRatio,
      daysToEarnings: dte,
    };
  } catch {
    return {
      beta: null,
      trailingPE: null,
      ps: null,
      peg: null,
      fcfYieldPct: null,
      debtToEquity: null,
      interestCoverage: null,
      avgDollarVol: null,
      shortPctFloat: null,
      shortRatio: null,
      daysToEarnings: null,
    };
  }
}

// ------------ risk scoring ------------
type RiskInputs = {
  vol12mPct: number | null;
  mdd12mPct: number | null;
  beta: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  trailingPE: number | null;
  ps: number | null;
  peg: number | null;
  fcfYieldPct: number | null;
  avgDollarVol: number | null;
  shortPctFloat: number | null;
  shortRatio: number | null;
  daysToEarnings: number | null;
  weightPct: number | null; // holding's share of portfolio in %

};

// returns 0..100 and detailed components
// returns 0..100 and detailed components
function computeRiskScore(x: RiskInputs) {
  // --- existing component scores (unchanged logic) ---
  const sVol   = scoreLinear(x.vol12mPct ?? NaN, 15, 60) ?? 50;
  const sMDD   = scoreLinear(x.mdd12mPct ?? NaN, 10, 60) ?? 50;
  const sBeta  = (x.beta == null) ? 50 : clamp(Math.round(100 * Math.max(0, Math.abs(x.beta - 1) / 0.8)), 0, 100);

  const sD2E   = scoreLinear(x.debtToEquity ?? NaN, 0, 250) ?? 50;
  const sICov  = (x.interestCoverage == null) ? 50 :
                 (x.interestCoverage <= 1 ? 100 : scoreLinear(x.interestCoverage, 2, 8, true)!);

  const sPE    = (x.trailingPE != null && x.trailingPE > 0)
                   ? scoreLinear(x.trailingPE, 10, 40)!
                   : (x.ps != null ? scoreLinear(x.ps, 1, 10)! : 50);
  const sPEG   = (x.peg != null) ? scoreLinear(x.peg, 1, 2.5)! : 50;
  const sFCFY  = (x.fcfYieldPct != null) ? scoreLinear(x.fcfYieldPct, 5, 0)! : 50;

  const sADV   = (x.avgDollarVol != null) ? scoreLinear(x.avgDollarVol, 50e6, 2e6, true)! : 50;

  const sShort = Math.max(
    x.shortPctFloat != null ? scoreLinear(x.shortPctFloat, 2, 20)! : 0,
    x.shortRatio != null ? scoreLinear(x.shortRatio, 1, 8)! : 0
  ) || 50;

  const sEvt   = (x.daysToEarnings != null)
                   ? (x.daysToEarnings <= 7 ? 100 : x.daysToEarnings <= 21 ? 60 : 0)
                   : 20;

  // --- NEW: Position size (maps weight% to risk 0..100) ---
  // Tune these bounds to your taste. Example:
  // 1% position ~ 0 risk contribution; 15%+ ~ maxed risk.
  const sPos   = (x.weightPct != null) ? scoreLinear(x.weightPct, 1, 15)! : 50;

  // Keep existing mix, scaled by 0.9, and add 10% for position size.
  const baseScore =
      0.20 * sVol  + 0.10 * sMDD + 0.05 * sBeta +
      0.15 * sD2E  + 0.10 * sICov +
      0.06 * sPE   + 0.05 * sPEG + 0.04 * sFCFY +
      0.10 * sADV  +
      0.10 * sShort+
      0.05 * sEvt;

  const score = 0.90 * baseScore + 0.10 * sPos;

  const riskScore = Math.round(score);
  const bucket = riskScore < 33 ? "Low" : riskScore < 66 ? "Medium" : "High";

  const components = [
    { key: "vol",   label: "Volatility (12m)",        score: sVol,   weight: 0.20 * 0.90, value: x.vol12mPct },
    { key: "mdd",   label: "Max Drawdown (12m)",      score: sMDD,   weight: 0.10 * 0.90, value: x.mdd12mPct },
    { key: "beta",  label: "Beta",                    score: sBeta,  weight: 0.05 * 0.90, value: x.beta },
    { key: "d2e",   label: "Debt/Equity",             score: sD2E,   weight: 0.15 * 0.90, value: x.debtToEquity },
    { key: "icov",  label: "Interest Coverage",       score: sICov,  weight: 0.10 * 0.90, value: x.interestCoverage },
    { key: "pe",    label: "P/E (or P/S)",            score: sPE,    weight: 0.06 * 0.90, value: x.trailingPE ?? x.ps },
    { key: "peg",   label: "PEG",                     score: sPEG,   weight: 0.05 * 0.90, value: x.peg },
    { key: "fcfy",  label: "FCF Yield %",             score: sFCFY,  weight: 0.04 * 0.90, value: x.fcfYieldPct },
    { key: "adv",   label: "Avg $ Volume (10d)",      score: sADV,   weight: 0.10 * 0.90, value: x.avgDollarVol },
    { key: "short", label: "Short Interest",          score: sShort, weight: 0.10 * 0.90, value: x.shortPctFloat ?? x.shortRatio },
    { key: "evt",   label: "Earnings Proximity",      score: sEvt,   weight: 0.05 * 0.90, value: x.daysToEarnings },

    // NEW component
    { key: "pos",   label: "Position Size (weight %)", score: sPos,  weight: 0.10,        value: x.weightPct },
  ];

  return { riskScore, bucket, components };
}

// ------------ route handler ------------
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const benchmark = url.searchParams.get("benchmark") || DEFAULT_BENCH;

    // 1) Load portfolio + holdings
    const { data: portfolio, error } = await supabase
      .from("portfolios")
      .select(`*, portfolio_holdings (*)`)
      .eq("id", params.id)
      .eq("user_id", auth.user.id)
      .single();

    if (error || !portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const holdings: Holding[] = portfolio.portfolio_holdings || [];
    if (!holdings.length) {
      return NextResponse.json({
        holdings: [],
        meta: { benchmark, anyCostBasis: false, totalValue: 0, avgBetaWeighted: 0 },
      });
    }

    // 2) Quotes (batch)
    const symbols = holdings.map(h => h.ticker);
    const quotesMap = await fetchQuotesBatch(symbols);

    // 3) Values/weights
    const temp = holdings.map(h => {
      const q = quotesMap[h.ticker] || { price: 100, change: 0, changePercent: 0 };
      const shares = h.shares ?? (h.weight * 10000) / q.price; // fallback
      const totalValue = q.price * shares;
      const hasCostBasis = !!(h.purchase_price);
      const retSincePurchase = hasCostBasis && h.purchase_price
        ? ((q.price - h.purchase_price) / h.purchase_price) * 100
        : null;
      return {
        ...h,
        price: q.price,
        changePercent: q.changePercent,
        shares,
        totalValue,
        hasCostBasis,
        returnSincePurchase: retSincePurchase,
        sector: getSectorForTicker(h.ticker),
      };
    });

    const portfolioTotalValue = temp.reduce((s, x) => s + x.totalValue, 0) || 1;
    const withWeights = temp.map(x => ({ ...x, weightPct: (x.totalValue / portfolioTotalValue) * 100 }));

    const enriched = withWeights.map(x => ({
      ...x,
      contributionPct: x.returnSincePurchase != null ? (x.returnSincePurchase * x.weightPct) / 100 : null,
    }));
    const anyCostBasis = enriched.some(x => x.hasCostBasis);

    // 4) Monthly series for fallback beta/vol
    let benchHistory: { date: string; close: number }[] = [];
    try {
      benchHistory = await fetchHistoryMonthlyClose(benchmark, 12);
    } catch {
      benchHistory = [];
    }
    const benchIndex = benchHistory.map(p => p.close);
    const benchBase = benchIndex[0] || 100;
    const benchNorm = benchIndex.map(v => (v / benchBase) * 100);

    const historyByTicker = await Promise.all(
      symbols.map(async sym => {
        try {
          const pts = await fetchHistoryMonthlyClose(sym, 12);
          return [sym, pts] as const;
        } catch {
          return [sym, []] as const;
        }
      }),
    );
    const historyMap = Object.fromEntries(historyByTicker);

    // 5) Fetch risk inputs per symbol (daily vol/MDD + fundamentals)
    const riskInputsBySymbol = Object.fromEntries(
  await Promise.all(
    symbols.map(async (sym) => {
      const [hist, f] = await Promise.all([fetchHistRisk(sym), fetchFundamentals(sym)]);
      return [sym, {
        vol12mPct: hist.vol12mPct,
        mdd12mPct: hist.mdd12mPct,
        beta: f.beta,
        debtToEquity: f.debtToEquity,
        interestCoverage: f.interestCoverage,
        trailingPE: f.trailingPE,
        ps: f.ps,
        peg: f.peg,
        fcfYieldPct: f.fcfYieldPct,
        avgDollarVol: f.avgDollarVol,
        shortPctFloat: f.shortPctFloat,
        shortRatio: f.shortRatio,
        daysToEarnings: f.daysToEarnings,
      }] as const;
    })
  )
);

    // 6) Build final rows (prefer Yahoo-daily computations; fallback to monthly)
    // 6) Build final rows
const final = enriched.map(h => {
  const pts = (historyMap[h.ticker] as { date: string; close: number }[]) || [];

  // Fallback computations (monthly) if missing
  let fallbackVol12m: number | null = null;
  let fallbackBeta12m: number | null = null;
  if (pts.length >= 6) {
    const sIdx = pts.map(p => p.close);
    const base = sIdx[0] || 100;
    const norm = sIdx.map(v => (v / base) * 100);

    fallbackVol12m = Number((annualizedVolatilityFromIndex(norm) * 100).toFixed(1));

    if (benchNorm.length === norm.length && benchNorm.length >= 6) {
      fallbackBeta12m = Number(estimateBeta(norm, benchNorm).toFixed(2));
    }
  }

  // --- FETCHED inputs (daily Yahoo + fundamentals) ---
  const inputs = riskInputsBySymbol[h.ticker];

  // --- FIX: define these before returning the object ---
  const volatility12m: number | null =
    (inputs?.vol12mPct != null ? inputs.vol12mPct : null) ?? fallbackVol12m;

  const beta12m: number | null =
    (typeof inputs?.beta === "number" ? Number(inputs.beta.toFixed(2)) : null) ??
    (typeof fallbackBeta12m === "number" ? fallbackBeta12m : null);

  // Compute risk score with position size (weightPct)
  const { riskScore, bucket, components } = computeRiskScore({
    ...inputs,
    weightPct: h.weightPct,
  });

  return {
    id: h.id,
    ticker: h.ticker,
    sector: h.sector,
    price: Number(h.price.toFixed(2)),
    weightPct: Number(h.weightPct.toFixed(2)),
    shares: Number(h.shares.toFixed(4)),
    hasCostBasis: h.hasCostBasis,
    returnSincePurchase: h.returnSincePurchase != null ? Number(h.returnSincePurchase.toFixed(2)) : null,
    contributionPct: h.contributionPct != null ? Number(h.contributionPct.toFixed(2)) : null,

    // now defined identifiers:
    volatility12m,
    beta12m,

    riskScore,
    riskBucket: bucket,
    riskComponents: components,
  };
});


    const avgBetaWeighted = (() => {
      const valid = final.filter(f => typeof f.beta12m === "number");
      const sum = valid.reduce((s, x) => s + (x.beta12m as number) * (x.weightPct / 100), 0);
      return Number(sum.toFixed(2));
    })();

    return NextResponse.json({
      holdings: final.sort((a, b) => b.weightPct - a.weightPct),
      meta: {
        benchmark,
        anyCostBasis,
        totalValue: portfolioTotalValue,
        avgBetaWeighted,
        riskModel: "v1.0", // optional version tag
      },
    });
  } catch (err) {
    console.error("Error fetching holdings data:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


