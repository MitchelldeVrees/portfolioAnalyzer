import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchQuotesBatch, fetchHistoryMonthlyClose } from "@/lib/market-data";
import yahooFinance from "yahoo-finance2";

// --- types ---
type Holding = {
  id: string;
  ticker: string;
  weight: number;
  shares?: number;
  purchase_price?: number;
};

const DEFAULT_BENCH = "^GSPC"; // Yahoo supports ^GSPC, ^NDX, etc.

// ---------- utils & helpers ----------
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

// --------------------------------------
// Sector helpers
// --------------------------------------
function getSectorForTicker(ticker: string): string {
  const t = (ticker || "").toUpperCase().trim();
  if (!t) return "Other";
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

  const hit = _sectorCache.get(t);
  const now = Date.now();
  if (hit && (now - hit.ts) < SECTOR_TTL_MS && typeof hit.sector === "string") {
    return hit.sector;
  }
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

const SECTOR_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
type SectorEntry = { sector: string; ts: number; inflight: Promise<void> | null };
const _sectorCache: Map<string, SectorEntry> = new Map();

async function _fetchSectorFromYahoo(ticker: string): Promise<string | null> {
  try {
    const qs: any = await yahooFinance.quoteSummary(ticker, {
      modules: ["assetProfile", "summaryProfile", "price"],
    });
    const fromAsset = qs?.assetProfile?.sector;
    const fromSummary = qs?.summaryProfile?.sector;
    const quoteType = qs?.price?.quoteType || qs?.price?.quoteType?.raw;
    const isETF = (typeof quoteType === "string") && quoteType.toUpperCase() === "ETF";
    if (isETF) return "ETF";
    const sector = (typeof fromAsset === "string" && fromAsset) || (typeof fromSummary === "string" && fromSummary);
    return sector || null;
  } catch {
    return null;
  }
}

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
function computeDiversification(weights: number[], tickers: string[]) { const sectorAgg: Record<string, number> = {}; tickers.forEach((t, i) => { const s = getSectorForTicker(t); sectorAgg[s] = (sectorAgg[s] || 0) + weights[i]; }); const sectorWeights = Object.values(sectorAgg); const sectorHHI = hhi(sectorWeights); const sorted = weights.slice().sort((a, b) => b - a); const top2 = (sorted[0] || 0) + (sorted[1] || 0); const Neff = effectiveHoldings(weights); const breadthScore = clamp((Neff - 5) / (15 - 5), 0, 1); const sectorEven = clamp((0.25 - sectorHHI) / (0.25 - 0.10), 0, 1); const top2Score = clamp((0.40 - top2) / (0.40 - 0.20), 0, 1); const score = 10 * (0.5 * breadthScore + 0.3 * sectorEven + 0.2 * top2Score); return { score: Number(score.toFixed(1)), holdings: tickers.length, top2Pct: Number((top2 * 100).toFixed(1)), sectorHHI: Number(sectorHHI.toFixed(3)), effectiveHoldings: Number(Neff.toFixed(1)), }; }

// ---------- Yahoo helpers ----------
async function fetchYahooBeta(symbol: string): Promise<number | null> { try { const qs: any = await yahooFinance.quoteSummary(symbol, { modules: ["defaultKeyStatistics"] }); const b = qs?.defaultKeyStatistics?.beta; if (typeof b === "number") return b; if (b && typeof b?.raw === "number") return b.raw; return null; } catch { return null; } }
async function computePortfolioBetaSpx(symbols: string[], weights: number[]) { const betas = await Promise.all(symbols.map(fetchYahooBeta)); let bsum = 0, wsum = 0; for (let i = 0; i < symbols.length; i++) { const b = betas[i]; const w = weights[i]; if (typeof b === "number" && Number.isFinite(w)) { bsum += b * w; wsum += w; } } return wsum > 0 ? bsum / wsum : null; }

// ---------- route ----------
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient();

    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const userBenchmark = url.searchParams.get("benchmark") || DEFAULT_BENCH;

    // 1) Load portfolio
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
        performance: [],
        performanceMeta: { hasBenchmark: false, benchmark: userBenchmark },
        sectors: [],
        metrics: {
          // Removed portfolioReturn; added sortinoRatio with default 0
          historicalPortfolioReturn: 0,
          benchmarkReturn: null,
          volatility: 0,
          sharpeRatio: 0,
          sortinoRatio: 0, // NEW
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
      });
    }

    // 2) Quotes in ONE call
    const symbols = holdings.map((h) => h.ticker);
    const quotesMap = await fetchQuotesBatch(symbols);
    await warmSectorCache(symbols); // async, don't await

    // NEW: Fetch dynamic risk-free rate from Yahoo (^IRX for 13-week T-Bill)
    let riskFree = 0.05; // Fallback
    try {
      const irxQuote = await yahooFinance.quote('^IRX');
      riskFree = (irxQuote.regularMarketPrice || 4.04) / 100; // Divide by 100 to get decimal rate
    } catch (e) {
      console.warn('[risk-free] Failed to fetch ^IRX, using fallback 0.05:', (e as Error)?.message || e);
    }

    // 3) Build holdingsData
    const holdingsData = holdings.map((h) => {
      const q = quotesMap[h.ticker] || { price: 100, change: 0, changePercent: 0 };
      const qty = h.shares ?? (h.weight * 10000) / q.price; // like your old logic
      const totalValue = q.price * qty;
      return { ...h, ...q, totalValue, shares: qty };
    });

    const totalValue = holdingsData.reduce((s, h) => s + h.totalValue, 0);
    const weights = holdingsData.map((h) => (totalValue > 0 ? h.totalValue / totalValue : 0));
    const dailyPortfolioReturn = holdingsData.reduce((sum, h) => sum + (h.changePercent * h.totalValue) / (totalValue || 1), 0); // Kept for potential use, but not in metrics

    // 3b) Fetch benchmark sector targets once per request
    const benchTargets = (await fetchBenchmarkSectorTargets(userBenchmark)) ?? fallbackTargets();

    // 4) Sector allocation (portfolio vs benchmark targets)
    const sectorAgg: Record<string, number> = {};
    for (const h of holdingsData) {
      const sector = getSectorForTicker(h.ticker);
      sectorAgg[sector] = (sectorAgg[sector] || 0) + (h.totalValue / (totalValue || 1)) * 100;
    }
    const sectors = Object.entries(sectorAgg).map(([sector, allocation]) => ({
      sector,
      allocation: Number(allocation.toFixed(1)),
      target: Number((benchTargets[sector] ?? 0).toFixed(1)),
      color: getSectorColor(sector),
    }));

    // Ensure benchmark sectors that user has 0% in still show (nice for charts)
    for (const [sector, tgt] of Object.entries(benchTargets)) {
      if (!sectors.find((s) => s.sector === sector)) {
        sectors.push({ sector, allocation: 0, target: Number(tgt.toFixed(1)), color: getSectorColor(sector) });
      }
    }

    // UPDATED: Use YTD months
    const now = new Date();
    const monthsYTD = now.getMonth() + 1; // Jan = 1, Sep = 9

    // 5) History for performance
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

    // Check if sufficient history available (no purchase_price required)
    const hasPortfolioHistory = perTicker.filter(x => x.ok && x.points.length > 1).length / holdings.length > 0.5; // >50% holdings have data, and at least 2 points
    const showBenchmark = benchHistory.length > 1 && hasPortfolioHistory;

    let performance: { date: string; portfolio: number; benchmark?: number }[] = [];
    let vol = 0, beta = 0, mdd = 0, sharpe = 0, sortino = 0, benchRet: number | null = null; // Added sortino
    let historicalPortfolioReturn: number = 0;

    if (showBenchmark) {
      const byTicker = Object.fromEntries(perTicker.map((x) => [x.ticker, x.points]));
      const dates = benchHistory.map((p) => p.date);

      const portfolioRaw = dates.map((_, i) => {
        let acc = 0, wsum = 0;
        for (let k = 0; k < holdingsData.length; k++) {
          const t = holdingsData[k].ticker;
          const series = byTicker[t];
          const point = series?.[i];
          if (!point) continue;
          acc += weights[k] * point.close;
          wsum += weights[k];
        }
        return wsum > 0 ? acc / wsum : NaN;
      }).filter((v) => Number.isFinite(v)) as number[];

      const benchmarkRaw = benchHistory.map((p) => p.close);

      if (portfolioRaw.length > 1 && benchmarkRaw.length > 1) {
        const baseP = portfolioRaw[0];
        const baseB = benchmarkRaw[0];
        const normP = portfolioRaw.map((v) => (v / baseP) * 100);
        const normB = benchmarkRaw.map((v) => (v / baseB) * 100);

        performance = dates.map((date, i) => ({
          date,
          portfolio: Number(normP[i]?.toFixed(2)),
          benchmark: Number(normB[i]?.toFixed(2)),
        }));

        vol = annualizedVolatility(normP.map((v) => v / 100)) * 100;
        beta = estimateBeta(normP, normB);
        mdd = maxDrawdown(normP.map((v) => v / 100)) * 100;

        const retsMonthly = pctReturns(normP);
        const avgMonthly = mean(retsMonthly);
        const annualRet = avgMonthly * 12;
        const volAnnual = vol / 100;
        sharpe = volAnnual > 0 ? (annualRet - riskFree) / volAnnual : 0;

        // NEW: Compute Sortino ratio
        const mar = 0; // Minimum acceptable return (monthly); can set to riskFree / 12 if preferred
        const downsideDevs = retsMonthly.map(r => Math.pow(Math.min(0, r - mar), 2));
        const downsideVar = mean(downsideDevs);
        const downsideDevMonthly = Math.sqrt(downsideVar);
        const downsideDevAnnual = downsideDevMonthly * Math.sqrt(12);
        sortino = downsideDevAnnual > 0 ? (annualRet - riskFree) / downsideDevAnnual : 0;

        benchRet = Number((((normB.at(-1) ?? 100) / 100 - 1) * 100).toFixed(2));
        historicalPortfolioReturn = Number((((normP.at(-1) ?? 100) / 100 - 1) * 100).toFixed(2));
      } else {
        console.warn(`Insufficient history data for benchmark ${userBenchmark}`);
      }
    }

    // 6) Portfolio beta vs S&P 500 (unchanged)
    const portfolioBetaSpxRaw = await computePortfolioBetaSpx(
      holdingsData.map(h => h.ticker),
      weights
    );
    const portfolioBetaSpx = (typeof portfolioBetaSpxRaw === "number")
      ? Number(portfolioBetaSpxRaw.toFixed(2))
      : null;
    const spxBeta = 1.00;
    const betaDiff = (typeof portfolioBetaSpx === "number")
      ? Number((portfolioBetaSpx - spxBeta).toFixed(2))
      : null;

    const concentration = computeConcentration(weights);
    const diversification = computeDiversification(weights, holdingsData.map(h => h.ticker));

    const betaForRisk = showBenchmark ? beta : (typeof portfolioBetaSpx === "number" ? portfolioBetaSpx : 1);
    const betaLevel = betaForRisk < 0.8 ? "Low" : betaForRisk <= 1.2 ? "Medium" : "High";

    return NextResponse.json({
      holdings: holdingsData,
      performance: performance,
      performanceMeta: { hasBenchmark: showBenchmark, benchmark: userBenchmark },
      sectors: sectors.sort((a, b) => b.allocation - a.allocation),
      metrics: {
        // Replaced portfolioReturn (daily) with sharpeRatio and sortinoRatio as primary metrics
        historicalPortfolioReturn, // Retained for context
        benchmarkReturn: benchRet,
        volatility: Number(vol.toFixed(1)),
        sharpeRatio: Number(sharpe.toFixed(2)),
        sortinoRatio: Number(sortino.toFixed(2)), // NEW
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
    });
  } catch (err) {
    console.error("Error fetching portfolio data:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

