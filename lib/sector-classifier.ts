import yahooFinance from "yahoo-finance2"

type SectorEntry = { sector: string; ts: number }
type SectorMeta = {
  rawSector?: string | null
  rawIndustry?: string | null
  categoryName?: string | null
  quoteType?: string | null
  longName?: string | null
  shortName?: string | null
  summary?: string | null
}

const SECTOR_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

const BUILTIN_SECTORS: Record<string, string> = {
  AAPL: "Technology",
  MSFT: "Technology",
  NVDA: "Technology",
  GOOGL: "Technology",
  META: "Technology",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  JPM: "Financial Services",
  GS: "Financial Services",
  MS: "Financial Services",
  V: "Financial Services",
  BAC: "Financial Services",
  JNJ: "Healthcare",
  UNH: "Healthcare",
  XOM: "Energy",
  CVX: "Energy",
  TTE: "Energy",
  BP: "Energy",
  SPY: "ETF",
  QQQ: "ETF",
  DIA: "ETF",
  IWM: "ETF",
  VTI: "ETF",
  VOO: "ETF",
  BND: "Fixed Income",
  AGG: "Fixed Income",
  LQD: "Fixed Income",
  HYG: "Fixed Income",
  TLT: "Government Bonds",
  IEF: "Government Bonds",
  SHY: "Government Bonds",
  GLD: "Commodities",
  SLV: "Commodities",
  DBC: "Commodities",
  GDX: "Materials",
  VNQ: "Real Estate",
}

const sectorCache = new Map<string, SectorEntry>()
const inflightLookups = new Map<string, Promise<string>>()

type SectorSeed = {
  sector?: string | null
  industry?: string | null
  quoteType?: string | null
  longName?: string | null
  shortName?: string | null
}

export async function ensureSectors(tickers: string[]): Promise<void> {
  const unique = Array.from(new Set(tickers.map(normalizeTicker).filter(Boolean)))
  for (const ticker of unique) {
    await ensureSector(ticker)
  }
}

export function sectorForTicker(ticker: string): string {
  const normalized = normalizeTicker(ticker)
  if (!normalized) return "Other"

  const cached = sectorCache.get(normalized)
  if (cached && !isExpired(cached.ts)) {
    return cached.sector
  }

  const builtin = lookupBuiltin(normalized)
  if (builtin) return builtin

  return "Other"
}

export function seedSectorFromQuote(ticker: string, seed: SectorSeed) {
  const normalized = normalizeTicker(ticker)
  if (!normalized) return

  const existing = sectorCache.get(normalized)
  if (existing && !isExpired(existing.ts) && existing.sector !== "Other") {
    return
  }

  const determined = determineSector(normalized, {
    rawSector: seed.sector ?? undefined,
    rawIndustry: seed.industry ?? undefined,
    quoteType: seed.quoteType ?? undefined,
    longName: seed.longName ?? undefined,
    shortName: seed.shortName ?? undefined,
  })

  if (determined && determined !== "Other") {
    sectorCache.set(normalized, { sector: determined, ts: Date.now() })
  }
}

function normalizeTicker(ticker: string | null | undefined): string {
  return (ticker || "").trim().toUpperCase()
}

function stripSuffix(ticker: string): string {
  return ticker.split(".")[0]
}

function isExpired(ts: number): boolean {
  return Date.now() - ts > SECTOR_TTL_MS
}

function lookupBuiltin(ticker: string): string | undefined {
  if (BUILTIN_SECTORS[ticker]) return BUILTIN_SECTORS[ticker]
  const base = stripSuffix(ticker)
  return BUILTIN_SECTORS[base]
}

async function ensureSector(ticker: string): Promise<string> {
  const normalized = normalizeTicker(ticker)
  if (!normalized) return "Other"

  const cached = sectorCache.get(normalized)
  if (cached && !isExpired(cached.ts)) {
    return cached.sector
  }

  const builtin = lookupBuiltin(normalized)
  if (builtin) {
    sectorCache.set(normalized, { sector: builtin, ts: Date.now() })
    return builtin
  }

  const existingPromise = inflightLookups.get(normalized)
  if (existingPromise) {
    return existingPromise
  }

  const promise = fetchAndCacheSector(normalized).catch(() => {
    const fallback = lookupBuiltin(normalized) ?? "Other"
    sectorCache.set(normalized, { sector: fallback, ts: Date.now() })
    return fallback
  })

  inflightLookups.set(normalized, promise)
  try {
    const sector = await promise
    return sector
  } finally {
    inflightLookups.delete(normalized)
  }
}

async function fetchAndCacheSector(ticker: string): Promise<string> {
  const meta = await fetchSectorMeta(ticker)
  const sector = determineSector(ticker, meta)
  sectorCache.set(ticker, { sector, ts: Date.now() })
  return sector
}

async function fetchSectorMeta(ticker: string): Promise<SectorMeta> {
  const meta: SectorMeta = {}

  try {
    const qs: any = await yahooFinance.quoteSummary(ticker, {
      modules: ["assetProfile", "summaryProfile", "price", "fundProfile"],
    })

    meta.rawSector =
      (typeof qs?.assetProfile?.sector === "string" && qs.assetProfile.sector) ||
      (typeof qs?.summaryProfile?.sector === "string" && qs.summaryProfile.sector) ||
      null

    meta.rawIndustry =
      (typeof qs?.assetProfile?.industry === "string" && qs.assetProfile.industry) ||
      (typeof qs?.summaryProfile?.industry === "string" && qs.summaryProfile.industry) ||
      null

    meta.categoryName =
      (typeof qs?.fundProfile?.categoryName === "string" && qs.fundProfile.categoryName) || null

    meta.quoteType =
      (typeof qs?.price?.quoteType === "string" && qs.price.quoteType) ||
      (typeof qs?.price?.quoteType?.raw === "string" && qs.price.quoteType.raw) ||
      null

    meta.longName =
      (typeof qs?.price?.longName === "string" && qs.price.longName) ||
      (typeof qs?.price?.shortName === "string" && qs.price.shortName) ||
      null

    meta.shortName =
      (typeof qs?.price?.shortName === "string" && qs.price.shortName) ||
      (typeof qs?.price?.longName === "string" && qs.price.longName) ||
      null

    meta.summary =
      (typeof qs?.summaryProfile?.longBusinessSummary === "string" && qs.summaryProfile.longBusinessSummary) ||
      (typeof qs?.assetProfile?.longBusinessSummary === "string" && qs.assetProfile.longBusinessSummary) ||
      null
  } catch (error) {
    // ignore network/validation errors and fall back to quote
  }

  if (!meta.rawSector || !meta.quoteType || !meta.longName) {
    try {
      const quote: any = await yahooFinance.quote(ticker)
      if (!meta.rawSector && typeof quote?.sector === "string") meta.rawSector = quote.sector
      if (!meta.quoteType && typeof quote?.quoteType === "string") meta.quoteType = quote.quoteType
      if (!meta.longName && typeof quote?.longName === "string") meta.longName = quote.longName
      if (!meta.shortName && typeof quote?.shortName === "string") meta.shortName = quote.shortName
    } catch (error) {
      // swallow; we already have whatever data we could gather
    }
  }

  return meta
}

function determineSector(ticker: string, meta: SectorMeta): string {
  const normalizedTicker = normalizeTicker(ticker)
  if (!normalizedTicker) return "Other"

  const builtin = lookupBuiltin(normalizedTicker)
  if (builtin) return builtin

  const sectorFromMeta =
    normalizeSectorName(meta.rawSector) ||
    normalizeSectorName(meta.rawIndustry) ||
    null

  if (sectorFromMeta) return sectorFromMeta

  const quoteType = (meta.quoteType || "").toUpperCase()
  const baseTicker = stripSuffix(normalizedTicker)
  const textBlob = [
    meta.categoryName,
    meta.longName,
    meta.shortName,
    meta.summary,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase()

  if (lookslikeUsTreasury(baseTicker)) {
    if (textBlob.includes("municipal")) return "Municipal Bonds"
    return "Government Bonds"
  }

  if (quoteType === "BOND") {
    return classifyBondFromText(textBlob) ?? "Fixed Income"
  }

  const categoryBased = classifyFromCategory(meta.categoryName)
  if (categoryBased) return categoryBased

  if (quoteType === "ETF" || quoteType === "MUTUALFUND") {
    const byText = classifyFromText(textBlob)
    if (byText) return byText
    return quoteType === "ETF" ? "ETF" : "Mutual Fund"
  }

  if (quoteType === "CURRENCY") return "Currency"
  if (quoteType === "CRYPTOCURRENCY") return "Digital Assets"
  if (quoteType === "MONEYMARKET") return "Cash & Cash Equivalents"
  if (quoteType === "INDEX") return "Index"

  const textInference = classifyFromText(textBlob)
  if (textInference) return textInference

  const builtinBase = lookupBuiltin(baseTicker)
  if (builtinBase) return builtinBase

  if (looksLikeIsin(baseTicker) || looksLikeCusip(baseTicker)) {
    return classifyBondFromText(textBlob) ?? "Fixed Income"
  }

  return "Other"
}

function normalizeSectorName(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.trim()
  if (!cleaned) return null

  const lower = cleaned.toLowerCase()

  if (lower.includes("financial")) return "Financial Services"
  if (lower.startsWith("consumer discretion") || lower.includes("consumer cyclical")) return "Consumer Discretionary"
  if (lower.startsWith("consumer defensive") || lower.includes("consumer staples")) return "Consumer Defensive"
  if (lower.includes("communication")) return "Communication Services"
  if (lower.includes("information technology")) return "Technology"
  if (lower.startsWith("technology")) return "Technology"
  if (lower.startsWith("health care") || lower.startsWith("healthcare")) return "Healthcare"
  if (lower.startsWith("industrials")) return "Industrials"
  if (lower.startsWith("basic materials") || lower.startsWith("materials")) return "Materials"
  if (lower.startsWith("energy")) return "Energy"
  if (lower.startsWith("utilities")) return "Utilities"
  if (lower.includes("real estate")) return "Real Estate"
  if (lower.includes("telecom")) return "Communication Services"
  if (lower.includes("technology services")) return "Technology"
  if (lower.includes("commercial services")) return "Industrials"
  if (lower.includes("retail trade")) return "Consumer Discretionary"

  return cleaned
}

function classifyFromCategory(category: string | null | undefined): string | null {
  if (!category) return null
  const lower = category.toLowerCase()
  if (lower.includes("treasury") || lower.includes("sovereign")) return "Government Bonds"
  if (lower.includes("municipal")) return "Municipal Bonds"
  if (lower.includes("bond") || lower.includes("fixed income")) return "Fixed Income"
  if (lower.includes("reit") || lower.includes("real estate")) return "Real Estate"
  if (lower.includes("commodity") || lower.includes("precious metal")) return "Commodities"
  if (lower.includes("infrastructure")) return "Infrastructure"
  if (lower.includes("money market") || lower.includes("cash")) return "Cash & Cash Equivalents"
  if (lower.includes("emerging market")) return "Emerging Markets"
  return null
}

function classifyFromText(text: string): string | null {
  if (!text) return null
  if (text.includes("treasury") || text.includes("sovereign")) return "Government Bonds"
  if (text.includes("municipal")) return "Municipal Bonds"
  if (text.includes("corporate bond")) return "Corporate Bonds"
  if (text.includes("bond") || text.includes("fixed income") || text.includes("income fund")) return "Fixed Income"
  if (text.includes("reit") || text.includes("real estate")) return "Real Estate"
  if (text.includes("commodity") || text.includes("precious metal") || text.includes("gold")) return "Commodities"
  if (text.includes("infrastructure")) return "Infrastructure"
  if (text.includes("emerging market")) return "Emerging Markets"
  if (text.includes("cash") || text.includes("money market")) return "Cash & Cash Equivalents"
  return null
}

function classifyBondFromText(text: string): string | null {
  if (!text) return null
  if (text.includes("treasury") || text.includes("sovereign")) return "Government Bonds"
  if (text.includes("municipal")) return "Municipal Bonds"
  if (text.includes("mortgage-backed")) return "Mortgage-Backed Securities"
  if (text.includes("corporate")) return "Corporate Bonds"
  return null
}

function looksLikeIsin(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value)
}

function looksLikeCusip(value: string): boolean {
  return /^[A-Z0-9]{3}[0-9]{6}$/.test(value)
}

function lookslikeUsTreasury(value: string): boolean {
  return /^US[0-9]{10}[0-9]$/.test(value)
}
