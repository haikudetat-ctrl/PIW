# LeadConduit journey checkpoints

How PIW sees every lead that enters the Roofing and Roofing Virtual Quote
flows, including the ones the flows filter out, without a LeadConduit API key.

The owner has flow-edit rights and performs these steps. They extend the
Phase C procedure in [LeadConduit shadow recipient](leadconduit-shadow-recipient.md);
every safety rule there still applies.

## How it works

Add three PIW **Custom JSON** recipient steps to each flow. Each posts to the
flow's PIW endpoint with a `checkpoint` value:

| Checkpoint | Where in the flow | PIW keeps |
|---|---|---|
| `intake` | First step after source acceptance, before any filter | Contact details (for recovery) and matching keys |
| `after_corelogic` | Existing design: after step 26 (Roofing) / step 15 (Roofing Virtual Quote) | CoreLogic outputs; contact only for likely filter matches |
| `delivered` | After the last client destination | Normalized phone and email only |

A lead seen at `intake` that has not reached `delivered` after two hours
appears in `leadconduit_filtered_leads`, with `stopped_at` telling you
whether it was filtered before or after CoreLogic. That view is the recovery
queue.

## Endpoints and authentication

| Flow | Endpoint | Token variable |
|---|---|---|
| Roofing | `https://piw-sepia.vercel.app/api/integrations/leadconduit/roofing` | `LEADCONDUIT_ROOFING_WEBHOOK_TOKEN` |
| Roofing Virtual Quote | `https://piw-sepia.vercel.app/api/integrations/leadconduit/roofing-virtual-quote` | `LEADCONDUIT_VIRTUAL_QUOTE_WEBHOOK_TOKEN` |

All three recipients in a flow use the same endpoint and token. Send
`Authorization: Bearer <token>` and `Content-Type: application/json`. The
token value lives only in Vercel and LeadConduit; never paste it into a
ticket, document or chat.

## Body templates

Use JSON `null` for unavailable values. `schema_version` is the number `1`;
`is_test` is a JSON boolean.

`intake` and `delivered`:

```json
{
  "schema_version": 1,
  "lead_id": "<LeadConduit system lead ID>",
  "flow_id": "<this flow's ID>",
  "checkpoint": "intake",
  "piw_lead_id": "<lead_id_allss, when present>",
  "source": { "id": "<built-in Source ID>", "name": "<built-in Source name>" },
  "submitted_at": "<submission timestamp, ISO 8601 with offset>",
  "is_test": false,
  "lead": {
    "name": "<first_name last_name>",
    "phone": "<submitted phone>",
    "email": "<email>",
    "submitted_address": "<address_1, city, state postal_code>",
    "trustedform_url": "<TrustedForm certificate URL>"
  }
}
```

For `delivered`, change `checkpoint` to `"delivered"`. Neither body may
contain a `corelogic` object; PIW rejects it.

`after_corelogic`: the existing schema in the shadow recipient runbook, with
the optional `piw_lead_id` added.

`piw_lead_id` is how PIW recognises its own leads coming back through the
flow. PIW already sends its lead ID as `lead_id_allss` (and `reference`) on
every outbound submission. For leads from other sources it is absent; send
`null`. PIW records it as a reference only and matches it before trusting it.

## Procedure (per flow, Roofing first)

1. Confirm in Vercel Production: the flow ID variable equals the pinned ID
   (`LEADCONDUIT_ROOFING_FLOW_ID` = `6377949a81800d03d54119b5`,
   `LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID` = `68d597a7e5a45ce2a9c822fe`), the
   token is set, and `ACCESS_ROUTE_COMPANY_ID` is the All Season company.
2. Set the flow's receiver flag to `true`
   (`INTEGRATIONS_LEADCONDUIT_ROOFING_RECEIVER_ENABLED` or
   `INTEGRATIONS_LEADCONDUIT_VIRTUAL_QUOTE_RECEIVER_ENABLED`) and redeploy.
   Until then every call returns 503 by design.
3. In LeadConduit, add the three recipients **disabled**, at the positions
   above. Do not reorder, edit or delete any existing step.
4. For each recipient, confirm **fail-open**: a timeout, non-2xx response or
   network error must continue to the next step. Stop if it cannot be.
5. Enable the recipients and run **Test Flow** with a synthetic lead
   (`is_test: true`, no real person). Expect `{"outcome": "success"}` from
   each.
6. Verify in Supabase (aggregates only):

   ```sql
   select event_type, is_test, count(*)
   from public.leadconduit_events
   where event_type in ('checkpoint_intake', 'shadow_checkpoint', 'checkpoint_delivered')
   group by event_type, is_test;
   ```

7. Run a second synthetic lead that a filter rejects. After two hours it must
   appear in `leadconduit_filtered_leads` with the expected `stopped_at`.
8. Repeat for Roofing Virtual Quote. Never copy field selections between
   flows; select each field in each flow.

**Rollback:** disable only the PIW recipients in LeadConduit, or set the
receiver flag to `false` and redeploy. Leave every other step unchanged.

## Retention (owner approval required before live traffic)

Intake rows hold homeowner contact details for every lead, including leads
that never become customers. `redact_leadconduit_checkpoint_contacts` clears
the submitted name, phone, email, address and TrustedForm URL from intake rows
after an age that depends on the outcome. Normalized phone and email remain
for journey matching.

Proposed schedule (to be approved or changed by the business owner):

| Lead outcome | Contact details kept for | Why |
|---|---|---|
| Delivered to the client | 30 days | The client's own systems hold the lead |
| Filtered (not delivered) | 90 days | Long enough to review and recover |

Once approved, schedule it (for example daily) with:

```sql
select public.redact_leadconduit_checkpoint_contacts(
  '<All Season company UUID>', interval '30 days', interval '90 days'
);
```

Until a schedule is approved, keep the `intake` recipients disabled in
production flows. `after_corelogic` and `delivered` store no contact details
for ordinary leads and can run beforehand.
