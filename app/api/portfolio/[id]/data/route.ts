import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchQuotesBatch, fetchHistoryMonthlyClose } from "@/lib/market-data";
import yahooFinance from "yahoo-finance2";
import { ensureSectors, sectorForTicker } from "@/lib/sector-classifier";

// --- types ---
type Holding = {
  id: string;
  ticker: string;
  weight: number;
  shares?: number;
  purchase_price?: number;
};

type PortfolioAnalysisSnapshot = {
  holdings: any[];
  performance: Array<{ date: string; portfolio: number; benchmark?: number }>;
  performanceMeta: { hasBenchmark: boolean; benchmark: string };
  sectors: Array<{ sector: string; allocation: number; target: number; color?: string }>;
  metrics: {
    historicalPortfolioReturn: number;
    benchmarkReturn: number | null;
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    beta: number;
    totalValue: number;
    portfolioBetaSpx: number | null;
    spxBeta: number;
    betaDiff: number | null;
  };
  risk: {
    concentration: Record<string, any>;
    diversification: Record<string, any>;
    beta: { level: string; value: number };
  };
  meta: {
    benchmark: string;
    refreshedAt: string;
  };
  dividends?: DividendInsights | null;
};

type DividendTimelinePoint = {
  key: string;
  label: string;
  amount: number;
};

type DividendEvent = {
  ticker: string;
  date: string;
  amountPerShare: number;
  shares: number;
  cashAmount: number;
  currency?: string | null;
};

type DividendInsights = {
  year: number;
  totalIncome: number;
  monthlyTotals: DividendTimelinePoint[];
  quarterlyTotals: DividendTimelinePoint[];
  events: DividendEvent[];
};

const DEFAULT_BENCH = "^GSPC"; // Yahoo supports ^GSPC, ^NDX, etc.
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"];
const MAX_DIVIDEND_TICKERS = 20;
const DIVIDEND_FETCH_CONCURRENCY = 3;

// ---------- utils & helpers ----------
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

// --------------------------------------
// Benchmark sector allocation helpers
// --------------------------------------
function resolveBenchmarkProxy(symbol: string): string {
  // Map Yahoo indices to liquid ETF proxies for sector weights
  const s = (symbol || "").toUpperCase();
  if (s === "^GSPC") return "SPY";  // S&P 500
  if (s === "^NDX") return "QQQ";   // Nasdaq 100
  return s; // URTH, VT, VEA, EEM are already ETFs
}

function standardizeSectorName(raw: string): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase();
  const map: Record<string, string> = {
    "technology": "Technology",
    "information technology": "Technology",
    "communication services": "Communication Services",
    "communications": "Communication Services",
    "telecommunication services": "Communication Services",
    "consumer discretionary": "Consumer Discretionary",
    "consumer cyclical": "Consumer Discretionary",
    "consumer staples": "Consumer Staples",
    "consumer defensive": "Consumer Staples",
    "health care": "Healthcare",
    "healthcare": "Healthcare",
    "financials": "Financial Services",
    "financial services": "Financial Services",
    "industrials": "Industrial",
    "industrial": "Industrial",
    "energy": "Energy",
    "materials": "Materials",
    "basic materials": "Materials",
    "real estate": "Real Estate",
    "reit": "Real Estate",
    "reits": "Real Estate",
    "utilities": "Utilities",
    "utility": "Utilities",
  };
  return map[s] || raw; // fall back to original casing
}

async function fetchBenchmarkSectorTargets(benchmark: string): Promise<Record<string, number> | null> {
  try {
    const proxy = resolveBenchmarkProxy(benchmark);
    const qs: any = await yahooFinance.quoteSummary(proxy, { modules: ["topHoldings", "fundProfile"] });

    // Collect pairs of { sector, weightPct }
    const pairs: Array<{ sector: string; weight: number }> = [];

    // --- Helper: normalize weird/camel keys from Yahoo into standard sector names
    const keyToSector = (rawKey: string): string => {
      if (!rawKey) return "Other";
      const k = rawKey.replace(/[^a-zA-Z]/g, "").toLowerCase(); // e.g. "financialServices" -> "financialservices"
      const map: Record<string, string> = {
        technology: "Technology",
        informationtechnology: "Technology",

        healthcare: "Healthcare",
        healthcaresector: "Healthcare",
        healthcareequipmentservices: "Healthcare",

        financials: "Financial Services",
        financial: "Financial Services",
        financialservices: "Financial Services",

        industrials: "Industrial",
        industrial: "Industrial",

        consumerdiscretionary: "Consumer Discretionary",
        consumercyclical: "Consumer Discretionary",

        consumerstaples: "Consumer Staples",
        consumerdefensive: "Consumer Staples",

        communicationservices: "Communication Services",
        communications: "Communication Services",
        telecommunicationservices: "Communication Services",

        energy: "Energy",

        materials: "Materials",
        basicmaterials: "Materials",

        realestate: "Real Estate",
        reit: "Real Estate",
        reits: "Real Estate",

        utilities: "Utilities",
        utility: "Utilities",
      };
      return map[k] ?? standardizeSectorName(rawKey);
    };

    // ---- 1) Preferred: topHoldings.sectorWeightings
    const arr = qs?.topHoldings?.sectorWeightings;
    if (Array.isArray(arr) && arr.length) {
      for (const entry of arr) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

        // Case A: { sector: "Technology", weight: 0.28 }
        if (("sector" in entry) && ("weight" in entry || "pct" in entry)) {
          const name = standardizeSectorName(String((entry as any).sector || (entry as any).name || "Other"));
          const wRaw = Number((entry as any).weight ?? (entry as any).pct ?? 0);
          const pct = wRaw <= 1 ? wRaw * 100 : wRaw;
          if (pct > 0) pairs.push({ sector: name, weight: pct });
          continue;
        }

        // Case B (Yahoo common): { technology: 0.28 }  // single key/value
        const kv = Object.entries(entry);
        if (kv.length === 1) {
          const [rawKey, rawVal] = kv[0];
          const name = keyToSector(rawKey);
          const wRaw = Number(rawVal ?? 0);
          const pct = wRaw <= 1 ? wRaw * 100 : wRaw;
          if (pct >= 0) pairs.push({ sector: name, weight: pct });
        }
      }
    }

    // ---- 2) Secondary: fundProfile.sectorWeightings (rare)
    if (!pairs.length && Array.isArray(qs?.fundProfile?.sectorWeightings)) {
      for (const sw of qs.fundProfile.sectorWeightings) {
        if (!sw) continue;
        const name = standardizeSectorName(String(sw?.sector || sw?.name || "Other"));
        const wRaw = Number(sw?.weight ?? sw?.pct ?? 0);
        const pct = wRaw <= 1 ? wRaw * 100 : wRaw;
        if (pct >= 0) pairs.push({ sector: name, weight: pct });
      }
    }

    if (!pairs.length) return null;

    // Aggregate + normalize to ~100
    const out: Record<string, number> = {};
    for (const p of pairs) {
      const k = p.sector || "Other";
      out[k] = (out[k] || 0) + p.weight;
    }

    const sum = Object.values(out).reduce((s, x) => s + x, 0);
    const denom = sum > 0 ? sum : 100;
    for (const k of Object.keys(out)) {
      out[k] = Number(((out[k] / denom) * 100).toFixed(1));
    }

    return out;
  } catch (e) {
    console.warn("[benchmark sectors] failed:", (e as Error)?.message || e);
    return null;
  }
}

// Fallback static targets (very coarse) if Yahoo fails
function fallbackTargets(): Record<string, number> {
  return {
    Technology: 25,
    Healthcare: 13,
    "Financial Services": 12,
    Industrial: 10,
    "Communication Services": 9,
    "Consumer Discretionary": 10,
    "Consumer Staples": 7,
    Energy: 5,
    Materials: 3,
    Utilities: 3,
    "Real Estate": 3,
    Other: 0,
  };
}

function getSectorColor(sector: string): string {
  const s = (sector || "").trim().toLowerCase();
  if (!s) return "#6b7280";
  const PALETTE = [
    "#2563eb", "#0284c7", "#ea580c", "#16a34a", "#059669", "#d97706",
    "#7c3aed", "#dc2626", "#9333ea", "#0f766e", "#3f6212", "#1f2937",
  ];
  const MAP: Record<string, string> = {
    "information technology": "#2563eb",
    "technology": "#2563eb",
    "communication services": "#0284c7",
    "communications": "#0284c7",
    "telecommunication services": "#0284c7",
    "consumer discretionary": "#ea580c",
    "consumer cyclical": "#ea580c",
    "consumer staples": "#16a34a",
    "consumer defensive": "#16a34a",
    "health care": "#059669",
    "healthcare": "#059669",
    "financials": "#d97706",
    "financial services": "#d97706",
    "financial": "#d97706",
    "industrials": "#7c3aed",
    "industrial": "#7c3aed",
    "energy": "#dc2626",
    "materials": "#9333ea",
    "basic materials": "#9333ea",
    "real estate": "#be123c",
    "reit": "#be123c",
    "reits": "#be123c",
    "utilities": "#0f766e",
    "utility": "#0f766e",
    "etf": "#334155",
    "fund": "#334155",
    "index fund": "#334155",
    "fixed income": "#0ea5e9",
    "government bonds": "#1d4ed8",
    "municipal bonds": "#14b8a6",
    "corporate bonds": "#0d9488",
    "mortgage-backed securities": "#0891b2",
    "commodities": "#b45309",
    "infrastructure": "#475569",
    "emerging markets": "#f97316",
    "cash & cash equivalents": "#10b981",
    "currency": "#2563eb",
    "digital assets": "#a855f7",
    "index": "#334155",
    "mutual fund": "#334155",
    "other": "#6b7280",
  };
  for (const [k, color] of Object.entries(MAP)) {
    if (s === k || s.includes(k)) return color;
  }
  if (s === "other") return "#6b7280";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ---------- math helpers ----------
function pctReturns(series: number[]): number[] { const out: number[] = []; for (let i = 1; i < series.length; i++) out.push(series[i] / series[i - 1] - 1); return out; }
function mean(arr: number[]) { return arr.reduce((s, x) => s + x, 0) / (arr.length || 1); }
function annualizedVolatility(series: number[]): number { const rets = pctReturns(series); const avg = mean(rets); const variance = mean(rets.map((r) => Math.pow(r - avg, 2))); return Math.sqrt(variance) * Math.sqrt(12); }
function maxDrawdown(series: number[]): number { let peak = series[0]; let mdd = 0; for (const v of series) { if (v > peak) peak = v; const dd = (v - peak) / peak; if (dd < mdd) mdd = dd; } return Math.abs(mdd); }
function estimateBeta(portfolio: number[], benchmark: number[]): number { const rp = pctReturns(portfolio); const rb = pctReturns(benchmark); const n = Math.min(rp.length, rb.length); const p = rp.slice(-n), b = rb.slice(-n); const meanP = mean(p), meanB = mean(b); const cov = mean(p.map((x, i) => (x - meanP) * (b[i] - meanB))); const varB = mean(b.map((x) => Math.pow(x - meanB, 2))); return varB === 0 ? 1 : cov / varB; }

// ---------- risk helpers ----------
function hhi(weights: number[]) { return weights.reduce((s, w) => s + w * w, 0); }
function effectiveHoldings(weights: number[]) { const _hhi = hhi(weights); return _hhi > 0 ? 1 / _hhi : 0; }
function computeConcentration(weights: number[]) { const pct = weights.map((w) => w * 100); const largest = Math.max(...pct); const sorted = pct.slice().sort((a, b) => b - a); const top2 = (sorted[0] || 0) + (sorted[1] || 0); const _hhi = hhi(weights); const level = largest >= 20 || top2 >= 40 || _hhi >= 0.18 ? "High" : largest >= 12 || top2 >= 25 || _hhi >= 0.10 ? "Medium" : "Low"; return { level, largestPositionPct: Number(largest.toFixed(1)), top2Pct: Number(top2.toFixed(1)), hhi: Number(_hhi.toFixed(3)), effectiveHoldings: Number(effectiveHoldings(weights).toFixed(1)), }; }
function computeDiversification(weights: number[], tickers: string[]) {
  const sectorAgg: Record<string, number> = {};
  tickers.forEach((t, i) => {
    const s = sectorForTicker(t);
    sectorAgg[s] = (sectorAgg[s] || 0) + weights[i];
  });
  const sectorWeights = Object.values(sectorAgg);
  const sectorHHI = hhi(sectorWeights);
  const sorted = weights.slice().sort((a, b) => b - a);
  const top2 = (sorted[0] || 0) + (sorted[1] || 0);
  const Neff = effectiveHoldings(weights);
  const breadthScore = clamp((Neff - 5) / (15 - 5), 0, 1);
  const sectorEven = clamp((0.25 - sectorHHI) / (0.25 - 0.10), 0, 1);
  const top2Score = clamp((0.40 - top2) / (0.40 - 0.20), 0, 1);
  const score = 10 * (0.5 * breadthScore + 0.3 * sectorEven + 0.2 * top2Score);
  return {
    score: Number(score.toFixed(1)),
    holdings: tickers.length,
    top2Pct: Number((top2 * 100).toFixed(1)),
    sectorHHI: Number(sectorHHI.toFixed(3)),
    effectiveHoldings: Number(Neff.toFixed(1)),
  };
}

// ---------- Yahoo helpers ----------
async function fetchYahooBeta(symbol: string): Promise<number | null> { try { const qs: any = await yahooFinance.quoteSummary(symbol, { modules: ["defaultKeyStatistics"] }); const b = qs?.defaultKeyStatistics?.beta; if (typeof b === "number") return b; if (b && typeof b?.raw === "number") return b.raw; return null; } catch { return null; } }
async function computePortfolioBetaSpx(symbols: string[], weights: number[]) { const betas = await Promise.all(symbols.map(fetchYahooBeta)); let bsum = 0, wsum = 0; for (let i = 0; i < symbols.length; i++) { const b = betas[i]; const w = weights[i]; if (typeof b === "number" && Number.isFinite(w)) { bsum += b * w; wsum += w; } } return wsum > 0 ? bsum / wsum : null; }

// ---------- route ----------
const ANALYSIS_SNAPSHOT_TABLE = "portfolio_analysis_snapshots";

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

async function loadCachedAnalysisSnapshot(
  supabase: any,
  portfolioId: string,
  benchmark: string,
): Promise<PortfolioAnalysisSnapshot | null> {
  const { data, error } = await supabase
    .from(ANALYSIS_SNAPSHOT_TABLE)
    .select("payload")
    .eq("portfolio_id", portfolioId)
    .eq("benchmark", benchmark)
    .maybeSingle();

  if (error) {
    console.warn(`loadCachedAnalysisSnapshot error for ${portfolioId}/${benchmark}:`, error.message);
    return null;
  }

  const payload = data?.payload as PortfolioAnalysisSnapshot | undefined;
  return payload ?? null;
}

async function persistAnalysisSnapshot(
  supabase: any,
  portfolioId: string,
  benchmark: string,
  payload: PortfolioAnalysisSnapshot,
  userId: string,
) {
  const storedAt = new Date().toISOString();
  const refreshedAt = payload?.meta?.refreshedAt ?? storedAt;

  const { error } = await supabase
    .from(ANALYSIS_SNAPSHOT_TABLE)
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

function parseYahooDate(input: any): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === "number") {
    if (input > 1e12) return new Date(input);
    if (input > 1e9) return new Date(input * 1000);
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (typeof input?.raw === "number") {
    const raw = input.raw;
    return raw > 1e12 ? new Date(raw) : new Date(raw * 1000);
  }
  return null;
}

async function fetchDividendHistory(ticker: string) {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 2);

    const rows = await yahooFinance.historical(
      ticker,
      {
        period1: start,
        period2: end,
        events: "dividends",
      } as any,
    );

    const entries = Array.isArray(rows) ? rows : [];

    return entries
      .map((row: any) => {
        const date = parseYahooDate(row?.date);
        const rawAmount = row?.dividends ?? row?.amount ?? row?.adjclose ?? null;
        const amount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount ?? NaN);
        if (!date || !Number.isFinite(amount) || amount <= 0) return null;
        return {
          date,
          amount: Number(amount),
          currency: row?.currency ?? null,
        };
      })
      .filter(Boolean) as Array<{ date: Date; amount: number; currency?: string | null }>;
  } catch (error) {
    console.warn(`[dividends] failed to fetch history for ${ticker}:`, (error as Error)?.message ?? error);
    return [];
  }
}

async function fetchDividendEventsForTickers(tickers: string[]) {
  const queue = Array.from(new Set(tickers));
  if (!queue.length) return {} as Record<string, Array<{ date: Date; amount: number; currency?: string | null }>>;

  const results: Record<string, Array<{ date: Date; amount: number; currency?: string | null }>> = {};
  const workers = Array.from({ length: Math.min(DIVIDEND_FETCH_CONCURRENCY, queue.length) }).map(async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      results[next] = await fetchDividendHistory(next);
    }
  });

  await Promise.all(workers);
  return results;
}

function buildMonthlyBuckets(events: DividendEvent[], year: number): DividendTimelinePoint[] {
  return Array.from({ length: 12 }, (_, idx) => {
    const key = `${year}-${String(idx + 1).padStart(2, "0")}`;
    const label = MONTH_LABELS[idx];
    const amount = events
      .filter((event) => {
        const date = new Date(event.date);
        return date.getFullYear() === year && date.getMonth() === idx;
      })
      .reduce((sum, event) => sum + event.cashAmount, 0);
    return { key, label, amount: Number(amount.toFixed(2)) };
  });
}

function buildQuarterBuckets(monthly: DividendTimelinePoint[], year: number): DividendTimelinePoint[] {
  return QUARTER_LABELS.map((label, index) => {
    const slice = monthly.slice(index * 3, index * 3 + 3);
    const amount = slice.reduce((sum, point) => sum + point.amount, 0);
    return { key: `${year}-${label}`, label, amount: Number(amount.toFixed(2)) };
  });
}

async function buildDividendInsights(holdingsData: Array<any>): Promise<DividendInsights | null> {
  const dividendCandidates = holdingsData
    .filter((holding) => Number(holding?.shares) > 0)
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, MAX_DIVIDEND_TICKERS);

  if (!dividendCandidates.length) {
    return null;
  }

  const tickers = dividendCandidates.map((holding) => holding.ticker);
  const eventsByTicker = await fetchDividendEventsForTickers(tickers);
  const currentYear = new Date().getFullYear();

  const events: DividendEvent[] = [];
  for (const holding of dividendCandidates) {
    const history = eventsByTicker[holding.ticker] ?? [];
    const rawShares = Number(holding.shares ?? 0);
    const shares = Number(rawShares.toFixed(4));
    for (const event of history) {
      if (event.date.getFullYear() !== currentYear) continue;
      const amountPerShare = Number(event.amount.toFixed(4));
      const cashAmount = Number((amountPerShare * shares).toFixed(2));
      if (cashAmount <= 0) continue;
      events.push({
        ticker: holding.ticker,
        date: event.date.toISOString(),
        amountPerShare,
        shares,
        cashAmount,
        currency: event.currency ?? null,
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const monthlyTotals = buildMonthlyBuckets(events, currentYear);
  const quarterlyTotals = buildQuarterBuckets(monthlyTotals, currentYear);
  const totalIncome = Number(events.reduce((sum, event) => sum + event.cashAmount, 0).toFixed(2));

  return {
    year: currentYear,
    totalIncome,
    monthlyTotals,
    quarterlyTotals,
    events,
  };
}

async function computeAnalysisSnapshot(portfolio: any, userBenchmark: string): Promise<PortfolioAnalysisSnapshot> {
  const holdings: Holding[] = Array.isArray(portfolio?.portfolio_holdings) ? portfolio.portfolio_holdings : [];
  const refreshedAt = new Date().toISOString();

  if (!holdings.length) {
    return {
      holdings: [],
      performance: [],
      performanceMeta: { hasBenchmark: false, benchmark: userBenchmark },
      sectors: [],
      metrics: {
        historicalPortfolioReturn: 0,
        benchmarkReturn: null,
        volatility: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdown: 0,
        beta: 0,
        totalValue: 0,
        portfolioBetaSpx: null,
        spxBeta: 1.0,
        betaDiff: null,
      },
      risk: {
        concentration: { level: "Low", largestPositionPct: 0, top2Pct: 0, hhi: 0, effectiveHoldings: 0 },
        diversification: { score: 0, holdings: 0, top2Pct: 0, sectorHHI: 0, effectiveHoldings: 0 },
        beta: { level: "Medium", value: 1.0 },
      },
      meta: {
        benchmark: userBenchmark,
        refreshedAt,
      },
    };
  }

  const symbols = holdings.map((h) => h.ticker);
  const quotesMap = await fetchQuotesBatch(symbols);
  try {
    await ensureSectors(symbols);
  } catch (error) {
    console.warn("[analysis] sector preload failed", (error as Error)?.message ?? error);
  }

  let riskFree = 0.05;
  try {
    const irxQuote = await yahooFinance.quote('^IRX');
    riskFree = (irxQuote.regularMarketPrice || 4.04) / 100;
  } catch (e) {
    console.warn('[risk-free] Failed to fetch ^IRX, using fallback 0.05:', (e as Error)?.message || e);
  }

  const holdingsData = holdings.map((h) => {
    const q = quotesMap[h.ticker] || { price: 100, change: 0, changePercent: 0 };
    const qty = h.shares ?? (h.weight * 10000) / q.price;
    const totalValue = q.price * qty;
    return { ...h, ...q, totalValue, shares: qty };
  });

  const dividendInsights = await buildDividendInsights(holdingsData);
  const totalValue = holdingsData.reduce((s, h) => s + h.totalValue, 0);
  const weights = holdingsData.map((h) => (totalValue > 0 ? h.totalValue / totalValue : 0));
  const dailyPortfolioReturn = holdingsData.reduce((sum, h) => sum + (h.changePercent * h.totalValue) / (totalValue || 1), 0);
  const benchTargets = (await fetchBenchmarkSectorTargets(userBenchmark)) ?? fallbackTargets();

  const sectorAgg: Record<string, number> = {};
  for (const h of holdingsData) {
    const sector = sectorForTicker(h.ticker);
    sectorAgg[sector] = (sectorAgg[sector] || 0) + (h.totalValue / (totalValue || 1)) * 100;
  }
  const sectors = Object.entries(sectorAgg).map(([sector, allocation]) => ({
    sector,
    allocation: Number(allocation.toFixed(1)),
    target: Number((benchTargets[sector] ?? 0).toFixed(1)),
    color: getSectorColor(sector),
  }));

  for (const [sector, tgt] of Object.entries(benchTargets)) {
    if (!sectors.find((s) => s.sector === sector)) {
      sectors.push({ sector, allocation: 0, target: Number(tgt.toFixed(1)), color: getSectorColor(sector) });
    }
  }

  const now = new Date();
  const monthsYTD = now.getMonth() + 1;

  let benchHistory: { date: string; close: number }[] = [];
  try {
    benchHistory = await fetchHistoryMonthlyClose(userBenchmark, monthsYTD);
  } catch (e) {
    benchHistory = [];
    console.warn(`[history] benchmark ${userBenchmark} failed:`, (e as Error)?.message || e);
  }

  const perTicker = await Promise.all(
    holdings.map(async (h) => {
      try {
        const pts = await fetchHistoryMonthlyClose(h.ticker, monthsYTD);
        return { ticker: h.ticker, points: pts, ok: true as const };
      } catch (e) {
        console.warn(`[history] ${h.ticker} failed:`, (e as Error)?.message || e);
        return { ticker: h.ticker, points: [], ok: false as const };
      }
    }),
  );

  const hasPortfolioHistory = perTicker.filter(x => x.ok && x.points.length > 1).length / holdings.length > 0.5;
  const showBenchmark = benchHistory.length > 1 && hasPortfolioHistory;

  let performance: { date: string; portfolio: number; benchmark?: number }[] = [];
  let vol = 0, beta = 0, mdd = 0, sharpe = 0, sortino = 0, benchRet: number | null = null;
  let historicalPortfolioReturn = 0;

  if (showBenchmark) {
    const byTicker = Object.fromEntries(perTicker.map((x) => [x.ticker, x.points]));
    const dates = benchHistory.map((p) => p.date);

    const portfolioRaw = dates
      .map((_, i) => {
        let acc = 0;
        let wsum = 0;
        for (let k = 0; k < holdingsData.length; k++) {
          const t = holdingsData[k].ticker;
          const series = byTicker[t];
          const point = series?.[i];
          if (!point) continue;
          acc += weights[k] * point.close;
          wsum += weights[k];
        }
        return wsum > 0 ? acc / wsum : NaN;
      })
      .filter((v) => Number.isFinite(v)) as number[];

    const benchmarkRaw = benchHistory.map((p) => p.close);

    if (portfolioRaw.length > 1 && benchmarkRaw.length > 1) {
      const baseP = portfolioRaw[0];
      const baseB = benchmarkRaw[0];

      const portfolioNorm = portfolioRaw.map((v) => (baseP !== 0 ? v / baseP : 0));
      const benchmarkNorm = benchmarkRaw.map((v) => (baseB !== 0 ? v / baseB : 0));

      performance = dates.map((date, i) => ({
        date,
        portfolio: Number((portfolioNorm[i] * 100).toFixed(2)),
        benchmark: Number((benchmarkNorm[i] * 100).toFixed(2)),
      }));

      vol = annualizedVolatility(portfolioNorm) * 100;
      beta = estimateBeta(portfolioNorm, benchmarkNorm);
      mdd = maxDrawdown(portfolioNorm) * 100;

      const monthlyReturns = pctReturns(portfolioNorm);
      const periods = monthlyReturns.length;
      const cumulativeReturn =
        portfolioNorm.length >= 2 && portfolioNorm[0] !== 0
          ? portfolioNorm[portfolioNorm.length - 1] / portfolioNorm[0] - 1
          : 0;
      const annualRet =
        periods > 0
          ? Math.pow(1 + cumulativeReturn, Math.max(12 / periods, 1)) - 1
          : 0;
      const volAnnual = vol / 100;
      sharpe = volAnnual > 0 ? (annualRet - riskFree) / volAnnual : 0;

      const targetMonthly = riskFree / 12;
      const downsideDiffs = monthlyReturns.map((r) => Math.min(0, r - targetMonthly));
      const negatives = downsideDiffs.filter((r) => r < 0);
      const downsideVar = negatives.length
        ? negatives.reduce((acc, r) => acc + r * r, 0) / negatives.length
        : 0;
      const downsideDevMonthly = Math.sqrt(downsideVar);
      const downsideDevAnnual = downsideDevMonthly * Math.sqrt(12);
      sortino = downsideDevAnnual > 1e-6 ? (annualRet - riskFree) / downsideDevAnnual : 0;

      const benchCum =
        benchmarkNorm.length >= 2 && benchmarkNorm[0] !== 0
          ? benchmarkNorm[benchmarkNorm.length - 1] / benchmarkNorm[0] - 1
          : 0;
      const portCum =
        portfolioNorm.length >= 2 && portfolioNorm[0] !== 0
          ? portfolioNorm[portfolioNorm.length - 1] / portfolioNorm[0] - 1
          : 0;

      benchRet = Number((benchCum * 100).toFixed(2));
      historicalPortfolioReturn = Number((portCum * 100).toFixed(2));
    } else {
      console.warn(`Insufficient history data for benchmark ${userBenchmark}`);
    }
  }

  const portfolioBetaSpxRaw = await computePortfolioBetaSpx(
    holdingsData.map((h) => h.ticker),
    weights,
  );
  const portfolioBetaSpx = typeof portfolioBetaSpxRaw === "number" ? Number(portfolioBetaSpxRaw.toFixed(2)) : null;
  const spxBeta = 1.0;
  const betaDiff = typeof portfolioBetaSpx === "number" ? Number((portfolioBetaSpx - spxBeta).toFixed(2)) : null;

  const concentration = computeConcentration(weights);
  const diversification = computeDiversification(weights, holdingsData.map((h) => h.ticker));

  const betaForRisk = showBenchmark ? beta : typeof portfolioBetaSpx === "number" ? portfolioBetaSpx : 1;
  const betaLevel = betaForRisk < 0.8 ? "Low" : betaForRisk <= 1.2 ? "Medium" : "High";

  return {
    holdings: holdingsData,
    performance,
    performanceMeta: { hasBenchmark: showBenchmark, benchmark: userBenchmark },
    sectors: sectors.sort((a, b) => b.allocation - a.allocation),
    metrics: {
      historicalPortfolioReturn,
      benchmarkReturn: benchRet,
      volatility: Number(vol.toFixed(1)),
      sharpeRatio: Number(sharpe.toFixed(2)),
      sortinoRatio: Number(sortino.toFixed(2)),
      maxDrawdown: Number(mdd.toFixed(1)),
      beta: Number(beta.toFixed(2)),
      totalValue,
      portfolioBetaSpx,
      spxBeta,
      betaDiff,
    },
    risk: {
      concentration,
      diversification,
      beta: { level: betaLevel, value: Number(betaForRisk.toFixed(2)) },
    },
    dividends: dividendInsights ?? null,
    meta: {
      benchmark: userBenchmark,
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
    const userBenchmark = url.searchParams.get("benchmark") || DEFAULT_BENCH;
    const forceRefresh = url.searchParams.get("forceRefresh") === "true";

    const portfolio = await loadPortfolioWithHoldings(supabase, params.id, auth.user.id);
    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    if (!forceRefresh) {
      const cached = await loadCachedAnalysisSnapshot(supabase, params.id, userBenchmark);
      if (cached) {
        return NextResponse.json(cached);
      }
    }

    const snapshot = await computeAnalysisSnapshot(portfolio, userBenchmark);

    try {
      await persistAnalysisSnapshot(supabase, params.id, userBenchmark, snapshot, auth.user.id);
    } catch (persistError) {
      console.error("Failed to persist analysis snapshot:", persistError);
    }

    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("Error fetching portfolio data:", err);
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

    const snapshot = await computeAnalysisSnapshot(portfolio, benchmark);
    await persistAnalysisSnapshot(supabase, params.id, benchmark, snapshot, auth.user.id);

    return NextResponse.json({ status: "ok", snapshot });
  } catch (err) {
    console.error("Error refreshing portfolio data:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

