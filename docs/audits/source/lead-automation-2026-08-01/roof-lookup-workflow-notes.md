# Roof Lookup Workflow — Import Notes

`roof-lookup-workflow.json` is a hand-built n8n skeleton, not a tested export. Node types and `typeVersion` numbers are correct as of recent n8n releases, but check them against your instance's editor after import — n8n will flag any mismatch and let you swap the node version in place. Treat this as a fast starting point to wire up, not a finished workflow.

## What it assumes

The webhook (`roof-quote-lead`) is called as a sub-step of your existing Lead Support intake, after the lead record already exists and consent has been captured — not as the primary intake itself. That means the payload should include `lead_id` alongside the address fields and `consent_to_contact`. In practice this is one more node (Execute Workflow, or an HTTP call) added to whatever flow currently creates the lead, right after the form-submit webhook fires.

## Credentials / env vars to set in n8n

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side key — never the anon key, since this writes to tables), `GOOGLE_MAPS_API_KEY` (needs Geocoding API and Solar API both enabled on the same key/project).

## Node-by-node

Webhook receives `{ lead_id, address_line1, city, state, zip, consent_to_contact }`. Has Consent? gates the whole lookup — false routes into your standard flow with no roof data, matching what we discussed. Normalize Address builds the cache key (lowercased, joined address string — swap for a `place_id` from Places Autocomplete if you end up adding that on the form, it's a cleaner key than a string). Check Roof Lookup Cache / Cache Hit? is the dedupe check against `roof_lookups` — a hit skips straight to pricing and never touches Google. Get Monthly Quota Counter / Under Quota? reads `api_usage_counters` and stops new API calls at 9,500 (adjust the threshold in the "Under Quota?" node), leaving headroom under the 10k free tier before your GCP quota cap would even trigger. Geocode Address turns the address into lat/lng, since `buildingInsights:findClosest` takes coordinates, not a string. Call Google Solar API is the actual lookup; `neverError: true` is set so a 404 (no coverage) flows through the IF branch instead of throwing. Roof Data Found? splits into the success path (parse segments, upsert, increment the counter, price it) and the no-coverage path (log the miss, no counter increment since no call quota was consumed... actually it was consumed — see note below). Compute Quote Range holds the placeholder pricing formula — replace `pricePerSquareLow`/`High` and the complexity multiplier with your real numbers. Update Lead Record writes the range back onto the lead. The two "Send..." nodes are NoOps by design — swap them for whatever your GHL/Twilio/email step already looks like; this workflow only decides *what* should be sent, not how.

**One thing to double check in the Parse Segments node**: it assumes Google's per-segment area is already slope-corrected. Pull one real response for an address you know and compare `roofSegmentStats[].stats.areaMeters2` against a rough footprint measurement — if it's flat footprint instead, uncomment the pitch-correction math already sketched in the code comment.

**One thing to fix before this goes live**: the no-coverage branch (`Mark No Coverage`) doesn't currently call the quota-increment step, but a `findClosest` call that returns "no data" still counts against your Google quota. Add an `Increment Quota Counter` call on that branch too (copy the node, point it after `Upsert Lookup (no_coverage)`) so your internal counter stays accurate.

## Files in this set

`roof-lookup-schema.sql` — run this in the Supabase SQL editor first; the workflow depends on `roof_lookups`, `api_usage_counters`, and the `increment_api_usage_counter` RPC existing before it can write anything. `roof-lookup-workflow.json` — import via n8n's "Import from File" in the workflow list.
