// app/api/portfolio/[id]/summary/route.ts
import { NextResponse } from "next/server"

type DataResponse = {
  holdings: Array<{
    id: string
    ticker: string
    price?: number
    shares: number
    weightPct: number
    returnSincePurchase: number | null
    contributionPct: number | null
    volatility12m: number | null
    beta12m: number | null
    sector?: string
    purchase_price?: number | null
  }>
  performance: Array<{ date: string; portfolio: number; benchmark?: number }>
  performanceMeta: { hasBenchmark: boolean; benchmark: string }
  sectors: Array<{ sector: string; allocation: number; target: number }>
  metrics: {
    portfolioReturn: number // YTD in your existing endpoint
    benchmarkReturn: number | null
    volatility: number
    sharpeRatio: number
    maxDrawdown: number
    beta: number
    totalValue: number
  }
  risk: {
    concentration: { level: string; largestPositionPct: number }
    diversification: { score: number; holdings: number; top2Pct: number }
    beta: { level: string; value: number }
  }
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function scoreFromTargetRange(val: number, idealMin: number, idealMax: number, hardMin: number, hardMax: number) {
  // 1.0 in [idealMin, idealMax], diminish to 0.0 at hardMin/hardMax
  if (val >= idealMin && val <= idealMax) return 1
  if (val < idealMin) return clamp01((val - hardMin) / (idealMin - hardMin))
  return clamp01((hardMax - val) / (hardMax - idealMax))
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const url = new URL(req.url)
    const origin = `${url.protocol}//${url.host}`
    const benchmark = url.searchParams.get("benchmark") || "^GSPC"

    // pull your existing computed data (so we don't duplicate data access)
    const dataRes = await fetch(`${origin}/api/portfolio/${params.id}/data?benchmark=${encodeURIComponent(benchmark)}`, {
      // Forward cookies if needed:
      headers: { cookie: (req.headers.get("cookie") ?? "") },
      cache: "no-store",
    })
    if (!dataRes.ok) {
      return NextResponse.json({ error: "Failed to load portfolio data" }, { status: 500 })
    }
    const d = (await dataRes.json()) as DataResponse

    // ---------- Basic KPIs ----------
    const holdingsCount = d?.risk?.diversification?.holdings ?? d.holdings?.length ?? 0
    const sharpeRatio = d?.metrics?.sharpeRatio ?? null

    // Total return (since purchase) – only if cost basis exists for a majority of the portfolio
    const withCost = d.holdings.filter(h => typeof h.returnSincePurchase === "number" && isFinite(h.returnSincePurchase as number))
    const weightSumWithCost = withCost.reduce((a, h) => a + (h.weightPct || 0), 0)
    const hasMeaningfulCostBasis = weightSumWithCost >= 50 // >=50% of weight has cost basis

    const totalReturnPct =
      hasMeaningfulCostBasis
        ? withCost.reduce((acc, h) => acc + (h.returnSincePurchase as number) * (h.weightPct / 100), 0)
        : null

    // ---------- Allocation scoring ----------
    // Active share at sector level: 0.5 * sum(|allocation - target|)
    const diffs = (d.sectors ?? []).map(s => Math.abs((s.allocation ?? 0) - (s.target ?? 0)))
    const activeShare = 0.5 * diffs.reduce((a, b) => a + b, 0) // 0..100
    // Lower is better. 0% -> 100 score, 30%+ -> floor near 20.
    const allocationScore = clamp01(1 - activeShare / 30) * 0.8 + 0.2 // soften

    // Diversification comes 0..10 in your data – rescale
    const diversificationScoreRaw = typeof d?.risk?.diversification?.score === "number" ? d.risk.diversification.score : 5
    const diversificationScore = clamp01(diversificationScoreRaw / 10)

    // Concentration – largest position; <=10% ideal, >30% poor
    const largest = d?.risk?.concentration?.largestPositionPct ?? 15
    const concentrationScore = scoreFromTargetRange(largest, 0, 10, 0, 30)

    // ---------- Risk scoring ----------
    const vol = d?.metrics?.volatility ?? 15
    const volScore = scoreFromTargetRange(vol, 10, 15, 5, 35)

    const beta = typeof d?.metrics?.beta === "number" ? d.metrics.beta : 1
    const betaScore = clamp01(1 - Math.min(Math.abs(beta - 1), 1)) // closeness to 1

    const mdd = d?.metrics?.maxDrawdown ?? -20 // negative number
    // Less negative is better: -5% ideal, -35% poor
    const drawdownScore = scoreFromTargetRange(Math.abs(mdd), 5, 12, 0, 35)

    // ---------- Performance scoring ----------
    const rel = typeof d?.metrics?.benchmarkReturn === "number"
      ? (d.metrics.portfolioReturn - (d.metrics.benchmarkReturn as number))
      : null

    //  +10pp vs. benchmark -> great; -10pp -> poor. Map -15..+15 to 0..1
    const relScore = rel == null ? 0.5 : clamp01((rel + 15) / 30)

    // Absolute YTD also nudges – 0..30% to 0..1
    const absScore = clamp01((d.metrics.portfolioReturn) / 30)

    const performanceScore = rel == null ? 0.5 * absScore + 0.5 * 0.5 : 0.6 * relScore + 0.4 * absScore

    // ---------- Quality / “fundamentals proxy” ----------
    // We don’t have full fundamentals here, so we proxy with per-holding risk/return:
    //   + Positive contribution & return
    //   + Lower vol & beta closer to 1
    // Weighted by weightPct.
    const q = d.holdings.map(h => {
      const w = (h.weightPct ?? 0) / 100
      const rr = typeof h.returnSincePurchase === "number" ? clamp01((h.returnSincePurchase + 25) / 50) : 0.5 // -25..+25 → 0..1
      const contrib = typeof h.contributionPct === "number" ? clamp01((h.contributionPct + 2) / 4) : 0.5 // -2..+2 → 0..1
      const volH = typeof h.volatility12m === "number" ? scoreFromTargetRange(h.volatility12m, 10, 20, 5, 50) : 0.5
      const betaH = typeof h.beta12m === "number" ? clamp01(1 - Math.min(Math.abs(h.beta12m - 1), 1)) : 0.5
      const per = 0.35 * rr + 0.25 * contrib + 0.2 * volH + 0.2 * betaH
      return { w, per }
    })
    const qualityScore = q.length
      ? clamp01(q.reduce((a, x) => a + x.per * x.w, 0) / Math.max(0.0001, q.reduce((a, x) => a + x.w, 0)))
      : 0.5

    // ---------- Explainable overall ----------
    // Weights (must sum to 1)
    const weights = {
      allocation: 0.25, // allocationScore, diversification, concentration
      risk: 0.30,       // vol, beta, drawdown
      performance: 0.20,
      quality: 0.25,
    }

    const allocationBlend = 0.5 * allocationScore + 0.3 * diversificationScore + 0.2 * concentrationScore
    const riskBlend = 0.4 * volScore + 0.35 * drawdownScore + 0.25 * betaScore

    const components = [
      {
        key: "allocation",
        label: "Allocation & Diversification",
        weight: weights.allocation,
        score: allocationBlend,
        rationale: [
          `Active sector difference ~${activeShare.toFixed(1)}%`,
          `Diversification score ${(diversificationScoreRaw ?? 0).toFixed(1)}/10`,
          `Largest position ${largest.toFixed(1)}%`,
        ],
      },
      {
        key: "risk",
        label: "Risk Profile",
        weight: weights.risk,
        score: riskBlend,
        rationale: [
          `Volatility ${vol.toFixed(1)}%`,
          `Max drawdown ${mdd.toFixed(1)}%`,
          `Beta ${beta.toFixed(2)}`,
        ],
      },
      {
        key: "performance",
        label: "Performance",
        weight: weights.performance,
        score: performanceScore,
        rationale: [
          `YTD ${d.metrics.portfolioReturn.toFixed(1)}%`,
          `Rel. to benchmark ${rel == null ? "—" : `${rel.toFixed(1)}pp`}`,
        ],
      },
      {
        key: "quality",
        label: "Holdings Quality (proxy)",
        weight: weights.quality,
        score: qualityScore,
        rationale: [
          `Weighted return/contribution, vol & beta at holding level`,
        ],
      },
    ].map(c => ({
      ...c,
      contribution: Math.round(c.weight * c.score * 100),
      scorePct: Math.round(c.score * 100),
    }))

    const overallScore = Math.round(
      components.reduce((acc, c) => acc + c.weight * c.score, 0) * 100
    )

    // Drivers
    const positives: string[] = []
    const negatives: string[] = []

    if (activeShare <= 20) positives.push("Sector alignment close to benchmark")
    else negatives.push("Large sector tilts vs benchmark")

    if ((diversificationScoreRaw ?? 5) >= 7) positives.push("Good diversification across holdings")
    else negatives.push("Diversification can be improved")

    if (largest <= 12) positives.push("No oversized positions")
    else negatives.push("Concentration risk: a position >12%")

    if (vol <= 15) positives.push("Volatility within healthy range")
    else negatives.push("Elevated volatility")

    if (mdd > -12) positives.push("Drawdowns have been contained")
    else negatives.push("Large historical drawdowns")

    if (beta >= 0.9 && beta <= 1.1) positives.push("Market risk close to S&P 500")
    else negatives.push("Beta deviates materially from 1")

    if (rel != null) {
      if (rel >= 0) positives.push(`Outperforming benchmark by ${rel.toFixed(1)}pp`)
      else negatives.push(`Underperforming benchmark by ${Math.abs(rel).toFixed(1)}pp`)
    }

    return NextResponse.json({
      overall: {
        score: overallScore,                // 0..100
        components,                         // explainable breakdown
        drivers: { positives, negatives },  // quick bullets
      },
      summaryMetrics: {
        totalReturnPct,                     // null when cost basis insufficient
        holdingsCount,
        sharpeRatio,
        hasMeaningfulCostBasis,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 })
  }
}
