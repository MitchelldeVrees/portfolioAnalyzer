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
    .select("id, user_id")
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
  payload: { insights: any; recommendations?: any; meta?: any },
) {
  const asOf = payload?.meta?.todayISO ?? null
  const lookback = payload?.meta?.lookbackDays ?? STALE_AFTER_DAYS
  const { data, error } = await supabase
    .from("portfolio_research")
    .insert({
      portfolio_id: portfolioId,
      as_of_date: asOf,
      lookback_days: lookback,
      research: payload.insights,
      recommendations: payload.recommendations ?? null,
      meta: payload.meta ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function generateResearchViaInternalAPI(request: NextRequest, portfolioId: string, tickers: string[]) {
  const url = new URL("/api/research", request.url)
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers, portfolioData: { metrics: {} }, newsLookbackDays: STALE_AFTER_DAYS }),
    // Let Next route handle caching. We want a fresh response.
  })
  if (!res.ok) throw new Error("Failed to generate research")
  return (await res.json()) as { insights: any; recommendations?: any; meta?: any }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const portfolio = await ensureOwnership(supabase, params.id)
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // 1) Return fresh-enough research if present
    const existing = await loadLatestResearch(supabase, params.id)
    if (existing) {
      const ageDays = daysBetween(new Date(), new Date(existing.created_at))
      if (ageDays <= STALE_AFTER_DAYS) {
        return NextResponse.json({
          insights: existing.research,
          recommendations: existing.recommendations || [],
          meta: existing.meta || {},
          persisted: true,
          created_at: existing.created_at,
        })
      }
    }

    // 2) Generate and persist new research
    const tickers = await loadTickers(supabase, params.id)
    if (tickers.length === 0) return NextResponse.json({ error: "No holdings" }, { status: 400 })

    const generated = await generateResearchViaInternalAPI(request, params.id, tickers)
    const saved = await persistResearch(supabase, params.id, generated)

    return NextResponse.json({
      insights: saved.research,
      recommendations: saved.recommendations || [],
      meta: saved.meta || {},
      persisted: true,
      created_at: saved.created_at,
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

    const generated = await generateResearchViaInternalAPI(request, params.id, tickers)
    const saved = await persistResearch(supabase, params.id, generated)

    return NextResponse.json({
      insights: saved.research,
      recommendations: saved.recommendations || [],
      meta: saved.meta || {},
      persisted: true,
      created_at: saved.created_at,
    })
  } catch (err) {
    console.error("Error refreshing research:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

