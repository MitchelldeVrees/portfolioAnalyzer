const isProduction = process.env.NODE_ENV === "production";

export const SESSION_IDLE_TIMEOUT_SECONDS = Number(process.env.AUTH_SESSION_IDLE_TIMEOUT_SECONDS ?? 15 * 60);
export const SESSION_ABSOLUTE_TIMEOUT_SECONDS = Number(process.env.AUTH_SESSION_MAX_LIFETIME_SECONDS ?? 12 * 60 * 60);

export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  sameSite: "strict" as const,
  secure: isProduction,
  maxAge: SESSION_ABSOLUTE_TIMEOUT_SECONDS,
};

export const SESSION_IDLE_COOKIE_NAME = "pa.session.last";
export const SESSION_ISSUED_COOKIE_NAME = "pa.session.issued";
export const SESSION_ROLE_COOKIE_NAME = "pa.session.role";
export function getSessionRole(user: { email?: string | null; app_metadata?: Record<string, unknown> } | null) {
  if (!user) return "anonymous";

  const listEnv = [
    process.env.ADMIN_EMAILS,
    // allow alternate/case variants for convenience
    (process.env as any).admin_emails as string | undefined,
    process.env.TICKER_SYNC_ALLOWED_EMAILS,
  ]
    .filter(Boolean)
    .join(",");

  const adminAllowList = (listEnv || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const email = user.email?.toLowerCase() ?? "";
  const isAdminMetadata =
    typeof user.app_metadata === "object" && user.app_metadata !== null && !!(user.app_metadata as any).admin;

  if (isAdminMetadata || (email && adminAllowList.includes(email))) {
    return "admin";
  }

  return "user";
}

export type SessionRole = ReturnType<typeof getSessionRole>;
