// app/api/research/route.ts
import { type NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { fetchCuratedNewsForTickers, allowedDomains as preferredDomains } from "@/lib/news-curation";
//testing
export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/** ========= Types ========= */

type ISODate = string; // YYYY-MM-DD

type ResearchJSON = {
  performance: {
    asOf: ISODate;
    portfolioReturnPctYTD?: number;
    portfolioReturnPct1M?: number;
    benchmarkComparisons: Array<{
      name: string; // e.g., "S&P 500", "XLK (Tech)"
      period: "1M" | "3M" | "YTD";
      benchmarkReturnPct: number;
      relativeToBenchmarkPct: number; // portfolio minus benchmark for the period
      comment: string;
    }>;
    drivers: string[]; // brief bullets on what drove performance (macro or sector-level)
    caveats: string[]; // known gaps/assumptions
  };
  allocation: {
    bySector: Array<{ sector: string; weightPct: number }>;
    concentrationRisks: string[]; // e.g., "Over 40% in Tech"
    futureProofingAssessment: {
      summary: string; // argue why allocation is / isn't future-proof
      tailwinds: string[]; // secular trends helping the mix
      headwinds: string[]; // structural risks
    };
  };
  contributions: {
    lookbackDays: 7 | 14;
    stocks: Array<{
      ticker: string;
      contributionEstimate?: "positive" | "neutral" | "negative"; // optional label from news
      newsSupport: Array<{
        title: string;
        source: string;
        date: ISODate; // MUST be within lookback window
        url: string;
        impact: "low" | "medium" | "high";
        sentiment: "positive" | "neutral" | "negative";
        thesis: string; // how this news plausibly affects the stock/portfolio
      }>;
      note: string; // MUST base judgments solely on the above news; no unstated assumptions
    }>;
  };
  summary: {
    keyPoints: string[]; // 3–6 bullets summarizing the entire portfolio
    actions: string[]; // concise, actionable next steps
    risksToMonitor: string[]; // concrete watch items
  };
  sources: Array<{ title: string; source: string; date: ISODate; url: string }>;
};

/** ========= Helpers ========= */

function isoDateOnly(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

function withinLookback(dateStr: string, days: 7 | 14): boolean {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return new Date(dateStr) >= new Date(isoDateOnly(cutoff));
}

/** ========= Route ========= */

export async function POST(request: NextRequest) {
  try {
    const { tickers, portfolioData, newsLookbackDays } = await request.json();
    const lookback: 7 | 14 = newsLookbackDays === 7 ? 7 : 14; // default 14

    const todayISO = isoDateOnly(new Date());
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - lookback);
    const cutoffISO = isoDateOnly(cutoff);

    // Allowed domains for higher quality financial news sources
    const allowedDomains = [
      "finance.yahoo.com",
      "yahoo.com",
      "reuters.com",
      "bloomberg.com",
      "wsj.com",
      "ft.com",
      "cnbc.com",
      "marketwatch.com",
      "barrons.com",
      "investors.com",
      "fool.com",
      "seekingalpha.com",
      "sec.gov",
    ];

    function hostnameFromUrl(u: string): string | null {
      try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
    }

    // curatedUrlSetByTicker will be built after curated links are fetched

    function isAllowed(url: string, _source?: string): boolean {
      const host = hostnameFromUrl(url);
      if (!host) return false;
      return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
    }

    function normalizeUrl(raw: string): string | null {
      if (typeof raw !== "string") return null;
      let s = raw.trim();
      if (!s) return null;
      if (s.startsWith("//")) s = "https:" + s;
      if (!/^https?:\/\//i.test(s)) s = "https://" + s;
      try {
        const u = new URL(s);
        const STRIP = [
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_term",
          "utm_content",
          "utm_id",
          "gclid",
          "yclid",
          "fbclid",
          "CMP",
        ];
        STRIP.forEach((p) => u.searchParams.delete(p));
        return u.toString();
      } catch {
        return null;
      }
    }

    // ——— Authoritative instructions for the model ———
    const instructions = `
You are a professional financial analyst creating research reports.

CRITICAL NEWS WINDOW:
- ONLY cite news published between ${cutoffISO} and ${todayISO} (inclusive).
- If you cannot find a qualifying article for a ticker, say "No qualifying news in the last ${lookback} days."
- NEVER include news older than ${lookback} days.

SOURCING & CLAIMS:
- Any opinion about an individual security inside the "contributions" section MUST be supported by at least one article in the specified window.
- Include source (title, publisher, ISO date YYYY-MM-DD, URL) for every claim about companies or macro events.
- Keep dates in ISO (YYYY-MM-DD). If uncertain, say so briefly.
 - Every URL MUST be a full, valid HTTPS URL to the original article (e.g., https://domain/path). Do NOT output relative links or placeholders.

SCOPE & TONE:
- Be precise, concise, and factual. Avoid boilerplate.
- Explain to a sophisticated investor, not a layperson.
- You MUST generate text that further explains and justifies why a certain news item is likely to impact the stock/portfolio (the "thesis" field).
- Where you infer impact to the portfolio, make the chain-of-reasoning explicit in one sentence (the "thesis" field), but do not add hidden assumptions.

OUTPUT:
- MUST return valid JSON that conforms to the provided JSON schema.
- Do not include any text outside of the JSON.
`;

    const userPrompt = `
Portfolio tickers: ${Array.isArray(tickers) ? tickers.join(", ") : String(tickers)}

Portfolio metrics (raw input from system):
${JSON.stringify(portfolioData?.metrics ?? {}, null, 2)}

Deliver the following FOUR components:

1) Portfolio performance:
   - As-of date = "${todayISO}".
   - Compare portfolio performance to 1–2 relevant benchmarks per major sector exposure (e.g., S&P 500, sector ETFs like XLK, XLF) across 1M / 3M / YTD where possible.
   - Explain key drivers and disclose any caveats about data availability or proxies used.

2) Asset allocations:
   - Break down weights by sector (sum ≈ 100%).
   - Call out concentration risks.
   - Assess whether this mix is future-proof: list tailwinds / headwinds grounded in secular themes.

3) Individual security contributions (NEWS-ONLY):
   - For EACH ticker, search the web and list only articles dated between ${cutoffISO} and ${todayISO}.
   - For each article: title, publisher, ISO date, URL, impact (low/medium/high), sentiment (positive/neutral/negative), and a one-sentence thesis explaining likely effect on the stock (and by extension the portfolio).
   - Base any contribution label ("positive/neutral/negative") ONLY on the cited news in this window.

4) Summary:
   - 3–6 key bullets about the overall portfolio.
   - Concrete next actions and risks to monitor.

Return JSON conforming to the schema.`;

    // ——— JSON Schema enforcing the 4 components (strict mode compatible) ———
    const schema: Record<string, any> = {
      type: "object",
      additionalProperties: false,
      properties: {
        performance: {
          type: "object",
          additionalProperties: false,
          properties: {
            asOf: { type: "string" },
            portfolioReturnPctYTD: { type: ["number", "null"] },
            portfolioReturnPct1M: { type: ["number", "null"] },
            benchmarkComparisons: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  period: { enum: ["1M", "3M", "YTD"] },
                  benchmarkReturnPct: { type: ["number", "null"] },
                  relativeToBenchmarkPct: { type: ["number", "null"] },
                  comment: { type: "string" },
                },
                // strict:true requires all keys listed here:
                required: ["name", "period", "benchmarkReturnPct", "relativeToBenchmarkPct", "comment"],
              },
            },
            drivers: { type: "array", items: { type: "string" } },
            caveats: { type: "array", items: { type: "string" } },
          },
          // strict:true requires ALL keys in properties to be listed:
          required: ["asOf", "portfolioReturnPctYTD", "portfolioReturnPct1M", "benchmarkComparisons", "drivers", "caveats"],
        },

        allocation: {
          type: "object",
          additionalProperties: false,
          properties: {
            bySector: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  sector: { type: "string" },
                  weightPct: { type: ["number", "null"] },
                },
                required: ["sector", "weightPct"],
              },
            },
            concentrationRisks: { type: "array", items: { type: "string" } },
            futureProofingAssessment: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                tailwinds: { type: "array", items: { type: "string" } },
                headwinds: { type: "array", items: { type: "string" } },
              },
              required: ["summary", "tailwinds", "headwinds"],
            },
          },
          required: ["bySector", "concentrationRisks", "futureProofingAssessment"],
        },

        contributions: {
          type: "object",
          additionalProperties: false,
          properties: {
            lookbackDays: { enum: [7, 14] },
            stocks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ticker: { type: "string" },
                  contributionEstimate: { enum: ["positive", "neutral", "negative", null] },
              newsSupport: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    source: { type: "string" },
                    date: { type: "string" },
                    url: { type: "string", pattern: "^https?://" },
                    impact: { enum: ["low", "medium", "high"] },
                    sentiment: { enum: ["positive", "neutral", "negative"] },
                    thesis: { type: "string" },
                  },
                  required: ["title", "source", "date", "url", "impact", "sentiment", "thesis"],
                },
                minItems: 1,
              },
                  note: { type: "string" },
                },
                required: ["ticker", "contributionEstimate", "newsSupport", "note"],
              },
            },
          },
          required: ["lookbackDays", "stocks"],
        },

        summary: {
          type: "object",
          additionalProperties: false,
          properties: {
            keyPoints: { type: "array", items: { type: "string" } },
            actions: { type: "array", items: { type: "string" } },
            risksToMonitor: { type: "array", items: { type: "string" } },
          },
          required: ["keyPoints", "actions", "risksToMonitor"],
        },

    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          source: { type: "string" },
          date: { type: "string" },
          url: { type: "string", pattern: "^https?://" },
        },
        required: ["title", "source", "date", "url"],
      },
      minItems: 3,
    },
      },
      required: ["performance", "allocation", "contributions", "summary", "sources"],
    };


    // Build curated context to encourage concrete sourcing
    const tickerList: string[] = Array.isArray(tickers)
      ? tickers
      : String(tickers)
        .split(/[\,\s]+/)
        .filter(Boolean);
    const curated = await fetchCuratedNewsForTickers(tickerList, lookback);
    const curatedContext = tickerList
      .map((t) => {
        const items = (curated[t] || []).slice(0, 4);
        if (items.length === 0) return `- ${t}: No curated articles found within ${lookback} days.`;
        const lines = items
          .map((n) => `• ${t} | ${n.title} — ${n.source} — ${n.date} — ${n.url}`)
          .join("\n");
        return lines;
      })
      .join("\n");
    const instructionsExtra = `\nPREFERRED DOMAINS: ${allowedDomains.join(", ")}\nCURATED SOURCES (last ${lookback} days):\n${curatedContext}\n`;

    const ai = await openai.responses.create({
      model: "gpt-4o-mini", // model supporting structured output via text.format
      instructions: instructions + instructionsExtra,
      input: userPrompt,
      tools: [{ type: "web_search_preview" }],
      tool_choice: "auto",
      temperature: 0.1,
      max_output_tokens: 3200,
      text: {
        format: {
          type: "json_schema",
          name: "PortfolioResearchV2",
          schema,
          strict: true,
        },
      },
    });

    const text = ai.output_text; // SDK helper

    function tryParseStrict(s: string) {
      return JSON.parse(s) as ResearchJSON
    }
    function stripCodeFences(s: string) {
      return s.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    }
    function extractFirstJsonObject(s: string) {
      const first = s.indexOf("{")
      const last = s.lastIndexOf("}")
      if (first >= 0 && last > first) return s.slice(first, last + 1)
      return s
    }
    function removeTrailingCommas(s: string) {
      return s.replace(/,(\s*[}\]])/g, "$1")
    }

    let raw: ResearchJSON
    try {
      raw = tryParseStrict(text)
    } catch {
      // attempt lightweight repairs for occasional formatting artifacts
      let repaired = stripCodeFences(text)
      repaired = extractFirstJsonObject(repaired)
      repaired = removeTrailingCommas(repaired)
      raw = tryParseStrict(repaired)
    }
    
    // Build curated URL sets (normalized) for strict mapping post-parse
    const curatedUrlSetByTicker: Record<string, Set<string>> = {};
    for (const t of Object.keys(curated || {})) {
      const set = new Set<string>();
      for (const a of curated[t] || []) {
        const u = normalizeUrl(a.url);
        if (u) set.add(u);
      }
      curatedUrlSetByTicker[t] = set;
    }
    // —— Server-side belt & suspenders: filter any news that slipped past the window ——
    let cleaned: ResearchJSON = {
      ...raw,
      contributions: {
        ...raw.contributions,
        lookbackDays: lookback,
        stocks: (raw.contributions?.stocks ?? []).map((s) => {
          const normalizedNews = (s.newsSupport ?? [])
            .map((n) => {
              const url = normalizeUrl(n.url)
              if (!url) return null
              if (!isAllowed(url, n.source)) return null
              return { ...n, url }
            })
            .filter((n): n is NonNullable<typeof n> => !!n)
            .filter((n) => withinLookback(n.date, lookback))
            .filter((n) => {
              const set = curatedUrlSetByTicker[s.ticker];
              // If curated links are available for this ticker, keep only those
              return set && set.size > 0 ? set.has(n.url) : true;
            })
          return { ...s, newsSupport: normalizedNews }
        }),
      },
      sources: (raw.sources ?? [])
        .map((src) => {
          const url = normalizeUrl(src.url)
          if (!url) return null
          if (!isAllowed(url, src.source)) return null
          return { ...src, url }
        })
        .filter((s): s is NonNullable<typeof s> => !!s)
        .filter((src) => withinLookback(src.date, lookback)),
    };

    // Fallback: if any ticker has zero allowed sources after filtering, backfill from curated list
    cleaned = {
      ...cleaned,
      contributions: {
        ...cleaned.contributions,
        stocks: (cleaned.contributions?.stocks ?? []).map((s) => {
          if ((s.newsSupport ?? []).length > 0) return s;
          const curatedForTicker = (curated[s.ticker] || []).slice(0, 2);
          if (curatedForTicker.length === 0) return s;
          const fallback = curatedForTicker.map((n) => ({
            title: n.title,
            source: n.source,
            date: n.date,
            url: normalizeUrl(n.url) || n.url,
            impact: "medium" as const,
            sentiment: "neutral" as const,
            thesis: "Curated source; see linked article for details.",
          }));
          return { ...s, newsSupport: fallback };
        }),
      },
    };

    // Rebuild top-level sources from the actually used per-ticker news items (ensures only curated, deduped)
    {
      const agg: { title: string; source: string; date: string; url: string }[] = []
      const seen = new Set<string>()
      for (const s of cleaned.contributions.stocks || []) {
        for (const n of s.newsSupport || []) {
          const key = n.url
          if (!key || seen.has(key)) continue
          seen.add(key)
          agg.push({ title: n.title, source: n.source, date: n.date, url: n.url })
        }
      }
      if (agg.length > 0) {
        cleaned.sources = agg.slice(0, 12)
      } else {
        // Fallback to curated if still empty
        const fallback: { title: string; source: string; date: string; url: string }[] = []
        for (const t of Object.keys(curated)) {
          for (const n of curated[t]) {
            const url = normalizeUrl(n.url)
            if (!url) continue
            if (!isAllowed(url, n.source)) continue
            if (!withinLookback(n.date, lookback)) continue
            if (fallback.some((x) => x.url === url)) continue
            fallback.push({ title: n.title, source: n.source, date: n.date, url })
          }
        }
        cleaned.sources = fallback.slice(0, 6)
      }
    }

    // Construct richer recommendations with explanations and evidence
    const bySector = Array.isArray(cleaned?.allocation?.bySector) ? cleaned.allocation.bySector : [];
    const sortedSectors = [...bySector].sort((a, b) => (b?.weightPct || 0) - (a?.weightPct || 0));
    const topSector = sortedSectors[0]?.sector || undefined;
    const topWeight = sortedSectors[0]?.weightPct || undefined;
    const risks = Array.isArray(cleaned?.summary?.risksToMonitor) ? cleaned.summary.risksToMonitor : [];
    const drivers = Array.isArray(cleaned?.performance?.drivers) ? cleaned.performance.drivers : [];
    const src = (cleaned.sources || []).slice(0, 6);
    const sourceTitles = src.map((s) => s.title);
    const sourceLinks = src.map((s) => ({ title: s.title, url: s.url }));

    const rec1 = {
      type: "rebalance",
      priority: "high",
      title: topSector ? `Reduce concentration in ${topSector}` : "Reduce concentration in top sector",
      description: topSector
        ? `The portfolio shows a relatively high tilt toward ${topSector} (${Number(topWeight || 0).toFixed(1)}%).`
        : "The portfolio shows a relatively high tilt toward a single sector.",
      rationale: "Rebalance toward targets to reduce idiosyncratic sector risk while preserving core exposures.",
      whyItMatters:
        "Elevated sector concentration increases drawdown sensitivity to sector-specific shocks (regulatory, cyclical, or single-factor risk).",
      consequences:
        "Without rebalancing, negative sector catalysts can disproportionately impact portfolio returns and volatility.",
      evidence: sourceTitles.slice(0, 2).map((t) => `Recent coverage: ${t}`),
      sources: sourceTitles.slice(0, 3),
      sourceLinks: sourceLinks.slice(0, 3),
      confidence: 0.88,
    };

    const rec2 = {
      type: "opportunity",
      priority: "medium",
      title: "Add diversifiers and quality defensives",
      description:
        "Introduce uncorrelated or lower-beta assets (e.g., quality factor, healthcare staples, or cash equivalents) to stabilize returns.",
      rationale: "Diversification lowers portfolio variance and mitigates tail risk across regimes.",
      whyItMatters:
        "Correlated drawdowns compound losses across positions; diversifiers dampen shock transmission across the portfolio.",
      consequences:
        "Improves risk-adjusted returns; may modestly cap upside in strong risk-on periods but reduces downside in stress scenarios.",
      evidence: sourceTitles.slice(2, 4).map((t) => `Macro/sector signal: ${t}`),
      sources: sourceTitles.slice(2, 5),
      sourceLinks: sourceLinks.slice(2, 5),
      confidence: 0.8,
    };

    const macroHook = drivers.find((d) => /rates?|inflation|growth|earnings/i.test(d || "")) || risks[0];
    const rec3 = {
      type: "risk",
      priority: "high",
      title: macroHook ? `Hedge ${macroHook.toLowerCase()}` : "Define risk controls for macro shocks",
      description:
        "Implement stop-loss or alerting on high-beta names; consider partial hedges (index puts/overlays) during event risk windows.",
      rationale:
        "Systematic risk spikes during macro events; proactive controls contain tail exposure without wholesale de-risking.",
      whyItMatters:
        "Macro volatility can overwhelm single-name fundamentals; hedges preserve capital and optionality.",
      consequences:
        "Reduces left-tail outcomes; small carry cost may reduce returns if the hedge isn’t triggered.",
      evidence: sourceTitles.slice(4, 6).map((t) => `Event risk context: ${t}`),
      sources: sourceTitles.slice(4, 6),
      sourceLinks: sourceLinks.slice(4, 6),
      confidence: 0.82,
    };

    const recommendations = [rec1, rec2, rec3];

    return NextResponse.json({
      insights: cleaned, // keep top-level key "insights" if your frontend expects it; otherwise rename
      recommendations,
      meta: { cutoffISO, todayISO, lookbackDays: lookback },
    });
  } catch (error) {
    console.error("Error generating research:", error);
    return NextResponse.json({ error: "Failed to generate research" }, { status: 500 });
  }
}
