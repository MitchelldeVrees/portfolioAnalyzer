// app/api/portfolio/[id]/pdf/route.ts
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import yahooFinance from "yahoo-finance2"

export const runtime = "nodejs" // make sure this runs on Node

// Server-side Supabase with SERVICE ROLE (server only, never expose to client)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// === Price history & stats helpers (Yahoo Finance) ===
// We use `chart` because it's fast & stable across tickers/indices
type Bar = { date: string; adjClose: number };
async function getDailyHistoryAdjClose(symbol: string, days = 252): Promise<Bar[]> {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - Math.floor(days * 24 * 60 * 60 * 1.1); // small buffer
    const ch: any = await yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: "1d",
      events: "div,splits",
    });
    const quotes = ch?.quotes || [];
    return quotes
      .filter((q: any) => typeof q.adjclose === "number" && q.date)
      .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), adjClose: q.adjclose }));
  } catch {
    return [];
  }
}

function toDailyReturns(series: Bar[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].adjClose;
    const cur = series[i].adjClose;
    if (prev > 0 && isFinite(prev) && isFinite(cur)) {
      out.push({ date: series[i].date, r: (cur / prev) - 1 });
    }
  }
  return out;
}

function alignByDate<T extends { date: string }>(arrays: T[][]): string[] {
  // return intersection of dates across all arrays
  const sets = arrays.map(a => new Set(a.map(x => x.date)));
  const base = arrays[0]?.map(x => x.date) ?? [];
  return base.filter(d => sets.every(s => s.has(d)));
}

function corr(a: number[], b: number[]): number {
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

function stddev(a: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const mean = a.reduce((s,x)=>s+x,0)/n;
  const v = a.reduce((s,x)=>s+(x-mean)*(x-mean),0)/(n-1);
  return Math.sqrt(v);
}

// Harmonic mean for ratios like PE to avoid dominance by large values
function harmonicMean(values: number[], weights?: number[]): number | null {
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

// Fetch a subset of quoteSummary fields needed for fundamentals
type FundRow = {
  symbol: string;
  trailingPE?: number | null;
  forwardPE?: number | null;
  dividendYield?: number | null; // in fraction form from Yahoo
};
async function getFundamentals(tickers: string[]): Promise<Record<string, FundRow>> {
  const out: Record<string, FundRow> = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      const qs: any = await yahooFinance.quoteSummary(t, {
        modules: ["summaryDetail","defaultKeyStatistics","price"]
      });
      const sd = qs?.summaryDetail || {};
      const ks = qs?.defaultKeyStatistics || {};
      const symbol = (qs?.price?.symbol || t || "").toUpperCase();
      out[symbol] = {
        symbol,
        trailingPE: typeof sd?.trailingPE === "number" ? sd.trailingPE : (typeof ks?.trailingPE === "number" ? ks.trailingPE : null),
        forwardPE: typeof sd?.forwardPE === "number" ? sd.forwardPE : (typeof ks?.forwardPE === "number" ? ks.forwardPE : null),
        dividendYield: typeof sd?.dividendYield === "number" ? sd.dividendYield : null,
      };
    } catch {
      // ignore this symbol
    }
  }));
  return out;
}


// === Charts: GET -> data URI (base64) ===
async function chartToDataUri(config: any, width = 1000, height = 520): Promise<string> {
  const url = qcUrl(config, width, height)
  const resp = await fetch(url)
  if (!resp.ok) return ""
  const buf = Buffer.from(await resp.arrayBuffer())
  return `data:image/png;base64,${buf.toString("base64")}`
}

// === Branding image helper: read /public file by URL and inline it ===
async function imageUrlToDataUri(url: string): Promise<string> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return ""
    const buf = Buffer.from(await resp.arrayBuffer())
    return `data:image/png;base64,${buf.toString("base64")}`
  } catch {
    return ""
  }
}

// --- Helpers for Yahoo Finance ---
async function getSectorForTicker(ticker: string): Promise<string | null> {
  try {
    // Try quoteSummary assetProfile (preferred)
    const qs: any = await yahooFinance.quoteSummary(ticker, { modules: ["assetProfile"] })
    const sector = qs?.assetProfile?.sector
    if (sector && typeof sector === "string") return sector
  } catch {
    // ignore; fall through to quote
  }
  try {
    // Fallback to quote (some tickers carry sector in 'sector')
    const q: any = await yahooFinance.quote(ticker)
    const sector = q?.sector
    if (sector && typeof sector === "string") return sector
  } catch {
    // ignore
  }
  return null
}

type QuoteLite = { symbol: string; marketCap?: number | null }
async function getMarketCaps(tickers: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  if (!tickers.length) return result
  try {
    const quotes = (await yahooFinance.quote(tickers)) as any[]
    for (const q of quotes) {
      const sym = q?.symbol
      const mc = q?.marketCap
      if (sym && typeof mc === "number" && isFinite(mc)) result[sym.toUpperCase()] = mc
    }
  } catch {
    // Try individually if batch fails
    await Promise.all(
      tickers.map(async (t) => {
        try {
          const q: any = await yahooFinance.quote(t)
          if (q?.symbol && typeof q.marketCap === "number") result[q.symbol.toUpperCase()] = q.marketCap
        } catch {
          /* noop */
        }
      })
    )
  }
  return result
}

// Curated sector leaders to rank by market cap dynamically
const SECTOR_LEADERS: Record<string, string[]> = {
  "Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "GOOGL", "META", "TSM", "ASML", "ORCL", "ADBE"],
  "Information Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "ASML", "CSCO", "CRM", "AMD"],

  "Healthcare": ["LLY", "JNJ", "UNH", "MRK", "ABBV", "PFE", "TMO", "ABT", "BMY", "AMGN"],
  "Health Care": ["LLY", "JNJ", "UNH", "MRK", "ABBV", "PFE", "TMO", "ABT", "BMY", "AMGN"],

  "Financial Services": ["BRK-B", "JPM", "BAC", "WFC", "MS", "GS", "C", "AXP", "SCHW", "SPGI"],
  "Financials": ["BRK-B", "JPM", "BAC", "WFC", "MS", "GS", "C", "AXP", "SCHW", "SPGI"],

  "Communication Services": ["GOOGL", "META", "NFLX", "TMUS", "DIS", "CMCSA", "VZ", "T", "TTWO", "EA"],

  "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "ADBE", "LVMUY"],
  "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "ORLY"],

  "Consumer Defensive": ["WMT", "PG", "COST", "KO", "PEP", "PM", "MO", "MDLZ", "CL", "TGT"],

  "Industrials": ["UNP", "RTX", "CAT", "BA", "HON", "UPS", "GE", "DE", "LMT", "ADI"],

  "Energy": ["XOM", "CVX", "SHEL", "TTE", "COP", "BP", "PBR", "EOG", "SLB", "ENB"],

  "Utilities": ["NEE", "DUK", "SO", "SRE", "AEP", "EXC", "D", "XEL", "PCG", "NGG"],

  "Real Estate": ["PLD", "AMT", "EQIX", "PSA", "O", "CCI", "SPG", "WELL", "CSGP", "VICI"],

  "Materials": ["LIN", "SHW", "APD", "BHP", "RIO", "FCX", "ECL", "NEM", "DOW", "PPG"],
}

// Normalize sector label for mapping
function normSectorName(s: string | null | undefined): string {
  if (!s) return "Other"
  const m = s.trim()
  // Unify common variants
  if (/^info(?:rmation)?\s+tech/i.test(m)) return "Information Technology"
  if (/^tech/i.test(m)) return "Technology"
  if (/^health\s*care/i.test(m)) return "Health Care"
  if (/^financial/i.test(m)) return "Financials"
  if (/^consumer\s+(discretionary|cyclical)/i.test(m)) return "Consumer Discretionary"
  if (/^consumer\s+defensive/i.test(m)) return "Consumer Defensive"
  return m
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { benchmark = "^GSPC" } = (await request.json().catch(() => ({}))) as { benchmark?: string }

    // 1) Get the portfolio + holdings
    const { data: portfolio, error: portfolioErr } = await supabase
      .from("portfolios")
      .select(`
        id, user_id, name, description, created_at, updated_at,
        portfolio_holdings (
          id, ticker, weight, shares, purchase_price, created_at, updated_at
        )
      `)
      .eq("id", params.id)
      .single()

    if (portfolioErr || !portfolio) {
      console.error("Supabase portfolios error:", portfolioErr)
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 })
    }

    // 2) Profile (optional)
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", portfolio.user_id)
      .single()
    if (profileErr) console.warn("Supabase profiles warning:", profileErr)

    const origin = new URL(request.url).origin
    const cookieHeader = request.headers.get("cookie") || ""

    // 3) Get analysis data & research (match UI shape; pass benchmark)
    const [dataRes, researchRes] = await Promise.all([
      fetch(`${origin}/api/portfolio/${params.id}/data?benchmark=${encodeURIComponent(benchmark)}`, {
        headers: { cookie: cookieHeader },
      }),
      fetch(`${origin}/api/portfolio/${params.id}/research`, { headers: { cookie: cookieHeader } }),
    ])

    const data = dataRes.ok ? await dataRes.json() : null
    const research = researchRes.ok ? await researchRes.json() : null

    // 4) Branding assets (logo from /public)
    const logoDataUri = await imageUrlToDataUri(`${origin}/portify-logo.png`)
    const brand = { company: "Portify", logoDataUri }

    // 5) Build charts as base64 images (robust for printing)
    type PerfPoint = { date: string; portfolio: number; benchmark?: number }
    const perfSeries: PerfPoint[] = Array.isArray(data?.performance) ? data.performance : []

    let performanceChartUri = ""
    if (perfSeries.length) {
      const labels = perfSeries.map((p) => p.date)
      const portfolioLine = perfSeries.map((p) => p.portfolio)
      const maybeBenchmark = perfSeries.some((p) => typeof p.benchmark === "number")
        ? perfSeries.map((p) => p.benchmark as number)
        : null

      performanceChartUri = await chartToDataUri(
        {
          type: "line",
          data: {
            labels,
            datasets: [
              { label: "Portfolio", data: portfolioLine, borderWidth: 2, fill: false },
              ...(maybeBenchmark
                ? [
                    {
                      label: data?.performanceMeta?.benchmark || benchmark || "^GSPC",
                      data: maybeBenchmark,
                      borderWidth: 2,
                      fill: false,
                    },
                  ]
                : []),
            ],
          },
          options: {
            plugins: {
              legend: { position: "top", labels: { font: { size: 12 } } },
              title: { display: true, text: "Performance vs Benchmark (12m)" },
            },
            elements: { line: { tension: 0.25 } },
            scales: { y: { ticks: { callback: (v: any) => `${v}%` } } },
          },
        },
        1100,
        420
      )
    }

    type SectorRow = { sector: string; allocation: number; target?: number }
    const sectors: SectorRow[] = Array.isArray(data?.sectors) ? data.sectors : []
    const normSectors = sectors.map((s) => ({
      label: s.sector || "Other",
      alloc: s.allocation > 1 ? s.allocation : s.allocation * 100,
      target: typeof s.target === "number" ? (s.target > 1 ? s.target : s.target * 100) : undefined,
    }))

    const piePalette = [
  "#2563eb","#16a34a","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#84cc16","#f97316","#dc2626","#0ea5e9",
  "#a855f7","#22c55e","#eab308","#fb7185","#10b981",
  "#64748b"
];
const colors = normSectors.map((_, i) => piePalette[i % piePalette.length]);



    let allocationChartUri = ""
    if (normSectors.length) {
      allocationChartUri = await chartToDataUri(
  {
    type: "pie",
    data: {
      labels: normSectors.map((s) => s.label),
datasets: [
        {
          data: normSectors.map((s) => Number(s.alloc.toFixed(2))),
          backgroundColor: colors,           // 🔑 slice colors
          borderColor: "#ffffff",            // clean slice separators
          borderWidth: 1,
        },],
          },
    options: {
      layout: {
        // add breathing room so the legend never clips
        padding: { left: 8, right: 8, top: 8, bottom: 8 },
      },
      plugins: {
        legend: {
          position: "bottom", // move legend below chart
          labels: {
            font: { size: 28 }, // bigger legend
            boxWidth: 22,
            boxHeight: 16,
            padding: 20,
            usePointStyle: true, // round markers—reads better when larger
          },
        },
        title: { display: true, text: "Sector Allocation", font: { size: 18 } },
      },
    },
  },
  900,  // width
  760   // height (bigger chart area + legend, still fits nicely)
)

    }

    // 6) Sector mappings: combine from /data and fill gaps using Yahoo Finance
    const sectorByTicker = new Map<string, string>()
    // a) direct mapping array: [{ticker, sector}]
    if (Array.isArray(data?.holdingSectors)) {
      for (const row of data.holdingSectors) {
        if (row?.ticker && row?.sector) sectorByTicker.set(String(row.ticker).toUpperCase(), normSectorName(row.sector))
      }
    }
    // b) holdings array with meta: [{ticker, meta:{sector}}] or {sector}
    if (Array.isArray(data?.holdings)) {
      for (const h of data.holdings) {
        const t = h?.ticker ? String(h.ticker).toUpperCase() : null
        const s = h?.sector || h?.meta?.sector
        if (t && s) sectorByTicker.set(t, normSectorName(s))
      }
    }

    const holdings: any[] = Array.isArray(portfolio.portfolio_holdings) ? portfolio.portfolio_holdings : []
    const tickersNeedingSector = holdings
      .map((h) => String(h?.ticker || "").toUpperCase())
      .filter((t) => t && !sectorByTicker.has(t))

    // Fetch missing sectors via Yahoo
    if (tickersNeedingSector.length) {
      await Promise.all(
        tickersNeedingSector.map(async (t) => {
          const sec = await getSectorForTicker(t)
          if (sec) sectorByTicker.set(t, normSectorName(sec))
        })
      )
    }

    // 7) Compute sector tilts and recommendation inputs
    const norm = normSectors.map((s) => {
      const allocation = Number((s.alloc ?? 0).toFixed(2))
      const target = typeof s.target === "number" ? Number(s.target.toFixed(2)) : undefined
      const active = typeof target === "number" ? Number((allocation - target).toFixed(2)) : undefined
      return { sector: s.label, allocation, target, active }
    })

    const withTargets = norm.filter((s) => typeof s.target === "number")
    const largestPositive = withTargets
      .filter((s) => typeof s.active === "number")
      .sort((a, b) => (b.active! - a.active!))
      [0]

    const largestNegative = withTargets
      .filter((s) => typeof s.active === "number")
      .sort((a, b) => (a.active! - b.active!))
      [0]

    // For the positive tilt: which equity in that sector has the largest weight?
    let positiveTiltHolding: { ticker: string; weight: number } | null = null
    if (largestPositive) {
      const sectorName = normSectorName(largestPositive.sector)
      const inSector = holdings
        .map((h) => {
          const t = String(h?.ticker || "").toUpperCase()
          const w = typeof h?.weight === "number" ? (h.weight > 1 ? h.weight : h.weight * 100) : 0
          const s = sectorByTicker.get(t)
          return { ticker: t, weight: w, sector: s }
        })
        .filter((x) => normSectorName(x.sector) === sectorName)

      if (inSector.length) {
        inSector.sort((a, b) => b.weight - a.weight)
        if (inSector[0]) positiveTiltHolding = { ticker: inSector[0].ticker, weight: inSector[0].weight }
      }
    }

    // For the negative tilt: top 3 by market cap in that sector (recommend to add)
    let negativeTiltSuggestions: { symbol: string; marketCap: number }[] = []
    if (largestNegative) {
      const negSector = normSectorName(largestNegative.sector)
      // Use curated list per sector, fetch market caps and pick top 3 available
      const candidateList =
        SECTOR_LEADERS[negSector] ||
        SECTOR_LEADERS[negSector.replace("Financial Services", "Financials")] ||
        SECTOR_LEADERS[negSector.replace("Information Technology", "Technology")] ||
        []
      if (candidateList.length) {
        const caps = await getMarketCaps(candidateList)
        negativeTiltSuggestions = Object.entries(caps)
          .map(([symbol, mc]) => ({ symbol, marketCap: mc }))
          .sort((a, b) => b.marketCap - a.marketCap)
          .slice(0, 3)
      }
    }

    const tickers = holdings
      .map(h => String(h?.ticker || "").toUpperCase())
      .filter(t => t && t !== "CASH");

    // We’ll use last 252 trading days (~12m) for attribution; 130 days (~6m) for correlations/Σ
    const [benchHist, ...holdHists] = await Promise.all([
      getDailyHistoryAdjClose(benchmark || "^GSPC", 252),
      ...tickers.map(t => getDailyHistoryAdjClose(t, 252))
    ]);

    // Build daily return series
    const benchRets = toDailyReturns(benchHist);
    const holdRetsArr = holdHists.map(h => toDailyReturns(h));

    // Align by common dates across benchmark + all holdings (use ~130d recent window for corr/Σ)
    const allForAlign = [benchRets, ...holdRetsArr];
    const datesCommon = alignByDate(allForAlign);
    const datesRecent = datesCommon.slice(-130); // ~6m of trading days

    // Map weights (normalize to 1.0)
    const rawWeights = tickers.map((t, i) => {
      const w = typeof holdings[i]?.weight === "number" ? holdings[i].weight : 0;
      return w > 1 ? w/100 : w;
    });
    const wSum = rawWeights.reduce((s,x)=>s+(x||0),0) || 1;
    const weights = rawWeights.map(w => (w || 0)/wSum);

    // Build matrices aligned to recent dates
    const benchVec = datesRecent.map(d => benchRets.find(x => x.date === d)?.r ?? 0);
    const holdMat = holdRetsArr.map(arr => datesRecent.map(d => arr.find(x => x.date === d)?.r ?? 0));

    // === Correlations to Benchmark ===
    const corrToBench = tickers.map((t, i) => ({
      ticker: t,
      corr: corr(holdMat[i], benchVec)
    }))
    .filter(x => isFinite(x.corr))
    .sort((a,b)=>b.corr - a.corr);

    // === Portfolio daily returns & risk ===
    const portDaily = datesRecent.map((_, j) => {
      let r = 0;
      for (let i=0;i<holdMat.length;i++) r += weights[i] * holdMat[i][j];
      return r;
    });
    const dailyVol = stddev(portDaily);                 // stdev of daily returns
    const annVol = dailyVol * Math.sqrt(252);           // annualized volatility
    const var95 = (dailyVol * 1.65) * 100;              // 1-day 95% VaR (%), normal approx

    // === 12m performance attribution ===
    // For each holding: total return over 12m window (first/last of full 252-day series)
    const twelveMonthDates = alignByDate([benchRets, ...holdRetsArr]); // full intersection
    const use12m = twelveMonthDates.slice(-252); // try 252; if shorter, it’ll just be shorter
    const totalReturn = (series: {date:string; r:number}[], ds: string[]) => {
      const idxs = series.filter(x => ds.includes(x.date));
      let acc = 1;
      for (const x of idxs) acc *= (1 + (x.r || 0));
      return acc - 1;
    };
    const attrib = tickers.map((t, i) => {
      const ret = totalReturn(holdRetsArr[i], use12m);
      const contrib = (weights[i] || 0) * ret; // contribution in pct points (of portfolio return)
      return { ticker: t, weight: (weights[i]||0)*100, ret: ret*100, contrib: contrib*100 };
    })
    .filter(x => isFinite(x.ret) && isFinite(x.contrib))
    .sort((a,b)=>Math.abs(b.contrib) - Math.abs(a.contrib));

    const topContrib = attrib.slice(0, 8);
    const posContrib = attrib.filter(a => a.contrib >= 0).slice(0,5);
    const negContrib = attrib.filter(a => a.contrib < 0).slice(0,5);

    // === Fundamentals (yield & PE) ===
    const fMap = await getFundamentals(tickers);
    const fundRows = tickers.map((t, i) => {
      const f = fMap[t] || {};
      return {
        ticker: t,
        weight: (weights[i]||0)*100,
        trailingPE: typeof f.trailingPE === "number" ? f.trailingPE : null,
        forwardPE: typeof f.forwardPE === "number" ? f.forwardPE : null,
        dividendYieldPct: typeof f.dividendYield === "number" ? f.dividendYield * 100 : null,
      };
    });

    const w = weights;
    const yields = fundRows.map(r => (r.dividendYieldPct ?? 0)/100);
    const wAvgYield = w.reduce((s,wi,idx)=> s + wi * (yields[idx] || 0), 0) * 100;

    const trailingPEvals = fundRows.map(r => r.trailingPE ?? NaN);
    const forwardPEvals = fundRows.map(r => r.forwardPE ?? NaN);
    const hTraPE = harmonicMean(trailingPEvals, w);
    const hFwdPE = harmonicMean(forwardPEvals, w);

    // === Charts for the new pages ===
    // 1) Top Contributors / Detractors (bar)
    const contribChartUri = await chartToDataUri({
      type: "bar",
      data: {
        labels: topContrib.map(x => x.ticker),
        datasets: [{
          label: "Contribution (pp)",
          data: topContrib.map(x => Number(x.contrib.toFixed(2))),
        }]
      },
      options: {
        plugins: { title: { display: true, text: "Top Contributors / Detractors (12m)" }, legend: { display: false } },
        scales: { y: { title: { display:true, text: "percentage points" } } }
      }
    }, 1100, 420);

    // 2) Correlation to Benchmark (bar)
    const corrChartUri = await chartToDataUri({
      type: "bar",
      data: {
        labels: corrToBench.map(x => x.ticker),
        datasets: [{ label: "Correlation vs Benchmark (~6m)", data: corrToBench.map(x => Number((x.corr*100).toFixed(1))) }]
      },
      options: {
        plugins: { title: { display: true, text: "Holding Correlation to Benchmark (Pearson, %)" }, legend: { display: false } },
        scales: { y: { min: -100, max: 100 } }
      }
    }, 1100, 420);

    // 3) Dividend Yield by Holding (bar)
    const yieldBars = fundRows
      .filter(r => typeof r.dividendYieldPct === "number")
      .sort((a,b)=> (b.dividendYieldPct! - a.dividendYieldPct!))
      .slice(0, 12);
    const yieldChartUri = await chartToDataUri({
      type: "bar",
      data: {
        labels: yieldBars.map(r => r.ticker),
        datasets: [{ label: "Dividend Yield (%)", data: yieldBars.map(r => Number(r.dividendYieldPct!.toFixed(2))) }]
      },
      options: {
        plugins: { title: { display: true, text: "Dividend Yield by Holding (Top 12)" }, legend: { display: false } },
        scales: { y: { title: { display: true, text: "percent" } } }
      }
    }, 1100, 420);

    // Bundle new analytics for the renderer
    const advanced = {
      attribution: { items: attrib, top: topContrib, positives: posContrib, negatives: negContrib, chartUri: contribChartUri },
      corr: { items: corrToBench, chartUri: corrChartUri, annVol, var95 },
      fundamentals: {
        rows: fundRows,
        weighted: {
          dividendYieldPct: Number.isFinite(wAvgYield) ? Number(wAvgYield.toFixed(2)) : null,
          trailingPE_harmonic: hTraPE ? Number(hTraPE.toFixed(2)) : null,
          forwardPE_harmonic: hFwdPE ? Number(hFwdPE.toFixed(2)) : null,
        },
        chartUri: yieldChartUri,
      },
    };
    
    // Metrics for analysis tables
    const metrics = data?.metrics || {}
    const risk = data?.risk || {}
    const portfolioReturn = typeof metrics.portfolioReturn === "number" ? metrics.portfolioReturn : null
    const benchmarkReturn = typeof metrics.benchmarkReturn === "number" ? metrics.benchmarkReturn : null
    const volatility = typeof metrics.volatility === "number" ? metrics.volatility : null
    const sharpeRatio = typeof metrics.sharpeRatio === "number" ? metrics.sharpeRatio : null
    const maxDrawdown = typeof metrics.maxDrawdown === "number" ? metrics.maxDrawdown : null
    const concentrationLevel = risk?.concentration?.level ?? "—"
    const largestPositionPct = risk?.concentration?.largestPositionPct ?? null
    const diversificationScore = risk?.diversification?.score ?? null
    const diversificationHoldings = risk?.diversification?.holdings ?? null
    const diversificationTop2 = risk?.diversification?.top2Pct ?? null
    const portfolioBetaSpx = typeof metrics.portfolioBetaSpx === "number" ? metrics.portfolioBetaSpx : null

    // 8) Render HTML
    const pdfHtml = generateProfessionalPDFHTML({
      ...portfolio,
      profile,
      data,
      research,
      benchmark,
      charts: { performanceChartUri, allocationChartUri },
      branding: brand,
      sectorByTicker: Object.fromEntries(sectorByTicker.entries()),
      tiltInfo: {
        largestPositive,
        largestNegative,
        positiveTiltHolding,
        negativeTiltSuggestions,
      },
      advanced,
    })

    return NextResponse.json({
      html: pdfHtml,
      filename: `${String(portfolio.name ?? "Portfolio").replace(/\s+/g, "_")}_Analysis_Report.pdf`,
    })
  } catch (error) {
    console.error("Error generating PDF:", error)
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 })
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string))
}

function qcUrl(config: any, width = 900, height = 380) {
  const encoded = encodeURIComponent(JSON.stringify(config))
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&format=png&backgroundColor=white&version=4&devicePixelRatio=2`
}



function generateProfessionalPDFHTML(portfolio: any): string {
  const currentDate = new Date().toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const data = portfolio.data || {}
  const benchmarkName = data?.performanceMeta?.benchmark || portfolio.benchmark || "^GSPC"

  // branding + charts
  const brandName: string = portfolio.branding?.company || "Portify"
  const logoDataUri: string = portfolio.branding?.logoDataUri || ""
  const performanceChartUri = portfolio.charts?.performanceChartUri || ""
  const allocationChartUri = portfolio.charts?.allocationChartUri || ""

  // sectors/tilts (UI: { sector, allocation, target })
  const sectors: Array<{ sector: string; allocation: number; target?: number }> =
    Array.isArray(data?.sectors) ? data.sectors : []

  const normSectors = sectors.map((s) => {
    const alloc = s.allocation > 1 ? s.allocation : s.allocation * 100
    const target = typeof s.target === "number" ? (s.target > 1 ? s.target : s.target * 100) : undefined
    const active = typeof target === "number" ? Number((alloc - target).toFixed(2)) : undefined
    return { sector: s.sector || "Other", allocation: Number(alloc.toFixed(2)), target, active }
  })
  const hasSectors = normSectors.length > 0

  const withTargets = normSectors.filter((s) => typeof s.target === "number")
  const topOver = withTargets
    .filter((s) => typeof s.active === "number" && (s.active as number) > 0)
    .sort((a, b) => (b.active! - a.active!))
    .slice(0, 3)
  const topUnder = withTargets
    .filter((s) => typeof s.active === "number" && (s.active as number) < 0)
    .sort((a, b) => (a.active! - b.active!))
    .slice(0, 3)

  // risk/metrics for page 3 tables if needed
  const metrics = data?.metrics || {}
  const risk = data?.risk || {}
  const concentrationLevel = risk?.concentration?.level ?? "—"
  const largestPositionPct = risk?.concentration?.largestPositionPct ?? null
  const diversificationScore = risk?.diversification?.score ?? null
  const diversificationHoldings = risk?.diversification?.holdings ?? null
  const diversificationTop2 = risk?.diversification?.top2Pct ?? null
  const portfolioBetaSpx = typeof metrics.portfolioBetaSpx === "number" ? metrics.portfolioBetaSpx : null

  // holdings
  const holdings: any[] = Array.isArray(portfolio.portfolio_holdings) ? portfolio.portfolio_holdings : []
  const sectorByTicker: Record<string, string> = portfolio.sectorByTicker || {}
  const esc = (s: any) => escapeHtml(s ?? "")

  // Tilt recommendation block prepared earlier
  const tiltInfo = portfolio.tiltInfo || {}
  const largestPositive = tiltInfo.largestPositive as { sector: string; allocation?: number; target?: number; active?: number } | undefined
  const largestNegative = tiltInfo.largestNegative as { sector: string; allocation?: number; target?: number; active?: number } | undefined
  const positiveTiltHolding = tiltInfo.positiveTiltHolding as { ticker: string; weight: number } | null
  const negativeTiltSuggestions = (tiltInfo.negativeTiltSuggestions as Array<{ symbol: string; marketCap: number }>) || []

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <!-- Important: keep title short to avoid browser print headers showing portfolio name -->
  <title>Portify</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:'Inter',system-ui,-apple-system,Roboto,sans-serif;color:#0f172a}
    /* Increase page internal margins to avoid overlap with fixed header/footer */
    @page{size:A4;margin:22mm 16mm}
    .page{page-break-after:always;padding-top:22mm;padding-bottom:20mm}
    .page:last-child{page-break-after:auto}
    h1{font-size:28px;margin:0 0 6px}
    h2{font-size:20px;margin:0 0 12px;color:#1e3a8a}
    h3{font-size:16px;margin:16px 0 8px}
    p{font-size:12px;line-height:1.6;margin:0 0 8px}
    .block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0}
    .muted{color:#64748b}.avoid-break{page-break-inside:avoid}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;border-bottom:1px solid #e2e8f0;padding:8px 6px}
    th{background:#f1f5f9;font-weight:600;color:#334155}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .analysis-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}
    .subgrid{display:grid;grid-template-columns:1fr;gap:12px}
    .kpi{font-size:24px;font-weight:700}.small{font-size:11px;color:#64748b}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .pos{color:#059669}.neg{color:#dc2626}
    .chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:#ecfeff;border-radius:999px;padding:2px 8px;font-size:11px;color:#0e7490}

    /* Fixed header/footer inside printable area; padding on .page ensures no overlap */
    .pdf-header,.pdf-footer{
      position:fixed; left:16mm; right:16mm; color:#334155; font-size:11px; z-index:9999;
      background:transparent;
    }
    .pdf-header{top:8mm; display:flex; align-items:center; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px}
    .pdf-footer{bottom:8mm; display:flex; align-items:center; justify-content:space-between; border-top:1px solid #e2e8f0; padding-top:4px}
    .brand-row{display:flex; align-items:center; gap:8px}
    .brand-logo{height:16px; width:auto}
    .brand-name{font-weight:700; letter-spacing:.2px}
    .page-num:after{content: counter(page) " / " counter(pages)}
  </style>
</head>
<body>

  <!-- fixed header/footer -->
  <header class="pdf-header">
    <div class="brand-row">
      ${logoDataUri ? `<img class="brand-logo" src="${logoDataUri}" alt="${esc(brandName)} logo" />` : ""}
      <span class="brand-name">${esc(brandName)}</span>
    </div>
    <div style="margin-left:auto">${esc(currentDate)}</div>
  </header>
  <footer class="pdf-footer">
    <div class="brand-row">
      ${logoDataUri ? `<img class="brand-logo" src="${logoDataUri}" alt="${esc(brandName)} logo" />` : ""}
      <span>Generated by ${esc(brandName)}</span>
    </div>
    <div class="page-num"></div>
  </footer>

  <!-- PAGE 1: Meta-only cover -->
  <section class="page">
    <h1>Portfolio Summary Report</h1>
    <p class="muted">Prepared by ${esc(brandName)}</p>
    <div class="block">
      <h2>${esc(portfolio.name || "Portfolio")}</h2>
      <p>Date: <strong>${esc(currentDate)}</strong></p>
      <p>Report Owner: <strong>${esc(portfolio.profile?.full_name || "Portfolio Owner")}</strong></p>
    </div>
    <div class="block">
      <p class="small">
        This report was generated automatically by ${esc(brandName)}. It provides a holdings overview and sector-level analysis.
        For full methodology, see the final page notes or your in-app “Analysis” tab.
      </p>
      ${
        performanceChartUri
          ? `<img src="${performanceChartUri}" alt="Performance Chart" style="width:100%;height:auto;margin-top:8px;" />`
          : ""
      }
    </div>
  </section>

  <!-- PAGE 2: Holdings (conditional columns per row) -->
  <section class="page">
    <h2>Portfolio</h2>
    <div class="block avoid-break">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="num">Weight</th>
            <th class="num">Shares</th>
            <th class="num">Purchase Price</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>
          ${
            holdings.map((h) => {
              const w = typeof h.weight === "number" ? (h.weight > 1 ? h.weight : h.weight * 100) : 0
              const hasShares = h.shares != null && h.shares !== ""
              const hasPx = h.purchase_price != null && h.purchase_price !== ""
              const t = h?.ticker ? String(h.ticker).toUpperCase() : ""
              const sector = sectorByTicker[t] || "—"

              return `
                <tr>
                  <td><strong>${esc(h.ticker)}</strong></td>
                  <td class="num">${w.toFixed(2)}%</td>
                  <td class="num">${hasShares ? esc(h.shares) : "—"}</td>
                  <td class="num">${hasPx ? "€" + Number(h.purchase_price).toFixed(2) : "—"}</td>
                  <td>${esc(sector)}</td>
                </tr>
              `
            }).join("")
          }
        </tbody>
      </table>
      ${holdings.length === 0 ? `<p class="small muted" style="margin-top:8px;">No holdings found.</p>` : ""}
      <p class="small muted" style="margin-top:8px;">Sector data is sourced from Yahoo Finance where missing.</p>
    </div>
  </section>

  <!-- PAGE 3: Analysis -->
  <section class="page">
    <h2>Analysis</h2>

    <div class="analysis-grid">
      <div class="block avoid-break">
        <h3>Sector Allocation</h3>
        ${
          hasSectors
            ? `<img
  src="${allocationChartUri}"
  alt="Sector Allocation"
  style="width:100%;height:auto;max-height:520px;object-fit:contain;margin-top:6px;"
/>
`
            : `<p class="small muted">Insufficient sector data to render a chart.</p>`
        }
      </div>

      <div class="subgrid">
  <div class="block avoid-break">
  <h3>Active Sector Tilts (Top Over/Under)</h3>
  ${
    hasSectors && withTargets.length
      ? (() => {
          const highest = topOver[0];
          const lowest = topUnder[0];
          const rows = [highest, lowest].filter(Boolean) as Array<{sector:string; allocation:number; target?:number; active?:number}>;
          return rows.length
            ? `
              <table>
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th class="num">Portfolio</th>
                    <th class="num">${esc(benchmarkName)}</th>
                    <th class="num">Active</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    rows.map((s) => {
                      const active = typeof s.active === "number" ? s.active : NaN;
                      const cls = isFinite(active) ? (active >= 0 ? "pos" : "neg") : "";
                      const arrow = isFinite(active) ? (active >= 0 ? "▲" : "▼") : "";
                      const sign = isFinite(active) ? (active >= 0 ? "+" : "") : "";
                      return `
                        <tr>
                          <td>${esc(s.sector)}</td>
                          <td class="num">${s.allocation.toFixed(2)}%</td>
                          <td class="num">${typeof s.target === "number" ? s.target.toFixed(2) + "%" : "—"}</td>
                          <td class="num ${cls}">${isFinite(active) ? `${arrow} ${sign}${active.toFixed(2)}%` : "—"}</td>
                        </tr>
                      `;
                    }).join("")
                  }
                </tbody>
              </table>
              <p class="small muted" style="margin-top:6px;">Showing only the single highest overweight and single highest underweight sector.</p>
            `
            : `<p class="small muted">Provide benchmark sector weights to compute active tilts.</p>`;
        })()
      : `<p class="small muted">Provide benchmark sector weights to compute active tilts.</p>`
  }
</div>


        <div class="block avoid-break">
          <h3>Risk Snapshot</h3>
          <table>
            <tbody>
              <tr><td>Concentration Risk</td><td class="num">${esc(concentrationLevel)}</td></tr>
              <tr><td>Largest Position</td><td class="num">${largestPositionPct != null ? largestPositionPct + "%" : "—"}</td></tr>
              <tr><td>Diversification Score</td><td class="num">${diversificationScore != null ? diversificationScore + "/10" : "—"}</td></tr>
              <tr><td>Holdings (Count)</td><td class="num">${diversificationHoldings != null ? diversificationHoldings : "—"}</td></tr>
              <tr><td>Top 2 Concentration</td><td class="num">${diversificationTop2 != null ? diversificationTop2 + "%" : "—"}</td></tr>
              <tr><td>Beta (vs S&P 500)</td><td class="num">${portfolioBetaSpx != null ? portfolioBetaSpx.toFixed(2) : "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>

  <!-- PAGE 4: Sector Tilt Recommendations -->
  <section class="page">
    <h2>Sector Tilt Recommendations</h2>

    <div class="block">
      <h3>Largest Positive Tilt</h3>
      ${
        largestPositive
          ? `
            <p>
              Your highest overweight sector is <strong>${esc(largestPositive.sector)}</strong>
              at <strong>${(largestPositive.active ?? 0) >= 0 ? "+" : ""}${(largestPositive.active ?? 0).toFixed(2)}%</strong>
              versus ${esc(benchmarkName)}.
            </p>
            ${
              positiveTiltHolding
                ? `<p>
                     Within this sector, your largest position is <strong>${esc(positiveTiltHolding.ticker)}</strong>
                     at <strong>${positiveTiltHolding.weight.toFixed(2)}%</strong> of the portfolio.
                     To more closely track the benchmark, consider trimming this holding or redistributing within the sector.
                   </p>`
                : `<p>
                     Consider trimming your largest holdings in this sector to reduce the overweight.
                   </p>`
            }
          `
          : `<p class="small muted">No positive tilts detected (requires benchmark targets).</p>`
      }
    </div>

    <div class="block">
      <h3>Largest Negative Tilt</h3>
      ${
        largestNegative
          ? `
            <p>
              Your biggest underweight is <strong>${esc(largestNegative.sector)}</strong>
              at <strong>${(largestNegative.active ?? 0).toFixed(2)}%</strong> below ${esc(benchmarkName)}.
            </p>
            ${
              negativeTiltSuggestions.length
                ? `
                  <p>Consider adding exposure to sector leaders to improve alignment:</p>
                  <table>
                    <thead><tr><th>Ticker</th><th class="num">Approx. Market Cap</th></tr></thead>
                    <tbody>
                      ${
                        negativeTiltSuggestions.map(s => `
                          <tr>
                            <td><strong>${esc(s.symbol)}</strong></td>
                            <td class="num">$${(s.marketCap / 1e9).toFixed(1)}B</td>
                          </tr>
                        `).join("")
                      }
                    </tbody>
                  </table>
                  <p class="small muted" style="margin-top:6px;">Leaders retrieved via Yahoo Finance; final selections should consider valuation, liquidity, and your mandate.</p>
                `
                : `<p>
                    Consider adding broad exposure (e.g., a sector ETF) or top-cap constituents in this sector to close the gap.
                  </p>`
            }
          `
          : `<p class="small muted">No negative tilts detected (requires benchmark targets).</p>`
      }
    </div>

    <div class="block">
      <p class="small">
        <strong>Note:</strong> These suggestions are based on sector weights only and are not investment advice.
        Always evaluate fundamentals, valuation, and risk before reallocating capital.
      </p>
    </div>
  </section>
  <!-- PAGE 5: Performance Attribution (12m) -->
  <section class="page">
    <h2>Performance Attribution (12m)</h2>
    <div class="block avoid-break">
      ${portfolio?.advanced?.attribution?.chartUri
        ? `<img src="${portfolio.advanced.attribution.chartUri}" alt="Attribution Chart" style="width:100%;height:auto;" />`
        : `<p class="small muted">Not enough data to compute attribution.</p>`
      }
    </div>
    <div class="block avoid-break">
      <h3>Top Contributors & Detractors</h3>
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="num">Weight</th>
            <th class="num">Return (12m)</th>
            <th class="num">Contribution (pp)</th>
          </tr>
        </thead>
        <tbody>
          ${
            Array.isArray(portfolio?.advanced?.attribution?.top)
              ? portfolio.advanced.attribution.top.map((row:any)=>`
                <tr>
                  <td><strong>${escapeHtml(row.ticker)}</strong></td>
                  <td class="num">${row.weight.toFixed(2)}%</td>
                  <td class="num ${row.ret>=0?'pos':'neg'}">${row.ret>=0?'▲':'▼'} ${row.ret.toFixed(2)}%</td>
                  <td class="num ${row.contrib>=0?'pos':'neg'}">${row.contrib>=0?'+':''}${row.contrib.toFixed(2)}</td>
                </tr>
              `).join("")
              : ""
          }
        </tbody>
      </table>
      <p class="small muted" style="margin-top:6px;">
        Contribution approximated as weight × total return over the last 12 months, using adjusted close series.
      </p>
    </div>
  </section>

  <!-- PAGE 6: Correlation to Benchmark & Risk -->
  <section class="page">
    <h2>Correlation & Risk (Recent ~6 Months)</h2>
    <div class="two">
      <div class="block avoid-break">
        ${portfolio?.advanced?.corr?.chartUri
          ? `<img src="${portfolio.advanced.corr.chartUri}" alt="Correlation Chart" style="width:100%;height:auto;" />`
          : `<p class="small muted">Not enough overlapping data to compute correlations.</p>`
        }
      </div>
      <div class="block avoid-break">
        <h3>Portfolio Risk Snapshot</h3>
        <table>
          <tbody>
            <tr><td>Annualized Volatility</td><td class="num">${typeof portfolio?.advanced?.corr?.annVol === "number" ? (portfolio.advanced.corr.annVol*100).toFixed(2)+'%' : '—'}</td></tr>
            <tr><td>1-day VaR (95%)</td><td class="num">${typeof portfolio?.advanced?.corr?.var95 === "number" ? portfolio.advanced.corr.var95.toFixed(2)+'%' : '—'}</td></tr>
          </tbody>
        </table>
        <p class="small muted" style="margin-top:6px;">
          VaR is a parametric (normal) approximation based on recent daily volatility. Actual losses can exceed VaR.
        </p>
      </div>
    </div>
  </section>

  <!-- PAGE 7: Income & Valuation Snapshot -->
  <section class="page">
    <h2>Income & Valuation Snapshot</h2>
    <div class="block avoid-break">
      ${portfolio?.advanced?.fundamentals?.chartUri
        ? `<img src="${portfolio.advanced.fundamentals.chartUri}" alt="Dividend Yield Chart" style="width:100%;height:auto;" />`
        : `<p class="small muted">Dividend data unavailable for charting.</p>`
      }
    </div>
    <div class="block avoid-break">
      <div class="two">
        <div>
          <h3>Weighted Portfolio Averages</h3>
          <table>
            <tbody>
              <tr><td>Dividend Yield (weighted)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.dividendYieldPct === "number"
                  ? portfolio.advanced.fundamentals.weighted.dividendYieldPct.toFixed(2)+'%'
                  : '—'
              }</td></tr>
              <tr><td>Trailing P/E (harmonic)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.trailingPE_harmonic === "number"
                  ? portfolio.advanced.fundamentals.weighted.trailingPE_harmonic.toFixed(2)
                  : '—'
              }</td></tr>
              <tr><td>Forward P/E (harmonic)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.forwardPE_harmonic === "number"
                  ? portfolio.advanced.fundamentals.weighted.forwardPE_harmonic.toFixed(2)
                  : '—'
              }</td></tr>
            </tbody>
          </table>
          <p class="small muted" style="margin-top:6px;">
            P/E uses a harmonic mean to avoid distortion from very high multiples; dividend yield is weighted by portfolio weights.
          </p>
        </div>
        <div>
          <h3>Key Fundamentals by Holding</h3>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th class="num">Weight</th>
                <th class="num">Div. Yield</th>
                <th class="num">Trailing P/E</th>
                <th class="num">Forward P/E</th>
              </tr>
            </thead>
            <tbody>
              ${
                Array.isArray(portfolio?.advanced?.fundamentals?.rows)
                  ? portfolio.advanced.fundamentals.rows.map((r:any)=>`
                    <tr>
                      <td><strong>${escapeHtml(r.ticker)}</strong></td>
                      <td class="num">${(r.weight ?? 0).toFixed(2)}%</td>
                      <td class="num">${typeof r.dividendYieldPct === "number" ? r.dividendYieldPct.toFixed(2)+'%' : '—'}</td>
                      <td class="num">${typeof r.trailingPE === "number" ? r.trailingPE.toFixed(2) : '—'}</td>
                      <td class="num">${typeof r.forwardPE === "number" ? r.forwardPE.toFixed(2) : '—'}</td>
                    </tr>
                  `).join("")
                  : ""
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="block">
      <p class="small">
        <strong>Note:</strong> Fundamentals pulled from Yahoo Finance where available. Always consider the latest filings and your mandate before acting.
      </p>
    </div>
  </section>

</body>
</html>
  `
}
