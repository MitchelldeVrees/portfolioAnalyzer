import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import type {
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from "@simplewebauthn/server"

import { signPayload, verifySignature } from "./crypto"
import type { StoredWebAuthnCredential } from "./mfa-store"

export const WEBAUTHN_CHALLENGE_COOKIE_NAME = "pa.webauthn.challenge"

const rpId = process.env.WEBAUTHN_RP_ID
const rpName = process.env.WEBAUTHN_RP_NAME ?? "Portfolio Analyzer"
const origin = process.env.WEBAUTHN_ORIGIN

if (!rpId) {
  console.warn("WEBAUTHN_RP_ID is not configured. WebAuthn will not function correctly.")
}

if (!origin) {
  console.warn("WEBAUTHN_ORIGIN is not configured. WebAuthn will not function correctly.")
}

export type WebAuthnChallengeType = "registration" | "authentication"

export type StoredChallenge = {
  challenge: string
  type: WebAuthnChallengeType
  userId: string
  createdAt: number
}

export function encodeChallenge(data: StoredChallenge) {
  const payload = JSON.stringify(data)
  const signature = signPayload(payload)
  return `${Buffer.from(payload).toString("base64url")}.${signature}`
}

export function decodeChallenge(token: string) {
  const [payload, signature] = token.split(".")
  if (!payload || !signature) {
    throw new Error("Malformed challenge token")
  }
  const json = Buffer.from(payload, "base64url").toString("utf8")
  if (!verifySignature(json, signature)) {
    throw new Error("Invalid challenge signature")
  }
  return JSON.parse(json) as StoredChallenge
}

export function createRegistrationOptions(options: Omit<GenerateRegistrationOptionsOpts, "rpName" | "rpID">) {
  if (!rpId || !origin) {
    throw new Error("WebAuthn configuration is missing")
  }
  return generateRegistrationOptions({
    rpID: rpId,
    rpName,
    authenticatorSelection: {
      requireResidentKey: false,
      userVerification: "required",
    },
    attestationType: "none",
    ...options,
  })
}

export function verifyRegistrationResponseForUser(
  response: Parameters<typeof verifyRegistrationResponse>[0]["response"],
  expectedChallenge: string,
): VerifiedRegistrationResponse {
  if (!rpId || !origin) {
    throw new Error("WebAuthn configuration is missing")
  }

  return verifyRegistrationResponse({
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    response,
    requireUserVerification: true,
  })
}

export function createAuthenticationOptions(
  options: Omit<GenerateAuthenticationOptionsOpts, "rpID" | "userVerification">,
) {
  if (!rpId || !origin) {
    throw new Error("WebAuthn configuration is missing")
  }

  return generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "required",
    ...options,
  })
}

export function verifyAuthenticationResponseForUser(
  response: Parameters<typeof verifyAuthenticationResponse>[0]["response"],
  expectedChallenge: string,
  credential: StoredWebAuthnCredential,
): VerifiedAuthenticationResponse {
  if (!rpId || !origin) {
    throw new Error("WebAuthn configuration is missing")
  }

  return verifyAuthenticationResponse({
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    response,
    requireUserVerification: true,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey, "base64url"),
      counter: credential.counter,
      transports: credential.transports,
    },
  })
}
