# JobNimbus jobs through PIW enrichment and Context Dialer

Date: 2026-10-13
Repository: haikudetat-ctrl/PIW
Status: design approved; ActiveProspect backfill exclusion added at user direction. Implementation and production backfill have not run.

## Agreed outcome

Import JobNimbus jobs with their linked contacts into the PIW lead workflow.
Run full enrichment and make the resulting context available in Context Dialer.
Backfill jobs created in the 30 days before activation, then automatically
process newly created jobs after the existing hourly JobNimbus sync.
Contacts without jobs are excluded. JobNimbus remains the source of job status.

## Evidence from the current repository

- src/inngest/functions/jobnimbus-warehouse-sync.ts syncs contacts, jobs,
  estimates and files hourly, serially, then processes Roofr reports.
- src/modules/jobnimbus/project.ts exposes company-scoped jn_jobs, including
  primary_contact_jnid and jn_created_at, and normalized contact details.
- src/inngest/functions/crm-writer.ts starts validation only for leads with
  estimate_processing consent.
- src/inngest/functions/address-validation-worker.ts validates addresses,
  resolves property identity and duplicates, and publishes discovery events.
- src/inngest/functions/roof-estimate-worker.ts measures via Google Solar,
  reuses property results, calculates Good / Better / Best packages, and queues
  homeowner deliveries and Context Dialer. It currently requires processing,
  email and SMS consent together.
- src/app/(app)/leads/[leadId]/dialer/page.tsx shows imagery, validated property
  details, contact information, source, roof measurements, prices and workflow
  outcomes. The existing Slack sender is an optional downstream handoff.
- The pipeline and customer journey already reconcile PIW leads with
  JobNimbus identities. New imported leads must participate in that linkage.

Full enrichment means the capabilities currently implemented in PIW.
This change does not promise ownership, financial, or other datasets for
which PIW has no provider.

## Approach

Extend the existing warehouse sync with a durable JobNimbus-to-PIW intake
bridge and reuse PIW's enrichment workers. Keep the workflow and outputs in
PIW rather than making PIW depend on the separate 2stack-roof-quote app.
A separate polling service would duplicate sync and retry state; invoking the
old measurement script would only cover measurement and pricing.

The bridge runs after successful contact and job projection for a company.
Queue individual PIW pipeline runs through the transactional event outbox;
do not execute all provider requests inside the warehouse sync. Preserve the
serial JobNimbus API client. An enrichment failure must not fail warehouse
landing or stop other jobs.

## Selection and backfill

At activation, persist an activation timestamp and a fixed start timestamp
equal to activation minus 30 days for each enabled company. Select jobs by
jn_created_at at or after that fixed start, including jobs discovered late.
Use paginated, deterministic scans and durable per-job state. A moving
30-day cutoff must not strand unfinished backfill jobs during an outage.
Record timestamps in UTC and expose the actual interval in the run summary.

Include every job in that creation window regardless of sales status.
Record archived jobs explicitly rather than silently filtering them.
Do not select older jobs merely because they were updated recently.
A missing or invalid creation timestamp is a visible data-quality outcome.

Resolve contact details through the job's primary_contact_jnid within the
same company. Enrich the job's property address, falling back to its linked
contact address only when the job address is absent. Do not combine partial
addresses from different properties. Preserve source identifiers, original
source, job status and sales rep for the dialer context.

A missing linked contact, address or usable phone/email must remain visible.
Available property enrichment should proceed without requiring invented
contact values. Disable unavailable call/email actions. An absent address
creates a review outcome and a Context Dialer record with available details.
Retry records waiting on contact/address data when a later sync supplies it.

## Identity, atomicity and retries

Use an explicit company + JobNimbus job identity as the intake idempotency
key. Add a durable bridge mapping from that identity to PIW lead and pipeline
run, with intake/enrichment state and sanitized error information.

Reuse an existing PIW lead only when an explicit identity or unambiguous
contact AND property match proves the relationship. A shared phone/email
alone must not merge different jobs or properties. Conflicts require review.
Multiple jobs at the same property may reuse measurements while keeping
their job associations.

Create or link the lead, property, run, bridge mapping and pending outbox
event atomically. Retries after a commit or failed event publication must
resume the same run rather than duplicate leads, provider calls or dialer
handoffs. Do not overwrite rep notes, existing consent or completed quotes.
Track pending jobs durably; process bounded batches and retry temporary
failures with the existing Inngest and provider mechanisms.

## Internal enrichment and homeowner delivery

Add an explicit, server-created JobNimbus internal-enrichment mode on the
pipeline run. Workers must verify that the run is linked to a same-company
JobNimbus bridge record and an enabled integration. A client-supplied source
label is insufficient authorization for this mode.

Separate internal processing eligibility from homeowner delivery eligibility.
The JobNimbus bridge must not create or infer web-form consent. Internal
runs may validate the property, measure the roof, produce internal prices
and prepare Context Dialer without granting email/SMS permissions.
Keep existing web intake and its delivery behavior intact. Imported runs
do not queue automatic homeowner outreach as part of this task.

Queue a Context Dialer handoff for terminal success, no coverage, review,
budget exhaustion or terminal failure, including available facts and the
reason enrichment is incomplete. A low-confidence address must not prevent
the lead from being available to the rep. Temporary failures remain retryable.
Deduplicate handoffs per run. Use the existing configured internal handoff;
do not add a new messaging destination.

## Measurement and display

Reuse valid cached PIW measurements and pricing outputs according to existing
cache and pricing rules. Keep Google Solar and Roofr measurement sources
distinct so imported Roofr reports can be displayed and compared without
silently changing the measurement used for a quote.

Context Dialer must identify JobNimbus origin and link to the job. Preserve
JobNimbus status/rep and display unavailable data honestly. The pipeline
board and customer journey must count the linked customer/lead once.
Maintain company-scoped access for the lead, job, imagery and every output.

## Backfill ActiveProspect exclusion

User requirement added after design approval: the 30-day JobNimbus backfill
must not send Context Dialer notifications or lead submissions to ActiveProspect.

Persist intake origin (backfill or ongoing) on the job bridge and pipeline run;
it must survive retries, event replay and later changes to source attribution.
Every backfill run can prepare PIW Context Dialer context and the existing
configured internal handoff, but cannot create ActiveProspect delivery rows or
lead/distribution.requested events targeting either activeprospect_existing
or activeprospect_secondary. Do not relabel imports as Meta70/Meta30 to reuse
the live-lead distribution path.

Enforce exclusion in durable delivery creation and claim/recovery eligibility,
not only the initial dispatcher. A mistakenly queued backfill delivery must
not make an external HTTP submission on retry or recovery. Preserve provenance
per triggering run/delivery: linking a backfill job to an existing PIW lead
must not suppress a legitimate delivery from that lead's original live intake.
The backfill must not modify, replay or cancel that original delivery.

Acceptance evidence requires zero newly generated backfill ActiveProspect
deliveries, zero backfill distribution events and zero ActiveProspect client
calls, covering both destinations, retries, sweeps and attribution changes.
Existing live Meta distribution regression tests must continue to pass.

## Controls and operational evidence

Add a bridge-specific enable switch and per-company activation state.
Keep provider enablement, rate limits and cost budgets in force.
Stopping the bridge stops new intake without deleting warehouse data or
interrupting already queued work. Pausing enrichment must be separately
possible if queued provider work needs to stop.

Expose aggregate counts: eligible jobs, already linked, newly imported,
queued, completed, needs review, retry pending and failed. Report the fixed
backfill interval and remaining backlog. Keep customer details out of logs.

Before production activation, inspect the actual PIW deployment, migrations,
integration settings, provider credentials, budget headroom, Inngest
registration and existing Context Dialer configuration. Repository evidence
does not establish that those resources are deployed or configured.

## Validation and rollout

Tests must cover the exact 30-day boundary; older updated jobs; pagination;
late sync arrivals; no-contact/no-phone/no-email/no-address outcomes;
cross-company isolation; jobs sharing a contact with different properties;
explicit lead reuse and identity conflicts; overlapping syncs; failure
between database commit and event publication; replayed provider events;
review/no-coverage/failure handoffs; budget limits; and no homeowner
delivery or fabricated consent for imported runs.

Run existing intake, address validation, roof estimation, pipeline/journey
and Context Dialer regression checks. Verify database authorization with
tenant-scoped tests, not just application mocks.

Deploy disabled. Produce a read-only count of the fixed 30-day selection.
Exercise a small live batch, verify lead-to-job linkage, complete enrichment,
Context Dialer accessibility, provider accounting and handoff deduplication.
Then enable bounded processing of the full window and ongoing jobs.
Completion evidence must include production backfill counts and at least
one newly synced job completing the pipeline after activation.

## Review checkpoints

The user reviews this design before an implementation plan is written.
Implementation follows review of that plan and selection of execution.
No product code, production settings, messages or backfill records have
been changed by preparation of this document.
