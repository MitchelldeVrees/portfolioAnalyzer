import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export interface TickerSearchResult {
  symbol: string;
  name: string;
  marketCap?: number;
  exchange?: string | null;
}

function normalizeQuery(input: string) {
  return input.trim();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get("q");
    const query = rawQuery ? normalizeQuery(rawQuery) : "";

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const supabase = await createServerClient();
    const upper = query.toUpperCase();
    const symbolPattern = `${upper}%`;
    const namePattern = `%${query}%`;

    const { data, error } = await supabase
      .from("yahoo_tickers")
      .select("symbol, name, market_cap, exchange")
      .or(`symbol.ilike.${symbolPattern},name.ilike.${namePattern}`)
      .order("market_cap", { ascending: false, nullsLast: true })
      .limit(25);

    if (error) {
      console.error("Ticker search supabase error:", error);
      return NextResponse.json({ results: [] }, { status: 500 });
    }

    const results =
      data?.map((row) => ({
        symbol: row.symbol,
        name: row.name ?? row.symbol,
        marketCap: row.market_cap ? Number(row.market_cap) : undefined,
        exchange: row.exchange,
      })) ?? [];

    // Ensure exact symbol matches bubble to the top.
    results.sort((a, b) => {
      const aExact = a.symbol.toUpperCase() === upper ? 1 : 0;
      const bExact = b.symbol.toUpperCase() === upper ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aCap = a.marketCap ?? -1;
      const bCap = b.marketCap ?? -1;
      if (aCap !== bCap) return bCap - aCap;

      return a.symbol.localeCompare(b.symbol);
    });

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch (error) {
    console.error("Ticker search error:", error);
    return NextResponse.json({ results: [] }, { status: 500 });
  }
}
