# Speed-to-Lead & Meta CAPI — Import Notes

Both `speed-to-lead-workflow.json` and `meta-capi-workflow.json` are hand-built n8n skeletons, same caveat as the roof-lookup workflow: check node `typeVersion` numbers against your instance after import, and treat the HTTP Request bodies as a correct starting shape rather than a tested integration. Run the matching `.sql` file in the Supabase SQL editor before importing either workflow — both depend on columns/tables that don't exist yet.

## Speed to Lead

**Trigger it in parallel, not in sequence.** The whole point is that this fires before qualification/enrichment finishes, so wire the webhook directly off raw lead insert — a Supabase Database Webhook on `INSERT` to `leads`, or wherever LeadConduit posts new leads — not as a downstream step after your existing enrichment workflow. They should run side by side.

**Two things to confirm before this goes live.** First, the SMS/call channel: the workflow uses Twilio as the concrete example since it's already in your stack, but if CallTools or GoHighLevel is what actually sends SMS, swap the `Send Immediate SMS` node's endpoint/auth for that instead — don't run two SMS systems in parallel. Second, the `Queue Priority Call` node's URL and body are placeholders — CallTools does have a documented REST API (developers.calltools.com, API-key-in-header auth), but I didn't have the exact queue/call endpoint verified, so pull that from their docs before wiring it up.

**Business hours logic is naive on purpose** — it's a plain hour/weekday check in the `Check Business Hours` node, timezone hardcoded to `America/Chicago`. Update that to your real timezone and hours (currently Mon–Sat, 8am–7pm).

**One inefficiency worth knowing about**: `Update Lead - Attempted` is fed by both the SMS-logged and call-logged branches, so it fires twice per lead (harmless since it's just re-setting the same fields, but wasteful). Add a Merge node set to "wait for all inputs" between the two branches and `Update Lead - Attempted` if you want it clean.

**Not built here, worth flagging**: leads that come in after hours get queued (`speed_to_lead_status = 'queued_after_hours'`) but nothing currently picks them up. You'll want a small scheduled workflow (Cron trigger, ~8:01am) that pulls everyone in that status and queues them as priority dials for the morning.

## Meta Conversions API Feedback Loop

**Env vars to set**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_PIXEL_ID` (or dataset ID), `META_CAPI_ACCESS_TOKEN`, `META_API_VERSION` (e.g. `v23.0` — check developers.facebook.com/docs/graph-api/changelog for the current version rather than trusting a hardcoded one, Meta increments this a couple times a year), and optionally `META_TEST_EVENT_CODE` for testing sends in Events Manager before going live.

**Requires the built-in `crypto` module in Code nodes.** The `Hash PII & Assemble Meta CAPI Payload` node uses `require('crypto')` for the SHA-256 hashing Meta requires on email/phone. Depending on your n8n version/config this may need `NODE_FUNCTION_ALLOW_BUILTIN=crypto` set on the instance — if the Code node throws a "module not allowed" error, that's the fix.

**Two lead sources, two attribution paths.** Leads from native Meta Lead Ads forms carry Meta's own `lead_id` and don't strictly need `fbclid`/`fbp`/`fbc` for attribution — Meta already knows those came from their platform. Leads from your website (landing pages with the Pixel installed) need `fbclid`, `fbp`, and `fbc` captured at form-fill time and written onto the lead record, or this workflow has nothing to match the eventual Purchase event back to the original ad. That capture step isn't part of this workflow — it has to happen on the website/landing-page side, writing those three fields onto the lead at creation.

**Purchase is the event that matters most.** It's what teaches Meta's delivery algorithm which lead patterns turn into real revenue. `JobCompleted` is there for later value-based optimization (once you're comfortable with Purchase alone) but isn't essential to ship first — if you want the smaller version, cut the `Job Completed` webhook and the `Normalize JobCompleted Event` node and just ship the contract-signed path.

**Deduplication**: `event_id` is built as `{lead_id}-{event_name}`, which is stable and prevents the same event firing twice for the same lead (e.g. a workflow retry). If you also fire a client-side Pixel "Purchase" event anywhere, make sure `event_id` matches between the two so Meta dedupes them into one instead of double counting.

## Files in this set

`speed-to-lead-schema.sql`, `speed-to-lead-workflow.json`, `meta-capi-schema.sql`, `meta-capi-workflow.json` — run the two `.sql` files first, then import the two `.json` files via n8n's "Import from File."
