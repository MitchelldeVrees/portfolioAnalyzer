// /app/api/portfolio/[id]/holdings/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchQuotesBatch, fetchHistoryMonthlyClose } from "@/lib/market-data";
import yahooFinance from "yahoo-finance2";
import { ensureSectors, sectorForTicker, seedSectorFromQuote } from "@/lib/sector-classifier";

type Holding = {
  id: string;
  ticker: string;
  weight: number;
  shares?: number;
  purchase_price?: number | null;
};

type HoldingsSnapshotPayload = {
  holdings: Array<{
    id: string;
    ticker: string;
    sector: string;
    price: number;
    weightPct: number;
    shares: number;
    hasCostBasis: boolean;
    returnSincePurchase: number | null;
    contributionPct: number | null;
    volatility12m: number | null;
    beta12m: number | null;
    riskScore?: number | null;
    riskBucket?: string | null;
    riskComponents?: Array<{
      key: string;
      label: string;
      score: number;
      weight: number;
      value: number | null;
    }>;
  }>;
  meta: {
    benchmark: string;
    anyCostBasis: boolean;
    totalValue: number;
    avgBetaWeighted: number;
    riskModel: string;
    refreshedAt: string;
  };
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

  const score =
      0.20 * sVol  + 0.10 * sMDD + 0.05 * sBeta +
      0.15 * sD2E  + 0.10 * sICov +
      0.06 * sPE   + 0.05 * sPEG + 0.04 * sFCFY +
      0.10 * sADV  +
      0.10 * sShort+
      0.05 * sEvt;

  const riskScore = Math.round(score);
  const bucket = riskScore < 33 ? "Low" : riskScore < 66 ? "Medium" : "High";

  const components = [
    { key: "vol",   label: "Volatility (12m)",        score: sVol,   weight: 0.20, value: x.vol12mPct },
    { key: "mdd",   label: "Max Drawdown (12m)",      score: sMDD,   weight: 0.10, value: x.mdd12mPct },
    { key: "beta",  label: "Beta",                    score: sBeta,  weight: 0.05, value: x.beta },
    { key: "d2e",   label: "Debt/Equity",             score: sD2E,   weight: 0.15, value: x.debtToEquity },
    { key: "icov",  label: "Interest Coverage",       score: sICov,  weight: 0.10, value: x.interestCoverage },
    { key: "pe",    label: "P/E (or P/S)",            score: sPE,    weight: 0.06, value: x.trailingPE ?? x.ps },
    { key: "peg",   label: "PEG",                     score: sPEG,   weight: 0.05, value: x.peg },
    { key: "fcfy",  label: "FCF Yield %",             score: sFCFY,  weight: 0.04, value: x.fcfYieldPct },
    { key: "adv",   label: "Avg $ Volume (10d)",      score: sADV,   weight: 0.10, value: x.avgDollarVol },
    { key: "short", label: "Short Interest",          score: sShort, weight: 0.10, value: x.shortPctFloat ?? x.shortRatio },
    { key: "evt",   label: "Earnings Proximity",      score: sEvt,   weight: 0.05, value: x.daysToEarnings },
  ];

  return { riskScore, bucket, components };
}

// ------------ route handler ------------

const SNAPSHOT_TABLE = "portfolio_holdings_snapshots";

async function loadPortfolioWithHoldings(supabase: any, portfolioId: string, userId: string) {
  const { data, error } = await supabase
    .from("portfolios")
    .select(`*, portfolio_holdings (*)`)
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data;
}

async function loadCachedSnapshot(
  supabase: any,
  portfolioId: string,
  benchmark: string,
): Promise<HoldingsSnapshotPayload | null> {
  const { data, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select("payload")
    .eq("portfolio_id", portfolioId)
    .eq("benchmark", benchmark)
    .maybeSingle();

  if (error) {
    console.warn(`loadCachedSnapshot error for ${portfolioId}/${benchmark}:`, error.message);
    return null;
  }

  return (data?.payload as HoldingsSnapshotPayload) ?? null;
}

async function persistHoldingsSnapshot(
  supabase: any,
  portfolioId: string,
  benchmark: string,
  payload: HoldingsSnapshotPayload,
  userId: string,
) {
  const storedAt = new Date().toISOString();
  const refreshedAt = payload?.meta?.refreshedAt ?? storedAt;

  const { error } = await supabase
    .from(SNAPSHOT_TABLE)
    .upsert(
      {
        portfolio_id: portfolioId,
        benchmark,
        payload,
        refreshed_at: refreshedAt,
        refreshed_by: userId,
        updated_at: storedAt,
      },
      { onConflict: "portfolio_id,benchmark" },
    );

  if (error) {
    throw error;
  }
}

async function computeHoldingsSnapshot(
  holdings: Holding[],
  benchmark: string,
): Promise<HoldingsSnapshotPayload> {
  const sanitized = Array.isArray(holdings) ? holdings : [];
  const normalizedBenchmark = benchmark || DEFAULT_BENCH;
  const refreshedAt = new Date().toISOString();

  if (!sanitized.length) {
    return {
      holdings: [],
      meta: {
        benchmark: normalizedBenchmark,
        anyCostBasis: false,
        totalValue: 0,
        avgBetaWeighted: 0,
        riskModel: "v1.0",
        refreshedAt,
      },
    };
  }

  const symbols = sanitized.map((h) => h.ticker);
  const quotesMap = (await fetchQuotesBatch(symbols)) || {};

  for (const [symbol, quote] of Object.entries(quotesMap)) {
    if (!quote) continue;
    if (quote.sector || quote.industry || quote.quoteType || quote.longName || quote.shortName) {
      seedSectorFromQuote(symbol, {
        sector: quote.sector,
        industry: quote.industry,
        quoteType: quote.quoteType,
        longName: quote.longName,
        shortName: quote.shortName,
      });
    }
  }

  try {
    await ensureSectors(symbols);
  } catch (error) {
    console.warn("[holdings] sector preload failed", (error as Error)?.message ?? error);
  }

  const temp = sanitized.map((h) => {
    const quote = quotesMap[h.ticker] || { price: 100 };
    const price = typeof quote.price === "number" && Number.isFinite(quote.price) ? quote.price : 100;
    const sharesRaw =
      typeof h.shares === "number" && Number.isFinite(h.shares)
        ? h.shares
        : ((h.weight || 0) * 10000) / price;
    const shares = Number.isFinite(sharesRaw) ? sharesRaw : 0;
    const totalValue = price * shares;
    const hasCostBasis = typeof h.purchase_price === "number" && Number.isFinite(h.purchase_price);
    const returnSincePurchase =
      hasCostBasis && h.purchase_price
        ? ((price - h.purchase_price) / h.purchase_price) * 100
        : null;

    return {
      ...h,
      price,
      shares,
      totalValue,
      hasCostBasis,
      returnSincePurchase,
      sector: sectorForTicker(h.ticker),
    };
  });

  const rawPortfolioValue = temp.reduce((sum, x) => sum + x.totalValue, 0);
  const denominator = rawPortfolioValue || 1;
  const withWeights = temp.map((x) => ({
    ...x,
    weightPct: (x.totalValue / denominator) * 100,
  }));

  const enriched = withWeights.map((x) => ({
    ...x,
    contributionPct:
      x.returnSincePurchase != null ? (x.returnSincePurchase * x.weightPct) / 100 : null,
  }));

  const anyCostBasis = enriched.some((x) => x.hasCostBasis);

  let benchHistory: { date: string; close: number }[] = [];
  try {
    benchHistory = await fetchHistoryMonthlyClose(normalizedBenchmark, 12);
  } catch {
    benchHistory = [];
  }

  const benchIndex = benchHistory.map((p) => p.close);
  const benchBase = benchIndex[0] || 100;
  const benchNorm = benchIndex.map((v) => (v / benchBase) * 100);

  const historyEntries = await Promise.all(
    symbols.map(async (sym) => {
      try {
        const pts = await fetchHistoryMonthlyClose(sym, 12);
        return [sym, pts] as const;
      } catch {
        return [sym, []] as const;
      }
    }),
  );
  const historyMap = Object.fromEntries(historyEntries);

  const riskInputsEntries = await Promise.all(
    symbols.map(async (sym) => {
      const [hist, fundamentals] = await Promise.all([fetchHistRisk(sym), fetchFundamentals(sym)]);
      return [
        sym,
        {
          vol12mPct: hist.vol12mPct,
          mdd12mPct: hist.mdd12mPct,
          beta: fundamentals.beta,
          debtToEquity: fundamentals.debtToEquity,
          interestCoverage: fundamentals.interestCoverage,
          trailingPE: fundamentals.trailingPE,
          ps: fundamentals.ps,
          peg: fundamentals.peg,
          fcfYieldPct: fundamentals.fcfYieldPct,
          avgDollarVol: fundamentals.avgDollarVol,
          shortPctFloat: fundamentals.shortPctFloat,
          shortRatio: fundamentals.shortRatio,
          daysToEarnings: fundamentals.daysToEarnings,
        },
      ] as const;
    }),
  );
  const riskInputsBySymbol = Object.fromEntries(riskInputsEntries);

  const final = enriched.map((h) => {
    const pts = (historyMap[h.ticker] as { date: string; close: number }[]) || [];

    let fallbackVol12m: number | null = null;
    let fallbackBeta12m: number | null = null;
    if (pts.length >= 6) {
      const sIdx = pts.map((p) => p.close);
      const base = sIdx[0] || 100;
      const norm = sIdx.map((v) => (v / base) * 100);

      fallbackVol12m = Number((annualizedVolatilityFromIndex(norm) * 100).toFixed(1));

      if (benchNorm.length === norm.length && benchNorm.length >= 6) {
        fallbackBeta12m = Number(estimateBeta(norm, benchNorm).toFixed(2));
      }
    }

    const inputs = riskInputsBySymbol[h.ticker];

    const volatility12m =
      (inputs?.vol12mPct != null ? inputs.vol12mPct : null) ?? fallbackVol12m;

    const beta12m =
      (typeof inputs?.beta === "number" ? Number(inputs.beta.toFixed(2)) : null) ??
      (typeof fallbackBeta12m === "number" ? fallbackBeta12m : null);

    const { riskScore, bucket, components } = computeRiskScore({
      ...inputs,
    });

    return {
      id: h.id,
      ticker: h.ticker,
      sector: h.sector,
      price: Number(h.price.toFixed(2)),
      weightPct: Number(h.weightPct.toFixed(2)),
      shares: Number(h.shares.toFixed(4)),
      hasCostBasis: h.hasCostBasis,
      returnSincePurchase:
        h.returnSincePurchase != null ? Number(h.returnSincePurchase.toFixed(2)) : null,
      contributionPct:
        h.contributionPct != null ? Number(h.contributionPct.toFixed(2)) : null,
      volatility12m,
      beta12m,
      riskScore,
      riskBucket: bucket,
      riskComponents: components,
    };
  });

  const avgBetaWeighted = (() => {
    const valid = final.filter((f) => typeof f.beta12m === "number");
    const sum = valid.reduce((s, x) => s + (x.beta12m as number) * (x.weightPct / 100), 0);
    return Number(sum.toFixed(2));
  })();

  return {
    holdings: final.sort((a, b) => b.weightPct - a.weightPct),
    meta: {
      benchmark: normalizedBenchmark,
      anyCostBasis,
      totalValue: Number(rawPortfolioValue.toFixed(2)),
      avgBetaWeighted,
      riskModel: "v1.0",
      refreshedAt,
    },
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const benchmark = url.searchParams.get("benchmark") || DEFAULT_BENCH;
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    const portfolio = await loadPortfolioWithHoldings(supabase, params.id, auth.user.id);
    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    if (!forceRefresh) {
      const cached = await loadCachedSnapshot(supabase, params.id, benchmark);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    const snapshot = await computeHoldingsSnapshot(portfolio.portfolio_holdings || [], benchmark);

    try {
      await persistHoldingsSnapshot(supabase, params.id, benchmark, snapshot, auth.user.id);
    } catch (persistError) {
      console.error("Failed to persist holdings snapshot:", persistError);
    }

    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("Error fetching holdings data:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: any = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const url = new URL(request.url);
    const queryBenchmark = url.searchParams.get("benchmark");
    const bodyBenchmark = typeof body?.benchmark === "string" ? body.benchmark.trim() : "";
    const benchmark = bodyBenchmark || queryBenchmark || DEFAULT_BENCH;

    const portfolio = await loadPortfolioWithHoldings(supabase, params.id, auth.user.id);
    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const snapshot = await computeHoldingsSnapshot(portfolio.portfolio_holdings || [], benchmark);
    await persistHoldingsSnapshot(supabase, params.id, benchmark, snapshot, auth.user.id);

    return NextResponse.json({ status: "ok", snapshot });
  } catch (err) {
    console.error("Error refreshing holdings data:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
