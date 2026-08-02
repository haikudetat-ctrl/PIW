# Plan

Integrate the audited lead-automation capabilities without creating a parallel roof-estimate system. Promote the database delta first, then adapt and test each inactive n8n draft in staging before any production activation.

## Scope

- In: Meta attribution and CAPI audit records, speed-to-lead tracking, inactive workflow references, migration reconciliation, staging tests, and controlled production promotion.
- Out: replacing the existing Inngest roof worker, activating unverified CallTools/Twilio traffic, storing contract accounting on leads, or deploying any workflow directly from this branch.

## Action items

[ ] Reconcile hosted Supabase migration history with `supabase/migrations` and capture a schema dump before applying the new delta.
[ ] Dry-run and apply `20260801230408_lead_automation_audit_delta.sql` to staging, then run `supabase/tests/lead-automation-audit-delta.test.sql` and database advisors.
[ ] Update the website-to-intake mapping so `fbclid`, `fbp`, `fbc`, client IP, and user agent reach the corresponding lead columns without exposing the service role.
[ ] Replace the speed-to-lead draft's public webhook assumptions with an authenticated internal trigger, select one SMS provider, verify the CallTools API, switch to `America/New_York`, join parallel branches, and add the morning after-hours queue drain.
[ ] Replace Meta CAPI draft NoOps with real alerting, validate signed event payloads, persist attempts before sending, record actual HTTP status, and test Meta deduplication with `META_TEST_EVENT_CODE`.
[ ] Keep `roof-lookup-workflow.json` as reference only and verify the existing Inngest roof worker continues to own cache, quota, pricing, and delivery state.
[ ] Run `npm run verify`, import only the adapted speed-to-lead and Meta workflows into staging, and retain test lead IDs, n8n execution IDs, Slack timestamps, and Meta Events Manager evidence.
[ ] Promote reviewed workflow exports through a PR, deploy database changes before workflows, monitor errors/duplicates for one business day, and retain a rollback export.

## Open questions

- Which system is the approved outbound SMS owner: Twilio, CallTools, or GoHighLevel?
- What authenticated system emits authoritative contract-signed and job-completed events?
- Who can reconcile the hosted Supabase migration history before the staging dry run?
