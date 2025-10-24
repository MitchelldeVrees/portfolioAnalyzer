// Enhanced CSV parser for Bloomberg exports and other financial data formats
import { ColumnMappings, BloombergFieldMapping, BLOOMBERG_FIELD_MAPPINGS } from './bloomberg-mapping';

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
    const columnIndices: Record<string, number> = {};
    
    // Map all fields
    Object.entries(mappings).forEach(([field, header]) => {
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
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter).map(v => v.trim().replace(/['"]/g, ''));
      
      if (values.length < rawHeaders.length) {
        warnings.push(`Row ${i + 1}: Insufficient columns (expected ${rawHeaders.length}, got ${values.length})`);
        continue;
      }
      
      const ticker = values[columnIndices.ticker];
      if (!ticker) {
        warnings.push(`Row ${i + 1}: Empty ticker symbol`);
        continue;
      }
      
      const holding: ParsedHolding = {
        ticker: ticker.toUpperCase().trim()
      };
      
      // Parse numeric fields
      const parseNumericField = (field: string, value: string): number | undefined => {
        if (!value) return undefined;
        const cleaned = value.replace(/[$,\s%]/g, '');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? undefined : parsed;
      };
      
      const parsePercentageField = (field: string, value: string): number | undefined => {
        const num = parseNumericField(field, value);
        if (num === undefined) return undefined;
        // Convert percentage to decimal if > 1
        return num > 1 ? num / 100 : num;
      };
      
      // Map all fields
      if (columnIndices.weight !== undefined) {
        const weight = parsePercentageField('weight', values[columnIndices.weight]);
        if (weight !== undefined) holding.weight = weight;
      }
      
      if (columnIndices.shares !== undefined) {
        const shares = parseNumericField('shares', values[columnIndices.shares]);
        if (shares !== undefined) holding.shares = shares;
      }
      
      if (columnIndices.purchasePrice !== undefined) {
        const price = parseNumericField('purchasePrice', values[columnIndices.purchasePrice]);
        if (price !== undefined) holding.purchasePrice = price;
      }
      
      if (columnIndices.marketPrice !== undefined) {
        const price = parseNumericField('marketPrice', values[columnIndices.marketPrice]);
        if (price !== undefined) holding.marketPrice = price;
      }
      
      if (columnIndices.marketValue !== undefined) {
        const value = parseNumericField('marketValue', values[columnIndices.marketValue]);
        if (value !== undefined) holding.marketValue = value;
      }
      
      if (columnIndices.costValue !== undefined) {
        const value = parseNumericField('costValue', values[columnIndices.costValue]);
        if (value !== undefined) holding.costValue = value;
      }
      
      if (columnIndices.unrealizedPl !== undefined) {
        const pl = parseNumericField('unrealizedPl', values[columnIndices.unrealizedPl]);
        if (pl !== undefined) holding.unrealizedPl = pl;
      }
      
      if (columnIndices.realizedPl !== undefined) {
        const pl = parseNumericField('realizedPl', values[columnIndices.realizedPl]);
        if (pl !== undefined) holding.realizedPl = pl;
      }
      
      if (columnIndices.totalPl !== undefined) {
        const pl = parseNumericField('totalPl', values[columnIndices.totalPl]);
        if (pl !== undefined) holding.totalPl = pl;
      }
      
      if (columnIndices.coupon !== undefined) {
        const coupon = parsePercentageField('coupon', values[columnIndices.coupon]);
        if (coupon !== undefined) holding.coupon = coupon;
      }
      
      if (columnIndices.yieldToMaturity !== undefined) {
        const ytm = parsePercentageField('yieldToMaturity', values[columnIndices.yieldToMaturity]);
        if (ytm !== undefined) holding.yieldToMaturity = ytm;
      }
      
      // Map text fields
      if (columnIndices.securityName !== undefined) {
        holding.securityName = values[columnIndices.securityName];
      }
      
      if (columnIndices.isin !== undefined) {
        holding.isin = values[columnIndices.isin];
      }
      
      if (columnIndices.cusip !== undefined) {
        holding.cusip = values[columnIndices.cusip];
      }
      
      if (columnIndices.sedol !== undefined) {
        holding.sedol = values[columnIndices.sedol];
      }
      
      if (columnIndices.sector !== undefined) {
        holding.sector = values[columnIndices.sector];
      }
      
      if (columnIndices.country !== undefined) {
        holding.country = values[columnIndices.country];
      }
      
      if (columnIndices.assetType !== undefined) {
        holding.assetType = values[columnIndices.assetType];
      }
      
      if (columnIndices.accountId !== undefined) {
        holding.accountId = values[columnIndices.accountId];
      }
      
      if (columnIndices.portfolioName !== undefined) {
        holding.portfolioName = values[columnIndices.portfolioName];
      }
      
      // Map date fields
      if (columnIndices.maturityDate !== undefined) {
        holding.maturityDate = values[columnIndices.maturityDate];
      }
      
      if (columnIndices.tradeDate !== undefined) {
        holding.tradeDate = values[columnIndices.tradeDate];
      }
      
      if (columnIndices.settlementDate !== undefined) {
        holding.settlementDate = values[columnIndices.settlementDate];
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


