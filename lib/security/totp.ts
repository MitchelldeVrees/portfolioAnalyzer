import { authenticator } from "otplib"

const issuer = process.env.MFA_TOTP_ISSUER ?? "Portfolio Analyzer"

authenticator.options = {
  window: 1,
}

export function generateTotpSecret() {
  return authenticator.generateSecret()
}

export function buildTotpKeyUri(email: string, secret: string) {
  return authenticator.keyuri(email, issuer, secret)
}

export function verifyTotpToken(secret: string, token: string) {
  return authenticator.verify({ token, secret })
}
