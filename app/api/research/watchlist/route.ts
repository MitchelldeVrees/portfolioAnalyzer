import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

type WatchlistRow = {
  id: string;
  ticker: string;
  label: string | null;
  notes: string | null;
  created_at: string;
};

function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

async function requireUser() {
  const supabase = await createServerClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  return { supabase, user: auth.user } as const;
}

async function listWatchlist(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("research_watchlist")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[watchlist] list error:", error);
    throw new Error("Failed to load watchlist");
  }
  return (data ?? []) as WatchlistRow[];
}

export async function GET() {
  try {
    const session = await requireUser();
    if ("error" in session) return session.error;

    const rows = await listWatchlist(session.supabase, session.user.id);
    return NextResponse.json({ watchlist: rows });
  } catch (error) {
    console.error("[watchlist] GET error:", error);
    return NextResponse.json({ error: "Failed to load watchlist" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireUser();
    if ("error" in session) return session.error;

    const payload = await request.json().catch(() => ({}));
    const ticker = normalizeTicker(payload?.ticker);
    if (!ticker) {
      return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
    }
    const label = normalizeLabel(payload?.label);
    const notes = normalizeNotes(payload?.notes);

    const { data: existing, error: selectErr } = await session.supabase
      .from("research_watchlist")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("ticker", ticker)
      .maybeSingle();

    if (selectErr) {
      console.error("[watchlist] select error:", selectErr);
      return NextResponse.json({ error: "Failed to upsert watchlist" }, { status: 500 });
    }

    if (existing?.id) {
      const { error: updateErr } = await session.supabase
        .from("research_watchlist")
        .update({ label, notes })
        .eq("id", existing.id)
        .eq("user_id", session.user.id);
      if (updateErr) {
        console.error("[watchlist] update error:", updateErr);
        return NextResponse.json({ error: "Failed to update watchlist item" }, { status: 500 });
      }
    } else {
      const { error: insertErr } = await session.supabase.from("research_watchlist").insert({
        user_id: session.user.id,
        ticker,
        label,
        notes,
      });
      if (insertErr) {
        console.error("[watchlist] insert error:", insertErr);
        return NextResponse.json({ error: "Failed to add watchlist item" }, { status: 500 });
      }
    }

    const rows = await listWatchlist(session.supabase, session.user.id);
    return NextResponse.json({ watchlist: rows });
  } catch (error) {
    console.error("[watchlist] POST error:", error);
    return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await requireUser();
    if ("error" in session) return session.error;

    const { searchParams } = new URL(request.url);
    const ticker = normalizeTicker(searchParams.get("ticker"));
    const id = searchParams.get("id");

    if (!ticker && !id) {
      return NextResponse.json({ error: "Ticker or id is required" }, { status: 400 });
    }

    const builder = session.supabase.from("research_watchlist").delete().eq("user_id", session.user.id);
    if (id) {
      builder.eq("id", id);
    } else if (ticker) {
      builder.eq("ticker", ticker);
    }

    const { error: deleteErr } = await builder;
    if (deleteErr) {
      console.error("[watchlist] delete error:", deleteErr);
      return NextResponse.json({ error: "Failed to remove watchlist item" }, { status: 500 });
    }

    const rows = await listWatchlist(session.supabase, session.user.id);
    return NextResponse.json({ watchlist: rows });
  } catch (error) {
    console.error("[watchlist] DELETE error:", error);
    return NextResponse.json({ error: "Failed to remove watchlist item" }, { status: 500 });
  }
}
