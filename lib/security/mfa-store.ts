import { createAdminClient } from "@/lib/supabase/admin"
import type { User } from "@supabase/supabase-js"

import { decryptSecret, encryptSecret } from "./crypto"

export type StoredTotpState = {
  secret?: string
  pendingSecret?: string
  verified?: boolean
  enrolledAt?: string
}

export type StoredWebAuthnCredential = {
  id: string
  publicKey: string
  counter: number
  transports?: string[]
  name: string
  createdAt: string
}

export type StoredWebAuthnState = {
  credentials?: StoredWebAuthnCredential[]
}

export type StoredMfaState = {
  totp?: StoredTotpState
  webauthn?: StoredWebAuthnState
}

export type PublicTotpState = {
  enabled: boolean
  pendingEnrollment: boolean
  enrolledAt?: string
}

export type PublicWebAuthnCredential = Pick<StoredWebAuthnCredential, "id" | "name" | "createdAt">

export type PublicWebAuthnState = {
  credentials: PublicWebAuthnCredential[]
}

export type PublicMfaState = {
  totp: PublicTotpState
  webauthn: PublicWebAuthnState
}

function cloneState(state: StoredMfaState | undefined | null): StoredMfaState {
  return state ? (JSON.parse(JSON.stringify(state)) as StoredMfaState) : {}
}

function pruneState(state: StoredMfaState): StoredMfaState {
  const next: StoredMfaState = {}

  if (state.totp) {
    const totp = { ...state.totp }
    if (!totp.secret && !totp.pendingSecret) {
      delete totp.verified
      delete totp.enrolledAt
    }
    if (Object.keys(totp).length > 0) {
      next.totp = totp
    }
  }

  if (state.webauthn) {
    const webauthn: StoredWebAuthnState = {
      credentials: state.webauthn.credentials?.filter(Boolean) ?? [],
    }

    if (webauthn.credentials && webauthn.credentials.length === 0) {
      delete webauthn.credentials
    }

    if (webauthn.credentials) {
      next.webauthn = webauthn
    }
  }

  return next
}

export async function readMfaState(userId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) {
    throw error ?? new Error("Failed to load user")
  }

  const rawState = cloneState((data.user.app_metadata as any)?.mfa)
  return { user: data.user, state: rawState }
}

export async function updateMfaState(
  userId: string,
  updater: (current: StoredMfaState, user: User) => StoredMfaState,
) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) {
    throw error ?? new Error("Failed to load user")
  }

  const currentState = cloneState((data.user.app_metadata as any)?.mfa)
  const nextState = pruneState(updater(currentState, data.user) ?? {})
  const nextAppMetadata = {
    ...(data.user.app_metadata ?? {}),
    mfa: nextState,
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: nextAppMetadata,
  })

  if (updateError) {
    throw updateError
  }

  return { user: data.user, state: nextState }
}

export function toPublicMfaState(state: StoredMfaState): PublicMfaState {
  const totpEnabled = Boolean(state.totp?.secret)
  const totpPending = Boolean(state.totp?.pendingSecret)

  return {
    totp: {
      enabled: totpEnabled,
      pendingEnrollment: totpPending,
      enrolledAt: state.totp?.enrolledAt,
    },
    webauthn: {
      credentials: (state.webauthn?.credentials ?? []).map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
      })),
    },
  }
}

export function storeTotpSecret(secret: string) {
  return encryptSecret(secret)
}

export function restoreSecret(payload: string) {
  return decryptSecret(payload)
}

export function getActiveTotpSecret(state: StoredMfaState) {
  const encrypted = state.totp?.secret
  if (!encrypted) return null
  return restoreSecret(encrypted)
}

export function getPendingTotpSecret(state: StoredMfaState) {
  const encrypted = state.totp?.pendingSecret
  if (!encrypted) return null
  return restoreSecret(encrypted)
}

export function hasTotpFactor(state: StoredMfaState) {
  return Boolean(state.totp?.secret)
}

export function hasWebAuthnFactor(state: StoredMfaState) {
  return (state.webauthn?.credentials?.length ?? 0) > 0
}
