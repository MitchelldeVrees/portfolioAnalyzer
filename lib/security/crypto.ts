import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto"

function resolveKey(): Buffer {
  const secret = process.env.MFA_CRYPTO_KEY
  if (!secret) {
    throw new Error("MFA_CRYPTO_KEY environment variable is required for MFA operations")
  }

  if (/^[a-f0-9]{64}$/i.test(secret.trim())) {
    return Buffer.from(secret.trim(), "hex")
  }

  return createHash("sha256").update(secret).digest()
}

export function encryptSecret(plainText: string) {
  const key = resolveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url")
}

export function decryptSecret(payload: string) {
  const key = resolveKey()
  const buffer = Buffer.from(payload, "base64url")
  const iv = buffer.subarray(0, 12)
  const authTag = buffer.subarray(12, 28)
  const encrypted = buffer.subarray(28)

  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  return decrypted.toString("utf8")
}

export function signPayload(payload: string) {
  const key = resolveKey()
  return createHmac("sha256", key).update(payload).digest("base64url")
}

export function verifySignature(payload: string, signature: string) {
  const expected = signPayload(payload)
  const a = Buffer.from(signature, "base64url")
  const b = Buffer.from(expected, "base64url")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
