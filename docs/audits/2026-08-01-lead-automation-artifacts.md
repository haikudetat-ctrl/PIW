# Lead automation artifact audit

## Decision summary

The supplied files are useful design inputs, but none of the three n8n JSON files is a production-tested export. They remain inactive reference drafts. The safe schema delta integrates Meta attribution/audit data and speed-to-lead state without introducing a second roof-estimate system.

## Roof lookup

Do not apply `roof-lookup-schema.sql` or import its workflow into production.

PIW already implements the same capability more safely through:

- `lead_consents` rather than one mutable consent boolean;
- `roof_insights` and `roof_estimates` rather than `roof_lookups`;
- `provider_usage_monthly` and atomic `reserve_provider_usage` rather than a read-then-increment counter;
- tenant-scoped keys, RLS, service-only mutation, a 180-day cache, and Inngest retries;
- `roof-estimate-worker`, which records no-coverage calls and prevents quota races.

The draft n8n flow lacks tenant scoping, cache expiry, webhook authentication, atomic quota reservation, and a quota increment on the no-coverage path. Its direct REST writes could diverge from the existing pipeline state. The JSON and notes are retained under `n8n/workflows/reference` only as lineage.

## Speed to lead

The source schema lacked RLS, tenant-aware read policy, delete behavior, channel constraints, a queue index, and service-role grants. The integrated migration adds those protections and computes contact latency with a restricted trigger.

The workflow remains a draft because it contains an unverified CallTools endpoint, assumes `America/Chicago` instead of the configured New York timezone, fans two branches into the same update without a join, has public webhook authentication unresolved, uses NoOp alert nodes, and has no morning drain for after-hours leads. It must not be activated until those items are resolved and a single approved SMS provider is selected.

## Meta CAPI

The integrated schema uses `inet` for client IPs, constrains response/value data, makes event IDs unique for Meta retry deduplication, cascades lead deletion, enables RLS, and permits only service-role writes.

The workflow remains a draft because webhook authentication, payload validation, failure status capture, pre-send persistence, retry semantics, and the Slack failure node are incomplete. The website already captures `fbclid`, `fbp`, and `fbc`; the production intake mapping must persist them to the new lead columns. `META_API_VERSION` must be verified before activation and all secrets must stay in n8n credentials or environment variables.

## Supplied schema fields not adopted

- `contract_value` and `final_invoiced_value` were not added to `leads`. They describe contracts/jobs, not lead identity, and the draft Meta workflow receives them in its event payload. A future sales/production data model should own authoritative monetary values using the repository's integer-cent convention.
- `roof_lookup_id`, `consent_to_contact`, and `quote_range_sent_at` were not added because existing consent, insight, estimate, and delivery tables already model them.
- `roof_lookups`, `api_usage_counters`, and `increment_api_usage_counter` were not created because they conflict with the existing roof and quota model.

## Deployment gate

The linked migration audit currently shows remote-only versions
`20260801175757` and `20260801175758`. Local versions
`20260801162720`, `20260801174503`, and `20260801175520` are not recorded
remotely under those timestamps, and the new `20260801230408` migration is
correctly pending. The two remote-only entries were verified byte-for-byte as
timestamp-renamed copies of the local cost migrations:

- remote `20260801175757` = local `20260801174503` (`5452` bytes, MD5
  `f70f7c665436c414188a6a039031c873`);
- remote `20260801175758` = local `20260801175520` (`968` bytes, MD5
  `169f5fe3e0e7d8be8e06fc6197dac65d`).

`20260801162720_ai_content_cache.sql` is genuinely pending on the linked PIW
project; `ai_content_cache` was not present during the remote schema check.

Before applying the new migration remotely, compare the SQL bodies behind
those history entries, reconcile them with a reviewed migration repair plan,
run a linked `db push --dry-run` against staging, and inspect existing
columns/tables for SQL-editor-created copies. Never repair history or drop
legacy objects without a reviewed schema dump and rollback plan.

Before the history repair, a linked `public` schema snapshot was saved outside
the repository. The repair rollback is to mark local versions
`20260801174503` and `20260801175520` reverted, then restore remote versions
`20260801175757` and `20260801175758` as applied; it changes migration history,
not schema objects.
