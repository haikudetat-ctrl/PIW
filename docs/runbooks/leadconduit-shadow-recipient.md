# PREPARATION ONLY — DO NOT APPLY WITHOUT PHASE C APPROVAL

This document is a future configuration checklist for a direct, sanitized shadow receipt. It does not authorize a LeadConduit flow edit, recipient enablement, deployment, token provisioning, or a request containing client data.

## Current phase status

- Phase A implementation and local verification are complete.
- The disabled Phase B receiver deployment is present on the dedicated PIW staging stack.
- Both receiver flags remain false.
- Phase C flow insertion, token rotation, and authenticated synthetic testing are not approved or started.

## Intended recipients

Create a new Custom JSON recipient only after separate approval for Phase B deployment and Phase C LeadConduit edits:

| Flow | Exact endpoint path | Intended position |
|---|---|---|
| Roofing | `/api/integrations/leadconduit/roofing` | After step 26 and before step 27; do not reorder or alter existing steps. |
| Roofing Virtual Quote | `/api/integrations/leadconduit/roofing-virtual-quote` | After step 15 and before step 16; do not reorder or alter existing steps. |

The recipient must be a **Custom JSON** recipient. Configure bearer authorization from the server-managed token only; never put a token value in this document, a template URL, a test payload, or a ticket. Set `Content-Type: application/json`. The expected successful PIW response is `{ "outcome": "success" }`.

Do not add a filter based on PIW outcome. Do not reorder, delete, or change any existing LeadConduit step.

Before enabling a recipient, prove in LeadConduit Test Flow that timeout, non-2xx, and network-failure outcomes continue to the existing downstream steps. PIW persists before returning success, so the recipient must be configured fail-open from the client flow's perspective. Stop if that continuation behavior cannot be demonstrated.

## Schema version 1 body

The custom JSON body must contain only these schema-version-1 keys:

```json
{
  "schema_version": 1,
  "lead_id": "",
  "flow_id": "",
  "checkpoint": "after_corelogic",
  "source": { "id": "", "name": "" },
  "submitted_at": "",
  "is_test": true,
  "lead": {
    "name": "",
    "phone": "",
    "email": "",
    "submitted_address": "",
    "trustedform_url": ""
  },
  "corelogic": {
    "outcome": "",
    "reason": "",
    "building_comments": "",
    "site_land_use": ""
  }
}
```

Use JSON `null` for optional unavailable values; do not substitute invented values. `schema_version` is the number `1`, and `is_test` must be a JSON boolean, never a quoted string.

## Logical mapping gate

| PIW JSON key | Future LeadConduit selection | Verification rule |
|---|---|---|
| `lead_id` | LeadConduit system lead ID | Do **not** assume client field `lead_id_allss`; prove stable replay identity with a synthetic Test Flow. |
| `flow_id` | hardcoded expected flow ID | Must equal the path binding. |
| `checkpoint` | hardcoded `after_corelogic` | Literal only. |
| `source.id` | built-in Source ID | Prefer the stable internal ID; verify `66294ffc805cf61e9575ee40` and `65a84540388af4b003c1b8de` resolve to the two UI labels seen in the existing rules. |
| `source.name` | built-in Source name | Map alongside the ID when exposed; do **not** substitute `lead_source_allss` or `campaign_source`. |
| `submitted_at` | LeadConduit submission timestamp metadata | Verify ISO-8601 output with offset. |
| `is_test` | LeadConduit test marker metadata | Verify JSON boolean, not a quoted string. |
| `lead.name` | `first_name` plus `last_name` | Verify the recipient template joins safely when either is absent. |
| `lead.phone` | submitted phone field | Select by semantic field in Phase C; do not guess an unseen ID. |
| `lead.email` | `email` | Confirmed client field ID. |
| `lead.submitted_address` | `address_1`, optional `address_2`, `city`, plus state/postal fields selected semantically in Phase C | Join only present components; do not guess unseen IDs. |
| `lead.trustedform_url` | existing TrustedForm certificate URL | Select the existing flow/step value; optional. |
| `corelogic.outcome` | CoreLogic Property Details Outcome | Optional step output; omit/null when the conditional CoreLogic step did not run. |
| `corelogic.reason` | CoreLogic Property Details Reason | Step output after CoreLogic. |
| `corelogic.building_comments` | CoreLogic Property Details Building Building Comments | Step output after CoreLogic. |
| `corelogic.site_land_use` | CoreLogic Property Details Site Land Use | Step output after CoreLogic. |

### Observed-field appendix

The only field IDs observed during planning are `address_1`, `address_2`, `city`, `email`, `first_name`, `last_name`, `guid_allss`, `lead_id_allss`, `lead_source_allss`, `campaign_source`, `comments`, and `original_source`. Observed availability is not proof of semantic equivalence. In particular, do not treat `guid_allss`, `lead_id_allss`, `lead_source_allss`, `campaign_source`, `comments`, or `original_source` as replacements for system lead identity, built-in Source metadata, timestamp metadata, or CoreLogic step outputs.

A field listed in a catalog with Status off or zero Flow usage is not proven available. Never copy Roofing mappings to Roofing Virtual Quote; independently verify each selection with a synthetic preview.

## Phase C pre-enable mapping gate

Run this gate independently for both flows, using only LeadConduit Test Flow synthetic data:

1. Keep the new recipient disabled and leave every existing step untouched.
2. Verify the candidate fields show the required Status and Flow usage, then inspect the recipient preview.
3. Confirm the system lead ID, built-in Source ID and Source name, submission metadata type, test-marker boolean, and all CoreLogic outputs can be selected exactly as specified.
4. Send the synthetic preview only after the Phase C edit approval. Inspect PIW’s sanitized receipt result and the tenant-scoped stored row.
5. Prove replay uses the same system lead ID and produces one receipt row for the same tenant and flow.
6. Run one exempt-source synthetic case where CoreLogic output is absent. PIW must return success and retain a non-candidate row with customer and CoreLogic values omitted.

Stop immediately if the system lead ID, built-in Source ID/name, metadata types, or CoreLogic step outputs cannot be selected exactly. Do not infer a substitute field.

## Synthetic-only rollout and rollback

All Phase C checks are synthetic-only. Do not send client values. If any check fails, disable or remove only the new PIW recipient. Leave every existing step, destination, order, and filter unchanged.

PIW emits structured receipt telemetry limited to flow slug, HTTP status, sanitized outcome category, candidate-category count, test marker, and latency. Payload values, authorization data, contact fields, CoreLogic values, and persistence errors must never be logged.

## Retention gate

No live candidate traffic may be enabled until the business owner approves a written retention and deletion schedule for candidate contact/address evidence. Non-candidate receipts already discard homeowner and CoreLogic values. Synthetic rows may be removed only with separate approval scoped to exact `is_test=true` event IDs; there is no blanket or automated deletion authorization.

## Approval checklist

- [ ] Separate Phase B deployment approval recorded.
- [ ] Separate Phase C LeadConduit-edit approval recorded.
- [ ] Server-managed bearer token configured without exposing its value.
- [ ] Roofing Test Flow preview verified independently.
- [ ] Roofing Virtual Quote Test Flow preview verified independently.
- [ ] Exempt-source synthetic case verified.
- [ ] Rollback owner and approval recorded.
