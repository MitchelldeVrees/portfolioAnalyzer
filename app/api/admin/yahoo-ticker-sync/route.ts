import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { syncYahooTickers } from "@/lib/tickers/sync-yahoo-tickers";

export const runtime = "nodejs";

function isAuthorizedEmail(email: string | null | undefined) {
  if (!email) return false;
  const allowList = (process.env.TICKER_SYNC_ALLOWED_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowList.length === 0) return false;
  return allowList.includes(email.toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    
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
