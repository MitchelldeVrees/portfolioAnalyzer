export type ColumnMappings = {
  ticker: string
  weight: string
  shares: string
  purchasePrice: string
}

export type IdentifierColumnGuesses = {
  isin?: string
  cusip?: string
  sedol?: string
  figi?: string
  name?: string
  country?: string
}

export type HoldingIdentifiers = {
  isin?: string
  cusip?: string
  sedol?: string
  figi?: string
  name?: string
  country?: string
}

export type TickerCandidateResult = {
  original: string
  primary?: string
  candidates: string[]
}

const HEADER_SYNONYMS: Record<keyof ColumnMappings, string[]> = {
  ticker: [
    "ticker",
    "symbol",
    "securityid",
    "securitysymbol",
    "securitycode",
    "stockcode",
    "instrumentticker",
    "bbgid",
    "ric",
  ],
  weight: [
    "weight",
    "weighting",
    "allocation",
    "allocationpct",
    "allocationpercent",
    "percentportfolio",
    "portfolioallocation",
    "pctportfolio",
    "holdingweight",
    "portfolioweight",
    "percentofportfolio",
  ],
  shares: [
    "shares",
    "quantity",
    "qty",
    "units",
    "amount",
    "position",
    "positionqty",
    "sharecount",
    "unitsheld",
  ],
  purchasePrice: [
    "purchaseprice",
    "price",
    "unitprice",
    "priceperunit",
    "shareprice",
    "avgprice",
    "averageprice",
    "costbasis",
    "cost",
    "bookcost",
    "localprice",
    "pricelocal",
    "pricebase",
    "baseprice",
  ],
}

const MARKET_SUFFIXES = new Set([
  "US",
  "USA",
  "UW",
  "LN",
  "LON",
  "NA",
  "CA",
  "CN",
  "HK",
  "HKD",
  "AU",
  "AX",
  "TS",
  "TO",
  "FP",
  "PA",
  "AS",
  "SW",
  "VX",
  "ETR",
  "FRA",
  "DE",
  "BE",
  "BR",
  "SA",
  "SJ",
  "KS",
  "KR",
  "JP",
  "TKS",
  "SE",
  "SG",
  "TW",
  "IN",
  "NZ",
  "MI",
  "IM",
  "DC",
  "MC",
])

const DESCRIPTOR_TOKENS = new Set([
  "EQUITY",
  "COMMON",
  "STOCK",
  "SHARES",
  "ADR",
  "PREF",
  "PREFERRED",
  "CLASS",
  "CL",
  "UNIT",
  "UNITS",
  "ORD",
  "REGISTERED",
  "REG",
  "PLC",
  "INC",
  "SA",
  "NV",
  "ETP",
  "ETF",
  "FUND",
  "TR",
  "TRUST",
  "NOTE",
  "BOND",
  "CORP",
  "COMP",
  "SPON",
  "SP",
])

const SEPARATOR_REGEX = /[\s,;|/]+/

export function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const previousRow = new Array<number>(b.length + 1)
  const currentRow = new Array<number>(b.length + 1)

  for (let j = 0; j <= b.length; j++) {
    previousRow[j] = j
  }

  for (let i = 1; i <= a.length; i++) {
    currentRow[0] = i
    const aChar = a.charAt(i - 1)

    for (let j = 1; j <= b.length; j++) {
      const bChar = b.charAt(j - 1)
      const cost = aChar === bChar ? 0 : 1

      currentRow[j] = Math.min(
        currentRow[j - 1] + 1,
        previousRow[j] + 1,
        previousRow[j - 1] + cost,
      )
    }

    for (let j = 0; j <= b.length; j++) {
      previousRow[j] = currentRow[j]
    }
  }

  return previousRow[b.length]
}

function guessHeader(headers: string[], type: keyof ColumnMappings, exclude: Set<string>): string {
  if (!headers.length) return ""
  const normalized = headers.map((header) => ({
    original: header,
    normalized: normalizeHeaderKey(header),
  }))
  const synonyms = HEADER_SYNONYMS[type]

  const pick = (predicate: (value: string) => boolean) => {
    return normalized.find(
      ({ original, normalized: value }) => !exclude.has(original) && predicate(value),
    )
  }

  const exact = pick((value) => synonyms.includes(value))
  if (exact) return exact.original

  const partial = pick((value) => synonyms.some((syn) => value.includes(syn)))
  if (partial) return partial.original

  const startsWith = pick((value) => synonyms.some((syn) => value.startsWith(syn)))
  if (startsWith) return startsWith.original

  const fuzzy = pick((value) =>
    synonyms.some((syn) => levenshteinDistance(value, syn) <= Math.max(1, Math.floor(syn.length * 0.25))),
  )
  if (fuzzy) return fuzzy.original

  return ""
}

export function buildInitialColumnMappings(headers: string[]): ColumnMappings {
  const exclude = new Set<string>()
  const ticker = guessHeader(headers, "ticker", exclude) || headers[0] || ""
  if (ticker) exclude.add(ticker)

  let weight = guessHeader(headers, "weight", exclude)
  if (weight) {
    exclude.add(weight)
  }

  let purchasePrice = guessHeader(headers, "purchasePrice", exclude)
  if (purchasePrice) {
    exclude.add(purchasePrice)
  }

  let shares = guessHeader(headers, "shares", exclude)
  if (shares) {
    exclude.add(shares)
  }

  if (!weight) {
    const fallback = headers.find((header) => !exclude.has(header))
    if (fallback) {
      weight = fallback
      exclude.add(weight)
    }
  }

  if (!purchasePrice) {
    const fallback = headers.find((header) => !exclude.has(header))
    if (fallback) {
      purchasePrice = fallback
      exclude.add(purchasePrice)
    }
  }

  if (!shares) {
    const fallback = headers.find((header) => !exclude.has(header))
    if (fallback) {
      shares = fallback
      exclude.add(shares)
    }
  }

  return {
    ticker,
    weight: weight || "",
    shares: shares || "",
    purchasePrice: purchasePrice || "",
  }
}

export function detectIdentifierColumns(headers: string[]): IdentifierColumnGuesses {
  const normalized = headers.map((header) => ({
    original: header,
    normalized: normalizeHeaderKey(header),
  }))

  const find = (predicate: (value: string) => boolean) => {
    const match = normalized.find(({ normalized: value }) => predicate(value))
    return match ? match.original : undefined
  }

  const not = (value: string, tokens: string[]) => tokens.every((token) => !value.includes(token))

  return {
    isin: find((value) => value.includes("isin")),
    cusip: find((value) => value.includes("cusip")),
    sedol: find((value) => value.includes("sedol")),
    figi: find((value) => value.includes("figi") || value.includes("bbg")),
    name: find(
      (value) =>
        value.includes("securityname") ||
        value.includes("instrumentname") ||
        (value.includes("name") &&
          not(value, ["portfolio", "account", "manager", "benchmark", "person"])),
    ),
    country: find((value) => value.includes("country") || value.includes("region")),
  }
}

function addCandidate(list: string[], candidate: string) {
  const value = candidate.trim().toUpperCase()
  if (!value) return
  if (!list.includes(value)) {
    list.push(value)
  }
}

function normaliseToken(token: string): string {
  return token.replace(/[^A-Z0-9.\-:^]/g, "")
}

export function buildTickerCandidateList(rawTicker: string): TickerCandidateResult {
  const trimmed = (rawTicker ?? "").trim()
  const result: TickerCandidateResult = {
    original: rawTicker,
    candidates: [],
  }

  if (!trimmed) {
    return result
  }

  const candidates: string[] = []
  const upper = trimmed.toUpperCase()
  const cleaned = upper.replace(/["']/g, "")
  addCandidate(candidates, cleaned)

  const parenMatches = cleaned.match(/\(([A-Z0-9.\-:^]+)\)/g)
  if (parenMatches) {
    for (const match of parenMatches) {
      const inner = match.replace(/[()]/g, "")
      addCandidate(candidates, inner)
      if (inner.includes(".")) addCandidate(candidates, inner.replace(/\./g, "-"))
      if (inner.includes(":")) addCandidate(candidates, inner.replace(":", "-"))
    }
  }

  const tokens = cleaned
    .split(SEPARATOR_REGEX)
    .map(normaliseToken)
    .filter(Boolean)

  if (tokens.length) {
    const first = tokens[0]
    if (first) {
      addCandidate(candidates, first)
    }
  }

  const isNoise = (token: string) => MARKET_SUFFIXES.has(token) || DESCRIPTOR_TOKENS.has(token)

  for (const token of tokens) {
    if (!token || isNoise(token)) continue
    addCandidate(candidates, token)

    if (token.includes(".")) {
      const [head] = token.split(".")
      addCandidate(candidates, head)
      addCandidate(candidates, token.replace(/\./g, "-"))
    }

    if (token.includes("-")) {
      const [head] = token.split("-")
      addCandidate(candidates, head)
      addCandidate(candidates, token.replace(/-/g, "."))
    }

    if (token.includes(":")) {
      const [head] = token.split(":")
      addCandidate(candidates, head)
      addCandidate(candidates, token.replace(":", "-"))
    }

    if (token.includes("/")) {
      const [head] = token.split("/")
      addCandidate(candidates, head)
      addCandidate(candidates, token.replace(/\//g, "-"))
    }
  }

  if (tokens.length >= 2) {
    const [first, second] = tokens
    if (first && second && !isNoise(second)) {
      addCandidate(candidates, `${first}-${second}`)
      addCandidate(candidates, `${first}.${second}`)
    }
  }

  result.candidates = candidates
  result.primary = candidates.find((candidate) => !/\s/.test(candidate)) || candidates[0]
  return result
}
