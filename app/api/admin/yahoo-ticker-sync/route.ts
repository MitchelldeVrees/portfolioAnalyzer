import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { syncYahooTickers } from "@/lib/tickers/sync-yahoo-tickers";
import { getSessionRole } from "@/lib/security/session";

export const runtime = "nodejs";

function isAuthorized(email: string | null | undefined) {
  if (!email) return false;
  const listEnv = [
    process.env.ADMIN_EMAILS,
    (process.env as any).admin_emails as string | undefined,
    process.env.TICKER_SYNC_ALLOWED_EMAILS,
  ]
    .filter(Boolean)
    .join(",");
  const allow = (listEnv || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || (!isAuthorized(user.email) && getSessionRole(user as any) !== "admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await request.json().catch(() => ({}));
    const dryRun = Boolean(payload?.dryRun);
    const limitSymbols =
      typeof payload?.limitSymbols === "number" && payload.limitSymbols > 0 ? payload.limitSymbols : undefined;

    const result = await syncYahooTickers({
      dryRun,
      limitSymbols,
      onProgress: (stage, data) => {
        console.log("[ticker-sync]", stage, data);
      },
    });

    return NextResponse.json({ ok: true, dryRun: result.dryRun, summary: result });
  } catch (err) {
    console.error("Ticker sync failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
