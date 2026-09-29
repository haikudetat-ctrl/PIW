# Customer journey

One customer record across PIW, ActiveProspect (LeadConduit) and JobNimbus,
with a timeline of the stages each customer reached. LeadMaster joins through
the same tables once its exports are imported.

## Tables

| Table | Holds |
|---|---|
| `customers` | One row per person, with first-touch source and first-seen time |
| `customer_identities` | Every source record attached to a customer, and how it matched |
| `customer_journey_events` | One row per stage reached, with its time and source |
| `customer_match_conflicts` | Records not attached because the match was ambiguous or missing |
| `jobnimbus_status_stages` | JobNimbus status → stage mapping (default, overridable per company) |
| `source_costs` | Per-lead prices and monthly spend per source, for cost per sale |

## Matching

Each new record is attached in this order:

1. **Explicit link.** A LeadConduit lead carrying a PIW lead ID
   (`piw_lead_id` in the checkpoint body); a JobNimbus job's primary contact.
2. **Phone** (E.164), then **email** (lowercased), against records already
   attached.
3. Otherwise a **new customer**, attributed to that record's source.

A phone or email already attached to more than one customer is never used to
merge. The record goes to `customer_match_conflicts` for review, as does a
JobNimbus job with no primary contact. Test leads are excluded.

## Stages

| Stage | From |
|---|---|
| `lead_received` | PIW lead created |
| `ap_intake`, `ap_delivered` | LeadConduit checkpoints |
| `ap_filtered` | Entered a flow, not delivered after two hours |
| `handoff` | JobNimbus job created |
| `quoted` | First JobNimbus estimate (exact) or status `Quoted` |
| `appointment_set`, `appointment_no_show` | JobNimbus status |
| `sold` | `Signed Contract` (exact) |
| `in_production` | `Job Prep`, `Final Walk Through` |
| `completed` | `Job Completed`, `Pending Payments` |
| `lost` | `Lost` |
| `contacted`, `appointment_ran` | LeadMaster (after export import) |

A status's own stage is recorded at the time the job entered that status. A
job first seen further along (for example already `Job Completed`) also gets
the stages it must have passed (`sold`), marked `is_approximate` because their
exact time is unknown. From the first sync onward, every status change is
recorded as it happens, so approximate events only come from history.

Events are never deleted. A stage a customer reached stays on their timeline
even after the source status moves on.

## Schedule

`customer-journey-refresh` runs hourly at minute 47 (America/New_York), after
the JobNimbus sync at minute 17, for every company with an enabled JobNimbus
integration plus the LeadConduit company. It only attaches new records and
adds new events, so reruns are cheap and safe. To run it by hand:

```sql
select public.refresh_customer_journey('<company uuid>');
```

It returns `attached`, `unmatched`, `events_added` and `open_conflicts`.

## Costs

Add one row per source and period. Use `per_lead` for a vendor's price per
lead and `monthly` for a fixed monthly spend; a source can have both.

```sql
insert into public.source_costs (company_id, source_name, cost_type, amount, effective_from)
values ('<company uuid>', 'Angi', 'per_lead', 45.00, '2026-09-01');
```

`source_name` must match the customer's first-touch source as it appears in
`customers.source_name`.

## Review conflicts

```sql
select source_system, reason, candidate_count, count(*)
from public.customer_match_conflicts
where company_id = '<company uuid>'
group by source_system, reason, candidate_count;
```
