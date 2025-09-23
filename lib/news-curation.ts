export type CuratedArticle = {
  title: string
  source: string
  date: string // ISO YYYY-MM-DD
  url: string
}

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
]

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function hostnameFromUrl(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function isAllowed(url: string): boolean {
  const host = hostnameFromUrl(url)
  if (!host) return false
  return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

async function fetchFromNewsApi(tickers: string[], fromISO: string, toISO: string): Promise<Record<string, CuratedArticle[]>> {
  const apiKey = process.env.NEWSAPI_KEY
  if (!apiKey) return {}
  const domains = allowedDomains.join(",")
  const result: Record<string, CuratedArticle[]> = {}

  for (const t of tickers) {
    try {
      const url = new URL("https://newsapi.org/v2/everything")
      url.searchParams.set("q", t)
      url.searchParams.set("from", fromISO)
      url.searchParams.set("to", toISO)
      url.searchParams.set("language", "en")
      url.searchParams.set("sortBy", "publishedAt")
      url.searchParams.set("pageSize", "10")
      url.searchParams.set("domains", domains)
      const res = await fetch(url.toString(), { headers: { "X-Api-Key": apiKey } })
      if (!res.ok) continue
      const data = await res.json()
      const items: CuratedArticle[] = (data.articles || [])
        .filter((a: any) => a.url && isAllowed(a.url))
        .map((a: any) => ({
          title: a.title,
          source: a.source?.name || hostnameFromUrl(a.url) || "",
          date: isoDateOnly(new Date(a.publishedAt)),
          url: a.url,
        }))
      if (items.length) result[t] = items
    } catch {
      // ignore
    }
  }
  return result
}

async function fetchFromMarketaux(tickers: string[], fromISO: string, toISO: string): Promise<Record<string, CuratedArticle[]>> {
  const apiKey = process.env.MARKETAUX_API_KEY
  if (!apiKey) return {}
  const result: Record<string, CuratedArticle[]> = {}
  try {
    const url = new URL("https://api.marketaux.com/v1/news/all")
    url.searchParams.set("symbols", tickers.join(","))
    url.searchParams.set("filter_entities", "true")
    url.searchParams.set("language", "en")
    url.searchParams.set("limit", "50")
    url.searchParams.set("published_after", fromISO)
    url.searchParams.set("published_before", toISO)
    url.searchParams.set("api_token", apiKey)
    const res = await fetch(url.toString())
    if (!res.ok) return {}
    const data = await res.json()
    const byTicker: Record<string, CuratedArticle[]> = {}
    for (const item of data.data || []) {
      const urlStr = item.url as string
      if (!isAllowed(urlStr)) continue
      // Extract best matching ticker from entities/symbols if present
      let sym: string | undefined
      if (Array.isArray(item.entities)) {
        sym = (item.entities.find((e: any) => e.symbol && tickers.includes(e.symbol))?.symbol as string | undefined)
      }
      if (!sym && Array.isArray(item.symbols)) {
        sym = (item.symbols.find((s: string) => tickers.includes(s)) as string | undefined)
      }
      if (!sym) continue
      const entry: CuratedArticle = {
        title: String(item.title || item.description || ""),
        source: String(item.source || hostnameFromUrl(urlStr) || ""),
        date: isoDateOnly(new Date(item.published_at || item.published_at || new Date())),
        url: urlStr,
      }
      if (!byTicker[sym]) byTicker[sym] = []
      byTicker[sym].push(entry)
    }
    return byTicker
  } catch {
    return {}
  }
}

export async function fetchCuratedNewsForTickers(tickers: string[], lookbackDays: number): Promise<Record<string, CuratedArticle[]>> {
  const toISO = isoDateOnly(new Date())
  const from = new Date()
  from.setUTCDate(from.getUTCDate() - lookbackDays)
  const fromISO = isoDateOnly(from)

  // Try marketaux first, then newsapi as fallback
  const combined: Record<string, CuratedArticle[]> = {}
  const m = await fetchFromMarketaux(tickers, fromISO, toISO)
  for (const k of Object.keys(m)) combined[k] = m[k]
  const n = await fetchFromNewsApi(tickers, fromISO, toISO)
  for (const k of Object.keys(n)) {
    const existing = combined[k] || []
    const merged = [...existing]
    for (const art of n[k]) {
      if (!existing.some((e) => e.url === art.url)) merged.push(art)
    }
    combined[k] = merged
  }
  return combined
}

export { allowedDomains }

