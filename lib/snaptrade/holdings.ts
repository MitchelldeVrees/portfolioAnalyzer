import type { SupabaseClient } from "@supabase/supabase-js"

import { getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"
import { fetchFxRate } from "@/lib/market-data"

type Authorization = {
  id?: string | null
  disabled?: boolean | null
  brokerage?: {
    slug?: string | null
    name?: string | null
    display_name?: string | null
  } | null
}

type SnaptradeAccountHoldingRaw = {
  account?: {
    balance?: {
      total?: {
        amount?: number | null
        currency?: string | null
      }
    }
  }
}

export type SnaptradeHoldingsSummary = {
  status: "ok" | "pending" | "none"
  snaptradeUserId?: string
  baseCurrency?: string
  fxRates?: Record<string, number>
  accounts?: SnaptradeAccountHoldingRaw[]
  summary?: {
    total: number
    currency?: string | null
  }
  summaryBase?: {
    total: number
    currency?: string | null
  }
  pendingBroker?: string | null
  pendingMessage?: string | null
}

function normalizeCurrencyCode(value?: { code?: string | null } | string | null): string | null {
  if (!value) return null
  if (typeof value === "string") {
    const trimmed = value.trim().toUpperCase()
    return trimmed || null
  }
  const code = value.code ?? null
  return code ? code.trim().toUpperCase() : null
}

export async function attachBaseCurrencyToSnaptradeAccounts(
  accounts: any[] | undefined,
  baseCurrency = "USD",
): Promise<{
  baseCurrency: string
  accounts: any[]
  summaryBase: { total: number; currency?: string | null } | null
  fxRates: Record<string, number>
}> {
  const normalizedBase = normalizeCurrencyCode(baseCurrency) ?? "USD"
  const inputAccounts = Array.isArray(accounts) ? accounts : []
  const fxRates: Record<string, number> = {}

  const getRate = async (fromCurrency?: string | null) => {
    const from = normalizeCurrencyCode(fromCurrency) ?? normalizedBase
    if (!fxRates[from]) {
      fxRates[from] = await fetchFxRate(from, normalizedBase)
    }
    return fxRates[from]
  }

  const converted = await Promise.all(
    inputAccounts.map(async (account: any) => {
      const accountCurrency =
        normalizeCurrencyCode(account?.total_value?.currency) ??
        normalizeCurrencyCode(account?.account?.balance?.total?.currency) ??
        normalizedBase
      const totalValue = typeof account?.total_value?.value === "number" ? account.total_value.value : null
      const totalRate = await getRate(accountCurrency)
      const totalValueBase = typeof totalValue === "number" ? totalValue * totalRate : null

      const cashAmount =
        typeof account?.account?.balance?.total?.amount === "number" ? account.account.balance.total.amount : null
      const cashCurrency = normalizeCurrencyCode(account?.account?.balance?.total?.currency) ?? accountCurrency
      const cashRate = await getRate(cashCurrency)
      const cashBase = typeof cashAmount === "number" ? cashAmount * cashRate : null

      const positions = Array.isArray(account?.positions)
        ? await Promise.all(
            account.positions.map(async (position: any) => {
              const priceCurrency =
                normalizeCurrencyCode(position?.currency?.code ?? position?.currency) ??
                normalizeCurrencyCode(position?.symbol?.symbol?.currency) ??
                normalizedBase
              const fx = await getRate(priceCurrency)
              const units =
                typeof position?.units === "number"
                  ? position.units
                  : typeof position?.fractional_units === "number"
                    ? position.fractional_units
                    : null
              const price = typeof position?.price === "number" ? position.price : null
              const priceBase = typeof price === "number" ? price * fx : null
              const valueBase = priceBase !== null && typeof units === "number" ? priceBase * units : null

              return {
                ...position,
                price_currency: priceCurrency,
                fx_to_base: fx,
                price_base: priceBase,
                value_base: valueBase,
              }
            }),
          )
        : account?.positions ?? []

      return {
        ...account,
        base_currency: normalizedBase,
        total_value_base: {
          currency: normalizedBase,
          value: totalValueBase,
        },
        cash_base: {
          currency: normalizedBase,
          value: cashBase,
        },
        positions,
      }
    }),
  )

  const summaryBase =
    converted.length > 0
      ? converted.reduce<{ total: number; currency?: string | null }>(
          (acc, account) => ({
            total:
              acc.total +
              (typeof account?.total_value_base?.value === "number" ? (account.total_value_base.value as number) : 0),
            currency: normalizedBase,
          }),
          { total: 0, currency: normalizedBase },
        )
      : null

  return { baseCurrency: normalizedBase, accounts: converted, summaryBase, fxRates }
}

export async function getSnaptradeHoldingsDetails(
  supabase: SupabaseClient,
  userId: string,
): Promise<SnaptradeHoldingsSummary> {
  const { snaptradeUserId, snaptradeUserSecret } = await ensureSnaptradeCredentials(supabase, userId)
  const snaptrade = getSnaptradeClient()

  const { data: authorizations } = await snaptrade.connections.listBrokerageAuthorizations({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
  })

  const authList: Authorization[] = Array.isArray(authorizations) ? authorizations : []
  const activeAuthorization = authList.find((auth) => !Boolean(auth.disabled))
  const pendingAuthorization = authList.find((auth) => Boolean(auth.disabled))

  if (!activeAuthorization) {
    const brokerName =
      pendingAuthorization?.brokerage?.display_name ??
      pendingAuthorization?.brokerage?.name ??
      pendingAuthorization?.brokerage?.slug ??
      null

    const message = pendingAuthorization
      ? `${brokerName ?? "Your broker"} is still provisioning read access. This step can take up to 24 hours—please try syncing again later.`
      : null

    return {
      status: pendingAuthorization ? "pending" : "none",
      snaptradeUserId,
      pendingBroker: brokerName,
      pendingMessage: message ?? "No active broker connection found. Connect a broker first to sync holdings.",
    }
  }

  const { data } = await snaptrade.accountInformation.getAllUserHoldings({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
  })

  const accountsRaw = Array.isArray(data) ? data : []
  const summary = accountsRaw.reduce<{ total: number; currency?: string | null }>(
    (acc, account) => {
      const amount = account?.account?.balance?.total?.amount ?? 0
      const currency = account?.account?.balance?.total?.currency ?? acc.currency
      return {
        total: acc.total + amount,
        currency,
      }
    },
    { total: 0, currency: accountsRaw[0]?.account?.balance?.total?.currency ?? null },
  )
  const { accounts, summaryBase, baseCurrency, fxRates } = await attachBaseCurrencyToSnaptradeAccounts(
    accountsRaw,
    "USD",
  )

  return {
    status: "ok",
    snaptradeUserId,
    baseCurrency,
    fxRates,
    accounts,
    summary,
    summaryBase,
  }
}
