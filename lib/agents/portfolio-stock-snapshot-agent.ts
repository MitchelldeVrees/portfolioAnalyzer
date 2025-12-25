import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

// Schema for a single stock snapshot returned by the model
export const AgentSchema = z.object({
  ticker: z.string(),
  sources: z.array(z.string()),
  profile: z.object({
    description: z.string(),
    sector: z.string(),
    industry: z.string(),
  }),
  fundamentals: z.object({
    revenue: z.number(),
    revenue_period: z.string(),
    net_income: z.number(),
    eps: z.number(),
    margin: z.number(),
    growth_yoy: z.number(),
  }),
  valuation: z.object({
    market_cap: z.number(),
    price: z.number(),
    as_of: z.string(),
  }),
  narrative: z.object({
    summary: z.string(),
    drivers: z.array(z.string()),
    risks: z.array(z.string()),
  }),
});

export type StockSnapshot = z.infer<typeof AgentSchema>;

// Portfolio-level input that we will send as JSON text
export type PortfolioAgentInput = {
  portfolio_name: string;
  last_updated: string;
  positions: Array<{
    ticker: string;
    weight: number;
  }>;
  total_weight: number;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const STOCK_SNAPSHOT_WRAPPER_SCHEMA = z.object({
  snapshots: z.array(AgentSchema),
});
const stockSnapshotFormat = zodTextFormat(STOCK_SNAPSHOT_WRAPPER_SCHEMA, "stock_snapshots");

const AGENT_INSTRUCTIONS = `For each ticker symbol in the "positions" array of the input portfolio JSON, research and return a detailed, structured company analysis in the following specified JSON format.

Your process must be as follows:
- Carefully research each ticker using reputable and authoritative sources.
- For each company, gather and document all relevant, up-to-date facts and quantitative details.
- Assess source credibility and only use information verifiable from your references.
- Do NOT begin writing summaries, narratives, or any conclusions until all research, evidence gathering, and reasoning are complete.
- Organize findings into each required section; the final, human-readable narrative summary MUST be written last, strictly based on assembled evidence.
- List all sources used per ticker in the "sources" array with enough detail for future verification.
- All information must be explicitly supported by cited research—do NOT infer, speculate, or assume.

# Required JSON Output Structure

Return a single JSON object with this exact shape:

{
  "snapshots": [
    {
      "ticker": "[Ticker symbol from the input]",
      "sources": [
        "[Clickable URLs or full citation strings for all references used—must include company IR, reputable finance/data/news sites]"
      ],
      "profile": {
        "description": "[Short (2–4 sentence) business description, strictly based on sources]",
        "sector": "[Full sector name (e.g. 'Information Technology')]",
        "industry": "[Industry name (e.g. 'Consumer Electronics')]"
      },
      "fundamentals": {
        "revenue": [Latest annual revenue as a number, in absolute original currency units],
        "revenue_period": "[Fiscal period for revenue, e.g. 'FY2025' or 'TTM' (trailing twelve months)]",
        "net_income": [Latest annual net income as a number, in original currency units],
        "eps": [Latest annual Earnings Per Share, rounded to two decimals. Use diluted if available],
        "margin": [Most recent net margin as decimal (e.g., 0.272 for 27.2%)],
        "growth_yoy": [Latest year-over-year revenue growth rate as decimal (e.g., 0.08 for 8%); if unavailable, use closest period; cite source]
      },
      "valuation": {
        "market_cap": [Latest market capitalization as a number, in original currency units],
        "price": [Latest closing or current share price, rounded to two decimals],
        "as_of": "[Date of market data, in YYYY-MM-DD format]"
      },
      "narrative": {
        "summary": "[100–300 word objective synthesis: overview, recent financial/operating performance, strategic context, and major news—based ONLY on the supportable facts from prior sections]",
        "drivers": ["[Key growth drivers, business levers, or positive trends—specific and sourced]"],
        "risks": ["[Key risks, challenges, or negative factors—specific and sourced]"]
      }
    }
  ]
}

- All financial values must be directly sourced (with relevant period noted), never estimates or projections unless specifically cited.
- Be concise but precise in all sections; never speculate or editorialize.
- All subfields are required unless truly unavailable (in which case, use null and state the reason in the summary).
- Always strictly match the JSON shape and data types shown.
- Repeat this structure for each ticker in the portfolio, returning a JSON array with one object per ticker, in the same order as input.

# Steps

1. Parse the input JSON to extract the "positions" array and each "ticker".
2. For each ticker:
   a. Research recent, authoritative, and directly cited information: company investor relations, major finance/data portals, and reputable news sources.
   b. Systematically assemble facts for "profile", "fundamentals", and "valuation" using cited quantitative data.
   c. Only after completing step b, synthesize a concise "narrative" using exclusively your sourced evidence, naming key "drivers" and "risks" drawn directly from research.
   d. Prepare a "sources" array with all URLs/citations used for each field.
3. Assemble each ticker’s findings into the nested JSON object as per specification above.
4. Return a JSON array of these objects (one per ticker from input), in input order.

# Output Format

- Respond ONLY with a JSON object that has a single top-level "snapshots" array containing one object per ticker in the input “positions” (do not include any other commentary or explanation).
- Each object must match the specified nested format, with clearly identified strings, numbers, and arrays.
- All financial and quantitative values must be numbers (not strings); only "revenue_period", "as_of", and textual fields should be strings.
- Each "sources" array must include all URLs or citations (minimally: company IR, finance data source(s), one or more reputable news/analysis sources).

# Notes

- All fields are required; use null only if the information is truly unavailable and state the reason in the summary.
- The "narrative" section, including "drivers" and "risks", must be supported by specific research and sources included in "sources".
- Never generate content unsupported by your references.
- If data is stated in a non-USD currency, keep original units (do not convert).
- Synthesize evidence-based reasoning step by step before composing "narrative" (never simply rewrite sources).
- Do not introduce or append any extra commentary, markdown, or text—respond only with the JSON array.`;

type WorkflowInput = { input_as_text: string };

export type AgentWorkflowOutput = {
  output_text: string;
  output_parsed: StockSnapshot[];
};

// Main entrypoint for server-side use
export async function runPortfolioStockSnapshotWorkflow(
  workflow: WorkflowInput,
): Promise<AgentWorkflowOutput> {
  const inputText = [
    AGENT_INSTRUCTIONS,
    "",
    "Input portfolio JSON:",
    workflow.input_as_text,
  ].join("\n");

  const response = await openai.responses.parse({
    model: "o4-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: inputText,
          },
        ],
        type: "message",
      },
    ],
    text: {
      format: stockSnapshotFormat,
    },
  });

  const parsed = response.output_parsed ?? { snapshots: [] };
  const snapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : [];

  return {
    output_text: JSON.stringify(snapshots),
    output_parsed: snapshots,
  };
}
