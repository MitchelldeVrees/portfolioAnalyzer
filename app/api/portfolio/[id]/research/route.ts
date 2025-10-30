import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase/server"

const MAX_TICKERS = 8

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

async function loadHoldingsTickers(supabase: any, portfolioId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("portfolio_holdings")
    .select("ticker")
    .eq("portfolio_id", portfolioId)
  if (error || !data) return []
  const seen = new Set<string>()
  const tickers: string[] = []
  for (const row of data) {
    const ticker = typeof row?.ticker === "string" ? row.ticker.trim().toUpperCase() : ""
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    tickers.push(ticker)
    if (tickers.length >= MAX_TICKERS) break
  }
  return tickers
}

const CHATKIT_API_BASE = "https://api.openai.com/v1"
const CHATKIT_WORKFLOW_HEADER = "workflows=v1"

function extractWorkflowText(payload: any): string {
  if (!payload) return ""

  const texts: string[] = []

  const collect = (value: any) => {
    if (!value) return
    if (typeof value === "string") {
      if (value.trim()) texts.push(value.trim())
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry)
      return
    }
    if (typeof value === "object") {
      if (value.type === "text" && typeof value.text === "string") {
        collect(value.text)
        return
      }
      if (value.type === "message" && Array.isArray(value.content)) {
        collect(value.content)
        return
      }
      if (value.output_text) {
        collect(value.output_text)
        return
      }
      for (const key of Object.keys(value)) {
        collect(value[key])
      }
    }
  }

  collect(payload.output ?? payload.outputs ?? payload.result ?? payload.response)

  if (!texts.length) {
    const fallback = typeof payload === "string" ? payload : JSON.stringify(payload)
    texts.push(fallback)
  }

  const joined = texts.join("\n\n").trim()
  return joined
}

async function runChatKitWorkflow(tickers: string[]): Promise<{ text: string; runId?: string; status?: string }> {
  const workflowId = process.env.CHATKIT_WORKFLOW_ID
  const apiKey = process.env.OPENAI_API_KEY
  if (!workflowId) {
    throw new Error("CHATKIT_WORKFLOW_ID is not configured")
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured")
  }

  
  const version = process.env.CHATKIT_WORKFLOW_VERSION
  const joinedTickers = tickers.map((ticker) => ticker.toLowerCase()).join(", ")

  const url = new URL(`${CHATKIT_API_BASE}/workflows/${workflowId}/runs`)
  if (version && version.trim().length > 0) {
    url.searchParams.set("version", version.trim())
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": CHATKIT_WORKFLOW_HEADER,
    },
    body: JSON.stringify({
      input: joinedTickers,
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    console.error("[research] chatkit workflow error", response.status, errorText)
    throw new Error(`ChatKit workflow request failed (${response.status})`)
  }

  const payload = await response.json().catch(() => null)
  const text = extractWorkflowText(payload)
  const runId = payload?.id
  const status = payload?.status

  return { text, runId, status }
}

async function handleRequest(request: NextRequest, params: { id: string }) {
  try {
    const supabase = await createServerClient()
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const ownership = await ensurePortfolioOwnership(supabase, params.id, auth.user.id)
    if (!ownership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const tickers = await loadHoldingsTickers(supabase, params.id)
    if (!tickers.length) {
      return NextResponse.json({
        tickers: [],
        result: "",
        generatedAt: new Date().toISOString(),
      })
    }

    const workflowResult = await runChatKitWorkflow(tickers)

    return NextResponse.json({
      tickers,
      result: workflowResult.text,
      generatedAt: new Date().toISOString(),
      meta: {
        tickerCount: tickers.length,
        workflowId: process.env.CHATKIT_WORKFLOW_ID,
        workflowVersion: process.env.CHATKIT_WORKFLOW_VERSION ?? "production",
        runId: workflowResult.runId,
        status: workflowResult.status,
      },
    })
  } catch (error) {
    console.error("[research] route error", error)
    return NextResponse.json({ error: "Failed to generate research" }, { status: 500 })
  }
}

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  return handleRequest(request, context.params)
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return handleRequest(request, context.params)
}
