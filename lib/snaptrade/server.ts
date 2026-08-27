import type { SupabaseClient } from "@supabase/supabase-js"
import { getSnaptradeClient } from "./client"

type SnaptradeProfileFields = {
  snaptrade_user_id?: string | null
  snaptrade_user_secret?: string | null
}

export type SnaptradeUserCredentials = {
  snaptradeUserId: string
  snaptradeUserSecret: string
}

type SnaptradeErrorLike = {
  name?: unknown
  status?: unknown
  statusText?: unknown
  code?: unknown
  responseBody?: unknown
}

class SnaptradeRequestError extends Error {
  readonly status?: number
  readonly statusText?: string
  readonly responseBody?: Record<string, unknown>

  constructor(error: SnaptradeErrorLike) {
    const responseBody = sanitizeSnaptradeResponseBody(error.responseBody)
    const detail = typeof responseBody?.detail === "string" ? responseBody.detail : null
    super(detail ?? `SnapTrade request failed${typeof error.status === "number" ? ` (${error.status})` : ""}`)
    this.name = "SnaptradeRequestError"
    this.status = typeof error.status === "number" ? error.status : undefined
    this.statusText = typeof error.statusText === "string" ? error.statusText : undefined
    this.responseBody = responseBody
  }
}

function getSnaptradeError(error: unknown): SnaptradeErrorLike | null {
  if (!error || typeof error !== "object") return null
  return error as SnaptradeErrorLike
}

function sanitizeSnaptradeResponseBody(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object") return undefined

  const body = responseBody as Record<string, unknown>
  return {
    detail: body.detail,
    status_code: body.status_code,
    code: body.code,
  }
}

function sanitizeSnaptradeError(error: unknown) {
  const snaptradeError = getSnaptradeError(error)
  return snaptradeError?.name === "SnaptradeError" ? new SnaptradeRequestError(snaptradeError) : error
}

function isInvalidSnaptradeUserCredentials(error: unknown) {
  const snaptradeError = getSnaptradeError(error)
  if (snaptradeError?.status !== 401) return false

  const responseBody = snaptradeError.responseBody
  if (!responseBody || typeof responseBody !== "object") return false

  return String((responseBody as { code?: unknown }).code) === "1083"
}

async function persistSnaptradeCredentials(
  supabase: SupabaseClient,
  userId: string,
  credentials: SnaptradeUserCredentials,
) {
  const { error } = await supabase
    .from("profiles")
    .update({
      snaptrade_user_id: credentials.snaptradeUserId,
      snaptrade_user_secret: credentials.snaptradeUserSecret,
    })
    .eq("id", userId)

  if (error) {
    throw error
  }
}

async function refreshSnaptradeCredentials(
  supabase: SupabaseClient,
  userId: string,
  snaptradeUserId: string,
): Promise<SnaptradeUserCredentials> {
  const snaptrade = getSnaptradeClient()
  let response: { data: { userSecret?: string } }

  try {
    response = await snaptrade.authentication.resetSnapTradeUserSecret({
      userId: snaptradeUserId,
    })
  } catch (error) {
    const snaptradeError = getSnaptradeError(error)
    if (snaptradeError?.status !== 404) {
      throw error
    }

    response = await snaptrade.authentication.registerSnapTradeUser({
      userId: snaptradeUserId,
    })
  }

  const snaptradeUserSecret = (response.data as { userSecret?: string } | undefined)?.userSecret
  if (!snaptradeUserSecret) {
    throw new Error("SnapTrade did not return a user secret")
  }

  const credentials = { snaptradeUserId, snaptradeUserSecret }
  await persistSnaptradeCredentials(supabase, userId, credentials)
  return credentials
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

    await persistSnaptradeCredentials(supabase, userId, { snaptradeUserId, snaptradeUserSecret })
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

export async function withSnaptradeUserCredentials<T>(
  supabase: SupabaseClient,
  userId: string,
  operation: (credentials: SnaptradeUserCredentials) => Promise<T>,
): Promise<T> {
  try {
    const credentials = await ensureSnaptradeCredentials(supabase, userId)

    try {
      return await operation(credentials)
    } catch (error) {
      if (!isInvalidSnaptradeUserCredentials(error)) {
        throw error
      }

      const refreshedCredentials = await refreshSnaptradeCredentials(
        supabase,
        userId,
        credentials.snaptradeUserId,
      )
      return await operation(refreshedCredentials)
    }
  } catch (error) {
    throw sanitizeSnaptradeError(error)
  }
}

export function logSnaptradeError(context: string, error: unknown) {
  const snaptradeError = getSnaptradeError(error)
  if (snaptradeError?.name === "SnaptradeError" || snaptradeError?.name === "SnaptradeRequestError") {
    console.error(context, {
      name: snaptradeError.name,
      status: snaptradeError.status,
      statusText: snaptradeError.statusText,
      code: snaptradeError.code,
      responseBody: sanitizeSnaptradeResponseBody(snaptradeError.responseBody),
    })
    return
  }

  console.error(context, error)
}
