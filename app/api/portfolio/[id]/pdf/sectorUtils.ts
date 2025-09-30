import yahooFinance from "yahoo-finance2";

export const SECTOR_LEADERS: Record<string, string[]> = {
  "Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "GOOGL", "META", "TSM", "ASML", "ORCL", "ADBE"],
  "Information Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "ASML", "CSCO", "CRM", "AMD"],
  "Healthcare": ["LLY", "JNJ", "UNH", "MRK", "ABBV", "PFE", "TMO", "ABT", "BMY", "AMGN"],
  "Health Care": ["LLY", "JNJ", "UNH", "MRK", "ABBV", "PFE", "TMO", "ABT", "BMY", "AMGN"],
  "Financial Services": ["BRK-B", "JPM", "BAC", "WFC", "MS", "GS", "C", "AXP", "SCHW", "SPGI"],
  "Financials": ["BRK-B", "JPM", "BAC", "WFC", "MS", "GS", "C", "AXP", "SCHW", "SPGI"],
  "Communication Services": ["GOOGL", "META", "NFLX", "TMUS", "DIS", "CMCSA", "VZ", "T", "TTWO", "EA"],
  "Consumer Cyclical": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "ADBE", "LVMUY"],
  "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "BKNG", "TJX", "ORLY"],
  "Consumer Defensive": ["WMT", "PG", "COST", "KO", "PEP", "PM", "MO", "MDLZ", "CL", "TGT"],
  "Industrials": ["UNP", "RTX", "CAT", "BA", "HON", "UPS", "GE", "DE", "LMT", "ADI"],
  "Energy": ["XOM", "CVX", "SHEL", "TTE", "COP", "BP", "PBR", "EOG", "SLB", "ENB"],
  "Utilities": ["NEE", "DUK", "SO", "SRE", "AEP", "EXC", "D", "XEL", "PCG", "NGG"],
  "Real Estate": ["PLD", "AMT", "EQIX", "PSA", "O", "CCI", "SPG", "WELL", "CSGP", "VICI"],
  "Materials": ["LIN", "SHW", "APD", "BHP", "RIO", "FCX", "ECL", "NEM", "DOW", "PPG"],
};

export async function getSectorForTicker(ticker: string): Promise<string | null> {
  try {
    const qs: any = await yahooFinance.quoteSummary(ticker, { modules: ["assetProfile"] });
    const sector = qs?.assetProfile?.sector;
    if (sector && typeof sector === "string") return sector;
  } catch {
    // ignore
  }
  try {
    const q: any = await yahooFinance.quote(ticker);
    const sector = q?.sector;
    if (sector && typeof sector === "string") return sector;
  } catch {
    // ignore
  }
  return null;
}

export function normSectorName(s: string | null | undefined): string {
  if (!s) return "Other";
  const m = s.trim();
  if (/^info(?:rmation)?\s+tech/i.test(m)) return "Information Technology";
  if (/^tech/i.test(m)) return "Technology";
  if (/^health\s*care/i.test(m)) return "Health Care";
  if (/^financial/i.test(m)) return "Financials";
  if (/^consumer\s+(discretionary|cyclical)/i.test(m)) return "Consumer Discretionary";
  if (/^consumer\s+defensive/i.test(m)) return "Consumer Defensive";
  return m;
}