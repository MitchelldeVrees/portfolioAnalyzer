// Bloomberg field mapping configuration
// This file defines all possible Bloomberg fields and their mappings to our database columns

export interface BloombergFieldMapping {
  bloombergField: string;
  displayName: string;
  description: string;
  category: 'portfolio' | 'account' | 'security' | 'pricing' | 'holdings' | 'analytics' | 'type' | 'fixed-income' | 'trade';
  dataType: 'text' | 'number' | 'date' | 'percentage' | 'currency';
  required: boolean;
  examples: string[];
  commonHeaders: string[]; // Common variations of header names
}

export interface ColumnMappings {
  // Core required fields
  ticker: string;
  
  // Optional core fields
  weight?: string;
  shares?: string;
  purchasePrice?: string;
  
  // Bloomberg-specific fields
  securityName?: string;
  isin?: string;
  cusip?: string;
  sedol?: string;
  marketValue?: string;
  costValue?: string;
  unrealizedPl?: string;
  realizedPl?: string;
  totalPl?: string;
  sector?: string;
  country?: string;
  assetType?: string;
  coupon?: string;
  maturityDate?: string;
  yieldToMaturity?: string;
  tradeDate?: string;
  settlementDate?: string;
  marketPrice?: string;
  accountId?: string;
  portfolioName?: string;
}

export const BLOOMBERG_FIELD_MAPPINGS: BloombergFieldMapping[] = [
  // Portfolio Information
  {
    bloombergField: 'PORTFOLIO_NAME',
    displayName: 'Portfolio Name',
    description: 'Name of the portfolio',
    category: 'portfolio',
    dataType: 'text',
    required: false,
    examples: ['Main Portfolio', 'Growth Fund', 'Retirement Account'],
    commonHeaders: ['Portfolio Name', 'Portfolio', 'Fund Name', 'Account Name']
  },
  
  // Account Information
  {
    bloombergField: 'ACCT_ID',
    displayName: 'Account Number',
    description: 'Account identifier',
    category: 'account',
    dataType: 'text',
    required: false,
    examples: ['ACC-1001', '12345', 'MAIN-ACCOUNT'],
    commonHeaders: ['Account Number', 'Account ID', 'Account', 'Acct ID']
  },
  
  // Security Identifiers
  {
    bloombergField: 'SECURITY_NAME',
    displayName: 'Security Description',
    description: 'Full name/description of the security',
    category: 'security',
    dataType: 'text',
    required: false,
    examples: ['Apple Inc', 'Microsoft Corporation', 'Tesla Inc'],
    commonHeaders: ['Security Description', 'Security Name', 'Company Name', 'Description', 'Name']
  },
  {
    bloombergField: 'TICKER',
    displayName: 'Ticker Symbol',
    description: 'Stock ticker symbol',
    category: 'security',
    dataType: 'text',
    required: true,
    examples: ['AAPL US', 'MSFT US', 'TSLA US'],
    commonHeaders: ['Ticker', 'Symbol', 'Stock Symbol', 'Ticker Symbol']
  },
  {
    bloombergField: 'ISIN',
    displayName: 'ISIN',
    description: 'International Securities Identification Number',
    category: 'security',
    dataType: 'text',
    required: false,
    examples: ['US0378331005', 'US5949181045'],
    commonHeaders: ['ISIN', 'ISIN Code']
  },
  {
    bloombergField: 'CUSIP',
    displayName: 'CUSIP',
    description: 'Committee on Uniform Securities Identification Procedures',
    category: 'security',
    dataType: 'text',
    required: false,
    examples: ['037833100', '594918104'],
    commonHeaders: ['CUSIP', 'CUSIP Code']
  },
  {
    bloombergField: 'SEDOL1',
    displayName: 'SEDOL',
    description: 'Stock Exchange Daily Official List',
    category: 'security',
    dataType: 'text',
    required: false,
    examples: ['2046251', 'B0YQYS3'],
    commonHeaders: ['SEDOL', 'SEDOL Code']
  },
  
  // Pricing
  {
    bloombergField: 'PX_LAST',
    displayName: 'Market Price',
    description: 'Last market price',
    category: 'pricing',
    dataType: 'currency',
    required: false,
    examples: ['174.22', '342.50', '1,234.56'],
    commonHeaders: ['Market Price', 'Price', 'Last Price', 'Current Price', 'Share Price']
  },
  
  // Holdings
  {
    bloombergField: 'POSITION',
    displayName: 'Quantity',
    description: 'Number of shares/units held',
    category: 'holdings',
    dataType: 'number',
    required: false,
    examples: ['150', '1,000', '50.5'],
    commonHeaders: ['Quantity', 'Shares', 'Position', 'Units', 'Amount']
  },
  {
    bloombergField: 'MKT_VAL',
    displayName: 'Market Value',
    description: 'Current market value of position',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['26,133.00', '342,500.00'],
    commonHeaders: ['Market Value', 'Current Value', 'Value', 'Mkt Val']
  },
  {
    bloombergField: 'COST_PRICE',
    displayName: 'Cost Price',
    description: 'Original purchase price per share',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['120.50', '250.00'],
    commonHeaders: ['Cost Price', 'Purchase Price', 'Cost Basis', 'Avg Cost']
  },
  {
    bloombergField: 'COST_VALUE',
    displayName: 'Cost Value',
    description: 'Total cost basis of position',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['18,075.00', '250,000.00'],
    commonHeaders: ['Cost Value', 'Cost Basis', 'Total Cost', 'Original Cost']
  },
  {
    bloombergField: 'UNREALIZED_PL',
    displayName: 'Unrealized P/L',
    description: 'Unrealized profit or loss',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['8,058.00', '-1,250.00'],
    commonHeaders: ['Unrealized P/L', 'Unrealized PL', 'Unrealized Gain/Loss', 'Paper P/L']
  },
  {
    bloombergField: 'REALIZED_PL',
    displayName: 'Realized P/L',
    description: 'Realized profit or loss',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['0.00', '5,000.00'],
    commonHeaders: ['Realized P/L', 'Realized PL', 'Realized Gain/Loss']
  },
  {
    bloombergField: 'TOTAL_PL',
    displayName: 'Total P/L',
    description: 'Total profit or loss (realized + unrealized)',
    category: 'holdings',
    dataType: 'currency',
    required: false,
    examples: ['8,058.00', '-500.00'],
    commonHeaders: ['Total P/L', 'Total PL', 'Total Gain/Loss', 'Net P/L']
  },
  
  // Portfolio Analytics
  {
    bloombergField: 'WEIGHT_PCT',
    displayName: 'Weight (%)',
    description: 'Portfolio weight percentage',
    category: 'analytics',
    dataType: 'percentage',
    required: false,
    examples: ['12.3', '5.67'],
    commonHeaders: ['Weight (%)', 'Weight', 'Allocation', 'Percentage', 'Weight %']
  },
  
  // Security Type
  {
    bloombergField: 'SECURITY_TYP',
    displayName: 'Asset Type',
    description: 'Type of security',
    category: 'type',
    dataType: 'text',
    required: false,
    examples: ['Equity', 'Bond', 'ETF', 'Mutual Fund'],
    commonHeaders: ['Asset Type', 'Security Type', 'Type', 'Instrument Type']
  },
  
  // Sector
  {
    bloombergField: 'INDUSTRY_SECTOR',
    displayName: 'Sector',
    description: 'Industry sector classification',
    category: 'type',
    dataType: 'text',
    required: false,
    examples: ['Technology', 'Healthcare', 'Financial Services'],
    commonHeaders: ['Sector', 'Industry', 'Industry Sector', 'GICS Sector']
  },
  
  // Country
  {
    bloombergField: 'CNTRY_OF_DOMICILE',
    displayName: 'Country of Domicile',
    description: 'Country where the security is domiciled',
    category: 'type',
    dataType: 'text',
    required: false,
    examples: ['United States', 'Canada', 'United Kingdom'],
    commonHeaders: ['Country of Domicile', 'Country', 'Domicile', 'Country Code']
  },
  
  // Fixed Income
  {
    bloombergField: 'CPN',
    displayName: 'Coupon',
    description: 'Coupon rate for fixed income securities',
    category: 'fixed-income',
    dataType: 'percentage',
    required: false,
    examples: ['2.125', '4.5'],
    commonHeaders: ['Coupon', 'Coupon Rate', 'Interest Rate']
  },
  {
    bloombergField: 'MATURITY',
    displayName: 'Maturity Date',
    description: 'Maturity date for fixed income securities',
    category: 'fixed-income',
    dataType: 'date',
    required: false,
    examples: ['2028-11-15', '12/31/2030'],
    commonHeaders: ['Maturity Date', 'Maturity', 'Expiry Date']
  },
  {
    bloombergField: 'YIELD_TO_MATURITY',
    displayName: 'Yield (%)',
    description: 'Yield to maturity percentage',
    category: 'fixed-income',
    dataType: 'percentage',
    required: false,
    examples: ['2.3', '4.75'],
    commonHeaders: ['Yield (%)', 'Yield to Maturity', 'YTM', 'Yield']
  },
  
  // Trade Information
  {
    bloombergField: 'TRADE_DATE',
    displayName: 'Trade Date',
    description: 'Date when the trade was executed',
    category: 'trade',
    dataType: 'date',
    required: false,
    examples: ['2025-09-02', '09/02/2025'],
    commonHeaders: ['Trade Date', 'Transaction Date', 'Execution Date']
  },
  {
    bloombergField: 'SETTLE_DT',
    displayName: 'Settlement Date',
    description: 'Date when the trade settles',
    category: 'trade',
    dataType: 'date',
    required: false,
    examples: ['2025-09-04', '09/04/2025'],
    commonHeaders: ['Settlement Date', 'Settle Date', 'Settlement']
  }
];

// Helper functions for field mapping
export function findBestMatch(header: string, mappings: BloombergFieldMapping[]): BloombergFieldMapping | null {
  const normalizedHeader = header.toLowerCase().trim();
  
  for (const mapping of mappings) {
    // Check exact match with common headers
    for (const commonHeader of mapping.commonHeaders) {
      if (normalizedHeader === commonHeader.toLowerCase()) {
        return mapping;
      }
    }
    
    // Check partial matches
    for (const commonHeader of mapping.commonHeaders) {
      if (normalizedHeader.includes(commonHeader.toLowerCase()) || 
          commonHeader.toLowerCase().includes(normalizedHeader)) {
        return mapping;
      }
    }
  }
  
  return null;
}

export function autoMapHeaders(headers: string[]): Partial<ColumnMappings> {
  const mappings: Partial<ColumnMappings> = {};
  
  for (const header of headers) {
    const match = findBestMatch(header, BLOOMBERG_FIELD_MAPPINGS);
    if (match) {
      const fieldName = match.bloombergField.toLowerCase().replace(/_/g, '');
      switch (fieldName) {
        case 'ticker':
          mappings.ticker = header;
          break;
        case 'weightpct':
          mappings.weight = header;
          break;
        case 'position':
          mappings.shares = header;
          break;
        case 'costprice':
          mappings.purchasePrice = header;
          break;
        case 'securityname':
          mappings.securityName = header;
          break;
        case 'isin':
          mappings.isin = header;
          break;
        case 'cusip':
          mappings.cusip = header;
          break;
        case 'sedol1':
          mappings.sedol = header;
          break;
        case 'mktval':
          mappings.marketValue = header;
          break;
        case 'costvalue':
          mappings.costValue = header;
          break;
        case 'unrealizedpl':
          mappings.unrealizedPl = header;
          break;
        case 'realizedpl':
          mappings.realizedPl = header;
          break;
        case 'totalpl':
          mappings.totalPl = header;
          break;
        case 'industrysector':
          mappings.sector = header;
          break;
        case 'cntryofdomicile':
          mappings.country = header;
          break;
        case 'securitytyp':
          mappings.assetType = header;
          break;
        case 'cpn':
          mappings.coupon = header;
          break;
        case 'maturity':
          mappings.maturityDate = header;
          break;
        case 'yieldtomaturity':
          mappings.yieldToMaturity = header;
          break;
        case 'tradedate':
          mappings.tradeDate = header;
          break;
        case 'settledt':
          mappings.settlementDate = header;
          break;
        case 'pxlast':
          mappings.marketPrice = header;
          break;
        case 'acctid':
          mappings.accountId = header;
          break;
        case 'portfolioname':
          mappings.portfolioName = header;
          break;
      }
    }
  }
  
  return mappings;
}

export function getFieldMappingByBloombergField(bloombergField: string): BloombergFieldMapping | undefined {
  return BLOOMBERG_FIELD_MAPPINGS.find(mapping => mapping.bloombergField === bloombergField);
}

export function getMappingsByCategory(category: BloombergFieldMapping['category']): BloombergFieldMapping[] {
  return BLOOMBERG_FIELD_MAPPINGS.filter(mapping => mapping.category === category);
}


