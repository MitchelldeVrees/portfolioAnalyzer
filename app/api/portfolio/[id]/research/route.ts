// /app/api/portfolio/[id]/research/route.ts
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const STALE_AFTER_DAYS = 14

function daysBetween(a: Date, b: Date) {
  return Math.floor((+a - +b) / (1000 * 60 * 60 * 24))
}

async function ensureOwnership(supabase: any, portfolioId: string) {
  const { data: portfolio, error } = await supabase
    .from("portfolios")
    .select("id, user_id, name")
    .eq("id", portfolioId)
    .single()
  if (error || !portfolio) return null
  return portfolio
}

async function loadTickers(supabase: any, portfolioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select("ticker")
    .eq("portfolio_id", portfolioId)
  if (error || !data) return []
  return (data as { ticker: string }[]).map((r) => (r.ticker || "").toUpperCase())
}

async function loadLatestResearch(supabase: any, portfolioId: string) {
  const { data, error } = await supabase
    .from("portfolio_research")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data
}

async function persistResearch(
  supabase: any,
  portfolioId: string,
  payload: { research: any; recommendations?: any[]; meta?: any },
) {
  const asOf = payload?.meta?.generatedAt ?? null
  const lookback = payload?.meta?.lookbackDays ?? STALE_AFTER_DAYS
  const { data, error } = await supabase
    .from("portfolio_research")
    .insert({
      portfolio_id: portfolioId,
      as_of_date: asOf,
      lookback_days: lookback,
      research: payload.research,
      recommendations: payload.recommendations ?? null,
      meta: payload.meta ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function generateResearchViaInternalAPI(
  request: NextRequest,
  portfolioId: string,
  tickers: string[],
  portfolioName: string | null,
) {
  const origin = new URL(request.url).origin
  const cookieHeader = request.headers.get("cookie") ?? ""

  const [dataRes, holdingsRes] = await Promise.all([
    fetch(`${origin}/api/portfolio/${portfolioId}/data`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
    fetch(`${origin}/api/portfolio/${portfolioId}/holdings`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }).catch(() => null),
  ])

  const portfolioData = dataRes && dataRes.ok ? await dataRes.json().catch(() => null) : null
  const holdingsData = holdingsRes && holdingsRes.ok ? await holdingsRes.json().catch(() => null) : null

  const payload = {
    tickers,
    lookbackDays: STALE_AFTER_DAYS,
    portfolio: buildPortfolioPayload(portfolioId, portfolioName, portfolioData, holdingsData),
  }

  const url = new URL("/api/research", request.url)
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error("Failed to generate research")
  return (await res.json()) as {
    realTimeNews: any
    riskAndScenarioModeling: any
    fundamentalComparative: any
    recommendations?: any[]
    metadata?: any
  }
}

function buildPortfolioPayload(
  portfolioId: string,
  portfolioName: string | null,
  portfolioData: any,
  holdingsData: any,
) {
  const holdings = Array.isArray(holdingsData?.holdings)
    ? holdingsData.holdings.slice(0, 25).map((h: any) => ({
        ticker: (h?.ticker || "").toUpperCase(),
        weightPct: typeof h?.weightPct === "number" ? Number(h.weightPct) : undefined,
        sector: typeof h?.sector === "string" ? h.sector : undefined,
        price: typeof h?.price === "number" ? Number(h.price) : undefined,
        returnSincePurchase:
          typeof h?.returnSincePurchase === "number" ? Number(h.returnSincePurchase) : h?.returnSincePurchase ?? null,
        beta12m: typeof h?.beta12m === "number" ? Number(h.beta12m) : undefined,
        riskBucket: typeof h?.riskBucket === "string" ? h.riskBucket : undefined,
      }))
    : []

  return {
    id: portfolioId,
    name: portfolioName ?? undefined,
    metrics: portfolioData?.metrics ?? undefined,
    risk: portfolioData?.risk ?? undefined,
    performance: Array.isArray(portfolioData?.performance)
      ? portfolioData.performance.slice(-12)
      : undefined,
    performanceMeta: portfolioData?.performanceMeta ?? undefined,
    sectors: Array.isArray(portfolioData?.sectors) ? portfolioData.sectors.slice(0, 12) : undefined,
    holdings,
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const portfolio = await ensureOwnership(supabase, params.id)
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const existing = await loadLatestResearch(supabase, params.id)
    if (existing) {
      const ageDays = daysBetween(new Date(), new Date(existing.created_at))
      if (ageDays <= STALE_AFTER_DAYS) {
        return NextResponse.json({
          report: existing.research,
          recommendations: existing.recommendations || [],
          metadata: existing.meta || {},
          persisted: true,
          created_at: existing.created_at,
        })
      }
    }

    const tickers = await loadTickers(supabase, params.id)
    if (tickers.length === 0) return NextResponse.json({ error: "No holdings" }, { status: 400 })

    const generated = await generateResearchViaInternalAPI(request, params.id, tickers, portfolio.name ?? null)
    const meta = {
      ...(generated.metadata ?? {}),
      lookbackDays: STALE_AFTER_DAYS,
    }
    const toPersist = await persistResearch(supabase, params.id, {
      research: {
        realTimeNews: generated.realTimeNews,
        riskAndScenarioModeling: generated.riskAndScenarioModeling,
        fundamentalComparative: generated.fundamentalComparative,
      },
      recommendations: generated.recommendations ?? [],
      meta,
    })

    return NextResponse.json({
      report: toPersist.research,
      recommendations: toPersist.recommendations || [],
      metadata: toPersist.meta || meta,
      persisted: true,
      created_at: toPersist.created_at,
    })
  } catch (err) {
    console.error("Error ensuring research:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const portfolio = await ensureOwnership(supabase, params.id)
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const tickers = await loadTickers(supabase, params.id)
    if (tickers.length === 0) return NextResponse.json({ error: "No holdings" }, { status: 400 })

    const generated = await generateResearchViaInternalAPI(request, params.id, tickers, portfolio.name ?? null)
    const meta = {
      ...(generated.metadata ?? {}),
      lookbackDays: STALE_AFTER_DAYS,
    }
    const toPersist = await persistResearch(supabase, params.id, {
      research: {
        realTimeNews: generated.realTimeNews,
        riskAndScenarioModeling: generated.riskAndScenarioModeling,
        fundamentalComparative: generated.fundamentalComparative,
      },
      recommendations: generated.recommendations ?? [],
      meta,
    })

    return NextResponse.json({
      report: toPersist.research,
      recommendations: toPersist.recommendations || [],
      metadata: toPersist.meta || meta,
      persisted: true,
      created_at: toPersist.created_at,
    })
  } catch (err) {
    console.error("Error refreshing research:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
