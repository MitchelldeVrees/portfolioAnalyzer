export function generateProfessionalPDFHTML(portfolio: any): string {
  const currentDate = new Date().toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const data = portfolio.data || {};
  const benchmarkName = data?.performanceMeta?.benchmark || portfolio.benchmark || "^GSPC";

  const brandName: string = portfolio.branding?.company || "Portify";
  const logoDataUri: string = portfolio.branding?.logoDataUri || "";
  const performanceChartUri = portfolio.charts?.performanceChartUri || "";
  const allocationChartUri = portfolio.charts?.allocationChartUri || "";

  const sectors: Array<{ sector: string; allocation: number; target?: number }> =
    Array.isArray(data?.sectors) ? data.sectors : [];

  const normSectors = sectors.map((s) => {
    const alloc = s.allocation > 1 ? s.allocation : s.allocation * 100;
    const target = typeof s.target === "number" ? (s.target > 1 ? s.target : s.target * 100) : undefined;
    const active = typeof target === "number" ? Number((alloc - target).toFixed(2)) : undefined;
    return { sector: s.sector || "Other", allocation: Number(alloc.toFixed(2)), target, active };
  });
  const hasSectors = normSectors.length > 0;

  const withTargets = normSectors.filter((s) => typeof s.target === "number");
  const topOver = withTargets
    .filter((s) => typeof s.active === "number" && (s.active as number) > 0)
    .sort((a, b) => (b.active! - a.active!))
    .slice(0, 3);
  const topUnder = withTargets
    .filter((s) => typeof s.active === "number" && (s.active as number) < 0)
    .sort((a, b) => (a.active! - b.active!))
    .slice(0, 3);

  const metrics = data?.metrics || {};
  const risk = data?.risk || {};
  const concentrationLevel = risk?.concentration?.level ?? "—";
  const largestPositionPct = risk?.concentration?.largestPositionPct ?? null;
  const diversificationScore = risk?.diversification?.score ?? null;
  const diversificationHoldings = risk?.diversification?.holdings ?? null;
  const diversificationTop2 = risk?.diversification?.top2Pct ?? null;
  const portfolioBetaSpx = typeof metrics.portfolioBetaSpx === "number" ? metrics.portfolioBetaSpx : null;

  const holdings: any[] = Array.isArray(portfolio.portfolio_holdings) ? portfolio.portfolio_holdings : [];
  const sectorByTicker: Record<string, string> = portfolio.sectorByTicker || {};

  const tiltInfo = portfolio.tiltInfo || {};
  const largestPositive = tiltInfo.largestPositive as { sector: string; allocation?: number; target?: number; active?: number } | undefined;
  const largestNegative = tiltInfo.largestNegative as { sector: string; allocation?: number; target?: number; active?: number } | undefined;
  const positiveTiltHolding = tiltInfo.positiveTiltHolding as { ticker: string; weight: number } | null;
  const negativeTiltSuggestions = (tiltInfo.negativeTiltSuggestions as Array<{ symbol: string; marketCap: number }>) || [];

  function escapeHtml(s: string) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
  }

  const esc = (s: any) => escapeHtml(s ?? "");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Portify</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:'Inter',system-ui,-apple-system,Roboto,sans-serif;color:#0f172a}
    @page{size:A4;margin:22mm 16mm}
    .page{page-break-after:always;padding-top:22mm;padding-bottom:20mm}
    .page:last-child{page-break-after:auto}
    h1{font-size:28px;margin:0 0 6px}
    h2{font-size:20px;margin:0 0 12px;color:#1e3a8a}
    h3{font-size:16px;margin:16px 0 8px}
    p{font-size:12px;line-height:1.6;margin:0 0 8px}
    .block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin:10px 0}
    .muted{color:#64748b}.avoid-break{page-break-inside:avoid}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;border-bottom:1px solid #e2e8f0;padding:8px 6px}
    th{background:#f1f5f9;font-weight:600;color:#334155}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    .analysis-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}
    .subgrid{display:grid;grid-template-columns:1fr;gap:12px}
    .kpi{font-size:24px;font-weight:700}.small{font-size:11px;color:#64748b}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .pos{color:#059669}.neg{color:#dc2626}
    .chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:#ecfeff;border-radius:999px;padding:2px 8px;font-size:11px;color:#0e7490}
    .pdf-header,.pdf-footer{
      position:fixed; left:16mm; right:16mm; color:#334155; font-size:11px; z-index:9999;
      background:transparent;
    }
    .pdf-header{top:8mm; display:flex; align-items:center; gap:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px}
    .pdf-footer{bottom:8mm; display:flex; align-items:center; justify-content:space-between; border-top:1px solid #e2e8f0; padding-top:4px}
    .brand-row{display:flex; align-items:center; gap:8px}
    .brand-logo{height:16px; width:auto}
    .brand-name{font-weight:700; letter-spacing:.2px}
    .page-num:after{content: counter(page) " / " counter(pages)}
  </style>
</head>
<body>
  <header class="pdf-header">
    <div class="brand-row">
      ${logoDataUri ? `<img class="brand-logo" src="${logoDataUri}" alt="${esc(brandName)} logo" />` : ""}
      <span class="brand-name">${esc(brandName)}</span>
    </div>
    <div style="margin-left:auto">${esc(currentDate)}</div>
  </header>
  <footer class="pdf-footer">
    <div class="brand-row">
      ${logoDataUri ? `<img class="brand-logo" src="${logoDataUri}" alt="${esc(brandName)} logo" />` : ""}
      <span>Generated by ${esc(brandName)}</span>
    </div>
    <div class="page-num"></div>
  </footer>
  <section class="page">
    <h1>Portfolio Summary Report</h1>
    <p class="muted">Prepared by ${esc(brandName)}</p>
    <div class="block">
      <h2>${esc(portfolio.name || "Portfolio")}</h2>
      <p>Date: <strong>${esc(currentDate)}</strong></p>
      <p>Report Owner: <strong>${esc(portfolio.profile?.full_name || "Portfolio Owner")}</strong></p>
    </div>
    <div class="block">
      <p class="small">
        This report was generated automatically by ${esc(brandName)}. It provides a holdings overview and sector-level analysis.
        For full methodology, see the final page notes or your in-app “Analysis” tab.
      </p>
      ${
        performanceChartUri
          ? `<img src="${performanceChartUri}" alt="Performance Chart" style="width:100%;height:auto;margin-top:8px;" />`
          : ""
      }
    </div>
  </section>
  <section class="page">
    <h2>Portfolio</h2>
    <div class="block avoid-break">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="num">Weight</th>
            <th class="num">Shares</th>
            <th class="num">Purchase Price</th>
            <th>Sector</th>
          </tr>
        </thead>
        <tbody>
          ${
            holdings.map((h) => {
              const w = typeof h.weight === "number" ? (h.weight > 1 ? h.weight : h.weight * 100) : 0;
              const hasShares = h.shares != null && h.shares !== "";
              const hasPx = h.purchase_price != null && h.purchase_price !== "";
              const t = h?.ticker ? String(h.ticker).toUpperCase() : "";
              const sector = sectorByTicker[t] || "—";
              return `
                <tr>
                  <td><strong>${esc(h.ticker)}</strong></td>
                  <td class="num">${w.toFixed(2)}%</td>
                  <td class="num">${hasShares ? esc(h.shares) : "—"}</td>
                  <td class="num">${hasPx ? "€" + Number(h.purchase_price).toFixed(2) : "—"}</td>
                  <td>${esc(sector)}</td>
                </tr>
              `;
            }).join("")
          }
        </tbody>
      </table>
      ${holdings.length === 0 ? `<p class="small muted" style="margin-top:8px;">No holdings found.</p>` : ""}
      <p class="small muted" style="margin-top:8px;">Sector data is sourced from Yahoo Finance where missing.</p>
    </div>
  </section>
  <section class="page">
    <h2>Analysis</h2>
    <div class="analysis-grid">
      <div class="block avoid-break">
        <h3>Sector Allocation</h3>
        ${
          hasSectors
            ? `<img src="${allocationChartUri}" alt="Sector Allocation" style="width:100%;height:auto;max-height:520px;object-fit:contain;margin-top:6px;" />`
            : `<p class="small muted">Insufficient sector data to render a chart.</p>`
        }
      </div>
      <div class="subgrid">
        <div class="block avoid-break">
          <h3>Active Sector Tilts (Top Over/Under)</h3>
          ${
            hasSectors && withTargets.length
              ? (() => {
                  const highest = topOver[0];
                  const lowest = topUnder[0];
                  const rows = [highest, lowest].filter(Boolean) as Array<{sector:string; allocation:number; target?:number; active?:number}>;
                  return rows.length
                    ? `
                      <table>
                        <thead>
                          <tr>
                            <th>Sector</th>
                            <th class="num">Portfolio</th>
                            <th class="num">${esc(benchmarkName)}</th>
                            <th class="num">Active</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${
                            rows.map((s) => {
                              const active = typeof s.active === "number" ? s.active : NaN;
                              const cls = isFinite(active) ? (active >= 0 ? "pos" : "neg") : "";
                              const arrow = isFinite(active) ? (active >= 0 ? "▲" : "▼") : "";
                              const sign = isFinite(active) ? (active >= 0 ? "+" : "") : "";
                              return `
                                <tr>
                                  <td>${esc(s.sector)}</td>
                                  <td class="num">${s.allocation.toFixed(2)}%</td>
                                  <td class="num">${typeof s.target === "number" ? s.target.toFixed(2) + "%" : "—"}</td>
                                  <td class="num ${cls}">${isFinite(active) ? `${arrow} ${sign}${active.toFixed(2)}%` : "—"}</td>
                                </tr>
                              `;
                            }).join("")
                          }
                        </tbody>
                      </table>
                      <p class="small muted" style="margin-top:6px;">Showing only the single highest overweight and single highest underweight sector.</p>
                    `
                    : `<p class="small muted">Provide benchmark sector weights to compute active tilts.</p>`;
                })()
              : `<p class="small muted">Provide benchmark sector weights to compute active tilts.</p>`
          }
        </div>
        <div class="block avoid-break">
          <h3>Risk Snapshot</h3>
          <table>
            <tbody>
              <tr><td>Concentration Risk</td><td class="num">${esc(concentrationLevel)}</td></tr>
              <tr><td>Largest Position</td><td class="num">${largestPositionPct != null ? largestPositionPct + "%" : "—"}</td></tr>
              <tr><td>Diversification Score</td><td class="num">${diversificationScore != null ? diversificationScore + "/10" : "—"}</td></tr>
              <tr><td>Holdings (Count)</td><td class="num">${diversificationHoldings != null ? diversificationHoldings : "—"}</td></tr>
              <tr><td>Top 2 Concentration</td><td class="num">${diversificationTop2 != null ? diversificationTop2 + "%" : "—"}</td></tr>
              <tr><td>Beta (vs S&P 500)</td><td class="num">${portfolioBetaSpx != null ? portfolioBetaSpx.toFixed(2) : "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
  <section class="page">
    <h2>Sector Tilt Recommendations</h2>
    <div class="block">
      <h3>Largest Positive Tilt</h3>
      ${
        largestPositive
          ? `
            <p>
              Your highest overweight sector is <strong>${esc(largestPositive.sector)}</strong>
              at <strong>${(largestPositive.active ?? 0) >= 0 ? "+" : ""}${(largestPositive.active ?? 0).toFixed(2)}%</strong>
              versus ${esc(benchmarkName)}.
            </p>
            ${
              positiveTiltHolding
                ? `<p>
                     Within this sector, your largest position is <strong>${esc(positiveTiltHolding.ticker)}</strong>
                     at <strong>${positiveTiltHolding.weight.toFixed(2)}%</strong> of the portfolio.
                     To more closely track the benchmark, consider trimming this holding or redistributing within the sector.
                   </p>`
                : `<p>
                     Consider trimming your largest holdings in this sector to reduce the overweight.
                   </p>`
            }
          `
          : `<p class="small muted">No positive tilts detected (requires benchmark targets).</p>`
      }
    </div>
    <div class="block">
      <h3>Largest Negative Tilt</h3>
      ${
        largestNegative
          ? `
            <p>
              Your biggest underweight is <strong>${esc(largestNegative.sector)}</strong>
              at <strong>${(largestNegative.active ?? 0).toFixed(2)}%</strong> below ${esc(benchmarkName)}.
            </p>
            ${
              negativeTiltSuggestions.length
                ? `
                  <p>Consider adding exposure to sector leaders to improve alignment:</p>
                  <table>
                    <thead><tr><th>Ticker</th><th class="num">Approx. Market Cap</th></tr></thead>
                    <tbody>
                      ${
                        negativeTiltSuggestions.map(s => `
                          <tr>
                            <td><strong>${esc(s.symbol)}</strong></td>
                            <td class="num">$${(s.marketCap / 1e9).toFixed(1)}B</td>
                          </tr>
                        `).join("")
                      }
                    </tbody>
                  </table>
                  <p class="small muted" style="margin-top:6px;">Leaders retrieved via Yahoo Finance; final selections should consider valuation, liquidity, and your mandate.</p>
                `
                : `<p>
                    Consider adding broad exposure (e.g., a sector ETF) or top-cap constituents in this sector to close the gap.
                  </p>`
            }
          `
          : `<p class="small muted">No negative tilts detected (requires benchmark targets).</p>`
      }
    </div>
    <div class="block">
      <p class="small">
        <strong>Note:</strong> These suggestions are based on sector weights only and are not investment advice.
        Always evaluate fundamentals, valuation, and risk before reallocating capital.
      </p>
    </div>
  </section>
  <section class="page">
    <h2>Performance Attribution (12m)</h2>
    <div class="block avoid-break">
      ${portfolio?.advanced?.attribution?.chartUri
        ? `<img src="${portfolio.advanced.attribution.chartUri}" alt="Attribution Chart" style="width:100%;height:auto;" />`
        : `<p class="small muted">Not enough data to compute attribution.</p>`
      }
    </div>
    <div class="block avoid-break">
      <h3>Top Contributors & Detractors</h3>
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="num">Weight</th>
            <th class="num">Return (12m)</th>
            <th class="num">Contribution (pp)</th>
          </tr>
        </thead>
        <tbody>
          ${
            Array.isArray(portfolio?.advanced?.attribution?.top)
              ? portfolio.advanced.attribution.top.map((row: any) => `
                <tr>
                  <td><strong>${esc(row.ticker)}</strong></td>
                  <td class="num">${row.weight.toFixed(2)}%</td>
                  <td class="num ${row.ret >= 0 ? 'pos' : 'neg'}">${row.ret >= 0 ? '▲' : '▼'} ${row.ret.toFixed(2)}%</td>
                  <td class="num ${row.contrib >= 0 ? 'pos' : 'neg'}">${row.contrib >= 0 ? '+' : ''}${row.contrib.toFixed(2)}</td>
                </tr>
              `).join("")
              : ""
          }
        </tbody>
      </table>
      <p class="small muted" style="margin-top:6px;">
        Contribution approximated as weight × total return over the last 12 months, using adjusted close series.
      </p>
    </div>
  </section>
  <section class="page">
    <h2>Correlation & Risk (Recent ~6 Months)</h2>
    <div class="two">
      <div class="block avoid-break">
        ${portfolio?.advanced?.corr?.chartUri
          ? `<img src="${portfolio.advanced.corr.chartUri}" alt="Correlation Chart" style="width:100%;height:auto;" />`
          : `<p class="small muted">Not enough overlapping data to compute correlations.</p>`
        }
      </div>
      <div class="block avoid-break">
        <h3>Portfolio Risk Snapshot</h3>
        <table>
          <tbody>
            <tr><td>Annualized Volatility</td><td class="num">${typeof portfolio?.advanced?.corr?.annVol === "number" ? (portfolio.advanced.corr.annVol * 100).toFixed(2) + '%' : '—'}</td></tr>
            <tr><td>1-day VaR (95%)</td><td class="num">${typeof portfolio?.advanced?.corr?.var95 === "number" ? portfolio.advanced.corr.var95.toFixed(2) + '%' : '—'}</td></tr>
          </tbody>
        </table>
        <p class="small muted" style="margin-top:6px;">
          VaR is a parametric (normal) approximation based on recent daily volatility. Actual losses can exceed VaR.
        </p>
      </div>
    </div>
  </section>
  <section class="page">
    <h2>Income & Valuation Snapshot</h2>
    <div class="block avoid-break">
      ${portfolio?.advanced?.fundamentals?.chartUri
        ? `<img src="${portfolio.advanced.fundamentals.chartUri}" alt="Dividend Yield Chart" style="width:100%;height:auto;" />`
        : `<p class="small muted">Dividend data unavailable for charting.</p>`
      }
    </div>
    <div class="block avoid-break">
      <div class="two">
        <div>
          <h3>Weighted Portfolio Averages</h3>
          <table>
            <tbody>
              <tr><td>Dividend Yield (weighted)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.dividendYieldPct === "number"
                  ? portfolio.advanced.fundamentals.weighted.dividendYieldPct.toFixed(2) + '%'
                  : '—'
              }</td></tr>
              <tr><td>Trailing P/E (harmonic)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.trailingPE_harmonic === "number"
                  ? portfolio.advanced.fundamentals.weighted.trailingPE_harmonic.toFixed(2)
                  : '—'
              }</td></tr>
              <tr><td>Forward P/E (harmonic)</td><td class="num">${
                typeof portfolio?.advanced?.fundamentals?.weighted?.forwardPE_harmonic === "number"
                  ? portfolio.advanced.fundamentals.weighted.forwardPE_harmonic.toFixed(2)
                  : '—'
              }</td></tr>
            </tbody>
          </table>
          <p class="small muted" style="margin-top:6px;">
            P/E uses a harmonic mean to avoid distortion from very high multiples; dividend yield is weighted by portfolio weights.
          </p>
        </div>
        <div>
          <h3>Key Fundamentals by Holding</h3>
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th class="num">Weight</th>
                <th class="num">Div. Yield</th>
                <th class="num">Trailing P/E</th>
                <th class="num">Forward P/E</th>
              </tr>
            </thead>
            <tbody>
              ${
                Array.isArray(portfolio?.advanced?.fundamentals?.rows)
                  ? portfolio.advanced.fundamentals.rows.map((r: any) => `
                    <tr>
                      <td><strong>${esc(r.ticker)}</strong></td>
                      <td class="num">${(r.weight ?? 0).toFixed(2)}%</td>
                      <td class="num">${typeof r.dividendYieldPct === "number" ? r.dividendYieldPct.toFixed(2) + '%' : '—'}</td>
                      <td class="num">${typeof r.trailingPE === "number" ? r.trailingPE.toFixed(2) : '—'}</td>
                      <td class="num">${typeof r.forwardPE === "number" ? r.forwardPE.toFixed(2) : '—'}</td>
                    </tr>
                  `).join("")
                  : ""
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="block">
      <p class="small">
        <strong>Note:</strong> Fundamentals pulled from Yahoo Finance where available. Always consider the latest filings and your mandate before acting.
      </p>
    </div>
  </section>
</body>
</html>
  `;
}