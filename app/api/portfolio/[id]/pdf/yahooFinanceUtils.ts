import yahooFinance from "yahoo-finance2";

type Bar = { date: string; adjClose: number };

export async function getDailyHistoryAdjClose(symbol: string, days = 252): Promise<Bar[]> {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - Math.floor(days * 24 * 60 * 60 * 1.1);
    const ch: any = await yahooFinance.chart(symbol, {
      period1: start,
      period2: end,
      interval: "1d",
      events: "div,splits",
    });
    const quotes = ch?.quotes || [];
    return quotes
      .filter((q: any) => typeof q.adjclose === "number" && q.date)
      .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), adjClose: q.adjclose }));
  } catch {
    return [];
  }
}

export function toDailyReturns(series: Bar[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].adjClose;
    const cur = series[i].adjClose;
    if (prev > 0 && isFinite(prev) && isFinite(cur)) {
      out.push({ date: series[i].date, r: (cur / prev) - 1 });
    }
  }
  return out;
}

export type FundRow = {
  symbol: string;
  trailingPE?: number | null;
  forwardPE?: number | null;
  dividendYield?: number | null;
};

export async function getFundamentals(tickers: string[]): Promise<Record<string, FundRow>> {
  const out: Record<string, FundRow> = {};
  await Promise.all(tickers.map(async (t) => {
    try {
      const qs: any = await yahooFinance.quoteSummary(t, {
        modules: ["summaryDetail", "defaultKeyStatistics", "price"],
      });
      const sd = qs?.summaryDetail || {};
      const ks = qs?.defaultKeyStatistics || {};
      const symbol = (qs?.price?.symbol || t || "").toUpperCase();
      out[symbol] = {
        symbol,
        trailingPE: typeof sd?.trailingPE === "number" ? sd.trailingPE : (typeof ks?.trailingPE === "number" ? ks.trailingPE : null),
        forwardPE: typeof sd?.forwardPE === "number" ? sd.forwardPE : (typeof ks?.forwardPE === "number" ? ks.forwardPE : null),
        dividendYield: typeof sd?.dividendYield === "number" ? sd.dividendYield : null,
      };
    } catch {
      // ignore
    }
  }));
  return out;
}

export type QuoteLite = { symbol: string; marketCap?: number | null };

export async function getMarketCaps(tickers: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (!tickers.length) return result;
  try {
    const quotes = (await yahooFinance.quote(tickers)) as any[];
    for (const q of quotes) {
      const sym = q?.symbol;
      const mc = q?.marketCap;
      if (sym && typeof mc === "number" && isFinite(mc)) result[sym.toUpperCase()] = mc;
    }
  } catch {
    await Promise.all(
      tickers.map(async (t) => {
        try {
          const q: any = await yahooFinance.quote(t);
          if (q?.symbol && typeof q.marketCap === "number") result[q.symbol.toUpperCase()] = q.marketCap;
        } catch {
          /* noop */
        }
      })
    );
  }
  return result;
}