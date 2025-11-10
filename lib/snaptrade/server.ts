import type { SupabaseClient } from "@supabase/supabase-js"
import { getSnaptradeClient } from "./client"

type SnaptradeProfileFields = {
  snaptrade_user_id?: string | null
  snaptrade_user_secret?: string | null
}

export async function ensureSnaptradeCredentials(supabase: SupabaseClient, userId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select<SnaptradeProfileFields>("snaptrade_user_id, snaptrade_user_secret")
    .eq("id", userId)
    .single()

  if (error) {
    throw error
  }

  const snaptradeUserId = profile?.snaptrade_user_id ?? userId
  let snaptradeUserSecret = profile?.snaptrade_user_secret ?? null

  if (!snaptradeUserSecret) {
    const snaptrade = getSnaptradeClient()
    const registerResponse = await snaptrade.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    })

    const secret = (registerResponse.data as { userSecret?: string } | undefined)?.userSecret
    if (!secret) {
      throw new Error("SnapTrade did not return a user secret")
    }

    snaptradeUserSecret = secret

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        snaptrade_user_id: snaptradeUserId,
        snaptrade_user_secret: snaptradeUserSecret,
      })
      .eq("id", userId)

    if (updateError) {
      throw updateError
    }
  } else if (!profile?.snaptrade_user_id) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        snaptrade_user_id: snaptradeUserId,
      })
      .eq("id", userId)

    if (updateError) {
      throw updateError
    }
  }

  return { snaptradeUserId, snaptradeUserSecret }
}
