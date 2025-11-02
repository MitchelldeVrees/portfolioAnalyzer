"use strict";

import { Writable } from "stream";
import { Client as FtpClient } from "basic-ftp";
import yahooFinance from "yahoo-finance2";
import { createAdminClient } from "@/lib/supabase/admin";

export type ListingSource = "nasdaqlisted" | "otherlisted";

export type RawListing = {
  symbol: string;
  name: string;
  exchange?: string | null;
  mic?: string | null;
  currency?: string | null;
  lastPrice?: number | null;
  isEtf: boolean;
  source: ListingSource | "euronext-scrape";
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
const EURONEXT_DOWNLOAD_URL = "https://live.euronext.com/en/pd_es/data/stocks/download?mics=XAMS%2CTNLA";

const DEFAULT_CHUNK_SIZE = 40;
const DEFAULT_THROTTLE_MS = 250;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PortifyBot/1.0 Safari/537.36",
  Accept: "text/csv,application/octet-stream;q=0.9,*/*;q=0.8",
};

const OTHER_EXCHANGE_MAP: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  Z: "BATS",
};

const MIC_TO_YAHOO_SUFFIX: Record<string, string> = {
  XAMS: ".AS",
  XPAR: ".PA",
  XBRU: ".BR",
  XBRV: ".VX",
  XLIS: ".LS",
  XMAD: ".MC",
  XLON: ".L",
  XETR: ".DE",
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  const normalised = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let currentField = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let i = 0; i < normalised.length; i++) {
    const char = normalised[i];

    if (char === '"') {
      if (insideQuotes && normalised[i + 1] === '"') {
        currentField += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ";" && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
      continue;
    }

    if (char === "\n" && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  if (currentField.length || currentRow.length) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function renderTableHtml(rows: string[][]): string {
  const htmlRows = rows
    .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><tbody>${htmlRows}</tbody></table>`;
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
      mic: undefined,
      currency: "USD",
      lastPrice: null,
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
      mic: undefined,
      currency: "USD",
      lastPrice: null,
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

async function fetchUSListings(): Promise<RawListing[]> {
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

function isLikelyEtf(name: string): boolean {
  const upper = name.toUpperCase();
  return /\b(ETF|UCITS)\b/.test(upper);
}

function toNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d,.\-]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchEuronextAmsterdamListings(): Promise<RawListing[]> {
  const response = await fetch(EURONEXT_DOWNLOAD_URL, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to download Euronext Amsterdam listings (status ${response.status})`);
  }

  const csvText = await response.text();
  const records = parseCsvRecords(csvText);
  if (!records.length) return [];

  const { load } = await import("cheerio");
  const tableHtml = renderTableHtml(records);
  const $ = load(tableHtml);

  const headerCells = $("tr")
    .first()
    .find("td")
    .toArray()
    .map((cell) => $(cell).text().trim());

  if (!headerCells.length) return [];

  const normalisedHeaders = headerCells.map((cell) => cell.toLowerCase());
  const findIndex = (label: string) => normalisedHeaders.indexOf(label.toLowerCase());

  const nameIdx = findIndex("name");
  const symbolIdx = findIndex("symbol");
  const currencyIdx = findIndex("currency");
  const lastPriceIdx = findIndex("last price");
  const isinIdx = findIndex("isin");
  const marketIdx = findIndex("market");

  const listings: RawListing[] = [];

  $("tr")
    .slice(1)
    .each((_, element) => {
      const cells = $(element).find("td");
      if (cells.length !== headerCells.length) return;

      const rawSymbol = cells.eq(symbolIdx).text().trim();
      const symbol = sanitizeTicker(rawSymbol);
      if (!symbol) return;

      const name = cells.eq(nameIdx).text().trim() || symbol;
      const currency = cells.eq(currencyIdx).text().trim().toUpperCase() || "EUR";
      const lastPrice = toNumber(cells.eq(lastPriceIdx).text());
      const isin = cells.eq(isinIdx).text().trim();
      const market = cells.eq(marketIdx).text().trim();

      listings.push({
        symbol,
        name,
        exchange: "Euronext Amsterdam",
        mic: "XAMS",
        currency,
        lastPrice: lastPrice ?? null,
        isEtf: isLikelyEtf(name),
        source: "euronext-scrape",
        metadata: {
          isin: isin || null,
          market: market || null,
        },
      });
    });

  return listings;
}

function dedupeListings(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();
  for (const listing of listings) {
    const keySymbol = sanitizeTicker(listing.symbol) ?? listing.symbol;
    const keyMic = (listing.mic ?? "").toUpperCase();
    const key = `${keySymbol}::${keyMic}`;
    if (!map.has(key)) {
      map.set(key, listing);
    }
  }
  return Array.from(map.values());
}

function buildYahooSymbol(listing: RawListing): string {
  const base = sanitizeTicker(listing.symbol) ?? listing.symbol.trim().toUpperCase();
  const mic = listing.mic?.toUpperCase();
  const suffix = mic ? MIC_TO_YAHOO_SUFFIX[mic] ?? "" : "";
  return sanitizeTicker(`${base}${suffix}`) ?? `${base}${suffix}`;
}

async function fetchGlobalListings(): Promise<RawListing[]> {
  const [usListings, amsterdamListings] = await Promise.all([fetchUSListings(), fetchEuronextAmsterdamListings()]);
  return dedupeListings([...usListings, ...amsterdamListings]);
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

  const listings = await fetchGlobalListings();
  const limitedListings = typeof limitSymbols === "number" ? listings.slice(0, limitSymbols) : listings;

  const yahooSymbols = limitedListings.map((listing) => buildYahooSymbol(listing));
  const uniqueSymbols = Array.from(new Set(yahooSymbols.filter(Boolean))).sort();

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
    const yahooSymbol = buildYahooSymbol(listing);
    const quote = quoteMap.get(yahooSymbol);

    if (!quote && listing.source !== "euronext-scrape") {
      missingQuoteCount += 1;
      continue;
    }

    const displayName = (quote?.longName || quote?.shortName || listing.name || listing.symbol).trim();
    const marketCap =
      typeof quote?.marketCap === "number" && Number.isFinite(quote.marketCap) ? quote.marketCap : null;

    if (!marketCap) {
      missingMarketCapCount += 1;
    }

    const currency = quote?.currency ?? quote?.financialCurrency ?? listing.currency ?? null;
    const exchange =
      quote?.fullExchangeName ?? listing.exchange ?? (listing.mic === "XAMS" ? "Euronext Amsterdam" : null);
    const instrumentType = quote?.quoteType ?? (listing.isEtf ? "ETF" : "EQUITY");
    const isEtf = Boolean(listing.isEtf || (quote?.quoteType ?? "").toUpperCase() === "ETF");

    rowsToUpsert.push({
      symbol: listing.symbol,
      name: displayName,
      exchange,
      instrument_type: instrumentType,
      is_etf: isEtf,
      market_cap: marketCap,
      currency,
      source: listing.source,
      metadata: {
        listing,
        quoteType: quote?.quoteType ?? null,
        yahooSymbol,
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
