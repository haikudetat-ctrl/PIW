# All Season Meta conversions

This runbook operates the consent-gated Meta Pixel and Conversions API release
for the existing **All Season Roofing** dataset / Pixel **`3142520615938086`**.
It sends `PageView` in the browser, then one browser/server-deduplicated `Lead`
after canonical intake and one browser/server-deduplicated
`AssessmentCompleted` after a trusted personalized assessment is rendered.

Do not create another dataset or Pixel for this release. The saved
`meta_event_deliveries` ledger is an operational record, not a customer record;
it deliberately contains no raw contact details or outbound payload.

## Security and privacy boundary

- Meta is allowed only after the homeowner explicitly grants **Advertising**
  consent. Denial, a missing signed consent snapshot, Global Privacy Control,
  or later revocation means no Pixel, no `_fbp` / `_fbc` access, and no CAPI
  delivery.
- The only customer match data sent to CAPI is normalized, SHA-256-hashed email
  and phone, plus request IP, user agent, `_fbp`, and `_fbc` when available.
- Never send a name, street address, property image, assessment answer, roof
  geometry, quote amount, price tier/package, or any raw CAPI response body.
- Pixel/CAPI errors are non-blocking: lead intake, quote delivery, PIW CRM
  persistence, and Slack Context Dialer alerts must still finish.
- Treat `META_CAPI_ACCESS_TOKEN` and `PRIVACY_CONSENT_SIGNING_SECRET` as
  secrets. Do not put either in Git, Slack, a ticket, a screenshot, an issue,
  browser source, or a `NEXT_PUBLIC_*` variable.

## 1. Meta asset and token setup

Open [Events Manager](https://business.facebook.com/events_manager2/) and use
the path **Data sources → All Season Roofing → ID 3142520615938086**. Confirm
the selected asset ID matches `3142520615938086` before making any change.

1. In **Settings**, confirm the website Pixel is connected to the All Season
   dataset. The applications load Meta's standard Pixel loader after verified
   Advertising consent; do not paste a second browser Pixel snippet into either
   Vercel project, a tag manager, or a campaign HTML file.
2. In **Settings → Conversions API**, choose **Set up Conversions API** and use
   the manual/direct integration path. Do not select a partner integration that
   injects its own browser tag or relays unreviewed lead fields.
3. Generate the CAPI access token under the intended business/system-user
   access. Copy it directly into the approved secret manager, then into PIW's
   Vercel environment value. Never copy it into a command history or a shared
   document. If a token is exposed, revoke it in Events Manager immediately,
   create a replacement, update Vercel, and redeploy PIW.
4. During the same setup, note the supported Graph API version displayed for
   the token/endpoint. Set `META_GRAPH_API_VERSION` to that exact `vN.N`
   value, for example `v26.0` only if the current setup UI shows that version.
   Never use `latest`, an unversioned endpoint, or a version inferred from this
   runbook. Review Meta's deprecation notice before the pinned version expires;
   validate a replacement in Test Events before changing the value.

The CAPI endpoint remains server-only and has the form
`https://graph.facebook.com/<META_GRAPH_API_VERSION>/3142520615938086/events`.
The application never logs the token or raw request/response payload.

## 2. Vercel configuration

Set values separately for Preview and Production in the Vercel project
settings. `piw` owns server CAPI delivery and the PIW `/roof-estimate` Pixel;
`rake-website` owns main-site and campaign Pixel PageViews and consent handoff.
Use a different secret for preview and production. The two projects in the
same environment must share the *same* `PRIVACY_CONSENT_SIGNING_SECRET` so
the website can sign and PIW can verify a short-lived Advertising-consent
handoff.

| Project | Variable | Production value | Preview value |
| --- | --- | --- | --- |
| `piw` | `PRIVACY_CONSENT_SIGNING_SECRET` | 32+ byte production secret shared with `rake-website` | separate 32+ byte preview secret shared with preview website |
| `piw` | `META_TRACKING_ENABLED` | `false` until Test Events approval, then `true` | `true` only during attended Test Events validation |
| `piw` | `META_PIXEL_ID` | `3142520615938086` | `3142520615938086` |
| `piw` | `NEXT_PUBLIC_META_PIXEL_ID` | `3142520615938086` | `3142520615938086` |
| `piw` | `META_CAPI_ACCESS_TOKEN` | secure CAPI token | same token only if Meta policy/asset access permits preview testing; otherwise leave tracking disabled |
| `piw` | `META_GRAPH_API_VERSION` | exact supported pinned `vN.N` | same pinned `vN.N` |
| `piw` | `META_TEST_EVENT_CODE` | **unset** | current Test Events code only during attended QA |
| `rake-website` | `PRIVACY_CONSENT_SIGNING_SECRET` | exact same production secret as `piw` | exact same preview secret as preview `piw` |
| `rake-website` | `NEXT_PUBLIC_META_TRACKING_ENABLED` | `false` until Test Events approval, then `true` | `true` only during attended Test Events validation |
| `rake-website` | `NEXT_PUBLIC_META_PIXEL_ID` | `3142520615938086` | `3142520615938086` |

Use Vercel's project selector and secret prompt; do not put the value on a
shell command line. These commands intentionally prompt for each value:

```bash
# From the PIW project link.
vercel env add META_CAPI_ACCESS_TOKEN production
vercel env add PRIVACY_CONSENT_SIGNING_SECRET production
vercel env add META_GRAPH_API_VERSION production

# From the rake-website project link.
vercel env add PRIVACY_CONSENT_SIGNING_SECRET production
vercel env add NEXT_PUBLIC_META_TRACKING_ENABLED production
```

Repeat with `preview` as needed. Enter public IDs and `false`/`true` flags in
the Vercel UI or with the same prompted `vercel env add` command. After any
`NEXT_PUBLIC_*` value changes, redeploy that project: Next.js embeds it at
build time.

**Release gate:** verify the deployed Pixel providers read their respective
tracking flags before relying on the flag-only rollback below. If a deployed
provider does not read the flag, remove `NEXT_PUBLIC_META_PIXEL_ID` as the
immediate browser-side stop and redeploy, then repair the provider gate before
re-enabling tracking.

## 3. Test Events validation

1. In Events Manager, open **All Season Roofing → Test events** and copy the
   temporary test event code.
2. Set `META_TEST_EVENT_CODE` only on the PIW **Preview** environment. Leave
   the production value blank; application validation rejects a test code in
   production. Set both project tracking flags to `true`, deploy matching
   preview commits, and wait for Inngest to sync the PIW functions.
3. In a new private browser window, visit a public All Season page. Accept
   Advertising consent, submit one unique test lead, complete the assessment
   only after a real trusted Good/Better/Best quote renders, and retain the
   test email/lead ID only in the approved QA record.
4. In **Test events**, confirm `PageView`, `Lead`, and custom
   `AssessmentCompleted`. For each conversion, confirm the browser and server
   records use the same event ID and Meta displays one deduplicated logical
   event. A delayed server record is expected while the sender/retry worker
   runs; duplicated logical events are not.
5. Repeat from a new private window while denying Advertising consent. The
   customer journey must still save the lead, produce the eligible quote, and
   deliver normal CRM/Slack behavior, but DevTools must show no request to
   `connect.facebook.net` or `graph.facebook.com`, no Meta cookies, and Test
   Events must stay empty.
6. In Events Manager, inspect **Event Match Quality** for the CAPI conversions.
   Investigate an unexpected decline by checking consent, normalized contact
   capture, and permitted `_fbp`/`_fbc` availability—never by adding property
   or quote data to the event.
7. Remove `META_TEST_EVENT_CODE` from Preview immediately after evidence is
   captured, redeploy PIW, and keep the evidence timestamp, deployment URLs,
   and deduplication result in the release record. Do not ever add a Test
   Events code to production.

## 4. Production enablement

1. Confirm the database migration containing `meta_event_deliveries` is applied
   to PIW's configured production Supabase project; do not reset a linked
   remote database.
2. Confirm PIW and website production deployments have the matching shared
   consent secret, the same public Pixel ID, the pinned supported Graph API
   version, and the CAPI token only in PIW.
3. Leave both tracking flags `false` through the production deploy. Verify lead
   intake/quote/CRM/Slack without Meta, then set both flags `true` and redeploy
   both production projects together. Do not enable one project days ahead of
   the other.
4. Run one attended consented production journey and one denied-consent journey
   as above. In Events Manager verify deduplication, Event Match Quality, and
   the intended source URL. Remove any temporary test values before declaring
   production complete.

## 5. Delivery monitoring and diagnosis

Run the following in the Supabase SQL Editor for the intended PIW environment.
These aggregate delivery state only; they do not select contact data or an
outbound payload.

```sql
-- Pending work that has never been claimed.
select event_name, count(*) as deliveries
from public.meta_event_deliveries
where status = 'pending'
group by event_name
order by event_name;

-- Transient failures eligible for the 5-minute recovery sweep.
select event_name, last_error_category, count(*) as deliveries
from public.meta_event_deliveries
where status = 'retryable_failed'
group by event_name, last_error_category
order by deliveries desc, event_name;

-- Terminal failures: investigate configuration or the sanitized category.
select event_name, coalesce(last_error_category, 'unknown') as error_category,
       meta_http_status, count(*) as deliveries
from public.meta_event_deliveries
where status = 'permanent_failed'
group by event_name, error_category, meta_http_status
order by deliveries desc, event_name;

-- Accepted deliveries, grouped by event and day.
select event_name, date_trunc('day', sent_at) as sent_day,
       count(*) as deliveries
from public.meta_event_deliveries
where status = 'sent'
group by event_name, sent_day
order by sent_day desc, event_name;

-- Stuck claims older than ten minutes; the sweeper can republish them.
select event_name, count(*) as deliveries
from public.meta_event_deliveries
where status = 'sending'
  and last_attempted_at < now() - interval '10 minutes'
group by event_name;
```

Expected behavior:

- The sender retries transient network errors, HTTP `429`, and Meta `5xx`.
  It records a sanitized category and never stores a raw error body.
- The sweeper republishes eligible `pending`, `retryable_failed`, and stale
  `sending` rows every five minutes, up to the bounded attempt policy.
- `sent` rows retain a payload hash and optional Meta trace ID. Do not resend
  them manually or delete them to make the UI look clean.
- A current Advertising-consent revocation makes a reserved row ineligible for
  future CAPI delivery; events Meta has already accepted cannot be recalled.

## 6. Rollback and incident response

For an immediate reversible stop, set both tracking flags to `false` and
redeploy both projects:

```bash
# In the linked PIW project, then deploy the resulting production build.
vercel env rm META_TRACKING_ENABLED production
vercel env add META_TRACKING_ENABLED production
# Enter: false

# In the linked rake-website project, then deploy the resulting production build.
vercel env rm NEXT_PUBLIC_META_TRACKING_ENABLED production
vercel env add NEXT_PUBLIC_META_TRACKING_ENABLED production
# Enter: false
```

Do **not** delete `meta_event_deliveries` rows during rollback. They are needed
to distinguish accepted events from unsent work and to preserve idempotency.
If browser Pixel traffic must stop before the flag-gate deployment is verified,
remove `NEXT_PUBLIC_META_PIXEL_ID` from both projects and redeploy as the
emergency fallback. If the CAPI token is compromised, revoke it in Events
Manager, set PIW `META_TRACKING_ENABLED=false`, redeploy, then install a new
token only after reviewing access and Test Events evidence.

After an incident, record: deployment IDs, time range, aggregate delivery
counts, whether consent was honored, Meta trace IDs/error categories where
available, the rollback time, and the remediation. Never attach tokens, raw
payloads, addresses, images, or customer answers to that record.
