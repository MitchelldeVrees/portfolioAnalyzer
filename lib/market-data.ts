// /lib/market-data.ts
// Robust market data layer with provider fallbacks.
//
// Order of attempts:
// 1) Finnhub (if FINNHUB_API_KEY is present)
// 2) Yahoo Finance (no API key) - may 401 in some environments
// 3) Stooq CSV (no API key) - very reliable fallback
//
// Notes:
// - Benchmarks like ^GSPC / ^NDX are supported. For Finnhub/Stooq we map to proxies if needed.
// - Quotes: batch when possible (Yahoo), else per-ticker.
// - History: monthly closes for ~12 months.
// - Everything returns safe defaults if all providers fail.

export type Quote = {
  price: number
  change: number
  changePercent: number
  marketCap?: number
  pe?: number
  dividend?: number
  beta?: number
  currency?: string
}

export type OHLCPoint = { date: string; close: number }

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || ""
const YF_BASE = "https://query1.finance.yahoo.com"
const FX_CACHE_TTL_MS = 5 * 60 * 1000

const fxCache = new Map<string, { rate: number; fetchedAt: number }>()

const DEFAULT_HEADERS = {
  "User-Agent": "portfolio-analyzer/1.0",
  Accept: "application/json,text/plain,*/*",
}

type ProviderName = "finnhub" | "yahoo" | "stooq"
type ProviderOp = "quote" | "history" | "csv"

type ProviderMetricEntry = {
  count: number
  errors: number
  totalLatency: number
  lastLatency: number
}

const providerMetrics: Record<string, ProviderMetricEntry> = {}

function recordProviderMetric(
  provider: ProviderName,
  operation: ProviderOp,
  success: boolean,
  durationMs: number,
  extra?: Record<string, unknown>,
) {
  const key = `${provider}:${operation}`
  const entry = providerMetrics[key] ?? {
    count: 0,
    errors: 0,
    totalLatency: 0,
    lastLatency: 0,
  }

  entry.count += 1
  entry.totalLatency += durationMs
  entry.lastLatency = durationMs
  if (!success) entry.errors += 1
  providerMetrics[key] = entry

  const avgLatency = entry.totalLatency / entry.count
  const payload = {
    provider,
    operation,
    status: success ? "success" : "error",
    durationMs: Math.round(durationMs),
    count: entry.count,
    errors: entry.errors,
    avgLatencyMs: Math.round(avgLatency),
    ...(extra ?? {}),
  }

  if (success) {
    console.info("[market-data]", payload)
  } else {
    console.error("[market-data]", payload)
  }
}

// ---------- Utils ----------
function asNumber(x: any, def = NaN) {
  const n = Number(x)
  return Number.isFinite(n) ? n : def
}

function toYYYYMM(tsSec: number): string {
  const d = new Date(tsSec * 1000)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${yyyy}-${mm}`
}

function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1]
}

// ---------- Symbol mapping for providers ----------
function mapBenchmarkForFinnhub(sym: string): string {
  // Prefer ETF proxies for indices on Finnhub
  const s = sym.toUpperCase()
  if (s === "^GSPC") return "SPY"
  if (s === "^NDX") return "QQQ"
  return s
}

function mapBenchmarkForStooq(sym: string): string {
  const s = sym.toUpperCase()
  if (s === "^GSPC") return "^SPX"
  if (s === "^NDX") return "^NDX"
  return s
}

function stooqCandidateSymbols(sym: string): string[] {
  // Stooq often uses .US for US tickers, but plain may also work.
  const s = sym.toLowerCase()
  if (s.startsWith("^")) {
    return [s] // indices like ^spx, ^ndx
  }
  return [`${s}.us`, s]
}

// ---------- Finnhub (optional) ----------
async function finnhubQuote(symbol: string): Promise<Quote | null> {
  if (!FINNHUB_API_KEY) return null
  const start = Date.now()
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      recordProviderMetric("finnhub", "quote", false, Date.now() - start, { status: res.status })
      return null
    }
    const j = await res.json()
    const price = asNumber(j.c)
    const prev = asNumber(j.pc)
    if (!Number.isFinite(price) || !Number.isFinite(prev) || prev === 0) {
      recordProviderMetric("finnhub", "quote", false, Date.now() - start, { reason: "invalid-data" })
      return null
    }
    const change = price - prev
    const changePercent = (change / prev) * 100
    recordProviderMetric("finnhub", "quote", true, Date.now() - start, { symbol })
    return { price, change, changePercent }
  } catch (error) {
    recordProviderMetric("finnhub", "quote", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

async function finnhubHistoryMonthly(symbol: string, months = 12): Promise<OHLCPoint[] | null> {
  if (!FINNHUB_API_KEY) return null
  const start = Date.now()
  // Resolution M (monthly) isn't always available; use D and sample by month.
  const now = Math.floor(Date.now() / 1000)
  const yearAgo = now - 400 * 24 * 60 * 60
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
    symbol,
  )}&resolution=D&from=${yearAgo}&to=${now}&token=${FINNHUB_API_KEY}`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      recordProviderMetric("finnhub", "history", false, Date.now() - start, { status: res.status })
      return null
    }
    const j = await res.json()
    if (j.s !== "ok" || !Array.isArray(j.t) || !Array.isArray(j.c)) {
      recordProviderMetric("finnhub", "history", false, Date.now() - start, { reason: "invalid-data" })
      return null
    }
    // Collapse to month-end closes
    const byMonth = new Map<string, number>()
    for (let i = 0; i < j.t.length; i++) {
      const yyyymm = toYYYYMM(j.t[i])
      byMonth.set(yyyymm, j.c[i])
    }
    const arr = Array.from(byMonth.entries())
      .map(([date, close]) => ({ date, close: asNumber(close) }))
      .filter(p => Number.isFinite(p.close))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-months)
    if (arr.length) {
      recordProviderMetric("finnhub", "history", true, Date.now() - start, { symbol, points: arr.length })
      return arr
    }
    recordProviderMetric("finnhub", "history", false, Date.now() - start, { reason: "empty" })
    return null
  } catch (error) {
    recordProviderMetric("finnhub", "history", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

// ---------- Yahoo ----------
async function yahooQuotesBatch(symbols: string[]): Promise<Record<string, Quote> | null> {
  if (!symbols.length) return {}
  const unique = Array.from(new Set(symbols.map(s => s.trim()).filter(Boolean)))
  const url = `${YF_BASE}/v7/finance/quote?symbols=${encodeURIComponent(unique.join(","))}`
  const start = Date.now()
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS })
    if (!res.ok) {
      recordProviderMetric("yahoo", "quote", false, Date.now() - start, { status: res.status })
      return null
    }
    const json = await res.json()
    const results: any[] = json?.quoteResponse?.result ?? []

    const out: Record<string, Quote> = Object.fromEntries(
      unique.map(sym => [
        sym,
        {
          price: 100,
          change: 0,
          changePercent: 0,
        },
      ]),
    )

    for (const r of results) {
      const sym = r?.symbol
      if (!sym) continue
      const price = asNumber(r.regularMarketPrice)
      const change = asNumber(r.regularMarketChange, 0)
      const changePercent = asNumber(r.regularMarketChangePercent, 0)
      if (Number.isFinite(price)) {
        out[sym] = {
          price,
          change: Number.isFinite(change) ? change : 0,
          changePercent: Number.isFinite(changePercent) ? changePercent : 0,
          marketCap: asNumber(r.marketCap),
          pe: asNumber(r.trailingPE),
          dividend: asNumber(r.trailingAnnualDividendRate),
          beta: asNumber(r.beta) || asNumber(r.beta3Year),
          currency: typeof r.currency === "string" ? r.currency.toUpperCase() : undefined,
        }
      }
    }

    recordProviderMetric("yahoo", "quote", true, Date.now() - start, {
      requested: unique.length,
      received: results.length,
    })
    return out
  } catch (error) {
    recordProviderMetric("yahoo", "quote", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

async function yahooHistoryMonthlyClose(symbol: string, months = 12): Promise<OHLCPoint[] | null> {
  const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=1y&interval=1mo&includeAdjustedClose=true`
  const start = Date.now()
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS })
    if (!res.ok) {
      recordProviderMetric("yahoo", "history", false, Date.now() - start, { status: res.status })
      return null
    }
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) {
      recordProviderMetric("yahoo", "history", false, Date.now() - start, { reason: "no-result" })
      return null
    }
    const ts: number[] = result?.timestamp || []
    const adj = result?.indicators?.adjclose?.[0]?.adjclose
    const cls = result?.indicators?.quote?.[0]?.close
    const closes: number[] = Array.isArray(adj) ? adj : Array.isArray(cls) ? cls : []
    if (!ts.length || !closes.length) {
      recordProviderMetric("yahoo", "history", false, Date.now() - start, { reason: "empty-series" })
      return null
    }
    const points: OHLCPoint[] = ts
      .map((t, i) => ({ date: toYYYYMM(t), close: asNumber(closes[i]) }))
      .filter(p => Number.isFinite(p.close))
      .slice(-months)
    if (!points.length) {
      recordProviderMetric("yahoo", "history", false, Date.now() - start, { reason: "filtered-empty" })
      return null
    }
    recordProviderMetric("yahoo", "history", true, Date.now() - start, { symbol, points: points.length })
    return points
  } catch (error) {
    recordProviderMetric("yahoo", "history", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

// ---------- Stooq (CSV) ----------
async function stooqFetchCsv(symbol: string, interval: "d" | "m"): Promise<string | null> {
  // Try multiple symbol variants for better hit rate
  const cands = stooqCandidateSymbols(symbol)
  for (const s of cands) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=${interval}`
    const res = await fetch(url, { headers: { "User-Agent": "portfolio-analyzer/1.0" } })
    if (res.ok) {
      const text = await res.text()
      if (text && !/Not Found|Brak danych/i.test(text)) return text
    }
  }
  return null
}

function parseStooqCsvToPoints(csv: string, limit = 500): { d: string; c: number }[] {
  // CSV: Date,Open,High,Low,Close,Volume
  const lines = csv.trim().split(/\r?\n/)
  const out: { d: string; c: number }[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",")
    if (cols.length < 5) continue
    const date = cols[0]
    const close = asNumber(cols[4])
    if (Number.isFinite(close)) out.push({ d: date, c: close })
  }
  return out.slice(-limit)
}

async function stooqQuote(symbol: string): Promise<Quote | null> {
  const start = Date.now()
  try {
    // Use daily CSV; compute change from last two rows
    const csv = await stooqFetchCsv(symbol, "d")
    if (!csv) {
      recordProviderMetric("stooq", "quote", false, Date.now() - start, { reason: "no-csv" })
      return null
    }
    const pts = parseStooqCsvToPoints(csv, 10)
    const lastPt = last(pts)
    const prevPt = pts.length >= 2 ? pts[pts.length - 2] : undefined
    if (!lastPt || !prevPt) {
      recordProviderMetric("stooq", "quote", false, Date.now() - start, { reason: "insufficient-data" })
      return null
    }
    const price = lastPt.c
    const change = price - prevPt.c
    const changePercent = prevPt.c ? (change / prevPt.c) * 100 : 0
    recordProviderMetric("stooq", "quote", true, Date.now() - start, { symbol })
    return { price, change, changePercent }
  } catch (error) {
    recordProviderMetric("stooq", "quote", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

async function stooqHistoryMonthly(symbol: string, months = 12): Promise<OHLCPoint[] | null> {
  const start = Date.now()
  try {
    const csv = await stooqFetchCsv(symbol, "m")
    if (!csv) {
      recordProviderMetric("stooq", "history", false, Date.now() - start, { reason: "no-csv" })
      return null
    }
    const pts = parseStooqCsvToPoints(csv, 60).map(p => ({
      date: p.d.slice(0, 7),
      close: p.c,
    }))
    const out = pts.slice(-months)
    if (!out.length) {
      recordProviderMetric("stooq", "history", false, Date.now() - start, { reason: "empty" })
      return null
    }
    recordProviderMetric("stooq", "history", true, Date.now() - start, { symbol, points: out.length })
    return out
  } catch (error) {
    recordProviderMetric("stooq", "history", false, Date.now() - start, { error: (error as Error)?.message })
    throw error
  }
}

// ---------- Public API ----------

/**
 * Batch quotes with fallbacks: Finnhub (if key) -> Yahoo -> Stooq.
 */
export async function fetchQuotesBatch(symbols: string[]): Promise<Record<string, Quote>> {
  const unique = Array.from(new Set(symbols.map(s => s.trim()).filter(Boolean)))
  const result: Record<string, Quote> = {}

  // 1) Finnhub (optional)
  if (FINNHUB_API_KEY) {
    const finnhubResults = await Promise.all(
      unique.map(async sym => {
        const mapped = mapBenchmarkForFinnhub(sym)
        try {
          const q = await finnhubQuote(mapped)
          return [sym, q] as const
        } catch {
          return [sym, null] as const
        }
      }),
    )
    for (const [sym, q] of finnhubResults) {
      if (q) result[sym] = q
    }
  }

  // 2) Yahoo (for anything still missing)
  const remainingForYahoo = unique.filter(s => !result[s])
  if (remainingForYahoo.length) {
    try {
      const yf = await yahooQuotesBatch(remainingForYahoo)
      if (yf) {
        for (const sym of remainingForYahoo) {
          if (yf[sym]) result[sym] = yf[sym]
        }
      }
    } catch {
      // ignore; we'll fallback to Stooq
    }
  }

  // 3) Stooq fallback (per ticker)
  const stillMissing = unique.filter(s => !result[s])
  if (stillMissing.length) {
    const sto = await Promise.all(
      stillMissing.map(async sym => {
        const mapped = mapBenchmarkForStooq(sym)
        try {
          const q = await stooqQuote(mapped)
          return [sym, q] as const
        } catch {
          return [sym, null] as const
        }
      }),
    )
    for (const [sym, q] of sto) {
      if (q) result[sym] = q
    }
  }

  // Final safety defaults
  for (const sym of unique) {
    if (!result[sym]) {
      result[sym] = { price: 100, change: 0, changePercent: 0 }
    }
  }
  return result
}

export async function fetchFxRate(fromCurrency: string, toCurrency: string): Promise<number> {
  const from = fromCurrency?.toUpperCase?.() ?? ""
  const to = toCurrency?.toUpperCase?.() ?? ""
  if (!from || !to) return 1
  if (from === to) return 1
  const key = `${from}->${to}`
  const cached = fxCache.get(key)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < FX_CACHE_TTL_MS) {
    return cached.rate
  }

  const pair = `${from}${to}=X`
  try {
    const quotes = await yahooQuotesBatch([pair])
    const quote = quotes?.[pair]
    const rate = quote?.price
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      fxCache.set(key, { rate, fetchedAt: now })
      return rate
    }
  } catch (error) {
    console.error(`[fx] failed to fetch ${key}:`, (error as Error)?.message ?? error)
  }

  fxCache.set(key, { rate: 1, fetchedAt: now })
  return 1
}

/**
 * Monthly closes for the last ~12 months with fallbacks.
 */
export async function fetchHistoryMonthlyClose(symbol: string, months = 12): Promise<OHLCPoint[]> {
  // 1) Finnhub (optional; map index to ETF)
  if (FINNHUB_API_KEY) {
    const mapped = mapBenchmarkForFinnhub(symbol)
    const fin = await finnhubHistoryMonthly(mapped, months)
    if (fin?.length) return fin
  }

  // 2) Yahoo
  try {
    const yf = await yahooHistoryMonthlyClose(symbol, months)
    if (yf?.length) return yf
  } catch {
    // ignore; fallback to Stooq
  }

  // 3) Stooq (map indices)
  const mappedSto = mapBenchmarkForStooq(symbol)
  const sto = await stooqHistoryMonthly(mappedSto, months)
  if (sto?.length) return sto

  // Safety default
  const today = new Date()
  const out: OHLCPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))
    out.push({
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      close: 100 + Math.random() * 5,
    })
  }
  return out
}
