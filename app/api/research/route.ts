import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import yahooFinance from "yahoo-finance2"
import { createServerClient } from '@supabase/ssr'
import { fetchCuratedNewsForTickers } from "@/lib/news-curation"
import { cookies } from 'next/headers'

type PortfolioSnapshot = {
  name?: string | null
  id?: string
  metrics?: Record<string, any>
  risk?: Record<string, any>
  performance?: Array<{ date: string; portfolio: number; benchmark?: number }>
  performanceMeta?: Record<string, any>
  holdings?: Array<{
    ticker: string
    weightPct?: number
    sector?: string
    price?: number
    returnSincePurchase?: number | null
    beta12m?: number | null
    riskBucket?: string | null
  }>
  sectors?: Array<{ sector: string; allocation: number; target?: number }>
}

type FundamentalSnapshot = {
  ticker: string
  name?: string | null
  sector?: string | null
  industry?: string | null
  marketCap?: number | null
  trailingPE?: number | null
  forwardPE?: number | null
  pegRatio?: number | null
  dividendYieldPct?: number | null
  revenueGrowth?: number | null
  epsForward?: number | null
  profitMargin?: number | null
}

type NewsBrief = {
  ticker: string
  title: string
  source: string
  date: string
  url: string
  summary: string
}

const openai = (() => {
  const apiKey = process.env.OPENAI_API_KEY
  return apiKey ? new OpenAI({ apiKey }) : null
})()

const MODEL = "gpt-4.1-mini"

const DEFAULT_LOOKBACK = 7
const MAX_NEWS_PER_TICKER = 3
const MAX_TICKERS_FOR_FUNDAMENTALS = 8

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies()

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Return all cookies as an array of { name, value }
          return cookieStore.getAll().map(({ name, value }) => ({ name, value }))
        },
        setAll(cookies: { name: string; value: string }[]) {
          // Set all cookies from the array
          cookies.forEach(({ name, value }) => cookieStore.set({ name, value }))
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()

  
  if (!openai) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 })
  }

  
  try {
    const body = await request.json()
    const { tickers: tickersInput, portfolioData, newsLookbackDays } = body;
    
    if (!Array.isArray(tickersInput) || tickersInput.length === 0) {
      return NextResponse.json({ error: "tickers array is required" }, { status: 400 })
    }

    const lookback: 7 | 14 = newsLookbackDays === 7 ? 7 : 14; // default 14

    const todayISO = isoDateOnly(new Date());
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - lookback);
    const cutoffISO = isoDateOnly(cutoff);

    
    // Allowed domains for higher quality financial news sources
    const allowedDomains = [
      "finance.yahoo.com",
      "yahoo.com",
      "reuters.com",
      "bloomberg.com",
      "wsj.com",
      "ft.com",
      "cnbc.com",
      "marketwatch.com",
      "barrons.com",
      "investors.com",
      "fool.com",
      "seekingalpha.com",
      "sec.gov",
    ];

    function hostnameFromUrl(u: string): string | null {
      try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
    }

    const tickers = Array.from(
      new Set(
        tickersInput
          .map((t) => (typeof t === "string" ? t.trim().toUpperCase() : ""))
          .filter((t) => t.length > 0),
      ),
    )

    const lookbackDays = Number.isFinite(body?.lookbackDays) ? Math.max(1, body.lookbackDays) : DEFAULT_LOOKBACK
    const portfolioSnapshot: PortfolioSnapshot | null = sanitizePortfolioSnapshot(body?.portfolio)

    const [newsMap, fundamentals] = await Promise.all([
      fetchCuratedNewsForTickers(tickers, lookbackDays).catch(() => ({} as Record<string, any[]>)),
      fetchFundamentalSnapshots(tickers.slice(0, MAX_TICKERS_FOR_FUNDAMENTALS)).catch(() => [] as FundamentalSnapshot[]),
    ])

    const newsBriefs = normalizeNews(newsMap)
    const newsSources = newsBriefs.map((n) => ({ ticker: n.ticker, source: n.source, url: n.url, date: n.date }))

    const aiRequestPayload = {
      tickers,
      news: newsBriefs,
      fundamentals,
      portfolio: portfolioSnapshot,
      lookbackDays,
    }

    const schema = buildResearchSchema()

    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      response_format: { type: "json_schema", json_schema: schema },
      messages: [
        {
          role: "system",
          content:
            "You are an equity research analyst. Produce concise, actionable insights based strictly on the provided data.",
        },
        {
          role: "user",
          content:
            `Portfolio context and raw data:\n${JSON.stringify(aiRequestPayload, null, 2)}\n\n` +
            "Return a JSON object that conforms to the provided schema. Do not include any additional text.",
        },
      ],
    })

    const aiText = completion.choices?.[0]?.message?.content
    if (!aiText) {
      throw new Error("Failed to read response from OpenAI")
    }

    const parsed = JSON.parse(aiText)
    const recommendations = Array.isArray(parsed?.fundamentalComparative?.recommendations)
      ? parsed.fundamentalComparative.recommendations
      : []

    return NextResponse.json({
      realTimeNews: parsed.realTimeNews,
      riskAndScenarioModeling: parsed.riskAndScenarioModeling,
      fundamentalComparative: parsed.fundamentalComparative,
      recommendations,
      metadata: {
        generatedAt: new Date().toISOString(),
        newsSources,
        model: MODEL,
      },
    })
  } catch (error) {
    console.error("/api/research error", error)
    return NextResponse.json({ error: "Failed to generate research" }, { status: 500 })
  }
}

function sanitizePortfolioSnapshot(snapshot: any): PortfolioSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null
  type SanitizedHolding = NonNullable<PortfolioSnapshot["holdings"]>[number]
  const holdings: SanitizedHolding[] = Array.isArray(snapshot?.holdings)
    ? (snapshot.holdings as any[])
        .slice(0, 25)
        .map((raw) => {
          const holding: SanitizedHolding = {
            ticker: typeof raw?.ticker === "string" ? raw.ticker.toUpperCase() : "",
            weightPct: isFiniteNumber(raw?.weightPct) ? Number(raw.weightPct) : undefined,
            sector: typeof raw?.sector === "string" ? raw.sector : undefined,
            price: isFiniteNumber(raw?.price) ? Number(raw.price) : undefined,
            returnSincePurchase: isFiniteNumber(raw?.returnSincePurchase) ? Number(raw.returnSincePurchase) : null,
            beta12m: isFiniteNumber(raw?.beta12m) ? Number(raw.beta12m) : null,
            riskBucket: typeof raw?.riskBucket === "string" ? raw.riskBucket : undefined,
          }
          return holding
        })
        .filter((holding) => holding.ticker.length > 0)
    : []

  return {
    name: typeof snapshot.name === "string" ? snapshot.name : undefined,
    id: typeof snapshot.id === "string" ? snapshot.id : undefined,
    metrics: snapshot.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : undefined,
    risk: snapshot.risk && typeof snapshot.risk === "object" ? snapshot.risk : undefined,
    performance: Array.isArray(snapshot.performance) ? snapshot.performance.slice(-12) : undefined,
    performanceMeta:
      snapshot.performanceMeta && typeof snapshot.performanceMeta === "object" ? snapshot.performanceMeta : undefined,
    sectors: Array.isArray(snapshot.sectors) ? snapshot.sectors.slice(0, 12) : undefined,
    holdings,
  }
}

function normalizeNews(newsMap: Record<string, any[]>): NewsBrief[] {
  const output: NewsBrief[] = []
  for (const [ticker, articles] of Object.entries(newsMap)) {
    if (!Array.isArray(articles)) continue
    for (const article of articles.slice(0, MAX_NEWS_PER_TICKER)) {
      const title = asString(article?.title)
      const url = asString(article?.url)
      if (!title || !url) continue
      output.push({
        ticker: ticker.toUpperCase(),
        title,
        source: asString(article?.source) || "Unknown",
        date: asString(article?.date) || "",
        url,
        summary: asString(article?.summary) || "",
      })
    }
  }
  return output.slice(0, 24)
}

async function fetchFundamentalSnapshots(tickers: string[]): Promise<FundamentalSnapshot[]> {
  const results: Array<FundamentalSnapshot | null> = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const summary: any = await yahooFinance.quoteSummary(ticker, {
          modules: ["price", "summaryProfile", "financialData", "defaultKeyStatistics", "summaryDetail"],
        })

        const companyName = summary?.price?.longName || summary?.price?.shortName || null
        const sector = summary?.summaryProfile?.sector || null
        const industry = summary?.summaryProfile?.industry || null
        const marketCap = safeNumber(summary?.price?.marketCap)
        const trailingPE = safeNumber(summary?.summaryDetail?.trailingPE)
        const forwardPE = safeNumber(summary?.summaryDetail?.forwardPE)
        const pegRatio = safeNumber(summary?.defaultKeyStatistics?.pegRatio)
        const dividendYieldBase = safeNumber(summary?.summaryDetail?.dividendYield)
        const dividendYieldPct = dividendYieldBase != null ? dividendYieldBase * 100 : null
        const revenueGrowth = safeNumber(summary?.financialData?.revenueGrowth)
        const epsForward = safeNumber(summary?.financialData?.epsForward)
        const profitMargin = safeNumber(summary?.financialData?.profitMargins)

        const snapshot: FundamentalSnapshot = {
          ticker,
          name: typeof companyName === "string" ? companyName : undefined,
          sector: typeof sector === "string" ? sector : undefined,
          industry: typeof industry === "string" ? industry : undefined,
          marketCap,
          trailingPE,
          forwardPE,
          pegRatio,
          dividendYieldPct,
          revenueGrowth,
          epsForward,
          profitMargin,
        }
        return snapshot
      } catch (error) {
        console.warn(`[research] fundamentals failed for ${ticker}:`, error)
        return null
      }
    }),
  )

  return results.filter((item): item is FundamentalSnapshot => item !== null)
}

function buildResearchSchema() {
  return {
    name: "ResearchReport",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        realTimeNews: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "keyThemes", "sentimentScore", "items"],
          properties: {
            summary: { type: "string" },
            keyThemes: {
              type: "array",
              items: { type: "string" },
              maxItems: 6,
            },
            sentimentScore: {
              type: "object",
              additionalProperties: false,
              properties: {
                positive: { type: "number" },
                neutral: { type: "number" },
                negative: { type: "number" },
              },
              required: ["positive", "neutral", "negative"],
            },
            items: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["ticker", "headline", "sentiment", "impact", "summary"],  // Kept impact required as before
                properties: {
                  ticker: { type: "string" },
                  headline: { type: "string" },
                  sentiment: { enum: ["positive", "neutral", "negative"] },
                  impact: { enum: ["high", "medium", "low"] },  // No default needed since required
                  summary: { type: "string" },
                  themes: { 
                    type: "array", 
                    items: { type: "string" }, 
                    maxItems: 4,
                    default: []  // Added default to make optional
                  },
                  source: { 
                    type: ["string", "null"],  // Allow null
                    default: null  // Added default to make optional
                  },
                  date: { 
                    type: ["string", "null"], 
                    default: null  // Added default
                  },
                  url: { 
                    type: ["string", "null"], 
                    default: null  // Added default
                  },
                },
              },
            },
          },
        },
        riskAndScenarioModeling: {
          type: "object",
          additionalProperties: false,
          required: ["overview", "scenarios", "methodology"],
          properties: {
            overview: { type: "string" },
            methodology: { type: "string" },
            scenarios: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description", "expectedOutcome", "impactOnPortfolio", "suggestedActions"],
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  assumptions: { 
                    type: "array", 
                    items: { type: "string" }, 
                    maxItems: 5,
                    default: []  // Added default to make optional (was missing)
                  },
                  expectedOutcome: { type: "string" },
                  impactOnPortfolio: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      returnPct: { 
                        type: ["number", "null"],  // Allow null to make optional
                        default: null  // Added default
                      },
                      maxDrawdownPct: { 
                        type: ["number", "null"], 
                        default: null  // Added default
                      },
                    },
                  },
                  suggestedActions: { 
                    type: "array", 
                    items: { type: "string" }, 
                    maxItems: 5 
                  },
                },
              },
            },
          },
        },
        fundamentalComparative: {
          type: "object",
          additionalProperties: false,
          required: ["overview", "holdings", "recommendations"],
          properties: {
            overview: { type: "string" },
            holdings: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["ticker", "narrative", "metrics"],
                properties: {
                  ticker: { type: "string" },
                  narrative: { type: "string" },
                  metrics: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["label", "value"],
                      properties: {
                        label: { type: "string" },
                        value: { type: "string" },
                      },
                    },
                    maxItems: 6,
                  },
                  peerComparison: { 
                    type: ["string", "null"],  // Allow null
                    default: null  // Added default to make optional (was missing)
                  },
                  esgNote: { 
                    type: ["string", "null"],
                    default: null  // Added default (was missing, even though type allows null)
                  },
                },
              },
            },
            recommendations: {
              type: "array",
              items: { type: "string" },
              maxItems: 6,
            },
          },
        },
      },
      required: ["realTimeNews", "riskAndScenarioModeling", "fundamentalComparative"],
    },
    strict: true,
  }
}

function safeNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value?.raw === "number" && Number.isFinite(value.raw)) return value.raw
  if (typeof value?.fmt === "string") {
    const parsed = Number(value.fmt.replace(/[^0-9.-]/g, ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asString(value: any): string {
  return typeof value === "string" ? value : ""
}

function isFiniteNumber(value: any): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

