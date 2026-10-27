# ActiveProspect booking intake

This operational receiver is separate from the legacy observational
`/api/integrations/leadconduit/*` checkpoints. Installing the code does not
change any ActiveProspect flow, contact ownership or enabled sender.

## Server configuration

Set `ACTIVEPROSPECT_INTAKE_BINDINGS_JSON` as a server-only deployment secret.
Each binding selects one client and one flow. Do not use `NEXT_PUBLIC_` or
put real tokens in source control. Example shape (placeholders only):

```json
[{
  "slug": "allseason-virtual",
  "companyId": "<PIW company UUID>",
  "flowId": "<ActiveProspect flow ID>",
  "appointmentType": "virtual",
  "contactOwner": "piw",
  "enabled": false,
  "tokens": [{"value": "<random bearer secret, at least 32 characters>", "validUntil": null}]
}]
```

Create a separate `in_home` binding for the in-home flow. Slugs and
company/flow pairs must be unique; tokens cannot be reused between bindings.
Malformed or ambiguous registries disable resolution. Two tokens per binding
allow rotation: add the new token, give the old one a future `validUntil`,
update the recipient, then remove the expired token. Never print the registry.

The endpoint is `POST /api/integrations/activeprospect/<slug>`, with
`Authorization: Bearer <binding token>` and `Content-Type: application/json`.
The body is limited to 64 KiB. The bearer binding supplies company,
appointment type and contact owner; those fields are never accepted from a
request body. A mismatch between body flow ID and configured flow is rejected.

## Payload contract

Map the following contract independently for each client flow. This example
contains synthetic values. Preserve the original lead ID, timestamp and test
boolean on retries; do not regenerate them per HTTP attempt.

```json
{
  "schema_version": 1,
  "lead_id": "synthetic-vendor-lead-001",
  "flow_id": "<ActiveProspect flow ID>",
  "submitted_at": "2026-10-27T14:00:00Z",
  "is_test": true,
  "source": {"id": "synthetic-source", "name": "Synthetic Vendor"},
  "lead": {
    "name": "Dana Example",
    "phone": "+16095550101",
    "email": "dana@example.com",
    "submitted_address": "1 Test Lane"
  }
}
```

Missing contact fields may be null or omitted. At least one source ID/name is
required. Phone numbers normalize to US E.164; unsupported numbers become
unavailable contact details. Invalid supplied emails are rejected. PIW's
existing lead schema requires name, phone, email and address: incomplete
submissions are retained as review receipts without invented contact data.

Optional `sms_consent` has this shape:

```json
{
  "granted": true,
  "company_id": "<the exact PIW company UUID>",
  "disclosure": "<the actual client-specific wording shown to the homeowner>",
  "captured_at": "2026-10-27T13:59:00Z",
  "evidence_url": "https://<retained evidence URL>"
}
```

The capture time cannot be after the original submission or current time.
The company must match the authenticated binding. All fields are needed to
record SMS eligibility; a certificate URL alone is insufficient. The full
typed evidence is retained with the immutable receipt. This records the
source's attestation, not independent certification of its legal sufficiency.
The client must approve the disclosure and evidence mapping before live use.
Intake never removes suppression, and send-time guards still apply. It grants
no estimate-processing consent and launches no paid enrichment itself.

## Acceptance and replay

Successful durable receipt returns HTTP 200 with `outcome: success`,
`receipt_id`, `state`, and `duplicate`. No homeowner contact values or internal
lead IDs appear in the response.

| State | Behavior |
| --- | --- |
| `accepted` | New canonical lead, one setter task, consent record, CRM event and outbox committed together. |
| `linked` | Existing PIW phone/lead reused; initial contact is not restarted. |
| `external` | External/Booking-Bot ownership recorded; no PIW lead, task or workflow created. |
| `test` | Receipt only; no live lead, contact ownership, task or event. |
| `needs_review` | Missing required contact details or ambiguous existing phone matches; no new contact workflow. |
| `ownership_conflict` | Another source is already recorded as owning the phone; no automatic transfer or contact. |

Receipts deduplicate by company, flow, vendor lead ID and test flag. Payload
normalization occurs before comparison. Identical retries return the original
result. Changed payloads or changed binding appointment/owner settings for that
same identity return 409; they never overwrite evidence. A corrected source
submission needs a new stable source submission ID and should reference the
old receipt in the operator's review record. There is no receipt-edit or
ownership-transfer UI in this slice.

Ownership is additionally keyed by company and phone, so submissions across
flows cannot create competing initial tasks. Another tenant with the same
phone or vendor lead ID remains independent. A unique existing live PIW lead
with the normalized phone is linked; multiple matches require review. Original
lead fields, stage, consent and active booking are not overwritten on linking.

401 means an unauthorized token/flow/company; 400 means invalid payload or
content type; 413 means too large; 409 means changed replay. Correct those
upstream rather than endlessly retrying. A 503 is disabled configuration or
retryable persistence failure. Success is returned only after the transaction
commits. If immediate event delivery fails, the durable outbox relay retries.

## Manager visibility and recovery

Managers can open **Intake** (`/intake`) for the latest 100 receipt summaries
and links to accepted leads. The list omits raw contact and consent evidence.
An authorized operator can inspect a specific company's receipt by full UUID
for correction/review. This initial page is read-only: do not work incomplete
leads or move phone ownership by casually editing production rows. A tested,
explicit transfer/review workflow is a later slice.

Neither intake nor this page sends texts or books appointments automatically.
The immediate setter task is the handoff to the existing CRM. Setter queue,
cadence and complete appointment lifecycle work follow in subsequent slices.

## Before live routing

Apply the migration through the normal reviewed CI/deployment process. Prove
the system lead ID, source ID/name, submission time, test marker, contact fields
and any consent evidence in each flow's synthetic preview. Connect the new
recipient only at the point where the lead is assigned to PIW for booking;
pre-filter observational checkpoints must not create live contact work.

Choose an exclusive cohort before directing traffic: do not leave Booking-Bot
and PIW both contacting the same phone. The receiver can enforce ownership
within PIW, but cannot stop an external service that still receives the lead.
Existing Booking-Bot ownership must be configured/reconciled before expanding
the cohort. Changing a binding does not transfer previously owned contacts.

Agree retention/deletion requirements for receipt contact and consent evidence
before enabling live traffic. Automatic retention pruning is not included yet.
Keep bindings disabled until these mapping, ownership and operational checks
are complete. Disable a binding to return retryable 503s; already committed
receipts/tasks/outbox events remain durable and are not undone by that flag.

## Local verification

Run `npx vitest run src/modules/activeprospect`, full application tests,
typecheck, lint and build. Apply the migration to a separate local Supabase
database and run the full pgTAP suite. The race tests follow the repository's
port-56322 harness; isolated local copies must substitute their own published
port in every `dblink` connection. Never run those fixtures against a different
project's database. Regenerate `src/lib/database.types.ts` from the migrated
schema and confirm CI's generated-types comparison passes.
