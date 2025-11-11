import { NextResponse } from "next/server"
import yahooFinance from "yahoo-finance2"
import { buildTickerCandidateList, type HoldingIdentifiers } from "@/lib/upload-parsing"

type ResolveRequestHolding = {
  rowNumber?: number
  rawTicker?: string
  ticker?: string
  candidates?: string[]
  identifiers?: HoldingIdentifiers
}

type TickerResolutionRecord = {
  rowNumber: number
  rawTicker: string
  resolvedTicker: string
  source: "provided" | "candidate" | "isin" | "search"
  confidence: number
  usedIdentifier?: string
  note?: string
  attempted?: string[]
}

type TickerResolutionIssue = {
  rowNumber: number
  rawTicker: string
  reason: string
  attempted?: string[]
}

type QuoteCheckResult = {
  ok: boolean
  symbol?: string
  name?: string
  quoteType?: string
  exchange?: string
}

const quoteCache = new Map<string, QuoteCheckResult>()
const searchCache = new Map<string, any[] | null>()
const IDENTIFIER_PRIORITY: Array<keyof HoldingIdentifiers> = ["isin", "cusip", "sedol", "figi"]

function normaliseSymbol(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase()
}

function isQuoteTypeAllowed(type: string | undefined, rawTicker: string): boolean {
  if (!type) return true
  const normalized = type.toUpperCase()
  if (normalized === "OPTION") return false
  if (normalized === "FUTURE") return rawTicker.includes("/")
  return true
}

async function validateSymbol(symbol: string): Promise<QuoteCheckResult> {
  const normalized = normaliseSymbol(symbol)
  if (!normalized) return { ok: false }

  const cached = quoteCache.get(normalized)
  if (cached) return cached

  try {
    const quote: any = await yahooFinance.quote(normalized)
    if (!quote || typeof quote.symbol !== "string") {
      const failure: QuoteCheckResult = { ok: false }
      quoteCache.set(normalized, failure)
      return failure
    }

    const quoteType =
      typeof quote.quoteType === "string" ? (quote.quoteType as string).toUpperCase() : undefined
    if (!isQuoteTypeAllowed(quoteType, normalized)) {
      const failure: QuoteCheckResult = { ok: false, quoteType }
      quoteCache.set(normalized, failure)
      return failure
    }

    const entry: QuoteCheckResult = {
      ok: true,
      symbol: (quote.symbol as string).toUpperCase(),
      name:
        (typeof quote.shortName === "string" && (quote.shortName as string)) ||
        (typeof quote.longName === "string" && (quote.longName as string)) ||
        undefined,
      quoteType,
      exchange:
        typeof quote.fullExchangeName === "string" ? (quote.fullExchangeName as string) : undefined,
    }
    quoteCache.set(normalized, entry)
    return entry
  } catch (error) {
    const failure: QuoteCheckResult = { ok: false }
    quoteCache.set(normalized, failure)
    return failure
  }
}

async function searchQuotes(query: string): Promise<any[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const cacheKey = trimmed.toUpperCase()
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey) ?? []
  }

  try {
    const result: any = await yahooFinance.search(trimmed, {
      quotesCount: 10,
      newsCount: 0,
      listsCount: 0,
    })
    const quotes = Array.isArray(result?.quotes) ? result.quotes : []
    searchCache.set(cacheKey, quotes)
    return quotes
  } catch (error) {
    searchCache.set(cacheKey, [])
    return []
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || !Array.isArray((body as any).holdings)) {
      return NextResponse.json({ error: "holdings array is required" }, { status: 400 })
    }

    const holdings: ResolveRequestHolding[] = (body as any).holdings
    const resolved: TickerResolutionRecord[] = []
    const unresolved: TickerResolutionIssue[] = []

    for (let index = 0; index < holdings.length; index += 1) {
      try {
        const outcome = await resolveHolding(holdings[index], index)
        if (outcome.record) {
          resolved.push(outcome.record)
        } else if (outcome.issue) {
          unresolved.push(outcome.issue)
        }
      } catch (error) {
        const rowNumber =
          typeof holdings[index]?.rowNumber === "number" && Number.isFinite(holdings[index]?.rowNumber)
            ? (holdings[index]?.rowNumber as number)
            : index + 1
        const rawTicker =
          typeof holdings[index]?.rawTicker === "string"
            ? (holdings[index]?.rawTicker as string)
            : typeof holdings[index]?.ticker === "string"
            ? (holdings[index]?.ticker as string)
            : ""
        unresolved.push({
          rowNumber,
          rawTicker,
          reason: "Lookup error",
        })
      }
    }

    return NextResponse.json({ resolved, unresolved })
  } catch (error) {
    console.error("[ticker-resolve] failed to process request", error)
    return NextResponse.json({ error: "Failed to resolve tickers" }, { status: 500 })
  }
}

async function resolveHolding(
  holding: ResolveRequestHolding | undefined,
  index: number,
): Promise<{ record?: TickerResolutionRecord; issue?: TickerResolutionIssue }> {
  const rowNumber =
    typeof holding?.rowNumber === "number" && Number.isFinite(holding.rowNumber)
      ? holding.rowNumber
      : index + 1

  const rawTicker =
    typeof holding?.rawTicker === "string" && holding.rawTicker.trim()
      ? holding.rawTicker.trim()
      : ""

  const providedTicker =
    typeof holding?.ticker === "string" && holding.ticker.trim() ? holding.ticker.trim() : ""

  const displayTicker = rawTicker || providedTicker

  const candidateInfo = buildTickerCandidateList(displayTicker)
  const providedCandidateInfo =
    providedTicker && providedTicker !== displayTicker
      ? buildTickerCandidateList(providedTicker)
      : null

  const primaryTicker =
    (providedCandidateInfo?.primary && providedCandidateInfo.primary.trim()) ||
    (candidateInfo.primary && candidateInfo.primary.trim()) ||
    providedTicker ||
    displayTicker

  const attempted: string[] = []

  if (!primaryTicker) {
    return {
      issue: {
        rowNumber,
        rawTicker: displayTicker,
        reason: "Missing ticker value",
      },
    }
  }

  const candidateMap = new Map<string, "provided" | "candidate">()

  const addCandidate = (value: string | null | undefined, source: "provided" | "candidate") => {
    const normalized = normaliseSymbol(value)
    if (!normalized) return
    if (!candidateMap.has(normalized)) {
      candidateMap.set(normalized, source)
    }
  }

  addCandidate(primaryTicker, "provided")
  addCandidate(holding?.ticker, "provided")
  candidateInfo.candidates.forEach((candidate) => addCandidate(candidate, "candidate"))
  providedCandidateInfo?.candidates.forEach((candidate) => addCandidate(candidate, "candidate"))
  if (Array.isArray(holding?.candidates)) {
    holding?.candidates?.forEach((candidate) => addCandidate(candidate, "candidate"))
  }
  if (!candidateMap.size) {
    addCandidate(candidateInfo.primary ?? primaryTicker, "candidate")
  }

  const maybeIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(primaryTicker.trim().toUpperCase())
  if (maybeIsin) {
    const isinCandidateSuffixes = [".SG", ".DE", ".MI", ".PA"]
    for (const suffix of isinCandidateSuffixes) {
      addCandidate(`${primaryTicker.trim()}${suffix}`, "candidate")
    }
  }

  const identifiers: HoldingIdentifiers =
    holding?.identifiers && typeof holding.identifiers === "object" && holding.identifiers !== null
      ? holding.identifiers
      : {}

  const countryHint =
    typeof identifiers.country === "string" ? identifiers.country.trim().toLowerCase() : ""

  const tryValidate = async (
    symbolCandidate: string,
    source: "provided" | "candidate" | "isin" | "search",
    confidence: number,
    opts?: { note?: string; usedIdentifier?: string },
  ): Promise<TickerResolutionRecord | null> => {
    const normalized = normaliseSymbol(symbolCandidate)
    if (!normalized) return null
    if (!attempted.includes(normalized)) attempted.push(normalized)
    const quote = await validateSymbol(normalized)
    if (!quote.ok) return null
    if (!isQuoteTypeAllowed(quote.quoteType, displayTicker || primaryTicker)) return null
    return {
      rowNumber,
      rawTicker: displayTicker || primaryTicker,
      resolvedTicker: quote.symbol ?? normalized,
      source,
      confidence,
      usedIdentifier: opts?.usedIdentifier,
      note: opts?.note || quote.name,
      attempted: [...attempted],
    }
  }

  const pickFromSearch = async (
    quotes: any[],
    opts: { source: "isin" | "search"; usedIdentifier?: string; confidence: number },
  ): Promise<TickerResolutionRecord | null> => {
    if (!Array.isArray(quotes) || quotes.length === 0) return null
    const sorted = quotes
      .filter((quote) => typeof quote?.symbol === "string")
      .sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0))
      .slice(0, 8)

    for (const quote of sorted) {
      const symbol = normaliseSymbol(quote.symbol as string)
      if (!symbol) continue

      const quoteType =
        typeof quote.quoteType === "string" ? (quote.quoteType as string).toUpperCase() : undefined
      if (!isQuoteTypeAllowed(quoteType, primaryTicker)) continue

      if (countryHint) {
        const quoteCountry =
          typeof quote.country === "string"
            ? (quote.country as string).toLowerCase()
            : typeof quote.region === "string"
            ? (quote.region as string).toLowerCase()
            : ""
        if (quoteCountry && !quoteCountry.includes(countryHint) && !countryHint.includes(quoteCountry)) {
          continue
        }
      }

      const note =
        (typeof quote.longname === "string" && (quote.longname as string)) ||
        (typeof quote.shortname === "string" && (quote.shortname as string)) ||
        undefined

      const resolved = await tryValidate(symbol, opts.source, opts.confidence, {
        note,
        usedIdentifier: opts.usedIdentifier,
      })
      if (resolved) return resolved
    }
    if (sorted.length) {
      const fallbackQuote = sorted[0]
      const fallbackSymbol = normaliseSymbol(fallbackQuote.symbol as string)
      if (fallbackSymbol && !attempted.includes(fallbackSymbol)) {
        attempted.push(fallbackSymbol)
      }
      const note =
        (typeof fallbackQuote.longname === "string" && (fallbackQuote.longname as string)) ||
        (typeof fallbackQuote.shortname === "string" && (fallbackQuote.shortname as string)) ||
        undefined
      if (fallbackSymbol) {
        return {
          rowNumber,
          rawTicker: displayTicker || primaryTicker,
          resolvedTicker: fallbackSymbol,
          source: opts.source,
          confidence: opts.confidence * 0.75,
          usedIdentifier: opts.usedIdentifier,
          note,
          attempted: [...attempted],
        }
      }
    }
    return null
  }

  for (const [candidate, source] of candidateMap.entries()) {
    const resolved = await tryValidate(candidate, source, source === "provided" ? 1 : 0.85)
    if (resolved) {
      return { record: resolved }
    }
  }

  for (const key of IDENTIFIER_PRIORITY) {
    const value = identifiers[key]
    if (!value || typeof value !== "string") continue
    const trimmedValue = value.trim()
    if (!trimmedValue) continue

    const marker = `${key}:${trimmedValue}`
    if (!attempted.includes(marker)) attempted.push(marker)

    const quotes = await searchQuotes(trimmedValue)
    const resolved = await pickFromSearch(quotes, {
      source: key === "isin" ? "isin" : "search",
      usedIdentifier: `${key}:${trimmedValue}`,
      confidence: key === "isin" ? 0.9 : 0.8,
    })
    if (resolved) {
      return { record: resolved }
    }
  }

  const searchQueries = new Set<string>()
  if (typeof identifiers.name === "string" && identifiers.name.trim().length > 1) {
    searchQueries.add(identifiers.name)
  }
  searchQueries.add(primaryTicker)
  if (displayTicker && displayTicker !== primaryTicker) {
    searchQueries.add(displayTicker)
  }
  candidateMap.forEach((_source, symbol) => searchQueries.add(symbol))

  let searchAttempts = 0
  for (const query of searchQueries) {
    if (searchAttempts >= 4) break
    const trimmed = query.trim()
    if (trimmed.length < 2) continue

    const marker = `search:${trimmed}`
    if (!attempted.includes(marker)) attempted.push(marker)

    const quotes = await searchQuotes(trimmed)
    const resolved = await pickFromSearch(quotes, {
      source: "search",
      confidence: 0.7,
    })
    searchAttempts += 1
    if (resolved) {
      return { record: resolved }
    }
  }

  return {
    issue: {
      rowNumber,
      rawTicker: displayTicker || primaryTicker,
      reason: "Unable to find matching ticker",
      attempted: attempted.length ? [...attempted] : undefined,
    },
  }
}
