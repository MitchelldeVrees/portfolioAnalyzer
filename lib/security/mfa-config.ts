import type { SessionRole } from "./session"

export const MFA_DISABLED = process.env.DISABLE_MFA === "1"
export const MFA_BASELINE_ENABLED = !MFA_DISABLED
export const MFA_ADMIN_ONLY = (process.env.MFA_ADMIN_ONLY ?? "1") !== "0"

export function isMfaEnabledForRole(role: SessionRole | null | undefined): boolean {
  if (!MFA_BASELINE_ENABLED) return false
  if (!role) return false
  if (MFA_ADMIN_ONLY && role !== "admin") {
    return false
  }
  return true
}
