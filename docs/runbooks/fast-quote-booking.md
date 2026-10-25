# Fast quote booking

Value-first leads (address → roof → 3 taps → contact) used to reach booking only after a second loading screen, nine more questions and a results page. With `QUOTE_FAST_BOOKING_ENABLED` on, the estimate page they land on after contact becomes:

1. **Phases.** Four progress lines at 0.25s each (about 1s). The price is normally ready already (see "Pricing at submit"). If not, the last line holds until it lands, for at most 15s.
2. **Quote and booking, one screen.** A navy price card (the aerial, the span across the three options, then Good / Better / Best with Better marked; a single range when the estimate has no tiers), and beside it (under it on phones) the booking panel. Review and no-range estimates still offer booking. If the price outlasts the hold, the card says it is on its way and swaps the price in when it arrives; booking works meanwhile.
3. **"Do you own this home?"** On the same screen. Owners, buyers and property managers get the calendar right under it. "No" shows callback times in its place (`request_estimate_callback`, same task as the quote chat). The answer is saved to the assessment right away (`save_roof_assessment_ownership`); an answer from an earlier visit is preselected.
4. **Booking.** Day chips (first open day picked), times, then **Confirm Mon, Oct 26 at 10:30 AM**, on the virtual consultation engine (same endpoints as the quote chat). A taken time keeps the homeowner on the screen with fresh times. No online booking, or no open times → callback times in the panel.
5. **"Help us speed up your meeting."** The remaining assessment questions (usually 5), one per screen, saved in the assessment's order. Answers the homeowner already gave (the preview's timeline, the ownership gate) are confirmed silently. Skippable at any point.

## Pricing at submit

The preview measures the roof at the address step, but pricing used to wait for the estimate worker, which only starts when a once-a-minute cron publishes the intake's `property/discovery_requested` event (5 to 57 seconds in recent production leads). With the flag on, the contact submit runs that same worker step (`runRoofEstimate`) on that same event before it responds, so the estimate is priced when the homeowner lands on it. The worker's idempotency key (pipeline run and attempt) turns the later cron-driven run into a no-op; texts, emails and CRM delivery are queued exactly as before.

Guard rails: it only runs when the measurement is already cached, so the submit never calls Google; it waits at most 4 seconds, then lets the work finish after the response; any failure is logged and the worker prices it as before. Logs: `preview_conversion_pricing` (`kind`: priced, skipped, deferred, failed, with `durationMs`).

Only value-first leads are affected (`property_previews.converted_lead_id` is set). Vendor and legacy leads keep the existing assessment journey. With the flag off, nothing changes.

It also fixes a gap in the price-first view: an assessment untouched for 24 hours is marked abandoned, which used to turn the estimate link into "Your secure assessment link has expired". With fast booking, value-first leads always see their price; an abandoned assessment only hides the follow-up questions.

## Turn it on

1. Apply the migration `20261023124120_roof_assessment_ownership_answer.sql` (adds one function; nothing calls it until the flag is on).
2. On a **piw** preview deployment, set `QUOTE_FAST_BOOKING_ENABLED=true` and run one value-first quote end to end with a test address: book a time, answer the questions, then cancel the booking from the invite. Repeat once answering "No" to ownership and confirm the callback task appears.
3. Set `QUOTE_FAST_BOOKING_ENABLED=true` on **piw** production and redeploy.

Rollback: set the flag to `false` and redeploy. The function can stay. Both the new screens and pricing at submit follow the flag.

## The look (navy-led)

The whole estimate flow (address, contact, quote, booking page) uses the AllSeason website palette at full strength: a navy header with the logo, a navy price card, lime buttons with navy text, blue for links and selections. This styling is not behind the flag; the booking-on-the-quote-screen layout is.

The header wants a logo drawn for a dark background. PIW serves AllSeason's at `/brand/all-season-logo-on-dark.svg` (the website's colour logo with "SOLAR" and its rules in white). Until the tenant row names it, the header draws the regular logo in plain white. After the deploy that adds `logoOnDarkUrl` to the brand schema (never before: older code rejects the unknown key and the host stops resolving), run:

```sql
update public.company_public_hosts
set brand = brand || '{"logoOnDarkUrl": "https://estimate.allseasonroofingquote.com/brand/all-season-logo-on-dark.svg"}'::jsonb
where host = 'estimate.allseasonroofingquote.com';
```

To roll the code back past that deploy, remove the key first: `update public.company_public_hosts set brand = brand - 'logoOnDarkUrl' where host = 'estimate.allseasonroofingquote.com';`

## Look at it locally

`/roof-estimate/dev-preview?screen=fast` (price ready) and `?screen=fast-pending` (price lands after 6s) in `next dev`, with stubbed endpoints.

## Watch

```sql
-- Value-first leads since launch: booked, and finished the follow-up questions.
select
  count(*) as leads,
  count(*) filter (where a.responses ? 'ownership') as answered_ownership,
  count(*) filter (where a.responses->>'ownership' = 'not_owner') as not_owner,
  count(appt.id) as booked,
  count(*) filter (where a.status = 'completed') as finished_questions
from public.property_previews p
join public.leads l on l.id = p.converted_lead_id
join public.roof_estimates e on e.lead_id = l.id
left join public.roof_assessments a on a.estimate_id = e.id
left join lateral (
  select ap.id from public.appointments ap
  where ap.lead_id = l.id and ap.meeting_type = 'virtual' limit 1
) appt on true
where l.created_at >= '<launch date>';
```
