# All Season Canonical Metric Vocabulary

**Status:** Approved design  
**Date:** 2026-08-08  
**System:** PIW / Rake / All Season RevOps  
**Purpose:** Give All Season ownership a trustworthy view of where the sales process succeeds, stalls, or breaks, with team-level visibility and named accountability available by drill-down.

## 1. Scope and design principles

PIW owns the canonical reporting vocabulary. LeadConduit, LeadMaster, JobNimbus, Rake, and other systems retain their raw records and vendor-specific statuses, but PIW maps them into stable definitions used by owner reporting, automation, reconciliation, and accountability workflows.

The design follows these principles:

- Official metrics require confirmed evidence.
- Inferred states may support operational queues but are labeled and excluded from official KPIs.
- Every active lead has one accountable next-action owner.
- Handoffs are explicit, accepted, timestamped, and auditable.
- SLA breaches remain immutable facts; their causes are classified separately.
- Process execution and sales effectiveness are measured separately.
- Owner reporting begins with team and process views; named individual detail is available through drill-down.
- Raw source values, corrections, provenance, and calculation versions remain inspectable.
- Original acquisition source is the primary CAC lens; assisted attribution never duplicates customers, revenue, or cost.

This specification defines the data contract. It does not define public legal language, retention schedules, disaster recovery procedures, incident response, or dashboard visual design. Those are separate designs.

## 2. Selected architecture

Use an **event-backed operational model**, not full event sourcing.

PIW maintains:

1. Canonical entity tables for current business objects.
2. An immutable event ledger for process history and evidence.
3. Raw source records for vendor-specific payloads and statuses.
4. Current-state projections for fast operational views.
5. Versioned metric definitions for reproducible reporting.

This architecture supports live accountability while preserving enough history to explain who owned an action, what changed, why a metric moved, and which source supplied the evidence.

Snapshot-only normalization was rejected because it cannot reliably reconstruct responsibility or stage changes. A warehouse-first design was rejected because it would be too delayed and detached from daily lead handling.

## 3. Canonical entities

| Entity | Definition |
| --- | --- |
| `person` | A homeowner, contact, or authorized decision-maker. |
| `property` | A service address or physical property. |
| `lead` | One uniquely identifiable inquiry or acquisition event. |
| `opportunity` | One service-specific sales pursuit, such as roofing or solar. |
| `appointment` | A scheduled interaction tied to an opportunity. |
| `contract` | An executed commercial agreement. |
| `job` | Production and fulfillment activity following a sale. |
| `touchpoint` | An attributable marketing or sales interaction. |
| `assignment` | Responsibility for the next required action. |
| `cost_entry` | A media or purchased-lead cost fact. |
| `revenue_entry` | A contract, invoicing, or collection fact. |

A person may have multiple properties, leads, opportunities, appointments, contracts, and jobs. A lead may create more than one service-line opportunity. Entity identifiers must remain stable across vendor synchronization and deduplication.

## 4. Event contract

Every meaningful state change is represented by an immutable event with:

- a unique event ID;
- tenant/company ID;
- relevant canonical entity IDs;
- event type and schema version;
- `occurred_at` and `recorded_at` timestamps;
- originating system and source-record ID;
- actor type and actor ID;
- accountable next-action owner when applicable;
- confirmation state;
- supporting evidence reference;
- correlation and idempotency keys;
- original source timestamp;
- structured event payload.

All timestamps are stored in UTC. Staffed-hour SLAs and owner reporting use the configured All Season business timezone.

Corrections are new events. They do not delete or overwrite the original event. Replaying the same source event must not create a duplicate canonical event or entity.

## 5. Confirmation and confidence states

| State | Meaning | Official KPI eligibility |
| --- | --- | --- |
| `confirmed` | Backed by the required authoritative evidence. | Included |
| `provisional` | Supplied by an approved fallback while the authority source is unavailable or stale. | Excluded unless a metric explicitly allows provisional values |
| `inferred` | Derived from behavior or incomplete evidence. | Excluded |
| `disputed` | Authoritative sources conflict. | Excluded pending resolution |
| `unknown` | Evidence is insufficient. | Excluded |

Inferred and provisional records may appear in operational queues if their state is visibly labeled. They may not silently enter confirmed owner KPIs.

## 6. Canonical funnel

All service lines use one canonical backbone. Configurable overlays adjust qualification rules, required actions, staffed hours, attempt cadence, and SLAs by source, service line, territory, and priority.

| Milestone | Canonical definition and minimum evidence |
| --- | --- |
| `lead_received` | PIW received a uniquely identifiable inquiry from a known source. |
| `lead_accepted` | The lead passed required validation, geography, suppression, duplication, and consent checks. |
| `next_action_assigned` | A named owner accepted responsibility for the next required action. |
| `human_first_attempt` | A human-initiated call, SMS, or email attempt was logged. Automated acknowledgment does not count. |
| `contacted` | Two-way communication occurred with the homeowner or an authorized party. |
| `qualified` | Service need, geography, decision-making eligibility, and minimum intent requirements were confirmed. |
| `opportunity_opened` | A specific service-line sales pursuit was created. |
| `appointment_set` | A valid future appointment has a time, type, assigned representative, and contact method or location. |
| `appointment_held` | The homeowner and representative engaged at the scheduled appointment. |
| `demo_completed` | The required inspection, needs assessment, and/or sales presentation was completed. |
| `proposal_presented` | A specific scope and price were delivered to the homeowner. |
| `contract_signed` | An enforceable agreement was executed. |
| `deposit_received` | A required deposit was received. |
| `financing_approved` | Required financing was approved. |
| `job_scheduled` | Production was scheduled. |
| `job_completed` | Production work was completed. |
| `revenue_invoiced` | Revenue was invoiced. |
| `cash_collected` | Customer funds were received. |

`appointment_held`, `demo_completed`, and `proposal_presented` remain separate. This identifies whether a breakdown occurred in scheduling, attendance, presentation execution, or closing.

Exit and pause events require a coded reason and evidence. Initial canonical reasons are:

- rejected;
- duplicate;
- suppressed;
- disqualified;
- unreachable;
- appointment canceled;
- homeowner no-show;
- company or representative no-show;
- lost;
- deferred or nurture;
- withdrawn.

## 7. Accountability model

Every active lead or opportunity has exactly one accountable owner for the next required action. The assignment includes:

- owner ID and role;
- action type;
- assigned and accepted timestamps;
- SLA due time;
- completion or disposition requirement;
- handoff sender and recipient;
- escalation policy;
- current exception state.

Ownership changes only through a recorded handoff. An unaccepted handoff remains the sender's responsibility until accepted or escalated.

### 7.1 Process-execution metrics

- receipt-to-acceptance time;
- acceptance-to-assignment-acceptance time;
- staffed minutes to first human attempt;
- staffed minutes to meaningful contact;
- required attempt-cadence completion;
- handoff acceptance time;
- overdue next actions;
- time stalled in each stage;
- appointments missing a disposition;
- no-shows without timely rebooking follow-up;
- unworked priority callbacks;
- unresolved review tasks.

These measures remain separate from conversion outcomes. A homeowner's failure to answer is not treated as proof that the assigned representative failed to execute the required process.

### 7.2 SLA breaches and exceptions

SLA clocks use configured staffed minutes. A breach is immutable. A manager may classify its cause but may not erase it.

Cause classifications are:

- representative-controllable;
- management or staffing;
- system or vendor;
- customer-caused;
- bad data;
- approved exception.

### 7.3 After-hours handling

After-hours leads follow this path:

1. Send immediate automated acknowledgment.
2. Offer appointment booking.
3. Offer a `speak now` option.
4. Route `speak now` only to representatives explicitly marked on call and available.
5. If nobody accepts within the configured window, return the homeowner to appointment booking and create a priority callback.

Automated acknowledgment never satisfies the human-first-attempt SLA. The event vocabulary includes `automated_acknowledgment_at`, `live_contact_requested_at`, `appointment_offered_at`, `appointment_booked_at`, `human_first_attempt_at`, `human_contact_at`, and `after_hours_unresolved`.

## 8. Field authority and conflict resolution

Each canonical field has a field-specific authority registry entry containing:

- plain-English definition;
- entity, data type, allowed values, unit, and timezone rule;
- inclusion and exclusion criteria;
- authoritative source;
- approved fallback sources;
- required confirmation evidence;
- allowed inference logic;
- freshness expectation;
- conflict behavior;
- correction permissions;
- PII classification;
- metric consumers;
- definition owner and schema version.

Conflict resolution proceeds as follows:

1. Preserve every raw vendor value.
2. Normalize using the designated authority source.
3. Display an approved fallback as provisional when the authority source is unavailable or stale.
4. Create a review task when authoritative evidence conflicts.
5. Require reason, editor, timestamp, and evidence for a manual correction.
6. Preserve both original and corrected history.

The initial system-level authority matrix is:

| Fact family | Initial authority source |
| --- | --- |
| Owned website and quote interactions | Rake source events |
| Third-party intake, source, acceptance, and rejection | LeadConduit source events |
| Sales attempts and dispositions | The system in which the representative performed the action, normalized by PIW; LeadMaster and connected dialer records are expected initial sources |
| Canonical identity, routing, assignment, handoff, SLA, confidence, and derived metrics | PIW |
| Appointments, contracts, jobs, and production outcomes | JobNimbus |
| Media spend | Source-platform billing export |
| Purchased-lead cost | Vendor invoice or vendor billing export |
| Cash collection and direct job costs | The client-designated accounting authority; these metrics remain unavailable until that authority is explicitly selected and mapped |

This matrix establishes system families, not permission to activate an integration. The implementation plan must enumerate the authority source for every field before live activation. If All Season changes an operational system, the registry is versioned from an effective date; historical facts retain the authority rules in effect when they were confirmed.

## 9. Financial vocabulary

### 9.1 Acquisition costs

The official cost scope is **media and purchased leads only**.

| Metric | Definition |
| --- | --- |
| `media_spend` | Platform-billed advertising spend. |
| `purchased_lead_spend` | Vendor charges for acquired leads. |
| `direct_acquisition_spend` | Media spend plus purchased-lead spend. |
| `direct_acquisition_cac` | Direct acquisition spend divided by attributed signed-contract customers. |

PIW also calculates cost per received lead, accepted lead, contact, appointment set, appointment held, signed contract, and collected-revenue customer.

Sales labor, commissions, creative, software, 2Stack fees, and general overhead are excluded from official CAC. The dashboard must call the result **direct acquisition CAC**, never fully loaded CAC.

### 9.2 Revenue milestones

- original contract value;
- approved change orders;
- cancellations and reductions;
- current net contract value;
- invoiced revenue;
- cash collected.

### 9.3 Margin milestones

- estimated gross margin at contract signing;
- forecast gross margin updated as production information changes;
- realized gross margin only after a `job_financially_closed` event confirms that recognized revenue and directly attributable job costs are final in the designated accounting authority.

Before financial close, updated values remain forecast margin. Reopening a financially closed job creates a new event and a new calculation version; it does not rewrite the previously reported close.

Every financial value retains its source, effective timestamp, calculation timestamp, cost scope, and calculation version.

## 10. Attribution vocabulary

Every lead retains:

- original acquisition source;
- lead-creation source;
- appointment-driving touch;
- contract-driving touch;
- assisted touches;
- campaign, ad, creative, vendor, landing-page, and tracking identifiers when available.

Original acquisition source is the primary CAC lens. A customer, cost, or revenue amount is counted once in the primary financial view. Assisted attribution is analytical and never duplicates financial totals.

## 11. Operational projections and owner reporting

PIW derives these projections from the event ledger:

- current lead and opportunity state;
- current accountable owner and SLA;
- appointment and job state;
- financial milestones;
- live accountability and exception queue;
- cohort funnel;
- source economics;
- data-confidence and integration-health views.

### 11.1 Cohort performance

Leads are grouped by received date. Reporting shows stage-to-stage conversion and time between stages using confirmed records. Views may be segmented by source, campaign, service line, territory, and team.

### 11.2 Live accountability

The team overview shows:

1. untouched accepted leads;
2. unaccepted handoffs;
3. missed next-action SLAs;
4. appointments awaiting disposition;
5. no-shows awaiting follow-up;
6. stalled proposals;
7. vendor or synchronization failures;
8. records requiring human review.

Named individual detail appears through drill-down with timestamps, required action, SLA, evidence, and exception classification. The initial design does not create a single opaque representative score or a default named leaderboard.

### 11.3 Source economics

Reporting presents direct acquisition spend, cost at each funnel milestone, direct acquisition CAC, contract value, collected cash, and estimated, forecast, and realized gross margin. Every metric clearly states its cost scope and attribution basis.

### 11.4 Data confidence

Every integration exposes last successful synchronization, expected update interval, newest source timestamp, record lag, mapping gaps, disputed records, excluded KPI records, and current health. Stale data must not appear as current truth.

### 11.5 Metric explainability

Every KPI supports drill-through to:

- exact formula;
- numerator and denominator;
- cohort and time window;
- included and excluded records;
- authority sources;
- freshness;
- calculation version;
- supporting canonical events.

## 12. Error handling

- Duplicate source events are ignored through source-specific idempotency keys.
- Out-of-order events are retained and projections are recalculated according to occurrence time and authority rules.
- Missing required evidence creates an unknown, provisional, or inferred state rather than a fabricated confirmed value.
- Conflicting authority evidence creates a review task.
- Mapping failures are quarantined with the raw record intact.
- Synchronization failures surface in the live exception queue with affected scope, last successful sync, retry state, and owner.
- Metric computation failures preserve the last successful version but mark it stale and unavailable for current-period decisioning.

## 13. Acceptance and testing

The contract is ready for implementation when these tests can be specified without ambiguity:

1. A Golden Lead can be reconstructed from acquisition through cash collection.
2. Replaying vendor events creates no duplicate entities or events.
3. Late-arriving events recalculate the correct cohort without deleting history.
4. Conflicting authority sources create a review task.
5. Inferred and provisional records do not enter confirmed KPIs.
6. After-hours, daylight-saving, on-call, and appointment-fallback SLA calculations are correct.
7. An unaccepted handoff remains attributable and escalates correctly.
8. Funnel totals reconcile to their underlying entities and events.
9. Financial metrics identify cost scope, attribution basis, evidence, and calculation version.
10. Original-source financial totals do not double-count assisted touchpoints.
11. Manual corrections retain the original value and an immutable correction trail.
12. Every owner-facing KPI can drill through to its formula and supporting events.

## 14. Implementation boundaries

The implementation plan must keep these components independently testable:

- canonical entity identifiers;
- event ingestion and idempotency;
- source adapters and raw evidence storage;
- authority and normalization registry;
- assignment, handoff, and SLA engine;
- financial and attribution calculations;
- projection builders;
- review and exception workflow;
- metric registry and explainability API.

No live integration should be activated until its field mappings, authority assignments, confirmation evidence, fallback behavior, and reconciliation tests are approved.
