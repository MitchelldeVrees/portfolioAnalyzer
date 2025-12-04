import { NextResponse, type NextRequest } from "next/server"

import { applyCookieMutations, createRouteHandlerSupabase } from "@/lib/api/supabase-route"
import { assertSnaptradeConfigured, getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"
import type { CookieMutation } from "@/lib/api/supabase-route"

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

type PortfolioHoldingInput = {
  ticker: string
  shares?: number | null
  purchasePrice?: number | null
  accountId?: string | null
  currencyCode?: string | null
  quoteSymbol?: string | null
}

function buildHoldingRow(portfolioId: string, input: PortfolioHoldingInput) {
  return {
    portfolio_id: portfolioId,
    ticker: input.ticker,
    weight: 0,
    shares: input.shares ?? null,
    purchase_price: input.purchasePrice ?? null,
    account_id: input.accountId ?? null,
    currency_code: input.currencyCode ?? null,
    quote_symbol: input.quoteSymbol ?? null,
  }
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

function normalizeCurrencyCode(input?: { code?: string | null } | string | null) {
  if (!input) return null
  if (typeof input === "string") return input.trim().toUpperCase() || null
  const code = input.code ?? null
  return code ? code.trim().toUpperCase() : null
}

function mapQuoteSymbol(rawSymbol?: string | null, exchangeCode?: string | null) {
  if (!rawSymbol) return null
  const suffix = exchangeCode ? EXCHANGE_SUFFIX_MAP[exchangeCode] : undefined
  if (suffix === undefined) {
    return rawSymbol
  }
  return suffix === "" ? rawSymbol : `${rawSymbol}${suffix}`
}

function inferAccountCurrency(account: any): string | null {
  const positions = Array.isArray(account?.positions) ? account.positions : []
  for (const position of positions) {
    const code =
      normalizeCurrencyCode(position?.currency ?? null) ||
      normalizeCurrencyCode(position?.symbol?.symbol?.currency ?? null)
    if (code) return code
  }
  return null
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

    const payload = await request.json().catch(() => null)
    const requestedAccountId = payload?.accountId?.toString().trim()
    const customName = payload?.portfolioName?.toString().trim()
    const requestedBaseCurrency = normalizeCurrencyCode(payload?.baseCurrency ?? null)

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

    const selectedAccounts = (accounts as any[]).filter((account) => {
      if (!requestedAccountId) return true
      const accountMeta = account.account ?? {}
      const accountId = accountMeta.id ?? accountMeta.account_id ?? accountMeta.accountId ?? accountMeta.number
      return accountId === requestedAccountId
    })

    if (selectedAccounts.length === 0) {
      return applyCookieMutations(
        NextResponse.json({ error: "No matching SnapTrade accounts found" }, { status: 404 }),
        cookieMutations,
      )
    }

    const created: Array<{ portfolioId: string; name: string }> = []

    for (const account of selectedAccounts) {
      const accountMeta = account.account ?? {}
      const accountId =
        accountMeta.id ?? accountMeta.account_id ?? accountMeta.accountId ?? accountMeta.number ?? null
      if (!accountId) continue

      const inferredCurrency = inferAccountCurrency(account)
      const baseCurrency = (requestedBaseCurrency ?? inferredCurrency ?? "USD").toUpperCase()
      const portfolioName = customName || `SnapTrade - ${accountMeta.name ?? accountMeta.number ?? accountId}`

      const { data: portfolio, error: insertError } = await supabase
        .from("portfolios")
        .insert({
          user_id: user.id,
          name: portfolioName,
          description: "Imported from SnapTrade",
          base_currency: baseCurrency,
        })
        .select()
        .single()

      if (insertError || !portfolio) {
        throw insertError ?? new Error("Failed to create portfolio")
      }

      const holdingsRows: ReturnType<typeof buildHoldingRow>[] = []
      const positions = (account.positions ?? []) as SnaptradePosition[]

      for (const position of positions) {
        const rawSymbol =
          position.symbol?.symbol?.raw_symbol ??
          position.symbol?.symbol?.symbol ??
          position.symbol?.symbol?.description ??
          null
        if (!rawSymbol) continue
        const units = typeof position.units === "number" ? position.units : Number(position.units) || null
        const quoteSymbol = mapQuoteSymbol(
          position.symbol?.symbol?.raw_symbol ?? position.symbol?.symbol?.symbol ?? null,
          position.symbol?.symbol?.exchange?.code ?? null,
        )
        const currencyCode =
          normalizeCurrencyCode(position.currency ?? null) ||
          normalizeCurrencyCode(position.symbol?.symbol?.currency ?? null) ||
          baseCurrency
        holdingsRows.push(
          buildHoldingRow(portfolio.id, {
            ticker: rawSymbol,
            shares: units,
            purchasePrice:
              typeof position.average_purchase_price === "number"
                ? position.average_purchase_price
                : Number(position.average_purchase_price) || null,
            accountId,
            currencyCode,
            quoteSymbol,
          }),
        )
      }

      try {
        const activitiesResponse = await snaptrade.accountInformation.getAccountActivities({
          accountId,
          userId: snaptradeUserId,
          userSecret: snaptradeUserSecret,
          type: "BUY",
          limit: 500,
        })
        const activities = Array.isArray(activitiesResponse.data?.activities)
          ? activitiesResponse.data.activities
          : Array.isArray(activitiesResponse.data)
            ? activitiesResponse.data
            : []

        for (const activity of activities as any[]) {
          const rawSymbol =
            activity.symbol?.universal_symbol?.raw_symbol ??
            activity.symbol?.universal_symbol?.symbol ??
            activity.symbol?.symbol ??
            null
          if (!rawSymbol) continue
          const units =
            typeof activity.units === "number"
              ? activity.units
              : activity.units !== undefined
                ? Number(activity.units)
                : null
          const price =
            typeof activity.price === "number"
              ? activity.price
              : activity.price !== undefined
                ? Number(activity.price)
                : null
          const activityCurrency = normalizeCurrencyCode(activity.currency ?? null) ?? baseCurrency
          const quoteSymbol = mapQuoteSymbol(
            rawSymbol,
            activity.symbol?.universal_symbol?.exchange?.code ?? activity.symbol?.exchange?.code ?? null,
          )

          holdingsRows.push(
            buildHoldingRow(portfolio.id, {
              ticker: rawSymbol,
              shares: units,
              purchasePrice: price,
              accountId,
              currencyCode: activityCurrency,
              quoteSymbol,
            }),
          )
        }
      } catch (activityError) {
        console.error("[snaptrade] failed to fetch account activities", activityError)
      }

      if (holdingsRows.length > 0) {
        const { error: holdingsError } = await supabase.from("portfolio_holdings").insert(holdingsRows)
        if (holdingsError) {
          throw holdingsError
        }
      }

      created.push({ portfolioId: portfolio.id, name: portfolio.name })
    }

    return applyCookieMutations(
      NextResponse.json({ ok: true, portfolios: created }, { status: 201 }),
      cookieMutations,
    )
  } catch (error) {
    console.error("[snaptrade] portfolio import failed", error)
    const message = error instanceof Error ? error.message : "Failed to create portfolio"
    return applyCookieMutations(NextResponse.json({ error: message }, { status: 500 }), cookieMutations)
  }
}
