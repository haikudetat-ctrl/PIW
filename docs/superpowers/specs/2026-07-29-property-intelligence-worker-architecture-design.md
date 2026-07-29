# Property Intelligence Worker Architecture Design

**Status:** Approved design  
**Date:** July 29, 2026  
**Initial market:** New Jersey  
**Initial service:** Residential roofing  
**Deployment:** GitHub and Vercel  
**Users:** Administrators at one roofing company

## 1. Objective

Property Intelligence Worker (PIW) converts a roofing lead submission into an operational property profile that sales, estimating, and operations can use immediately.

The input is:

- Name
- Phone
- Email
- Property address
- Service requested
- Optional notes

The output is a traceable property intelligence report containing:

- Overall and field-level confidence
- Recommended next action
- Estimated roof and job size
- Preliminary revenue range
- Sales risk
- Missing or conflicting information
- Evidence and assumptions supporting every material conclusion

PIW is property-first. Leads may become inactive or be deleted under a retention policy, but nonpersonal property intelligence remains attached to the property and improves over time.

## 2. Scope

### 2.1 Included

- A private, admin-only application for one New Jersey roofing company
- A simple built-in CRM for lead intake and pipeline management
- Residential roofing intelligence
- Address validation and duplicate detection
- Parcel, structure, assessment, permit, GIS, and roof enrichment
- Explainable lead scoring
- Versioned preliminary estimates
- In-app notifications and human review
- Selective re-enrichment
- Hybrid public and paid data sourcing with explicit cost controls
- Auditability, source attribution, and confidence at the field level

### 2.2 Excluded

- Weather, hail, wind, hurricane, storm-probability, and insurance-event intelligence
- Insurance claims data
- Solar or other exterior services
- Commercial roofing automation
- Customer-facing accounts or portals
- Multiple companies or tenants
- A general-purpose CRM
- Binding quotes or contracts
- Autonomous outreach

Commercial properties and other unsupported property types create review tasks rather than continuing through automated estimating. Weather can be added later as an independent worker without changing existing event contracts, but no weather schema, UI, scoring factors, or placeholder integration will be built initially.

## 3. Architectural Approach

PIW is a modular monolith with durable event-driven workers.

- **Next.js on Vercel** hosts the admin application, intake flow, internal API, report pages, and Inngest HTTP handler.
- **Supabase** provides managed PostgreSQL, PostGIS, authentication, file storage, and real-time database updates.
- **Inngest** provides durable event execution, step-level retries, concurrency control, schedules, and pipeline observability.
- **External providers** are accessed through capability-based adapters rather than directly from domain workers.
- **One GitHub repository** contains the application, worker modules, shared contracts, database migrations, tests, and operational documentation.

The architecture preserves service boundaries without imposing the operational burden of ten independently deployed services. A worker can be extracted later if its compute, release, or scaling requirements justify it.

Vercel request handlers do not coordinate the full enrichment pipeline synchronously. They validate requests, write durable state, publish events, and return. Long-running work executes as checkpointed Inngest steps.

## 4. System Flow

The primary flow is:

`Lead submitted → address validated → property resolved → records and GIS enriched in parallel → roof analyzed → lead scored → estimate generated → CRM/report finalized → notification or review`

Pipeline states are:

1. `received`
2. `validating`
3. `enriching`
4. `analyzing`
5. `scoring`
6. `estimating`
7. `complete`

Terminal or exceptional states are:

- `partial`: useful results exist, but one or more noncritical enrichments failed or are unavailable
- `review_required`: a human decision is required before dependent automation can continue
- `failed`: no useful report can be produced after retries

Address and parcel identity are critical gates. Public-record gaps, unavailable optional GIS layers, or provider outages can produce a partial report when identity and minimum estimating inputs remain sound.

Every event includes:

- Immutable event ID
- Correlation ID
- Lead ID when applicable
- Property ID when resolved
- Pipeline run ID
- Event and schema version
- Causation event ID
- Timestamp
- Idempotency key

## 5. Worker Contracts

Each worker:

1. Consumes a versioned domain event.
2. Loads only its required records.
3. Calls capabilities through provider adapters.
4. Validates and normalizes responses.
5. Writes immutable observations and a worker-run record.
6. Updates current projections transactionally.
7. Publishes a completion, partial, failure, or review event.

Workers never call downstream workers directly.

### 5.1 Address Validation Worker

**Purpose:** Confirm that the lead refers to a real, serviceable property.

**Responsibilities:**

- Normalize the submitted address
- Geocode it
- Reverse-verify locality, municipality, county, and state
- Detect duplicate leads
- Match an existing property or customer record
- Produce parcel search candidates

**Outputs:**

- Canonical address
- Latitude and longitude
- Municipality and county
- Property match
- Parcel candidates
- Confidence and evidence

An address confidence below 95, material forward/reverse geocode disagreement, or multiple unresolved property matches creates a review task.

### 5.2 Property Discovery Worker

**Purpose:** Resolve the durable property, parcel, and physical structure.

**Responsibilities:**

- Match NJ block, lot, qualifier, and PAMS PIN
- Load parcel geometry and assessment attributes
- Identify relevant building footprints
- Determine residential property class
- Record lot size, year built, stories, and available assessed values

Statewide NJGIN parcel/MOD-IV data is the baseline. County or municipal data may supersede it when newer and compatible. Parcel geometry is analytical and must not be presented as a legal survey.

Multiple plausible parcels, condominium ambiguity, missing primary structures, or nonresidential classification creates a review task.

### 5.3 Public Records Worker

**Purpose:** Establish legally available property and roofing history.

**Responsibilities:**

- Discover roofing and relevant building permits
- Record solar, pool, addition, or renovation permits only when they affect roofing scope
- Capture assessment history and property transfers
- Estimate likely roof age from dated evidence
- Record municipality-specific availability and freshness

Permit access varies by municipality. Absence of a discoverable permit is represented as “not found in available sources,” never as proof that no work occurred.

### 5.4 GIS Worker

**Purpose:** Produce spatial intelligence relevant to roofing scope and logistics.

**Responsibilities:**

- Store parcel and structure geometry in PostGIS
- Calculate building footprint and relevant dimensions
- Retrieve current-enough imagery and elevation/LiDAR where available
- Estimate slope and terrain
- Estimate tree coverage
- Identify flood exposure
- Assess driveway, staging, dumpster, and crew access constraints
- Determine municipality and historic-district intersections
- Identify nearby completed company projects when company data is available

“GeoLibre” is treated as a replaceable GIS capability, not a required vendor. Each layer records its source, vintage, resolution, and spatial accuracy.

### 5.5 Roof Analysis Worker

**Purpose:** Generate a preliminary, evidence-based roofing scope.

**Responsibilities:**

- Estimate roof surface area and squares
- Identify or estimate roof planes, valleys, dormers, hips, and gables
- Estimate pitch and complexity
- Apply a versioned waste factor
- Infer likely material only when evidence supports it
- Estimate tear-off, disposal, dumpster, and crew-day requirements

Every output is labeled as:

- `measured`: directly supplied by an accepted measurement source
- `calculated`: derived from stored geometry and a versioned formula
- `assumed`: based on a documented company default

The worker never presents preliminary geometry as an inspection-grade measurement.

### 5.6 Lead Scoring Worker

**Purpose:** Explain the commercial opportunity and recommended response.

**Responsibilities:**

- Calculate a versioned deterministic sales score
- Estimate close probability
- Estimate expected revenue
- Identify urgency and sales risk
- Recommend the next action and sales strategy
- List positive and negative scoring factors
- Identify missing information that could materially change the result

Potential factors include:

- Likely roof age and permit history
- Estimated roof size and job value
- Property class and assessed-value band
- Residential-service fit
- Roof and access complexity
- Completeness of contact information
- Lead source and engagement
- Nearby completed projects and company history

Weather and storm indicators are not scoring factors.

An optional language model may summarize stored facts and deterministic scoring factors. It cannot create evidence, alter the numeric score, or make unsupported claims.

### 5.7 Quote Worker

**Purpose:** Produce a preliminary sales estimate, not a final quote.

**Responsibilities:**

- Apply versioned company price books
- Calculate low, expected, and high ranges
- Estimate labor, materials, waste, tear-off, and disposal
- Apply pitch, access, height, and complexity adjustments
- Recommend a package and optional upgrades
- Widen the range when critical inputs are uncertain

The calculation is conceptually:

`roof squares × material rate + labor + tear-off + disposal + complexity + accessories + options`

Every estimate records its pricing version, input observations, assumptions, confidence, and overrides. It displays “Preliminary sales estimate—not a final quote.”

### 5.8 CRM Writer

**Purpose:** Project intelligence into the built-in operational workflow.

**Responsibilities:**

- Update lead stage and status
- Append timeline activities
- Create tags and tasks
- Link the lead to the property and current report
- Update searchable current projections
- Avoid copying canonical property evidence into lead fields

### 5.9 Notification Worker

**Purpose:** Surface actionable events to administrators.

**Responsibilities:**

- Create in-app notifications
- Highlight high-value or urgent leads
- Notify on review tasks, stuck pipelines, and exhausted failures
- Apply deduplication and notification policies

Email or Slack may be added later through adapters. No external channel is required initially.

### 5.10 Human Escalation Worker

**Purpose:** Convert uncertainty or conflict into a resolvable admin task.

**Triggers:**

- Address confidence below 95
- Address mismatch
- Competing parcel candidates
- Condominium or multi-structure ambiguity
- Incomplete critical GIS
- Material measurement conflicts
- Commercial property
- Historic-district intersection
- Unsupported property type
- Required evidence below policy thresholds

The review UI shows candidates, maps, evidence, source dates, and the downstream consequences of each decision. Resolving a task publishes a versioned resolution event and resumes only the affected pipeline steps.

## 6. Property-First Data Model

### 6.1 Operational Entities

- `admin_profiles`
- `leads`
- `lead_stage_history`
- `properties`
- `property_addresses`
- `parcels`
- `structures`
- `roofs`
- `permits`
- `gis_layers`
- `estimates`
- `interactions`
- `tasks`
- `notifications`
- `review_tasks`
- `insights`

### 6.2 Evidence and Orchestration Entities

- `observations`
- `evidence_artifacts`
- `source_records`
- `provider_requests`
- `provider_cost_entries`
- `worker_runs`
- `pipeline_runs`
- `domain_events`
- `dead_letter_events`
- `audit_log`

### 6.3 Observation Model

An enrichment never silently overwrites a fact. It creates an observation containing:

- Entity type and entity ID
- Field or fact type
- Normalized value and units
- Raw value or response reference
- Source provider
- Source URL or stable record identifier
- Retrieved date
- Effective date or source vintage
- Confidence from 0 through 100
- Method: measured, calculated, assumed, or reported
- Transformation and model version
- Supporting evidence artifact IDs
- Estimated and actual provider cost
- Current, superseded, disputed, or rejected status

Current property screens use projections that select the best applicable observation according to explicit precedence rules. The evidence history remains immutable.

### 6.4 Identity and Lifecycle

A normalized address may have multiple submissions, but one resolved physical property. Duplicate detection considers normalized address, parcel identity, contact information, and time window.

Lead PII and nonpersonal property intelligence are separated. Deleting or anonymizing a lead under a retention policy does not delete lawful, nonpersonal parcel, structure, permit, or derived property records.

## 7. Confidence Model

Confidence and sales score are separate concepts.

Observation confidence is based on:

- Source authority
- Source freshness
- Agreement with independent sources
- Spatial precision
- Measurement method
- Completeness and validation quality

The initial overall report weighting is:

- Identity and address: 25%
- Parcel and structure: 20%
- Roof geometry and size: 30%
- Roof age and condition indicators: 15%
- Estimate completeness: 10%

These weights are versioned settings. Critical gates override the weighted average. An unresolved property identity cannot become “high confidence” because other categories score well.

The report shows:

- Overall confidence
- Category confidence
- Field-level confidence
- Confidence rationale
- Missing evidence
- Material conflicts

## 8. Scoring and Estimating Governance

The authoritative lead score is deterministic and versioned. Rules and weights are administrator-configurable within guarded ranges and take effect as a new scoring version.

The scoring output includes:

- Close probability
- Expected revenue
- Urgency
- Sales risk
- Recommended next action
- Recommended sales strategy
- Positive factors
- Negative factors
- Missing material information

Price books contain:

- Material packages
- Per-square material and labor rates
- Tear-off rates
- Disposal and dumpster rates
- Pitch, story, access, and complexity adjustments
- Accessories and upgrades
- Margin policy
- Effective dates and version status

Administrators may override inputs or pricing. Every override records the administrator, timestamp, reason, original value, replacement value, and resulting estimate version.

## 9. New Jersey Data Strategy

### 9.1 Tier 0: Cached Evidence

PIW first reuses observations that satisfy evidence-specific freshness policies. Address and parcel identity have longer freshness windows than permits or imagery. Cache lookup is mandatory before any paid request.

### 9.2 Tier 1: Free Authoritative Data

Initial candidates include:

- NJGIN statewide parcels and MOD-IV assessment attributes
- NJGIN imagery, elevation/LiDAR, administrative, land-use, and related GIS layers
- FEMA flood data
- USGS elevation and geospatial data
- Municipal and county permit or record sources where lawful and technically stable
- Company-owned completed-project and customer history

NJGIN ownership redactions under Daniel’s Law are honored. PIW does not infer or reconstruct protected names. Public records are used according to their licensing and stated limitations.

### 9.3 Tier 2: Low-Cost Transactional APIs

A commercial address or geocoding provider may run when public validation is inconclusive. Calls are cached, deduplicated, rate-limited, and written to the cost ledger.

### 9.4 Tier 3: Premium Intelligence

Commercial aerial measurement, imagery, permit aggregation, or property-data providers run only when:

- A required fact remains unresolved
- The expected confidence gain exceeds a configured threshold
- Expected lead value justifies the request
- The provider remains within monthly and per-lead budgets
- An administrator explicitly requests an upgrade

Providers implement capabilities such as:

- `address.validate`
- `parcel.lookup`
- `permits.search`
- `imagery.retrieve`
- `elevation.retrieve`
- `roof.measurement`

Workers depend on capability contracts, not vendor names.

### 9.5 Cost Controls

- Monthly and provider-specific budgets
- Per-lead spending caps
- Cache-first access
- Request deduplication
- Concurrency and rate limits
- Circuit breakers
- Usage alerts
- Provider fallback policies
- Dry-run mode that shows expected charges
- Preview environments that cannot call paid production providers by default

The report and pipeline run show enrichment cost beside confidence and projected value.

## 10. Built-In CRM

### 10.1 Dashboard

Shows new leads, high-value opportunities, review queue, pipeline totals, stuck or failed enrichments, and provider spend.

### 10.2 Lead Intake

Collects the approved input fields and provides immediate address and duplicate feedback. Submission creates the lead, starts a pipeline, and returns a trackable status.

### 10.3 Pipeline

Provides board and table views with these initial stages:

- New
- Contacting
- Appointment Set
- Estimating
- Proposal Sent
- Won
- Lost
- Nurture

Pipeline stage is a commercial workflow and is separate from enrichment pipeline state.

### 10.4 Lead Workspace

Shows contact details, stage, linked property, tasks, notes, interactions, report state, and activity history.

### 10.5 Property Profile

Shows the current parcel, structure, roof, GIS, permits, imagery, prior leads, estimates, observations, and evidence history.

### 10.6 Intelligence Report

Shows:

- Recommended next action
- Estimated job size and roof squares
- Low, expected, and high revenue
- Sales risk and opportunity factors
- Overall and category confidence
- Missing and conflicting information
- Facts, calculations, assumptions, and sources

Confirmed facts show source and retrieval date. Calculations show their formula or model version. Assumptions are labeled. Reports can be printed or exported to PDF.

### 10.7 Estimate Builder

Shows generated inputs, pricing, packages, upgrades, assumptions, confidence, range, and audited overrides.

### 10.8 Review Queue

Shows unresolved candidates and evidence side by side, including maps and downstream effects. An administrator can resolve, reject, retry, or mark a case unsupported.

### 10.9 Settings

Manages pricing, packages, scoring versions, confidence thresholds, freshness policies, provider budgets, notification rules, and admin invitations.

## 11. Reliability and Failure Handling

Worker idempotency keys are derived from property, worker type, source, source version, and pipeline version. Database uniqueness constraints enforce them.

- Transient failures retry with exponential backoff and jitter.
- Rate limits pause the affected provider without blocking unrelated workers.
- Schema or validation errors do not retry indefinitely.
- Noncritical exhausted failures produce a partial report.
- Critical identity failures create review tasks and stop dependent workers.
- Exhausted events enter a dead-letter state with an audited manual replay action.
- Circuit breakers stop repeated provider failures and spending.
- Reprocessing targets a worker or evidence capability rather than always rerunning the entire pipeline.

Worker output and event publication use a transactional outbox pattern. This prevents a committed observation from being separated from its completion event.

## 12. Security, Privacy, and Compliance

- Authentication is invitation-only through Supabase Auth.
- All application tables enable row-level security.
- Anonymous access to operational data is denied.
- Service-role credentials are restricted to trusted server and worker code.
- Provider keys are stored only in deployment secrets.
- Lead PII is encrypted in transit and protected by least privilege.
- Sensitive values are redacted from logs, traces, and provider error payloads.
- Audit logs record logins, exports, overrides, reviews, stage changes, settings changes, and manual replays.
- Retention and deletion procedures distinguish lead PII from nonpersonal property data.
- Provider access must comply with terms, licensing, robots restrictions, rate limits, and applicable New Jersey and federal law.
- Daniel’s Law redactions are respected.

The initial system is an operational estimating aid, not a legal survey, inspection, appraisal, insurance determination, or binding quote. Those limitations are visible wherever relevant outputs appear.

## 13. Re-Enrichment

Scheduled re-enrichment uses evidence-specific freshness policies.

Eligible checks include:

- Newly available permits
- Changed assessment data
- Ownership or transfer data when lawfully available
- Updated parcel or structure information
- Updated public imagery or elevation layers
- New nearby completed company projects

Expensive imagery and roof measurements are not repeated automatically. Re-enrichment compares source vintage and checks budgets before retrieval. A material change creates a new observation, updates the current projection, records an audit event, and may rescore active leads.

## 14. Observability and Operations

Every request, event, worker run, and provider call uses the same correlation ID.

Operational views show:

- Pipeline and worker duration
- Success, partial, review, and failure rates
- Retry and dead-letter counts
- Provider latency and error rate
- Confidence contribution by source
- Spend by provider, capability, and lead
- Cache hit rate
- Stuck pipeline runs

Alerts cover stuck runs, abnormal provider failure rates, budget thresholds, dead letters, and review backlog.

GitHub Actions runs formatting, linting, types, unit tests, contract tests, integration tests, migration checks, and application builds before production deployment. Vercel preview deployments use isolated configuration and paid-provider access is disabled by default.

Supabase backup and recovery procedures are documented. Recovery exercises verify both database restoration and access to evidence artifacts in storage.

## 15. Testing Strategy

### 15.1 Unit Tests

- Address and identifier normalization
- Confidence calculations
- Scoring rules
- Estimate calculations
- Provider response mapping
- Freshness and cost policies
- Idempotency-key generation

### 15.2 Contract Tests

Sanitized, recorded provider responses verify adapter contracts and detect upstream schema changes without incurring live request costs.

### 15.3 Integration Tests

- PostgreSQL and PostGIS behavior
- Transactional outbox behavior
- Worker idempotency
- Retry and dead-letter transitions
- Partial completion
- Human escalation and resumption
- Duplicate lead-to-property resolution
- Row-level security

### 15.4 End-to-End Tests

- Lead intake through completed report
- Pipeline movement
- Incremental report updates
- Estimate override audit
- Review resolution
- PDF export
- Provider budget exhaustion

### 15.5 Required New Jersey Fixtures

- Standard single-family parcel
- Multiple parcel candidates
- Condominium or multi-unit property
- Missing permit coverage
- Stale or conflicting roof evidence
- Commercial or historic property requiring review
- Repeated submissions for the same property
- Partial provider outage
- Exhausted per-lead budget

CI uses deterministic provider fakes. Live staging smoke tests require an explicit flag and use a capped budget.

## 16. Delivery Phases

### Phase 1: Foundation

Repository, deployment skeleton, authentication, database, PostGIS, evidence model, event contracts, provider framework, worker-run tracking, and audit logging.

### Phase 2: CRM

Lead intake, dashboard, pipeline, lead workspace, property profile shell, tasks, interactions, and in-app notifications.

### Phase 3: Property Identity

Address validation, duplicate matching, NJ parcel discovery, maps, property resolution, and human review.

### Phase 4: Property Intelligence

Public records, GIS, roof analysis, confidence calculation, evidence history, and partial-report behavior.

### Phase 5: Commercial Intelligence

Lead scoring, pricing configuration, estimate ranges, intelligence report, PDF export, and actionable notifications.

### Phase 6: Operations

Selective re-enrichment, provider budgets, observability, dead-letter replay, security hardening, backup verification, and production readiness.

Each phase ends with a deployable vertical slice and explicit acceptance tests. The architecture defines all ten workers now; implementation follows these phases to keep each release coherent and usable.

## 17. Architecture Acceptance Criteria

The architecture is successfully implemented when:

1. An admin can submit a New Jersey residential roofing lead and immediately track enrichment progress.
2. Duplicate submissions resolve to the same property without losing separate lead histories.
3. PIW produces a complete or explicitly partial report with job size, estimate range, confidence, risk, next action, and missing information.
4. Every material report value traces to source evidence, a calculation version, or a labeled assumption.
5. Low-confidence identity and material conflicts create resolvable review tasks.
6. Retrying any worker does not create duplicate state or duplicate notifications.
7. Public data is preferred, paid requests respect configured budgets, and provider cost is visible.
8. Scoring and estimates are deterministic, versioned, explainable, and auditable.
9. Weather and storm intelligence do not affect schema, workflows, reports, scores, or estimates.
10. The application deploys through GitHub to Vercel and passes its automated test and migration gates.

## 18. Reference Sources

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Vercel cron usage and limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Inngest durable functions](https://www.inngest.com/docs/learn/inngest-functions)
- [Inngest deployment on Vercel and other runtimes](https://www.inngest.com/docs/platform/deployment)
- [Supabase database and PostGIS overview](https://supabase.com/docs/guides/database/overview)
- [Supabase data security](https://supabase.com/docs/guides/database/secure-data)
- [NJGIN parcels and MOD-IV](https://www.nj.gov/njgin/edata/parcels/)

