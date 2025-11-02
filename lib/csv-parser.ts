// Enhanced CSV parser for Bloomberg exports and other financial data formats
import { ColumnMappings } from './upload-parsing';

export interface ParsedHolding {
  ticker: string;
  weight?: number;
  shares?: number;
  purchasePrice?: number;
  // Bloomberg-specific fields
  securityName?: string;
  isin?: string;
  cusip?: string;
  sedol?: string;
  marketValue?: number;
  costValue?: number;
  unrealizedPl?: number;
  realizedPl?: number;
  totalPl?: number;
  sector?: string;
  country?: string;
  assetType?: string;
  coupon?: number;
  maturityDate?: string;
  yieldToMaturity?: number;
  tradeDate?: string;
  settlementDate?: string;
  marketPrice?: number;
  accountId?: string;
  portfolioName?: string;
}

export interface ParseResult {
  holdings: ParsedHolding[];
  errors: string[];
  warnings: string[];
  detectedDelimiter: string;
  encoding: string;
}

// Detect CSV delimiter
export function detectDelimiter(content: string): string {
  const lines = content.split('\n').slice(0, 5); // Check first 5 lines
  const delimiters = [',', ';', '\t', '|'];
  const delimiterCounts = delimiters.map(delimiter => {
    const counts = lines.map(line => (line.match(new RegExp(`\\${delimiter}`, 'g')) || []).length);
    return {
      delimiter,
      count: counts.reduce((sum, count) => sum + count, 0),
      consistency: counts.every(count => count === counts[0]) ? counts[0] : 0
    };
  });

  // Prefer delimiter with highest count and consistency
  return delimiterCounts
    .sort((a, b) => {
      if (a.consistency > 0 && b.consistency === 0) return -1;
      if (b.consistency > 0 && a.consistency === 0) return 1;
      return b.count - a.count;
    })[0]?.delimiter || ',';
}

// Parse CSV content with enhanced Bloomberg support
export function parseCSVContent(content: string, mappings: ColumnMappings): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Detect delimiter
    const delimiter = detectDelimiter(content);
    
    // Split into lines and clean
    const lines = content.trim().split('\n').map(line => line.trim()).filter(line => line);
    
    if (lines.length < 2) {
      errors.push('File must contain at least a header row and one data row');
      return { holdings: [], errors, warnings, detectedDelimiter: delimiter, encoding: 'utf-8' };
    }
    
    // Parse headers
    const rawHeaders = lines[0].split(delimiter).map(h => h.trim().replace(/['"]/g, ''));
    const lowerHeaders = rawHeaders.map(h => h.toLowerCase());
    
    // Validate required ticker mapping
    if (!mappings.ticker) {
      errors.push('Ticker column mapping is required');
      return { holdings: [], errors, warnings, detectedDelimiter: delimiter, encoding: 'utf-8' };
    }
    
    // Find column indices
    const columnIndices: Partial<Record<keyof ColumnMappings, number>> = {};

    (Object.entries(mappings) as Array<[keyof ColumnMappings, string]>).forEach(([field, header]) => {
      if (header && header !== '') {
        const index = lowerHeaders.findIndex(h => h === header.toLowerCase());
        if (index !== -1) {
          columnIndices[field] = index;
        } else {
          warnings.push(`Column "${header}" not found in file headers`);
        }
      }
    });
    
    if (columnIndices.ticker === undefined) {
      errors.push(`Ticker column "${mappings.ticker}" not found in file`);
      return { holdings: [], errors, warnings, detectedDelimiter: delimiter, encoding: 'utf-8' };
    }
    
    // Parse data rows
    const holdings: ParsedHolding[] = [];
    
    const parseNumericField = (value: string | undefined): number | undefined => {
      if (!value) return undefined;
      const cleaned = value.replace(/[$,\s%]/g, '');
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? undefined : parsed;
    };

    const parsePercentageField = (value: string | undefined): number | undefined => {
      const numeric = parseNumericField(value);
      if (numeric === undefined) return undefined;
      return numeric > 1 ? numeric / 100 : numeric;
    };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter).map(v => v.trim().replace(/['"]/g, ''));
      const rowNumber = i;
      const tickerIndex = columnIndices.ticker ?? -1;

      if (tickerIndex < 0 || tickerIndex >= values.length) {
        warnings.push(`Row ${rowNumber}: Missing ticker value.`);
        continue;
      }

      const ticker = values[tickerIndex];
      if (!ticker) {
        warnings.push(`Row ${rowNumber}: Empty ticker symbol`);
        continue;
      }

      const holding: ParsedHolding = {
        ticker: ticker.toUpperCase().trim()
      };

      if (columnIndices.weight !== undefined) {
        const rawWeight = columnIndices.weight < values.length ? values[columnIndices.weight] : undefined;
        const weight = parsePercentageField(rawWeight);
        if (weight !== undefined) holding.weight = weight;
      }

      if (columnIndices.shares !== undefined) {
        const rawShares = columnIndices.shares < values.length ? values[columnIndices.shares] : undefined;
        const shares = parseNumericField(rawShares);
        if (shares !== undefined) holding.shares = shares;
      }

      if (columnIndices.purchasePrice !== undefined) {
        const rawPrice = columnIndices.purchasePrice < values.length ? values[columnIndices.purchasePrice] : undefined;
        const price = parseNumericField(rawPrice);
        if (price !== undefined) holding.purchasePrice = price;
      }

      holdings.push(holding);
    }
    
    if (holdings.length === 0) {
      errors.push('No valid holdings found in the file');
    }
    
    return { holdings, errors, warnings, detectedDelimiter: delimiter, encoding: 'utf-8' };
    
  } catch (error) {
    errors.push(`Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { holdings: [], errors, warnings, detectedDelimiter: ',', encoding: 'utf-8' };
  }
}

// Validate parsed holdings
export function validateHoldings(holdings: ParsedHolding[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (holdings.length === 0) {
    errors.push('No holdings found');
    return { errors, warnings };
  }
  
  // Check for duplicate tickers
  const tickers = holdings.map(h => h.ticker);
  const duplicates = tickers.filter((ticker, index) => tickers.indexOf(ticker) !== index);
  if (duplicates.length > 0) {
    warnings.push(`Duplicate tickers found: ${[...new Set(duplicates)].join(', ')}`);
  }
  
  // Check weight totals
  const totalWeight = holdings.reduce((sum, h) => sum + (h.weight || 0), 0);
  if (totalWeight > 0) {
    if (Math.abs(totalWeight - 1) > 0.01 && Math.abs(totalWeight - 100) > 1) {
      warnings.push(`Total weight is ${(totalWeight * 100).toFixed(2)}%. Expected 100% or 1.0`);
    }
  }
  
  // Check for negative values where they shouldn't be
  holdings.forEach((holding, index) => {
    if (holding.weight !== undefined && holding.weight < 0) {
      warnings.push(`Row ${index + 1}: Negative weight for ${holding.ticker}`);
    }
    if (holding.shares !== undefined && holding.shares < 0) {
      warnings.push(`Row ${index + 1}: Negative shares for ${holding.ticker}`);
    }
  });
  
  return { errors, warnings };
}
