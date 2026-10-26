# Google Search Ads: landing pages, attribution and conversion upload

Operator guide for the AllSeason Google Search campaign. It covers the three
landing pages, how a click becomes a lead and then a conversion in Google Ads,
the settings to configure, the launch checklist, and what to do when something
breaks.

Everything here ships disabled. Nothing is sent to Google until the flags and
the per-company settings row described below are set.

## How it fits together

```
Google ad click
  │  final URL + suffix (UTMs, ValueTrack) + auto-tagged gclid / gbraid / wbraid
  ▼
allseasonroofingquote.com/roof-replacement (or -cost, /roofing-contractor)
  │  proxy.ts, before any consent decision:
  │   • arrival beacon → PIW website_arrivals (click IDs, ValueTrack, no IP)
  │   • as_attr cookie: signed first + last paid touch, 90 days, HttpOnly,
  │     Domain=allseasonroofingquote.com so the estimate host can read it
  ▼
Address step (Get My Free Roof Estimate) → /api/property-preview
  │  forwards the verified as_attr token with the preview
  ▼
estimate.allseasonroofingquote.com (PIW): roof, price, contact, booking
  │  conversion: token from the preview, else the as_attr cookie
  ▼
PIW acceptance → lead_ad_attribution (channel credit, click ID, keyword)
  │
  ▼  every 15 min: enqueue_google_ads_conversions()
ad_conversion_deliveries: qualified_lead → appointment_set → appointment_ran → sold
  │  consent re-checked at send time; dry run uses validateOnly
  ▼
Google Ads API uploadClickConversions (enhanced conversions: hashed email + phone)
```

Spend comes back the other way: a daily job pulls cost by campaign and keyword
into `ad_spend_daily`, and `/reports/paid-search` joins spend to PIW outcomes.

### Why server-side uploads instead of the browser tag

The opt-in consent gate hides most browser traffic (it hid about 95% for Meta).
Lead conversions are therefore uploaded by PIW from its own records, where the
consent decision is known exactly. The browser Google tag is optional: it adds
the conversion linker, page views and the website call number swap, and it
never records a lead conversion, so nothing is counted twice.

## The landing pages

| Path | Ad group | Slug on the lead |
| --- | --- | --- |
| `/roof-replacement` | Roof Replacement | `roof-replacement` |
| `/roof-replacement-cost` | Roof Cost / Estimate | `roof-replacement-cost` |
| `/roofing-contractor` | Roofers Near Me | `roofing-contractor` |

- Source: `apps/website/app/search/`. Copy is in `search-pages.ts`; every fact
  comes from `apps/website/lib/company-facts.ts`. Change a fact there, once.
- They are `noindex, nofollow`: ad landing pages should not compete with the
  main site in organic search.
- Copy follows the AllSeason voice brief (calm, plain, no hype or urgency). A
  test fails if banned phrases, em dashes, or an unconfirmed service area
  appear (`search-pages.test.ts`).
- The form is the value-first address step with the button and the notice
  both reading "Get My Free Roof Estimate". When the preview flow is off, the
  legacy contact form renders instead.
- The NJ HIC registration line renders only when
  `NEXT_PUBLIC_NJ_HIC_REGISTRATION` is set.

### Open facts to confirm before launch

| Fact | Current page treatment | Who confirms |
| --- | --- | --- |
| CertainTeed tier | "CertainTeed ShingleMaster PREMIER, CertainTeed's highest contractor credential" (assumed from "top tier") | AllSeason |
| 20+ years | Stated | Confirmed by owner |
| Financing | "through Service Finance and GoodLeap, subject to credit approval" | Confirmed by owner |
| Price | $500 to $750 per square, with a 25-square example | Confirmed (live estimate range) |
| Service area | "New Jersey" only | AllSeason, then add towns or counties |
| NJ HIC registration number | Hidden until set | AllSeason |
| Job photos | No photo section yet | Chris |
| Brand name in ads | Pages say "AllSeason"; ads must match the verified advertiser name | AllSeason |

## Settings

### Vercel: `rake-website` (allseasonroofingquote.com)

| Variable | Value |
| --- | --- |
| `AD_ATTRIBUTION_SIGNING_SECRET` | 32+ byte secret, identical to PIW's |
| `AD_ATTRIBUTION_FORWARDING_ENABLED` | `false` until the PIW deploy is live, then `true` |
| `NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED` | `false` (optional; see above) |
| `NEXT_PUBLIC_GOOGLE_ADS_TAG_ID` | `AW-…` from Google Ads |
| `NEXT_PUBLIC_ADVERTISING_CONSENT_MODEL` | `opt_in` until AllSeason decides otherwise |
| `NEXT_PUBLIC_GOOGLE_ADS_CALL_CONVERSION_LABEL` | optional, call conversion label |
| `NEXT_PUBLIC_GOOGLE_ADS_CALL_TRACKED_NUMBER` | `(866) 835-6022` if the swap is used |
| `NEXT_PUBLIC_NJ_HIC_REGISTRATION` | AllSeason's registration number |

The cookie is minted only when `AD_ATTRIBUTION_SIGNING_SECRET` is set. It is
safe to set the secret before turning forwarding on: the cookie just waits.

### Vercel: `piw` (estimate.allseasonroofingquote.com)

| Variable | Value |
| --- | --- |
| `AD_ATTRIBUTION_SIGNING_SECRET` | same secret as the website |
| `GOOGLE_ADS_ENABLED` | `false` until dry run passes, then `true` |
| `GOOGLE_ADS_API_VERSION` | pinned, for example `v26` |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | from the 2Stack Cloud project (below) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | leave blank (ignored since Sept 2026) |
| `SLACK_PAID_MEDIA_ALERTS_WEBHOOK_URL` | Slack incoming webhook for alerts |

Without OAuth credentials, live uploads wait (status `pending`, reason
`google_ads_not_configured`) and dry-run rows are validated locally only.

### Database: `company_google_ads_settings`

One row per company. Insert it with the service role (SQL editor):

```sql
insert into public.company_google_ads_settings (
  company_id, customer_id, login_customer_id,
  uploads_enabled, dry_run, send_conversion_values, consent_model,
  qualified_lead_action_id, appointment_set_action_id,
  appointment_ran_action_id, sold_action_id,
  spend_import_enabled, monthly_budget_usd
) values (
  '<AllSeason company id>', '<10-digit customer id, no dashes>', '<2Stack manager id or null>',
  true, true, false, 'opt_in',
  '<id>', '<id>', '<id>', '<id>',
  true, 2500
);
```

- `dry_run = true` validates every upload against the real account with
  `validateOnly` and records nothing. Switch to `false` to go live.
- `send_conversion_values` stays `false` until the owner decides whether
  contract values may go to Google. Sold conversions still upload, with the
  conversion action's default value.
- `uploads_enabled = false` is the per-company kill switch.
- Conversion action IDs are the numeric IDs from the action's URL in Google
  Ads (`ctId=`).

## One-time setup in Google

### API access (replaces the developer token)

Since September 10, 2026, Google Ads API access follows the Google Cloud
project, not a developer token.

1. Create (or reuse) a 2Stack Google Cloud project. One project serves every
   Rake client.
2. Cloud Console → **Google Ads API Overview** → request access. New Basic and
   Standard applications need brand verification first; Google reviews Basic
   Access automatically after that.
3. Create an OAuth client (Web application) in the same project.
4. Authorize it once with a Google account that can reach AllSeason's Ads
   account (Chris, or Yuna), scope `https://www.googleapis.com/auth/adwords`,
   and keep the refresh token. Store the client ID, secret and refresh token
   only in Vercel.
5. Link AllSeason's Ads account under a 2Stack manager account and use that
   manager's ID as `login_customer_id`.

### Conversion actions

Create four actions in AllSeason's account. Source **Import → Other data
sources or CRMs → Track conversions from clicks**.

| Action | Category | Primary for bidding | Count | Click window | Value |
| --- | --- | --- | --- | --- | --- |
| Qualified lead | Qualified lead | Yes, at launch | One | 90 days | Default value set by AllSeason |
| Appointment set | Book appointment | No (secondary) | One | 90 days | Default |
| Appointment ran | Other | No (secondary) | One | 90 days | Default |
| Sold | Converted lead | No, until volume supports value bidding | One | 90 days | Use the value from each conversion |

Then:
- Turn on **enhanced conversions for leads** for the account (Goals →
  Settings) and accept the customer data terms (Chris or Yuna).
- Set the campaign to use **campaign-specific goals** with only "Qualified
  lead" as primary at launch.
- Do not also import GA4 conversions as primary; that double counts.

### Auto-tagging and the final URL suffix

- Account settings → **Auto-tagging on**. Without it there is no gclid.
- Account-level **Final URL suffix**:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&utm_content={creative}&campaignid={campaignid}&adgroupid={adgroupid}&keyword={keyword}&matchtype={matchtype}&creative={creative}&device={device}&network={network}&targetid={targetid}&loc_physical_ms={loc_physical_ms}
```

- Final URLs: `https://allseasonroofingquote.com/roof-replacement`,
  `/roof-replacement-cost`, `/roofing-contractor`. Changing a live RSA's final
  URL creates a new ad, so set these before launch.
- Test with Google's **Ad preview and diagnosis** plus a real click on a
  paused-then-enabled test ad; confirm the arrival row (below).

## Qualification and stage rules

Queued every 15 minutes by `enqueue_google_ads_conversions`. A lead/stage pair
is decided once.

**Candidates**: `lead_ad_attribution.channel = 'google_ads'`, a click ID
(unless identifier-only uploads are on), clicked within 90 days, not a test
lead.

**Qualified lead** (timed at lead submission):
- skipped `lead_flagged` if a manager flagged it
- skipped `not_homeowner` if the ownership answer is manager or not_owner
- skipped `invalid_phone` unless a valid US E.164 number
- skipped `out_of_area` unless the address is in NJ
- skipped `duplicate_30_days` if the same phone or email submitted in the prior 30 days
- skipped `existing_customer` if that customer already bought
- otherwise queued; it waits up to 24 hours for an ownership answer, then
  qualifies on the other checks

**Appointment set**: first non-cancelled PIW appointment, or the JobNimbus
"Appointment Scheduled" stage. **Appointment ran**: completed PIW appointment,
or the first exact `appointment_ran`/`quoted` journey event. **Sold**: the
JobNimbus sold stage, valued at the job's approved total. Each is skipped if
it happened before the click or more than 90 days after it.

**Consent, checked at send time** (`ad_conversion_consent_state`):
- `denied` (Advertising off, revoked later, or GPC): skipped, never sent
- `granted`: sent with hashed email and phone
- `unknown`: opt-in model waits up to 14 days, then skips; opt-out model sends
- Under GPC the website never captures a click ID, so there is nothing to send.

**Junk leads**: managers mark a lead on `/reports/paid-search`. Unsent
conversions stop; conversions sent within the previous 14 days are retracted
(`uploadConversionAdjustments`, type RETRACTION, by order ID).

## Launch checklist

Gate 1, before any spend:
- [ ] AllSeason decision on NJDPA opt-in vs opt-out recorded
- [ ] Privacy policy additions (below) approved by AllSeason and published on
      both the website (`public/privacy.html`) and PIW (`/privacy`)
- [ ] Open facts confirmed; HIC number set
- [ ] Migration `20261025120000_google_search_ads_attribution` applied to the
      production PIW database
- [ ] PIW deployed, then website deployed with `AD_ATTRIBUTION_SIGNING_SECRET`
      on both and `AD_ATTRIBUTION_FORWARDING_ENABLED=true` on the website
- [ ] Auto-tagging on, final URL suffix set, final URLs point at the pages
- [ ] A test click shows up:
      `select occurred_at, request_path, campaign_slug, gclid is not null as has_gclid, google_keyword from website_arrivals where google_campaign_id is not null order by occurred_at desc limit 5;`
- [ ] The browser shows an `as_attr` cookie for `.allseasonroofingquote.com`
- [ ] A test lead from that click has a row:
      `select channel, click_id_type, google_keyword, token_verified from lead_ad_attribution order by recorded_at desc limit 5;`

Gate 2, before uploads:
- [ ] Cloud project API access approved; OAuth credentials in PIW
- [ ] Four conversion actions created; IDs in `company_google_ads_settings`
- [ ] Enhanced conversions for leads on; customer data terms accepted
- [ ] `GOOGLE_ADS_ENABLED=true`, settings row with `dry_run = true`
- [ ] After a scheduler run, deliveries show `last_validated_at` set and no
      `permanent_failed`:
      `select event_name, status, skip_reason, last_error_category, last_validated_at from ad_conversion_deliveries order by created_at desc limit 20;`
- [ ] Switch `dry_run = false`; within 3 hours the conversion appears in Google
      Ads → Goals → Conversions → the action's diagnostics

Gate 3, reporting:
- [ ] `spend_import_enabled = true`; next morning `ad_spend_import_runs` shows
      a `succeeded` run and `/reports/paid-search` shows spend
- [ ] Slack webhook set; alerts arrive in the channel

## Operating

- **Dashboard**: `/reports/paid-search` (managers). Spend, cost per lead,
  qualified, appointment and CAC; by keyword; by day; upload status; recent
  Google leads with the junk-lead control.
- **Jobs (Inngest)**: `google-ads-conversion-scheduler` (*/15),
  `google-ads-conversion-sender` (per delivery, concurrency 5),
  `google-ads-spend-import` (6:20am ET), `paid-search-alerts` (hourly),
  `click-id-retention` (monthly).
- **Retries**: 5 min, 30 min, 2 h, 12 h, then daily; permanent after 6 tries.
  `401/403` count as retryable so a credential fix recovers the queue.
- **Alerts** (once per alert per day): spend with no leads in 48 h; Google
  clicks vs logged arrivals gap over 20%; budget pacing over 110% or under 70%
  of the monthly budget; permanent upload failures; uploads retrying over 6 h;
  failed retractions; spend import stale over 36 h. Thresholds live in
  `src/modules/marketing/google-ads/alerts.ts`.
- **Retention**: raw click IDs (website arrivals and lead attribution) are
  nulled after 13 months; campaign, keyword and UTM values are kept.

### Common failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Arrivals have no gclid | Auto-tagging off, or a redirect drops the query | Turn auto-tagging on; check final URLs resolve without redirect |
| `lead_ad_attribution.token_verified = false` for Google leads | Secrets differ between projects, or forwarding off | Match `AD_ATTRIBUTION_SIGNING_SECRET`; set forwarding on |
| `conversionUploadError:CLICK_NOT_FOUND` | Click from another account, or gclid altered | Check the customer ID and manager link |
| `conversionUploadError:TOO_RECENT_CONVERSION_ACTION` | Action created in the last few hours | Retries resolve it |
| Many `skipped / awaiting_consent` | Opt-in model, visitors not choosing | Expected under opt-in; revisit with AllSeason's NJDPA decision |
| `oauth_refresh_failed` | Refresh token revoked or expired | Re-authorize, update the Vercel value, redeploy |
| `http_403` on every call | Cloud project lacks API access for production | Check the access level on the Google Ads API Overview page |

### Kill switches

- Stop all Google API calls: `GOOGLE_ADS_ENABLED=false` on PIW.
- Stop uploads for one company: `uploads_enabled = false`.
- Back to validate-only: `dry_run = true`.
- Stop the browser tag: `NEXT_PUBLIC_GOOGLE_ADS_TRACKING_ENABLED=false`.
- Stop forwarding new fields: `AD_ATTRIBUTION_FORWARDING_ENABLED=false`.

## Proposed privacy policy additions (needs AllSeason approval)

Add to the Advertising section on both privacy pages. Draft only; do not
publish or enable uploads until AllSeason approves the wording.

> **Google Ads.** When you reach our site from a Google ad, we record the
> click identifier Google adds to the link and the ad's campaign and keyword,
> and keep them for up to 13 months to understand which ads lead to
> estimates. If you allow Advertising, we may send Google Ads a record that
> your request led to an estimate, an appointment, or a signed project, along
> with the Google click identifier and a one-way hashed version of your email
> address and phone number so Google can match it to the ad. [If the owner
> approves values: For a signed project we may include the contract amount.]
> We do not send your name, property address, imagery, assessment answers, or
> roof measurements to Google. When Advertising is off, or your browser sends
> Global Privacy Control, we do not send this information to Google.

Note for AllSeason: the existing Meta text says Meta does not receive a phone
number. Google's enhanced conversions use a hashed phone number; the Meta
statement stays true, but the Google section must say so.

## Testing

- Website: `cd apps/website && npm run test` (attribution cookie, beacon
  fields, landing slugs, page copy rules, Google tag consent).
- PIW: `npm run test:run` (attribution building, upload decisions, client,
  sender, spend import, alerts, intake hook).
- Database: `npm run db:test` runs `supabase/tests/google-search-ads.test.sql`.
  Without the full Supabase stack, `scripts/sql-sandbox/run.sh` runs the
  migration and that test (plus sandbox-only checks) on a plain Postgres 17.
