import { type NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"

import { createServerClient } from "@/lib/supabase/server"

const MAX_TICKERS = 8
const MAX_RESEARCH_TICKERS = 3
const MAX_TRANSCRIPT_CHARS = 2000
const ALPHA_VANTAGE_API_BASE = "https://www.alphavantage.co/query"
const NEWS_PER_TICKER = 3
const LOOKBACK_DAYS = 30
const DEFAULT_OPENAI_MODEL = process.env.RESEARCH_MODEL ?? "gpt-4o-mini"

async function ensurePortfolioOwnership(supabase: any, portfolioId: string, userId: string) {
  const { data, error } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error || !data) return null
  return data
}

async function loadHoldingsTickers(supabase: any, portfolioId: string, limit = MAX_TICKERS): Promise<string[]> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select("ticker, weight")
    .order("weight", { ascending: false, nullsLast: true })
    .eq("portfolio_id", portfolioId)
  if (error || !data) return []
  const seen = new Set<string>()
  const tickers: string[] = []
  for (const row of data) {
    const ticker = typeof row?.ticker === "string" ? row.ticker.trim().toUpperCase() : ""
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    tickers.push(ticker)
    if (tickers.length >= limit) break
  }
  return tickers
}

type AlphaOverview = {
  Name?: string
  Description?: string
  Sector?: string
  Industry?: string
  MarketCapitalization?: string
  PERatio?: string
  ForwardPE?: string
  DividendYield?: string
  EPS?: string
  Beta?: string
}

type AlphaNewsArticle = {
  title: string
  summary?: string
  url: string
  timePublished?: string
  source?: string
  sentiment?: string
}

type PriceSnapshot = {
  latestClose: number | null
  previousClose: number | null
  changePercent1d: number | null
  changePercentLookback: number | null
  lookbackClose: number | null
}

type EarningsSummary = {
  annualReports?: any[]
  quarterlyEarnings?: any[]
  fiscalDateEnding?: string | null
  reportedEPS?: number | null
  surprisePercent?: number | null
  revenue?: number | null
}

type EarningsCallTranscript = {
  content?: string
  status?: string
  symbol?: string
  quarter?: string
  year?: string
}

type InsiderTransaction = {
  symbol?: string
  name?: string
  share?: string
  filDate?: string
  transactionType?: string
  sharePrice?: string
  totalShares?: string
}

type TickerInsight = {
  ticker: string
  overview?: AlphaOverview | null
  price?: PriceSnapshot | null
  news?: AlphaNewsArticle[]
  earnings?: EarningsSummary | null
  earningsCall?: EarningsCallTranscript | null
  insiders?: InsiderTransaction[]
  errors?: string[]
}

type TickerStory = {
  ticker: string
  summary: string
}

async function alphaFetch(params: Record<string, string>, apiKey: string) {
  const url = new URL(ALPHA_VANTAGE_API_BASE)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set("apikey", apiKey)

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "portfolio-analyzer/1.0" },
    cache: "no-store",
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed (${response.status})`)
  }

  if (!payload || payload.Note || payload.Information) {
    const reason = payload?.Note || payload?.Information || "Alpha Vantage returned no data"
    throw new Error(reason)
  }

  return payload
}

async function fetchTickerOverview(ticker: string, apiKey: string): Promise<AlphaOverview | null> {
  try {
    const payload = await alphaFetch(
      {
        function: "OVERVIEW",
        symbol: ticker,
      },
      apiKey,
    )
    if (!payload || Object.keys(payload).length === 0) return null
    return payload as AlphaOverview
  } catch (error) {
    console.warn(`[research] alpha overview failed for ${ticker}:`, (error as Error)?.message ?? error)
    return null
  }
}

async function fetchEarningsData(ticker: string, apiKey: string): Promise<EarningsSummary | null> {
  try {
    const payload = await alphaFetch(
      {
        function: "EARNINGS",
        symbol: ticker,
      },
      apiKey,
    )
    if (!payload || !payload?.quarterlyEarnings) return null
    const latest = payload.quarterlyEarnings?.[0]
    const revenue = latest?.reportedRevenue ? Number(latest.reportedRevenue) : null
    const surprise =
      latest?.surprisePercentage !== undefined && latest?.surprisePercentage !== null
        ? Number(latest.surprisePercentage)
        : null
    const summary: EarningsSummary = {
      annualReports: payload.annualReports ?? [],
      quarterlyEarnings: payload.quarterlyEarnings ?? [],
      fiscalDateEnding: latest?.fiscalDateEnding ?? null,
      reportedEPS: latest?.reportedEPS ? Number(latest.reportedEPS) : null,
      surprisePercent: surprise,
      revenue,
    }
    return summary
  } catch (error) {
    console.warn(`[research] alpha earnings failed for ${ticker}:`, (error as Error)?.message ?? error)
    return null
  }
}

function deriveQuarter(dateString?: string | null) {
  if (!dateString) return null
  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getUTCFullYear()
  const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1
  return { year, quarter }
}

async function fetchEarningsCallTranscript(
  ticker: string,
  apiKey: string,
  referenceDate?: string | null,
): Promise<EarningsCallTranscript | null> {
  try {
    const derived = deriveQuarter(referenceDate)
    if (!derived) return null
    const payload = await alphaFetch(
      {
        function: "EARNINGS_CALL_TRANSCRIPT",
        symbol: ticker,
        year: String(derived.year),
        quarter: String(derived.quarter),
      },
      apiKey,
    )
    if (!payload) return null
    const content: string | undefined = payload?.content ?? payload?.transcript
    if (!content) return null
    return {
      content: content.length > MAX_TRANSCRIPT_CHARS ? content.slice(0, MAX_TRANSCRIPT_CHARS) : content,
      status: payload?.status,
      symbol: payload?.symbol,
      quarter: String(derived.quarter),
      year: String(derived.year),
    }
  } catch (error) {
    console.warn(`[research] transcript fetch failed for ${ticker}:`, (error as Error)?.message ?? error)
    return null
  }
}

async function fetchInsiderTransactions(ticker: string, apiKey: string): Promise<InsiderTransaction[]> {
  try {
    const payload = await alphaFetch(
      {
        function: "INSIDER_TRANSACTIONS",
        symbol: ticker,
      },
      apiKey,
    )
    if (!payload) return []
    const transactions: InsiderTransaction[] = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.insider_transactions)
      ? payload.insider_transactions
      : []
    return transactions.slice(0, 10)
  } catch (error) {
    console.warn(`[research] insider fetch failed for ${ticker}:`, (error as Error)?.message ?? error)
    return []
  }
}

function parseNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function fetchTickerSeries(ticker: string, apiKey: string): Promise<PriceSnapshot | null> {
  try {
    const payload = await alphaFetch(
      {
        function: "TIME_SERIES_DAILY",
        symbol: ticker,
        outputsize: "compact",
      },
      apiKey,
    )

    const series = payload?.["Time Series (Daily)"]
    if (!series || typeof series !== "object") return null
    const dates = Object.keys(series).sort((a, b) => b.localeCompare(a))
    if (!dates.length) return null

    const latest = series[dates[0]]
    const previous = series[dates[1]]
    const lookbackDate = dates.find((_, index) => index >= LOOKBACK_DAYS) ?? dates[dates.length - 1]
    const lookback = series[lookbackDate]

    const latestClose = parseNumber(latest?.["4. close"])
    const previousClose = parseNumber(previous?.["4. close"])
    const lookbackClose = parseNumber(lookback?.["4. close"])

    const changePercent1d =
      latestClose && previousClose && previousClose !== 0 ? ((latestClose - previousClose) / previousClose) * 100 : null
    const changePercentLookback =
      latestClose && lookbackClose && lookbackClose !== 0 ? ((latestClose - lookbackClose) / lookbackClose) * 100 : null

    return {
      latestClose: latestClose ?? null,
      previousClose: previousClose ?? null,
      changePercent1d: changePercent1d !== null ? Number(changePercent1d.toFixed(2)) : null,
      changePercentLookback: changePercentLookback !== null ? Number(changePercentLookback.toFixed(2)) : null,
      lookbackClose: lookbackClose ?? null,
    }
  } catch (error) {
    console.warn(`[research] alpha series failed for ${ticker}:`, (error as Error)?.message ?? error)
    return null
  }
}

async function fetchNewsForTickers(tickers: string[], apiKey: string): Promise<Record<string, AlphaNewsArticle[]>> {
  const result: Record<string, AlphaNewsArticle[]> = Object.fromEntries(tickers.map((ticker) => [ticker, []]))
  if (!tickers.length) return result
  try {
    const limit = Math.min(NEWS_PER_TICKER * tickers.length, 50)
    const payload = await alphaFetch(
      {
        function: "NEWS_SENTIMENT",
        tickers: tickers.join(","),
        sort: "LATEST",
        limit: String(limit),
      },
      apiKey,
    )

    const feed: any[] = Array.isArray(payload?.feed) ? payload.feed : []
    for (const article of feed) {
      const sentiments: Array<{ ticker: string }> = Array.isArray(article?.ticker_sentiment) ? article.ticker_sentiment : []
      const targets = sentiments
        .map((entry) => (typeof entry?.ticker === "string" ? entry.ticker.trim().toUpperCase() : ""))
        .filter((ticker) => tickers.includes(ticker))
      if (!targets.length) continue

      const normalized: AlphaNewsArticle = {
        title: article?.title ?? article?.headline ?? "Untitled",
        summary: article?.summary ?? article?.overall_sentiment_score ?? article?.summary_detail,
        url: article?.url ?? article?.source ?? "#",
        timePublished: article?.time_published,
        source: article?.source,
        sentiment: article?.overall_sentiment_label ?? article?.overall_sentiment,
      }

      for (const ticker of targets) {
        if (!result[ticker]) {
          result[ticker] = []
        }
        if (result[ticker].length < NEWS_PER_TICKER) {
          result[ticker].push(normalized)
        }
      }
    }
  } catch (error) {
    console.warn("[research] alpha news fetch failed:", (error as Error)?.message ?? error)
  }
  return result
}

async function buildTickerInsights(tickers: string[], apiKey: string): Promise<TickerInsight[]> {
  const insights: TickerInsight[] = []

  for (const ticker of tickers) {
    const errors: string[] = []
    const overview = await fetchTickerOverview(ticker, apiKey)
    if (!overview) {
      errors.push("No overview data")
    }
    const price = await fetchTickerSeries(ticker, apiKey)
    if (!price) {
      errors.push("No price history")
    }
    const earnings = await fetchEarningsData(ticker, apiKey)
    const earningsCall = await fetchEarningsCallTranscript(ticker, apiKey, earnings?.fiscalDateEnding)
    const insiders = await fetchInsiderTransactions(ticker, apiKey)
    insights.push({
      ticker,
      overview,
      price,
      news: [],
      earnings,
      earningsCall,
      insiders,
      errors: errors.length ? errors : undefined,
    })
  }

  const newsByTicker = await fetchNewsForTickers(tickers, apiKey)
  return insights.map((insight) => ({
    ...insight,
    news: newsByTicker[insight.ticker] ?? [],
  }))
}

const RESEARCH_SYSTEM_PROMPT = `You are a financial analyst creating investor-friendly summaries.
You write concise but insightful analyses of public companies based on structured data inputs.`

const RESEARCH_USER_TEMPLATE = `You are given multiple Alpha Vantage API responses about a stock.
Your task is to write a clear, narrative-style “research summary” about this company as if shown in an investor dashboard.
Focus on recent developments, sentiment, fundamentals, and insider/macro context.

Use a confident and objective tone. Avoid hype.
Keep it factual but interpret trends logically (e.g., “sentiment has improved following better-than-expected earnings”).

Input data:
{{DATA}}

Output format:
Return plain text with 3–5 paragraphs.

1. **Summary Overview** — what’s happening right now (sentiment, news, big events).
2. **Earnings & Financials** — EPS performance, revenue, estimates, fundamental trends.
3. **Insiders & Dividends** — any recent insider buying/selling, dividend or split updates.
4. **Market Context & Risk** — macro or sector sentiment, volatility or correlation info.
5. **Closing Insight** — short takeaway (bullish/bearish/neutral outlook based on data).

Example style:
“Apple’s recent sentiment turned positive after a strong Q3 earnings beat.
Revenue grew 5% YoY, and analysts raised guidance for FY2025.
Insiders have been modest buyers in the last quarter, while volatility remains lower than peers.”

Now generate the story.`

async function generateResearchSummary(tickers: string[]): Promise<{
  summary: string
  stories: TickerStory[]
  insights: TickerInsight[]
  metadata: { model: string }
}> {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY
  if (!alphaKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured")
  }
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openAiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  const insights = await buildTickerInsights(tickers, alphaKey)
  const openai = new OpenAI({ apiKey: openAiKey })

  const stories: TickerStory[] = []

  for (const insight of insights) {
    const dataPayload = {
      ticker: insight.ticker,
      overview: insight.overview,
      price: insight.price,
      earnings: insight.earnings,
      earningsCall: insight.earningsCall,
      insiders: insight.insiders,
      news: insight.news,
      generatedAt: new Date().toISOString(),
      lookbackDays: LOOKBACK_DAYS,
    }

    const userPrompt = RESEARCH_USER_TEMPLATE.replace(
      "{{DATA}}",
      JSON.stringify(dataPayload, null, 2),
    )

    const completion = await openai.chat.completions.create({
      model: DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })

    const text = completion.choices?.[0]?.message?.content?.trim()
    if (text) {
      stories.push({ ticker: insight.ticker, summary: text })
    }
  }

  const summary = stories.map((story) => `## ${story.ticker}\n\n${story.summary}`).join("\n\n")
  return {
    summary,
    stories,
    insights,
    metadata: { model: DEFAULT_OPENAI_MODEL },
  }
}

async function loadCachedResearch(supabase: any, portfolioId: string) {
  const { data, error } = await supabase
    .from("portfolio_research")
    .select("research")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.research
}

async function persistResearchSnapshot(
  supabase: any,
  portfolioId: string,
  payload: { result: string; tickers: string[]; generatedAt: string; meta?: Record<string, unknown>; insights?: unknown },
) {
  const record = {
    portfolio_id: portfolioId,
    as_of_date: new Date().toISOString().slice(0, 10),
    lookback_days: LOOKBACK_DAYS,
    research: payload,
    meta: {
      alphaLookbackDays: LOOKBACK_DAYS,
      tickers: payload.tickers,
      ...payload.meta,
    },
  }

  const { error } = await supabase.from("portfolio_research").insert(record)
  if (error) {
    throw error
  }
}

async function withAuth(request: NextRequest, portfolioId: string) {
  const supabase = await createServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user) {
    return { supabase, user: null }
  }
  const ownership = await ensurePortfolioOwnership(supabase, portfolioId, auth.user.id)
  if (!ownership) {
    return { supabase, user: auth.user, notFound: true }
  }
  return { supabase, user: auth.user }
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { supabase, user, notFound } = await withAuth(request, context.params.id)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (notFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const cached = await loadCachedResearch(supabase, context.params.id)
    if (!cached) {
      return NextResponse.json({ tickers: [], result: "", generatedAt: null })
    }
    return NextResponse.json(cached)
  } catch (error) {
    console.error("[research] load error", error)
    return NextResponse.json({ error: "Failed to load research" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { supabase, user, notFound } = await withAuth(request, context.params.id)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (notFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const tickers = await loadHoldingsTickers(supabase, context.params.id, MAX_RESEARCH_TICKERS)
    if (!tickers.length) {
      return NextResponse.json({ error: "No holdings available for research" }, { status: 400 })
    }

    const { summary, insights, metadata } = await generateResearchSummary(tickers)
    const payload = {
      tickers,
      result: summary,
      generatedAt: new Date().toISOString(),
      stories,
      meta: { ...metadata, tickerCount: tickers.length, lookbackDays: LOOKBACK_DAYS },
      insights,
    }
    await persistResearchSnapshot(supabase, context.params.id, payload)
    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    console.error("[research] refresh error", error)
    const message = error instanceof Error ? error.message : "Failed to refresh research"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
