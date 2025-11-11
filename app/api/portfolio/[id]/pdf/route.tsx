import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getDailyHistoryAdjClose, toDailyReturns, getFundamentals, getMarketCaps } from "./yahooFinanceUtils";
import { corr, stddev, harmonicMean, alignByDate } from "./statsUtils";
import { chartToDataUri } from "./chartUtils";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "@/lib/security/csrf";
import { generateProfessionalPDFHTML } from "./pdfTemplate";
import { getSectorForTicker, normSectorName, SECTOR_LEADERS } from "./sectorUtils";

export const runtime = "nodejs";

type PdfErrorMeta = {
  status?: number
  upstream?: string
  publicMessage?: string
}

class PdfGenerationError extends Error {
  meta: PdfErrorMeta

  constructor(message: string, meta: PdfErrorMeta) {
    super(message)
    this.meta = meta
  }
}

async function safeJson<T = any>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  try {
    const supabase = await createServerClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { benchmark = "^GSPC" } = (await request.json().catch(() => ({}))) as { benchmark?: string };

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
      .eq("user_id", auth.user.id)
      .single();

    if (portfolioErr || !portfolio) {
      console.error("Supabase portfolios error:", portfolioErr);
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    // 2) Profile (optional)
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", portfolio.user_id)
      .single();
    if (profileErr) console.warn("Supabase profiles warning:", profileErr);

    const origin = new URL(request.url).origin;
    const cookieHeader = request.headers.get("cookie") || "";

    // 3) Get analysis data & research
    const csrfMatch = cookieHeader.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
    const forwardHeaders: Record<string, string> = { cookie: cookieHeader };
    if (csrfMatch) {
      forwardHeaders[CSRF_HEADER_NAME] = decodeURIComponent(csrfMatch[1]);
    }

    const [dataResResult, researchResResult] = await Promise.allSettled([
      fetch(`${origin}/api/portfolio/${params.id}/data?benchmark=${encodeURIComponent(benchmark)}`, {
        headers: forwardHeaders,
      }),
      fetch(`${origin}/api/portfolio/${params.id}/research`, { headers: forwardHeaders }),
    ]);

    if (dataResResult.status === "rejected") {
      throw new PdfGenerationError(`Portfolio data request failed`, {
        upstream: `/api/portfolio/${params.id}/data`,
        publicMessage: dataResResult.reason?.message ?? "Portfolio analytics service unavailable.",
      });
    }

    const dataRes = dataResResult.value as Response;
    let research: any = null;
    let researchWarning: string | null = null;
    let researchMetaStatus: number | null = null;
    let researchRunError: string | null = null;

    if (!dataRes.ok) {
      const body = await safeJson<{ error?: string }>(dataRes);
      throw new PdfGenerationError(`Portfolio data request failed (${dataRes.status})`, {
        status: dataRes.status,
        upstream: `/api/portfolio/${params.id}/data`,
        publicMessage: body?.error || "Portfolio analytics service unavailable.",
      });
    }

    if (researchResResult.status === "fulfilled") {
      const researchRes = researchResResult.value as Response;
      if (researchRes.ok) {
        research = await researchRes.json().catch(() => null);
      } else {
        const body = await safeJson<{ error?: string }>(researchRes);
        researchMetaStatus = researchRes.status;
        researchRunError = body?.error || `Research service returned ${researchRes.status}`;
        researchWarning = body?.error || "Research service temporarily unavailable.";
        console.warn("[pdf] continuing without research data", researchWarning);
      }
    } else {
      const reason = researchResResult.reason;
      researchWarning =
        (reason instanceof Error ? reason.message : typeof reason === "string" ? reason : null) ||
        "Research request failed";
      console.warn("[pdf] research request rejected", researchWarning);
    }

    const data = await dataRes.json();
    if (!research) {
      research = {
        tickers: [],
        result: "",
        generatedAt: new Date().toISOString(),
        warning: researchWarning ?? "Research data unavailable.",
        status: researchMetaStatus ?? undefined,
        error: researchRunError ?? researchWarning ?? undefined,
      };
    } else if (researchWarning) {
      research.warning = researchWarning;
    }

    // 4) Branding assets
    const logoDataUri = await chartToDataUri(`${origin}/portify-logo.png`);
    const brand = { company: "Portify", logoDataUri };

    // 5) Build charts
    type PerfPoint = { date: string; portfolio: number; benchmark?: number };
    const perfSeries: PerfPoint[] = Array.isArray(data?.performance) ? data.performance : [];

    let performanceChartUri = "";
    if (perfSeries.length) {
      const labels = perfSeries.map((p) => p.date);
      const portfolioLine = perfSeries.map((p) => p.portfolio);
      const maybeBenchmark = perfSeries.some((p) => typeof p.benchmark === "number")
        ? perfSeries.map((p) => p.benchmark as number)
        : null;

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
      );
    }

    type SectorRow = { sector: string; allocation: number; target?: number };
    const sectors: SectorRow[] = Array.isArray(data?.sectors) ? data.sectors : [];
    const normSectors = sectors.map((s) => ({
      label: s.sector || "Other",
      alloc: s.allocation > 1 ? s.allocation : s.allocation * 100,
      target: typeof s.target === "number" ? (s.target > 1 ? s.target : s.target * 100) : undefined,
    }));

    const piePalette = [
      "#93c5fd", "#86efac", "#fcd34d", "#fca5a5", "#c4b5fd",
      "#67e8f9", "#bef264", "#fdba74", "#fda4af", "#7dd3fc",
      "#d8b4fe", "#86efac", "#fde047", "#f9a8d4", "#99f6e4",
      "#94a3b8",
    ];
    const colors = normSectors.map((_, i) => piePalette[i % piePalette.length]);

    let allocationChartUri = "";
    if (normSectors.length) {
      // Filter out sectors with 0 allocation
      const nonZeroSectors = normSectors.filter(s => s.alloc > 0);
      allocationChartUri = await chartToDataUri(
        {
          type: "pie",
          data: {
            labels: nonZeroSectors.map((s) => s.label),
            datasets: [
              {
                data: nonZeroSectors.map((s) => Number(s.alloc.toFixed(2))),
                
                backgroundColor: colors,
                borderColor: "#ffffff",
                borderWidth: 1,
              },
            ],
          },
          options: {
            layout: {
              padding: { left: 8, right: 8, top: 8, bottom: 8 },
            },
            plugins: {
              legend: {
                position: "bottom",
                labels: {
                  font: { size: 28 },
                  boxWidth: 22,
                  boxHeight: 16,
                  padding: 20,
                  usePointStyle: true,
                },
              },
              title: { display: true, text: "Sector Allocation", font: { size: 18 } },
            },
          },
        },
        900,
        760
      );
    }

    // 6) Sector mappings
    const sectorByTicker = new Map<string, string>();
    if (Array.isArray(data?.holdingSectors)) {
      for (const row of data.holdingSectors) {
        if (row?.ticker && row?.sector) sectorByTicker.set(String(row.ticker).toUpperCase(), normSectorName(row.sector));
      }
    }
    if (Array.isArray(data?.holdings)) {
      for (const h of data.holdings) {
        const t = h?.ticker ? String(h.ticker).toUpperCase() : null;
        const s = h?.sector || h?.meta?.sector;
        if (t && s) sectorByTicker.set(t, normSectorName(s));
      }
    }

    const holdings: any[] = Array.isArray(portfolio.portfolio_holdings) ? portfolio.portfolio_holdings : [];
    const tickersNeedingSector = holdings
      .map((h) => String(h?.ticker || "").toUpperCase())
      .filter((t) => t && !sectorByTicker.has(t));

    if (tickersNeedingSector.length) {
      await Promise.all(
        tickersNeedingSector.map(async (t) => {
          const sec = await getSectorForTicker(t);
          if (sec) sectorByTicker.set(t, normSectorName(sec));
        })
      );
    }

    // 7) Compute sector tilts and recommendations
    const norm = normSectors.map((s) => {
      const allocation = Number((s.alloc ?? 0).toFixed(2));
      const target = typeof s.target === "number" ? Number(s.target.toFixed(2)) : undefined;
      const active = typeof target === "number" ? Number((allocation - target).toFixed(2)) : undefined;
      return { sector: s.label, allocation, target, active };
    });

    const withTargets = norm.filter((s) => typeof s.target === "number");
    const largestPositive = withTargets
      .filter((s) => typeof s.active === "number")
      .sort((a, b) => (b.active! - a.active!))
      [0];

    const largestNegative = withTargets
      .filter((s) => typeof s.active === "number")
      .sort((a, b) => (a.active! - b.active!))
      [0];

    let positiveTiltHolding: { ticker: string; weight: number } | null = null;
    if (largestPositive) {
      const sectorName = normSectorName(largestPositive.sector);
      const inSector = holdings
        .map((h) => {
          const t = String(h?.ticker || "").toUpperCase();
          const w = typeof h?.weight === "number" ? (h.weight > 1 ? h.weight : h.weight * 100) : 0;
          const s = sectorByTicker.get(t);
          return { ticker: t, weight: w, sector: s };
        })
        .filter((x) => normSectorName(x.sector) === sectorName);

      if (inSector.length) {
        inSector.sort((a, b) => b.weight - a.weight);
        if (inSector[0]) positiveTiltHolding = { ticker: inSector[0].ticker, weight: inSector[0].weight };
      }
    }

    let negativeTiltSuggestions: { symbol: string; marketCap: number }[] = [];
    if (largestNegative) {
      const negSector = normSectorName(largestNegative.sector);
      const candidateList =
        SECTOR_LEADERS[negSector] ||
        SECTOR_LEADERS[negSector.replace("Financial Services", "Financials")] ||
        SECTOR_LEADERS[negSector.replace("Information Technology", "Technology")] ||
        [];
      if (candidateList.length) {
        const caps = await getMarketCaps(candidateList);
        negativeTiltSuggestions = Object.entries(caps)
          .map(([symbol, mc]) => ({ symbol, marketCap: mc }))
          .sort((a, b) => b.marketCap - a.marketCap)
          .slice(0, 3);
      }
    }

    const tickers = holdings
      .map(h => String(h?.ticker || "").toUpperCase())
      .filter(t => t && t !== "CASH");

    // 8) Performance attribution and analytics
    const [benchHist, ...holdHists] = await Promise.all([
      getDailyHistoryAdjClose(benchmark || "^GSPC", 252),
      ...tickers.map(t => getDailyHistoryAdjClose(t, 252))
    ]);

    const benchRets = toDailyReturns(benchHist);
    const holdRetsArr = holdHists.map(h => toDailyReturns(h));

    const allForAlign = [benchRets, ...holdRetsArr];
    const datesCommon = alignByDate(allForAlign);
    const datesRecent = datesCommon.slice(-130);

    const rawWeights = tickers.map((t, i) => {
      const w = typeof holdings[i]?.weight === "number" ? holdings[i].weight : 0;
      return w > 1 ? w/100 : w;
    });
    const wSum = rawWeights.reduce((s,x)=>s+(x||0),0) || 1;
    const weights = rawWeights.map(w => (w || 0)/wSum);

    const benchVec = datesRecent.map(d => benchRets.find(x => x.date === d)?.r ?? 0);
    const holdMat = holdRetsArr.map(arr => datesRecent.map(d => arr.find(x => x.date === d)?.r ?? 0));

    const corrToBench = tickers.map((t, i) => ({
      ticker: t,
      corr: corr(holdMat[i], benchVec)
    }))
    .filter(x => isFinite(x.corr))
    .sort((a,b)=>b.corr - a.corr);

    const portDaily = datesRecent.map((_, j) => {
      let r = 0;
      for (let i=0;i<holdMat.length;i++) r += weights[i] * holdMat[i][j];
      return r;
    });
    const dailyVol = stddev(portDaily);
    const annVol = dailyVol * Math.sqrt(252);
    const var95 = (dailyVol * 1.65) * 100;

    const twelveMonthDates = alignByDate([benchRets, ...holdRetsArr]);
    const use12m = twelveMonthDates.slice(-252);
    const totalReturn = (series: {date:string; r:number}[], ds: string[]) => {
      const idxs = series.filter(x => ds.includes(x.date));
      let acc = 1;
      for (const x of idxs) acc *= (1 + (x.r || 0));
      return acc - 1;
    };
    const attrib = tickers.map((t, i) => {
      const ret = totalReturn(holdRetsArr[i], use12m);
      const contrib = (weights[i] || 0) * ret;
      return { ticker: t, weight: (weights[i]||0)*100, ret: ret*100, contrib: contrib*100 };
    })
    .filter(x => isFinite(x.ret) && isFinite(x.contrib))
    .sort((a,b)=>Math.abs(b.contrib) - Math.abs(a.contrib));

    const topContrib = attrib.slice(0, 8);
    const posContrib = attrib.filter(a => a.contrib >= 0).slice(0,5);
    const negContrib = attrib.filter(a => a.contrib < 0).slice(0,5);

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

    const contribChartUri = await chartToDataUri({
      type: "bar",
      data: {
        labels: topContrib.map(x => x.ticker),
        datasets: [{
          label: "Contribution (pp)",
          data: topContrib.map(x => Number(x.contrib.toFixed(2))),
          backgroundColor: '#93c5fd',
          borderColor: '#60a5fa',
          borderWidth: 1
        }]
      },
      options: {
        plugins: { title: { display: true, text: "Top Contributors / Detractors (12m)" }, legend: { display: false } },
        scales: { y: { title: { display: true, text: "percentage points" } } }
      }
    }, 1100, 420);

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

    const yieldBars = fundRows
      .filter(r => typeof r.dividendYieldPct === "number")
      .sort((a,b)=> (b.dividendYieldPct! - a.dividendYieldPct!))
      .slice(0, 12);
    const yieldChartUri = await chartToDataUri({
      type: "bar",
      data: {
        labels: yieldBars.map(r => r.ticker),
        datasets: [{ 
          label: "Dividend Yield (%)", 
          data: yieldBars.map(r => Number(r.dividendYieldPct!.toFixed(2))),
          backgroundColor: '#86efac',
          borderColor: '#4ade80',
          borderWidth: 1
        }]
      },
      options: {
        plugins: { title: { display: true, text: "Dividend Yield by Holding (Top 12)" }, legend: { display: false } },
        scales: { y: { title: { display: true, text: "percent" } } }
      }
    }, 1100, 420);

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

    const metrics = data?.metrics || {};
    const risk = data?.risk || {};
    const portfolioReturn = typeof metrics.portfolioReturn === "number" ? metrics.portfolioReturn : null;
    const benchmarkReturn = typeof metrics.benchmarkReturn === "number" ? metrics.benchmarkReturn : null;
    const volatility = typeof metrics.volatility === "number" ? metrics.volatility : null;
    const sharpeRatio = typeof metrics.sharpeRatio === "number" ? metrics.sharpeRatio : null;
    const maxDrawdown = typeof metrics.maxDrawdown === "number" ? metrics.maxDrawdown : null;
    const concentrationLevel = risk?.concentration?.level ?? "—";
    const largestPositionPct = risk?.concentration?.largestPositionPct ?? null;
    const diversificationScore = risk?.diversification?.score ?? null;
    const diversificationHoldings = risk?.diversification?.holdings ?? null;
    const diversificationTop2 = risk?.diversification?.top2Pct ?? null;
    const portfolioBetaSpx = typeof metrics.portfolioBetaSpx === "number" ? metrics.portfolioBetaSpx : null;

    // 9) Render HTML
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
    });

    const responsePayload = {
      html: pdfHtml,
      filename: `${String(portfolio.name ?? "Portfolio").replace(/\s+/g, "_")}_Analysis_Report.pdf`,
    };

    const durationMs = Date.now() - startedAt;
    console.info("[pdf] generation success", {
      portfolioId: params.id,
      durationMs,
      holdings: Array.isArray(portfolio.portfolio_holdings) ? portfolio.portfolio_holdings.length : 0,
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    if (error instanceof PdfGenerationError) {
      console.error("[pdf] generation failure", {
        portfolioId: params.id,
        durationMs,
        upstream: error.meta.upstream,
        status: error.meta.status,
        message: error.message,
      });
      const status = error.meta.status ?? 502;
      return NextResponse.json(
        { error: error.meta.publicMessage ?? "Failed to generate PDF", upstream: error.meta.upstream ?? null },
        { status },
      );
    }

    console.error("Error generating PDF:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}


