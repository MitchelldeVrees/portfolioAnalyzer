# 🧭 Weekly Plan — Core Stabilization & Reporting Rollout

## **Day 1 – Stabilize Core Flows & Instrumentation**

**Goals**
- Audit Supabase policies and error handling in the PDF, summary, and research routes.
- Add structured logging and metrics around every external call to pinpoint slow or failing providers.
- Create staging smoke tests (manual or scripted) to exercise:
  - Dashboard load
  - Summary fetch
  - Research fetch
  - PDF download (using representative portfolios)

### **User Stories**

#### **US1 – Portfolio Owner (Tester) PDF Success**
> “As a pilot user, I want the ‘Download PDF’ action to succeed or fail with a clear error so that I can reliably share reports.”

**Acceptance Criteria**
- Successful downloads capture a log entry with timing.  
- Failed downloads raise a toast describing the failure and log the offending upstream call.

#### **US2 – Developer Observability**
> “As an operator, I need metrics around external market-data calls so that I can spot degraded providers before users do.”

**Acceptance Criteria**
- Dashboard surface (Grafana, console, or logs) shows per-provider latency and error counts from the market data module.

---

## **Day 2 – Data Quality & Performance Safeguards**

**Goals**
- Add caching or request coalescing for repeated benchmark, fundamentals, and sector lookups to reduce latency spikes in PDF generation.  
- Implement validation for holdings metadata (weights summing to ~100%, sector coverage) with fallbacks so the PDF tables and tilts never render blank sections.

### **User Stories**

#### **US3 – Analyst Data Trust**
> “As a user comparing my portfolio, I want holdings, sectors, and risk metrics in the export to be accurate so that decisions are data-backed.”

**Acceptance Criteria**
- Reported allocations reconcile with `/api/portfolio/[id]/data`.  
- Missing sectors trigger explanatory copy instead of blank tables.

#### **US4 – Backend Efficiency**
> “As a developer, I want PDF generation to complete under an agreed SLA so that the UI never times out.”

**Acceptance Criteria**
- Load testing with sample portfolios shows the route completing within target (e.g., <5s).  
- Logs capture caching hits.

---

## **Day 3 – Reporting Enhancements & Competitive Review**

**Goals**
- Collect benchmark portfolio reports (custodians, robo-advisors) to compare layouts, KPIs, and narrative tone.  
- Catalogue gaps versus our template (holdings, tilts, attribution, fundamentals).  
- Map summary API outputs (overall score, drivers) into both the dashboard and PDF narrative text.

### **User Stories**

#### **US5 – Executive Summary Accuracy**
> “As a client, I want the in-app and PDF executive summary to reflect my actual scores and drivers so that the message matches the data.”

**Acceptance Criteria**
- Summary cards render the API’s component values and bullet drivers.  
- PDF intro includes the same metrics.

#### **US6 – Competitive Parity**
> “As a product owner, I want our report to cover industry-standard KPIs so that prospects trust the output.”

**Acceptance Criteria**
- Comparison document highlighting competitor KPIs matched/exceeded.  
- Action items prioritized for missing metrics (e.g., performance attribution, risk commentary).

---

## **Day 4 – UX Polish & Communication Readiness**

**Goals**
- Finalize PDF styling (typography, spacing, disclaimers).  
- Ensure consistent branding (logo fallback, date formatting).  
- Draft onboarding email and in-app checklist guiding testers through:
  - Uploading holdings  
  - Reviewing analytics  
  - Generating research  
  - Exporting reports

### **User Stories**

#### **US7 – Branding Consistency**
> “As a tester, I expect the report to look professionally branded so that I can present it to stakeholders.”

**Acceptance Criteria**
- Report displays logo/name when provided and gracefully omits image when missing.  
- Layout remains intact and professional.

#### **US8 – Guided Onboarding**
> “As a first-time user, I want a walkthrough so that I know which steps to complete before sharing feedback.”

**Acceptance Criteria**
- Email or document outlines steps with links and screenshots.  
- QA run-through confirms completeness on staging account.

---

## **Day 5 – Final QA, Regression Suite & Go-Live Prep**

**Goals**
- Run end-to-end regression (`upload → summary → research → PDF`) on staging.  
- Capture artifacts for future automated testing.  
- Hold go/no-go review covering:
  - Metrics  
  - Open bugs  
  - Outstanding competitive analysis items

### **User Stories**

#### **US9 – Regression Confidence**
> “As the team, we need assurance that recent changes didn’t break critical flows so that we can invite the tester confidently.”

**Acceptance Criteria**
- Checklist signed off with evidence (logs/screenshots) for each core flow.  
- Any defects triaged with owner and ETA.

#### **US10 – Launch Readiness**
> “As the product owner, I need a clear go-live decision record so that stakeholder expectations are aligned.”

**Acceptance Criteria**
- Document summarizing status, known limitations, and rollout plan delivered to stakeholders.

---

✅ **End of Week Deliverables**
- Functional smoke tests for all core flows  
- PDF exports with validated data and metrics  
- Observable and measurable market-data performance  
- Finalized design and onboarding flow  
- Signed-off go-live readiness checklist




