import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import type { CookieMutation } from "@/lib/api/supabase-route"
import { assertSnaptradeConfigured, getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"
import {
  computeHoldingsSnapshot,
  persistHoldingsSnapshot,
  type Holding,
} from "@/app/api/portfolio/[id]/holdings/route"

const DEFAULT_BENCHMARK = "^GSPC"

type SnaptradePosition = {
  units?: number | null
  price?: number | null
  average_purchase_price?: number | null
  currency?: { code?: string | null } | string | null
  symbol?: {
    symbol?: {
      symbol?: string | null
      raw_symbol?: string | null
      description?: string | null
      exchange?: { code?: string | null } | null
      currency?: { code?: string | null } | null
    }
  }
}

function normalizeCurrencyCode(input?: { code?: string | null } | string | null) {
  if (!input) return null
  if (typeof input === "string") return input.trim().toUpperCase() || null
  const code = input.code ?? null
  return code ? code.trim().toUpperCase() : null
}

const EXCHANGE_SUFFIX_MAP: Record<string, string | undefined> = {
  XAMS: ".AS",
  XNAS: "",
  XNYS: "",
  XNFO: "",
  XASE: "",
  XBRU: ".BR",
  XETR: ".DE",
  XFRA: ".F",
  XTSE: ".TO",
  XTSX: ".V",
  XPAR: ".PA",
  XAMSX: ".AS",
  XSTO: ".ST",
  XHEL: ".HE",
  XLON: ".L",
  XLIS: ".LS",
  XMAD: ".MC",
  XSWX: ".SW",
  XWBO: ".VI",
  XSGO: ".SN",
}

function mapQuoteSymbol(rawSymbol?: string | null, exchangeCode?: string | null) {
  if (!rawSymbol) return null
  const suffix = exchangeCode ? EXCHANGE_SUFFIX_MAP[exchangeCode] : undefined
  if (suffix === undefined) {
    return rawSymbol
  }
  return suffix === "" ? rawSymbol : `${rawSymbol}${suffix}`
}

function buildHoldingRow(portfolioId: string, input: {
  ticker: string
  units?: number | null
  currency?: string | null
  accountId?: string | null
  quoteSymbol?: string | null
  purchasePrice?: number | null
}) {
  return {
    portfolio_id: portfolioId,
    account_id: input.accountId ?? null,
    ticker: input.ticker,
    weight: 0,
    shares: input.units ?? null ?? undefined,
    purchase_price: input.purchasePrice ?? null,
    currency_code: input.currency ?? null,
    quote_symbol: input.quoteSymbol ?? null,
  }
}

export async function POST(request: NextRequest) {
  let cookieMutations: CookieMutation[] = []

  if (!assertSnaptradeConfigured()) {
    return NextResponse.json({ error: "SnapTrade is not configured" }, { status: 503 })
  }

  try {
    const routeContext = createRouteHandlerSupabase(request)
    cookieMutations = routeContext.cookieMutations
    const { supabase } = routeContext

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return applyCookieMutations(NextResponse.json({ error: "Not authenticated" }, { status: 401 }), cookieMutations)
    }

    const body = await request.json().catch(() => null)
    const accountId = body?.accountId?.toString().trim() || null
    const portfolioName = body?.portfolioName?.toString().trim()
    const description = body?.description?.toString().trim() || null
    const requestedBase = normalizeCurrencyCode(body?.baseCurrency ?? null) ?? "USD"

    if (!portfolioName) {
      return applyCookieMutations(
        NextResponse.json({ error: "Portfolio name is required" }, { status: 400 }),
        cookieMutations,
      )
    }

    const { snaptradeUserId, snaptradeUserSecret } = await ensureSnaptradeCredentials(supabase, user.id)
    const snaptrade = getSnaptradeClient()

    const holdingsResponse = await snaptrade.accountInformation.getAllUserHoldings({
      userId: snaptradeUserId,
      userSecret: snaptradeUserSecret,
    })

    const accounts = Array.isArray(holdingsResponse.data)
      ? holdingsResponse.data
      : Array.isArray((holdingsResponse.data as any)?.accounts)
        ? (holdingsResponse.data as any).accounts
        : []

    if (!accounts.length) {
      return applyCookieMutations(
        NextResponse.json({ error: "No holdings available from SnapTrade" }, { status: 412 }),
        cookieMutations,
      )
    }

    const selectedAccount = accounts.find((account: any) => {
      if (!accountId) return true
      const meta = account?.account ?? {}
      const resolved =
        meta.id ?? meta.account_id ?? meta.accountId ?? meta.number ?? meta.guid ?? null
      return resolved === accountId
    })

    if (!selectedAccount) {
      return applyCookieMutations(
        NextResponse.json({ error: "No matching SnapTrade account found" }, { status: 404 }),
        cookieMutations,
      )
    }

    const accountMeta = selectedAccount.account ?? {}
    const resolvedAccountId =
      accountMeta.id ?? accountMeta.account_id ?? accountMeta.accountId ?? accountMeta.number ?? null

    const positions = Array.isArray(selectedAccount.positions) ? selectedAccount.positions : []

    const inferredCurrency =
      normalizeCurrencyCode(selectedAccount?.total_value?.currency ?? null) ||
      normalizeCurrencyCode(selectedAccount?.account?.balance?.total?.currency ?? null)
    const baseCurrency = (requestedBase || inferredCurrency || "USD").toUpperCase()

    const { data: portfolio, error: insertError } = await supabase
      .from("portfolios")
      .insert({
        user_id: user.id,
        name: portfolioName,
        description: description || "Imported from SnapTrade",
        base_currency: baseCurrency,
      })
      .select()
      .single()

    if (insertError || !portfolio) {
      throw insertError ?? new Error("Failed to create portfolio")
    }

    const holdingsRows = positions
      .map((position: SnaptradePosition) => {
        const rawSymbol =
          position.symbol?.symbol?.raw_symbol ??
          position.symbol?.symbol?.symbol ??
          position.symbol?.symbol?.description ??
          null
        if (!rawSymbol) return null
        const snaptradeSymbol = position.symbol?.symbol?.symbol ?? null
        const units =
          typeof position.units === "number"
            ? position.units
            : position.units !== undefined
              ? Number(position.units)
              : null
        const currencyCode =
          normalizeCurrencyCode(position.currency ?? null) ||
          normalizeCurrencyCode(position.symbol?.symbol?.currency ?? null) ||
          baseCurrency
        const exchangeCode =
          position.symbol?.symbol?.exchange?.code ??
          position.symbol?.symbol?.exchange?.mic_code ??
          null
        const quoteSymbol =
          snaptradeSymbol ||
          mapQuoteSymbol(position.symbol?.symbol?.raw_symbol ?? position.symbol?.symbol?.symbol ?? null, exchangeCode) ||
          mapQuoteSymbol(rawSymbol, exchangeCode)
        const finalQuoteSymbol =
          typeof quoteSymbol === "string" && quoteSymbol.trim().length > 0 ? quoteSymbol.trim() : null
        const purchasePrice =
          typeof position.average_purchase_price === "number"
            ? position.average_purchase_price
            : position.average_purchase_price !== undefined
              ? Number(position.average_purchase_price)
              : null

        return buildHoldingRow(portfolio.id, {
          ticker: rawSymbol,
          units,
          currency: currencyCode,
          accountId: resolvedAccountId,
          quoteSymbol: finalQuoteSymbol ?? undefined,
          purchasePrice,
        })
      })
      .filter(Boolean) as Array<ReturnType<typeof buildHoldingRow>>

    let insertedHoldings: Holding[] = []

    if (holdingsRows.length > 0) {
      const { data: inserted, error: holdingsError } = await supabase
        .from("portfolio_holdings")
        .insert(holdingsRows)
        .select()

      if (holdingsError) {
        // Clean up created portfolio to avoid orphaned row
        await supabase.from("portfolios").delete().eq("id", portfolio.id)
        throw holdingsError
      }
      insertedHoldings = inserted as Holding[]
    }

    let snapshotStatus: "saved" | "skipped" | "failed" = "skipped"
    let snapshotError: string | null = null

    if (insertedHoldings.length > 0) {
      try {
        const snapshot = await computeHoldingsSnapshot(insertedHoldings, DEFAULT_BENCHMARK, baseCurrency)
        const payload = {
          ...snapshot,
          source: { type: "snaptrade", provider: "snaptrade", accountId: resolvedAccountId },
        }
        await persistHoldingsSnapshot(supabase, portfolio.id, DEFAULT_BENCHMARK, payload, user.id)
        snapshotStatus = "saved"
      } catch (err) {
        snapshotStatus = "failed"
        snapshotError = err instanceof Error ? err.message : "Failed to persist snapshot"
        console.error("[snaptrade] snapshot persist failed", err)
      }
    }

    return applyCookieMutations(
      NextResponse.json(
        {
          ok: true,
          portfolio: { id: portfolio.id, name: portfolio.name },
          snapshotStatus,
          snapshotError,
        },
        { status: 201 },
      ),
      cookieMutations,
    )
  } catch (error) {
    console.error("[snaptrade] holdings import failed", error)
    const message = error instanceof Error ? error.message : "Failed to import holdings"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
