import type { SupabaseClient } from "@supabase/supabase-js"

import { getSnaptradeClient } from "@/lib/snaptrade/client"
import { ensureSnaptradeCredentials } from "@/lib/snaptrade/server"

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
  accounts?: SnaptradeAccountHoldingRaw[]
  summary?: {
    total: number
    currency?: string | null
  }
  pendingBroker?: string | null
  pendingMessage?: string | null
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
      pendingBroker: brokerName,
      pendingMessage: message ?? "No active broker connection found. Connect a broker first to sync holdings.",
    }
  }

  const { data } = await snaptrade.accountInformation.getAllUserHoldings({
    userId: snaptradeUserId,
    userSecret: snaptradeUserSecret,
  })

  const accounts = Array.isArray(data) ? data : []
  const summary = accounts.reduce<{ total: number; currency?: string | null }>(
    (acc, account) => {
      const amount = account?.account?.balance?.total?.amount ?? 0
      const currency = account?.account?.balance?.total?.currency ?? acc.currency
      return {
        total: acc.total + amount,
        currency,
      }
    },
    { total: 0, currency: accounts[0]?.account?.balance?.total?.currency ?? null },
  )

  return {
    status: "ok",
    accounts,
    summary,
  }
}
