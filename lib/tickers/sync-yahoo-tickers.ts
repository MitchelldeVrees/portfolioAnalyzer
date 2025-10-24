import { Writable } from "stream";
import { Client as FtpClient } from "basic-ftp";
import yahooFinance from "yahoo-finance2";
import { createAdminClient } from "@/lib/supabase/admin";

type ListingSource = "nasdaqlisted" | "otherlisted";

type RawListing = {
  symbol: string;
  name: string;
  exchange?: string | null;
  isEtf: boolean;
  source: ListingSource;
  metadata?: Record<string, any>;
};

type SyncOptions = {
  dryRun?: boolean;
  chunkSize?: number;
  throttleMs?: number;
  onProgress?: (stage: string, payload: Record<string, any>) => void;
  limitSymbols?: number;
};

export type SyncYahooTickerSummary = {
  totalListings: number;
  uniqueSymbols: number;
  payloadSize: number;
  upserted: number;
  skippedWithoutQuote: number;
  missingMarketCap: number;
  dryRun: boolean;
  durationMs: number;
  errors: string[];
};

const NASDAQ_REMOTE_PATH = "SymbolDirectory/nasdaqlisted.txt";
const OTHER_REMOTE_PATH = "SymbolDirectory/otherlisted.txt";

const DEFAULT_CHUNK_SIZE = 40;
const DEFAULT_THROTTLE_MS = 250;

const OTHER_EXCHANGE_MAP: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  Z: "BATS",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(ticker: string): string | null {
  if (!ticker) return null;
  const trimmed = ticker.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed.includes(" ") && !trimmed.includes(".")) {
    return trimmed.replace(/\s+/g, "");
  }
  return trimmed;
}

async function downloadFromNasdaq(path: string): Promise<string> {
  const client = new FtpClient();
  try {
    await client.access({
      host: "ftp.nasdaqtrader.com",
      port: 21,
      user: "anonymous",
      password: "anonymous@example.com",
      secure: false,
      secureOptions: undefined,
      passive: true,
    });

    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    await client.downloadTo(writable, path);
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    client.close();
  }
}

function parseNasdaqListings(raw: string): RawListing[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("File Creation Time"));

  if (lines.length <= 1) return [];

  const header = lines[0].split("|");
  const symbolIdx = header.indexOf("Symbol");
  const nameIdx = header.indexOf("Security Name");
  const testIssueIdx = header.indexOf("Test Issue");
  const etfIdx = header.indexOf("ETF");

  const listings: RawListing[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("|");
    if (parts.length < header.length) continue;

    const symbol = sanitizeTicker(parts[symbolIdx]);
    if (!symbol) continue;

    const testIssue = parts[testIssueIdx] === "Y";
    if (testIssue) continue;

    const name = (parts[nameIdx] || symbol).trim();
    const isEtf = parts[etfIdx] === "Y";

    listings.push({
      symbol,
      name,
      exchange: "NASDAQ",
      isEtf,
      source: "nasdaqlisted",
      metadata: {
        marketCategory: parts[header.indexOf("Market Category")] ?? null,
        financialStatus: parts[header.indexOf("Financial Status")] ?? null,
      },
    });
  }

  return listings;
}

function parseOtherListings(raw: string): RawListing[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("File Creation Time"));

  if (lines.length <= 1) return [];

  const header = lines[0].split("|");
  const symbolIdx = header.indexOf("ACT Symbol");
  const nameIdx = header.indexOf("Security Name");
  const exchangeIdx = header.indexOf("Exchange");
  const testIssueIdx = header.indexOf("Test Issue");
  const etfIdx = header.indexOf("ETF");

  const listings: RawListing[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("|");
    if (parts.length < header.length) continue;

    const symbol = sanitizeTicker(parts[symbolIdx]);
    if (!symbol) continue;

    const testIssue = parts[testIssueIdx] === "Y";
    if (testIssue) continue;

    const name = (parts[nameIdx] || symbol).trim();
    const exchangeCode = parts[exchangeIdx];
    const exchange = OTHER_EXCHANGE_MAP[exchangeCode] ?? exchangeCode ?? null;
    const isEtf = parts[etfIdx] === "Y";

    listings.push({
      symbol,
      name,
      exchange,
      isEtf,
      source: "otherlisted",
      metadata: {
        exchangeCode,
        cqsSymbol: parts[header.indexOf("CQS Symbol")] ?? null,
      },
    });
  }

  return listings;
}

async function fetchListings(): Promise<RawListing[]> {
  const [nasdaqRaw, otherRaw] = await Promise.all([
    downloadFromNasdaq(NASDAQ_REMOTE_PATH),
    downloadFromNasdaq(OTHER_REMOTE_PATH),
  ]);

  const nasdaqListings = parseNasdaqListings(nasdaqRaw);
  const otherListings = parseOtherListings(otherRaw);

  const combined = new Map<string, RawListing>();

  for (const listing of otherListings) {
    combined.set(listing.symbol, listing);
  }

  for (const listing of nasdaqListings) {
    combined.set(listing.symbol, listing);
  }

  return Array.from(combined.values());
}

type QuoteLite = {
  symbol: string;
  shortName?: string;
  longName?: string;
  marketCap?: number | null;
  currency?: string | null;
  financialCurrency?: string | null;
  fullExchangeName?: string | null;
  quoteType?: string | null;
};

async function fetchQuotesInChunks(
  symbols: string[],
  chunkSize: number,
  throttleMs: number,
  onProgress?: SyncOptions["onProgress"],
): Promise<Map<string, QuoteLite>> {
  const result = new Map<string, QuoteLite>();

  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    onProgress?.("fetch:yahoo", { current: i, total: symbols.length, chunk: chunk.length });

    try {
      const quotes = await yahooFinance.quote(chunk, undefined, { validateResult: false });
      const list = Array.isArray(quotes) ? quotes : [quotes];
      for (const quote of list) {
        if (!quote) continue;
        const key = sanitizeTicker((quote.symbol ?? chunk[0]) as string);
        if (!key) continue;
        result.set(key, {
          symbol: key,
          shortName: quote.shortName ?? undefined,
          longName: quote.longName ?? undefined,
          marketCap: typeof quote.marketCap === "number" ? quote.marketCap : undefined,
          currency: quote.currency ?? undefined,
          financialCurrency: quote.financialCurrency ?? undefined,
          fullExchangeName: quote.fullExchangeName ?? undefined,
          quoteType: quote.quoteType ?? undefined,
        });
      }
    } catch (err) {
      onProgress?.("fetch:error", {
        chunkStart: i,
        chunkSize,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  return result;
}

export async function syncYahooTickers(options: SyncOptions = {}): Promise<SyncYahooTickerSummary> {
  const { dryRun = false, chunkSize = DEFAULT_CHUNK_SIZE, throttleMs = DEFAULT_THROTTLE_MS, onProgress, limitSymbols } =
    options;
  const startedAt = Date.now();
  const errors: string[] = [];

  yahooFinance.suppressNotices?.(["yahooSurvey"]);

  const listings = await fetchListings();
  const limitedListings = typeof limitSymbols === "number" ? listings.slice(0, limitSymbols) : listings;

  const uniqueSymbols = limitedListings.map((l) => l.symbol);
  uniqueSymbols.sort();

  onProgress?.("listings:fetched", {
    totalListings: listings.length,
    uniqueSymbols: uniqueSymbols.length,
  });

  const quoteMap = await fetchQuotesInChunks(uniqueSymbols, chunkSize, throttleMs, (stage, payload) => {
    if (stage === "fetch:error" && payload.error) {
      errors.push(payload.error);
    }
    onProgress?.(stage, payload);
  });

  const supabase = dryRun ? null : createAdminClient();
  const rowsToUpsert: any[] = [];

  let missingQuoteCount = 0;
  let missingMarketCapCount = 0;

  for (const listing of limitedListings) {
    const quote = quoteMap.get(listing.symbol);
    if (!quote) {
      missingQuoteCount += 1;
      continue;
    }

    const displayName = (quote.longName || quote.shortName || listing.name || listing.symbol).trim();
    const marketCap =
      typeof quote.marketCap === "number" && Number.isFinite(quote.marketCap) ? quote.marketCap : null;

    if (!marketCap) {
      missingMarketCapCount += 1;
    }

    rowsToUpsert.push({
      symbol: listing.symbol,
      name: displayName,
      exchange: quote.fullExchangeName ?? listing.exchange ?? null,
      instrument_type: quote.quoteType ?? (listing.isEtf ? "ETF" : "EQUITY"),
      is_etf: listing.isEtf || (quote.quoteType ?? "").toUpperCase() === "ETF",
      market_cap: marketCap,
      currency: quote.currency ?? quote.financialCurrency ?? null,
      source: listing.source,
      metadata: {
        listing,
        quoteType: quote.quoteType ?? null,
      },
      updated_at: new Date().toISOString(),
    });
  }

  onProgress?.("payload:prepared", { size: rowsToUpsert.length });

  let upserted = 0;

  if (!dryRun && rowsToUpsert.length) {
    const batchSize = 500;
    for (let i = 0; i < rowsToUpsert.length; i += batchSize) {
      const batch = rowsToUpsert.slice(i, i + batchSize);
      const { error } = await supabase!
        .from("yahoo_tickers")
        .upsert(batch, { onConflict: "symbol" })
        .select("symbol");

      if (error) {
        const message = `Upsert failed at batch starting ${i}: ${error.message}`;
        errors.push(message);
        throw error;
      }
      upserted += batch.length;
      onProgress?.("upsert:batch", { processed: Math.min(i + batch.length, rowsToUpsert.length), total: rowsToUpsert.length });
      if (throttleMs > 0) {
        await sleep(50);
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  return {
    totalListings: listings.length,
    uniqueSymbols: uniqueSymbols.length,
    payloadSize: rowsToUpsert.length,
    upserted: dryRun ? 0 : upserted,
    skippedWithoutQuote: missingQuoteCount,
    missingMarketCap: missingMarketCapCount,
    dryRun,
    durationMs,
    errors,
  };
}
