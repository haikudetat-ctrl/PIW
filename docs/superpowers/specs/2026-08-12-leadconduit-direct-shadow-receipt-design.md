# LeadConduit Direct Shadow Receipt Design

**Date:** 2026-08-12  
**Status:** Approved in flow review; written for implementation planning  
**Product boundary:** ActiveProspect LeadConduit → PIW  
**Supersedes:** The API discovery, polling, and final-recipient architecture in `2026-08-11-activeprospect-access-route-design.md`. The tenant, authentication, provenance, and disabled-by-default foundations already implemented on the branch remain reusable.

## Objective

Add the smallest possible PIW observation point to the existing `Roofing` and `Roofing Virtual Quote` LeadConduit flows without requiring ActiveProspect account API access and without changing any LeadConduit flow during endpoint development.

The first release observes only the known post-CoreLogic property filters. It identifies a narrow allowlist of potentially over-filtered leads for later human review. It never changes LeadConduit, rescues a lead automatically, creates a PIW working lead, contacts a homeowner, or writes to LeadMaster, JobNimbus, or another client system.

## Observed flow configuration

The design is based on the read-only flow review completed on 2026-08-12.

### Roofing Virtual Quote

- Flow ID: `68d597a7e5a45ce2a9c822fe`
- CoreLogic is step 15.
- Step 16 rejects non-exempt leads when either CoreLogic Building Comments or Site Land Use includes `APARTMENT`.
- The intended PIW recipient position is after step 15 and before step 16.

### Roofing

- Flow ID: `6377949a81800d03d54119b5`
- CoreLogic is step 25.
- Step 26 stops a non-exempt lead when the CoreLogic outcome is not `Success`. This remains a fail-closed system/data gate.
- Step 27 rejects non-exempt leads when either CoreLogic Building Comments or Site Land Use includes `APARTMENT`.
- Step 28 is labeled `No Condos` in the flow card, but its actual rule rejects the exact CoreLogic reason `Incomplete address. Multiple property results returned.`
- Step 29 rejects non-exempt leads when CoreLogic Site Land Use includes `Vacant`.
- The intended PIW recipient position is after step 26 and before step 27.

The exact source exemptions observed for these post-CoreLogic business rules are:

- `RoofingCalculator`
- `Webrunner Media Group`
- `Angies Leads`
- `Angi`
- `Facebook Lead Ads`
- `1MDE`

The pasted flow exports show that LeadConduit serializes two of those UI labels as internal source IDs in rule text: `66294ffc805cf61e9575ee40` resolves to Webrunner Media Group and `65a84540388af4b003c1b8de` resolves to Angi. PIW therefore compares exact, trimmed source IDs and names against both representations; it does not depend on the UI label alone.

PIW mirrors these exemptions only to avoid creating false review candidates. LeadConduit remains authoritative and its rules remain unchanged.

## Approaches considered

### 1. ActiveProspect account API discovery and polling

This provides historical reconciliation and rejected-event visibility, but account API access is not currently available and the implementation is substantially larger than the baseline. This path is paused and must remain undeployed.

### 2. Before-and-after recipients around every filter

This proves the exact filter that stopped each lead, but it adds many production flow steps and broadens the operational surface. It is unnecessary while the selected rule conditions are explicit and reproducible.

### 3. One direct shadow recipient per flow — selected

Each flow sends one bounded JSON POST from the approved post-CoreLogic checkpoint to a flow-bound PIW endpoint. PIW evaluates the observed rules without influencing LeadConduit. This requires no ActiveProspect account API credential, adds the least flow complexity, and proves whether the selected business filters contain recoverable opportunities.

## Endpoint architecture

PIW exposes two public paths backed by one implementation:

- `POST /api/integrations/leadconduit/roofing`
- `POST /api/integrations/leadconduit/roofing-virtual-quote`

The path selects a compile-time flow slug. Server configuration then binds that slug to one company, one exact flow ID, one active/next bearer token set, and one disabled-by-default receiver flag. Request data never selects a company or authorizes a flow.

The existing generic `/api/integrations/[vendor]` route remains unavailable to LeadConduit.

### Request contract

The custom JSON recipient maps this versioned logical payload:

```json
{
  "schema_version": 1,
  "lead_id": "<LeadConduit lead ID>",
  "flow_id": "<hardcoded expected flow ID>",
  "checkpoint": "after_corelogic",
  "source": {
    "id": "<LeadConduit source ID when exposed>",
    "name": "<LeadConduit source name when exposed>"
  },
  "submitted_at": "<ISO timestamp>",
  "is_test": false,
  "lead": {
    "name": "<submitted name>",
    "phone": "<submitted phone>",
    "email": "<submitted email>",
    "submitted_address": "<submitted address>",
    "trustedform_url": "<existing TrustedForm URL when present>"
  },
  "corelogic": {
    "outcome": "<CoreLogic outcome when the step ran>",
    "reason": "<CoreLogic reason>",
    "building_comments": "<CoreLogic Building Comments>",
    "site_land_use": "<CoreLogic Site Land Use>"
  }
}
```

The endpoint accepts omitted optional contact/enrichment strings and CoreLogic outputs as null, because incomplete or conditionally skipped enrichment must not turn a shadow observer into a source-system failure. It requires schema version, LeadConduit lead ID, exact configured flow ID, checkpoint, submission timestamp, test marker, and at least one of source ID or source name. A missing or non-success CoreLogic outcome is a valid non-candidate observation.

The maximum request body is 64 KiB. Only `application/json` is accepted.

### Observed flow-field IDs and mapping boundary

The Roofing field inventory supplied during planning confirms these client-defined IDs among the available flow fields: `address_1`, `address_2`, `city`, `email`, `first_name`, `last_name`, `guid_allss`, `lead_id_allss`, `lead_source_allss`, `campaign_source`, `comments`, and `original_source`. These observations help prepare the future Custom JSON mapping, but they do not authorize a flow edit and they do not change PIW's logical request contract.

Two labels are deliberately not inferred from the client-defined IDs:

- `lead_id` means LeadConduit's stable system lead identifier. Do not map `lead_id_allss` unless a synthetic Test Flow proves that it is stable, present, and unique for recipient retries.
- `source.id` and `source.name` mean LeadConduit's built-in Source identity used by the existing filter exemptions. Do not substitute `lead_source_allss` or `campaign_source` without the same synthetic proof. Phase C should map both built-in values when the recipient editor exposes both.

CoreLogic outcome/reason/building-comments/site-land-use are step outputs, not base flow fields. Submission time and test status may also be LeadConduit metadata rather than client-defined fields. Phase C must verify each mapping in the recipient editor with synthetic data before either receiver can be enabled. Unknown or unavailable mappings stop activation; Phase A may still implement and locally verify the logical endpoint contract.

The Virtual Quote screenshot confirms that its Fields screen is also a larger catalog: visible entries can be switched off and show zero flow usage. A catalog entry is therefore not evidence that a value is populated for a flow. Phase C validates Roofing and Roofing Virtual Quote independently, checking field Status/Flow usage and the synthetic recipient preview for each; a mapping proven in Roofing is never inherited by Virtual Quote.

### Authentication and isolation

- Each flow has a distinct server-managed bearer token.
- Tokens are compared in constant time and may rotate through the existing active/next-token overlap.
- A token for one flow cannot authenticate the other path.
- The submitted flow ID and checkpoint must exactly match the trusted path binding, but authorization comes only from path, server configuration, and token.
- Tokens, authorization headers, request bodies, and customer values never appear in logs, errors, status panels, or audit metadata.
- The receiver is disabled by default independently for each flow.

## Classification policy

Classification is deterministic and deny-by-default. Comparisons trim whitespace. Source exemptions use exact case-sensitive equality after trimming, CoreLogic success and the two `includes` rules are case-insensitive, and the multiple-property reason uses exact case-sensitive equality after trimming.

An exempt source produces no candidate. Exact exemption keys include the six UI names plus internal IDs `66294ffc805cf61e9575ee40` and `65a84540388af4b003c1b8de`; a match on either submitted source field is sufficient. A missing CoreLogic outcome or an outcome other than case-insensitive `Success` produces no candidate. For eligible inputs, PIW may assign one or more of:

1. `apartment_classification`
   - Building Comments includes `APARTMENT`, or
   - Site Land Use includes `APARTMENT`.
2. `multiple_property_match` (Roofing only)
   - CoreLogic reason exactly equals `Incomplete address. Multiple property results returned.`
3. `vacant_property_classification` (Roofing only)
   - Site Land Use includes `Vacant`.

Roofing Virtual Quote can produce only `apartment_classification`; its exported flow has no post-CoreLogic multiple-property or vacant filter.

Unknown values, unknown rules, consent/suppression/TCPA/fraud categories, and enrichment failures never become candidates.

The endpoint is an observer. Its classifier does not claim that LeadConduit actually rejected the lead, because the first release has no after-filter reconciliation signal. The PIW UI must label these records `likely filter match`, not `rejected`, until a later reconciliation source proves the disposition.

## Persistence and privacy

Reuse the existing tenant-scoped `leadconduit_events` foundation and service-only batch upsert. Derive `event_id` as `shadow:<SHA-256 hex of trusted flow ID, LeadConduit lead ID, and checkpoint separated by NUL bytes>` so arbitrary identifier characters cannot collide and recipient retries merge into one observation. Store `event_type="shadow_checkpoint"`, `occurred_at=submitted_at`, and ingestion channel `webhook`.

- Every valid delivery creates one durable event row. This lets PIW acknowledge only after persistence and measure endpoint health without relying on logs.
- Candidate observations retain the normalized name/contact/address fields required for authenticated human review. Their normalized snapshot contains only schema version, checkpoint, CoreLogic outcome/reason/building-comments/site-land-use, and the ordered candidate-category list; it contains no authorization or arbitrary submitted keys.
- If more than one rule matches, `reason_category` is the first category in the documented policy order and `attribution.shadow_categories` contains the complete ordered list.
- Non-candidate event rows retain the trusted company/flow identity, derived event ID, LeadConduit lead ID, source ID/name, submitted/received timestamps, test marker, and a snapshot limited to schema version, checkpoint, and an empty candidate-category list. Their name, phone, email, address, TrustedForm URL, CoreLogic values, and arbitrary raw payload are stored as null/empty values.
- Authenticated users can read only their company rows through existing RLS.
- Browser-visible lists show category, source name, timestamps, and non-sensitive identifiers only. Customer values belong only in authenticated detail views.
- No PIW `leads`, properties, pipelines, consent records, tasks, deliveries, rescue decisions, or outbox events are created by this endpoint.

## Response and failure behavior

- Valid candidate or non-candidate: HTTP 200 with `{ "outcome": "success" }`.
- Duplicate retry: HTTP 200 with the same non-sensitive result.
- Invalid authentication or trusted-binding mismatch: HTTP 401 with a generic response.
- Invalid JSON/schema/content type: HTTP 400 with category and invalid field names only.
- Oversized body: HTTP 413 without parsing or echoing the payload.
- Receiver disabled or persistence unavailable: HTTP 503 with a sanitized retry category.

PIW never proxies a source response and never returns customer values. When LeadConduit is eventually configured, the recipient must not be followed by a filter on PIW's outcome; the client's existing source response and downstream destinations remain authoritative.

## Operational phases

### Phase A — authorized now

- Implement the two disabled-by-default PIW paths and shared classifier.
- Use synthetic fixtures only.
- Verify authentication, tenant binding, idempotency, payload limits, privacy, classification, and zero downstream side effects.
- Write exact custom JSON recipient mapping instructions.
- Do not deploy or modify LeadConduit.

### Phase B — separate approval

- Deploy the disabled receiver to PIW staging/preview.
- Configure only synthetic test tokens and run direct endpoint tests.
- Confirm status and persistence contain no customer values outside tenant-scoped candidate detail.

### Phase C — separate explicit approval

- Add one test-scoped custom JSON recipient to each LeadConduit flow at the documented position.
- Do not modify existing steps, filters, order, response parsing, or recipients.
- Use LeadConduit's test-lead criteria before any live shadow traffic.
- Compare expected classifier categories to the visible LeadConduit test flow.

No phase may silently advance to the next.

## Verification criteria

- Both routes reject cross-flow tokens and flow IDs.
- Disabled flags prevent receipt before body processing.
- Synthetic apartment, Roofing multiple-property, and Roofing-vacant inputs create the expected allowlisted observations.
- Exempt sources, missing/CoreLogic failure outcomes, unknown classifications, and Virtual Quote multiple-property/vacant inputs create no candidate.
- Replays remain idempotent.
- Malformed, oversized, and unauthenticated requests persist no customer values.
- Candidate persistence is tenant-scoped and authenticated read-only.
- The endpoint creates no PIW lead or downstream integration activity.
- No code path calls ActiveProspect APIs or exposes a LeadConduit mutation method.
- The implementation and tests make no change to either live LeadConduit flow.

## Deferred scope

- ActiveProspect API discovery, polling, and historical reconciliation.
- Earlier Roofing rules such as `NJ Only` and the pre-CoreLogic vacancy filter.
- Post-Experian `No Renters` review.
- Exact proof of final LeadConduit rejection.
- Automated rescue, PIW lead creation, outreach, CRM delivery, rule learning, or flow modification.
- Production deployment or LeadConduit configuration.
