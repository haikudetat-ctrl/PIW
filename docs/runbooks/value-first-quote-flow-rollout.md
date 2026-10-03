# Value-first quote flow rollout

Spec: [`docs/superpowers/specs/2026-10-03-value-first-quote-flow-design.md`](../superpowers/specs/2026-10-03-value-first-quote-flow-design.md). Plan: [`docs/superpowers/plans/2026-10-03-value-first-quote-flow.md`](../superpowers/plans/2026-10-03-value-first-quote-flow.md).

Everything ships dark. With the flags off, every entry point renders its legacy form and no preview can be created. Rollback is always a flag change on both projects.

## 1. One-time setup

### Domain

1. In DNS for `allseasonroofingquote.com`, add `estimate` as a CNAME to `cname.vercel-dns.com`.
2. In Vercel, add `estimate.allseasonroofingquote.com` to the **piw** project (production). Wait for it to verify.
3. Register the host for the All Season company (use the production company ID from `ALL_SEASON_INTAKE_COMPANY_ID`):

```sql
insert into public.company_public_hosts (host, company_id, brand, verified_at)
values (
  'estimate.allseasonroofingquote.com',
  '<ALL_SEASON_INTAKE_COMPANY_ID>',
  '{
    "displayName": "All Season Solar",
    "logoUrl": "https://allseasonroofingquote.com/assets/all-season-logo-color.svg",
    "privacyUrl": "https://allseasonroofingquote.com/privacy.html",
    "termsUrl": "https://allseasonroofingquote.com/terms.html"
  }'::jsonb,
  now()
);
```

Once this row exists, estimate emails and texts for that company link to the tenant host instead of the PIW domain. Existing PIW-domain links keep working.

### Cloudflare Turnstile

Create a Turnstile widget (managed, "invisible where possible") with hostnames `allseasonroofingquote.com` and `estimate.allseasonroofingquote.com`. Keep the site key and secret key.

### Resend

Verify a sender on the brand domain (for example `estimates@allseasonroofingquote.com`) in the Resend account behind `RESEND_API_KEY`.

### Environment variables

**piw** (production):

| Variable | Value |
|---|---|
| `PUBLIC_ESTIMATE_HOSTS` | `estimate.allseasonroofingquote.com` |
| `TURNSTILE_SECRET_KEY` | Turnstile secret key |
| `TURNSTILE_ALLOWED_HOSTNAMES` | `allseasonroofingquote.com,estimate.allseasonroofingquote.com` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
| `PREVIEW_REPORT_FROM_EMAIL` | the verified Resend sender |
| `PROPERTY_PREVIEW_ENABLED` | `false` until step 3 |

**rake-website** (production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key |
| `PROPERTY_PREVIEW_WEBHOOK_URL` | `https://<piw production host>/api/integrations/all-season/property-preview` |
| `NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED` | `false` until step 4 |

`PUBLIC_ESTIMATE_HOSTS` can be set before launch: the tenant host serves only the public estimate routes, and with previews off it simply serves the legacy pages.

## 2. Record the baseline

Run before enabling anything (30 days, America/New_York days, bots and scanners excluded):

```sql
select
  sum(campaign_visitor_days) as campaign_visitor_days,
  sum(campaign_leads) as campaign_leads,
  round(100.0 * sum(campaign_leads) / nullif(sum(campaign_visitor_days), 0), 3) as campaign_leads_per_100,
  sum(main_site_visitor_days) as main_site_visitor_days,
  sum(main_site_leads) as main_site_leads
from public.quote_funnel_daily
where company_id = '<ALL_SEASON_INTAKE_COMPANY_ID>'
  and funnel_date >= current_date - 30;
```

Record the result here before launch:

| Date recorded | Campaign visitor-days | Campaign leads | Leads per 100 | Provider spend per lead |
|---|---:|---:|---:|---:|
| | | | | |

## 3. Internal verification on PIW

1. Set `PROPERTY_PREVIEW_ENABLED=true` on **piw** and redeploy.
2. On `https://estimate.allseasonroofingquote.com/roof-estimate`, enter a real New Jersey address you are allowed to test with. Confirm the analysis sequence, the aerial, the roof size, the three questions, and the contact step.
3. Submit the contact step with an internal test contact. Confirm the estimate page shows the price first with "Refine your estimate", and that the lead, its three consent rows (`estimate_processing` = `all-season-property-preview-v1`, the others = `all-season-campaign-estimate-v3`), CRM delivery, and LeadConduit delivery look normal. Mark the test lead as a test in the dashboard.
4. On another preview, use "Email me this roof report". Confirm the email arrives, the resume link opens the preview, and unsubscribe works (page and one-click).
5. Confirm `https://estimate.allseasonroofingquote.com/leads` returns 404.

## 4. Enable on the website

1. Run the browser journey against a preview deployment of the website with the flag on:

```bash
WEBSITE_BASE_URL=https://<website preview URL> python3 apps/website/scripts/value-first-journey.py
```

2. Set `NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED=true` on **rake-website** and redeploy. This switches the campaign pages, homepage, contact form, and quote drawer together.
3. Submit one internal test through a campaign page and one through the homepage.

## 5. Watch the stop and cost rules

During the first 1,000 non-bot campaign visitor-days after step 4:

```sql
select
  sum(campaign_visitor_days) as campaign_visitor_days,
  sum(campaign_leads) as campaign_leads,
  sum(previews_created) as previews_created,
  sum(previews_revealed) as previews_revealed,
  sum(previews_contact_viewed) as contact_steps,
  sum(reports_saved) as reports_saved,
  sum(previews_converted) as previews_converted
from public.quote_funnel_daily
where company_id = '<ALL_SEASON_INTAKE_COMPANY_ID>'
  and funnel_date >= '<launch date>';
```

- **Stop rule:** if 1,000 campaign visitor-days produce one lead or fewer, roll back and investigate. At the pre-launch rate (about 0.6%), that outcome has roughly a 1% chance if conversion were unchanged.
- **Cost rule:** if Google provider spend per lead rises above three times the pre-launch figure, roll back. Preview measurements are recorded as `provider_requests` with request keys starting `roof.measurement:preview:`.
- The step counts show where homeowners drop off (address → reveal → contact step → conversion).

## Rollback

Set `NEXT_PUBLIC_PROPERTY_PREVIEW_ENABLED=false` on **rake-website** and `PROPERTY_PREVIEW_ENABLED=false` on **piw**, then redeploy both. Every entry point returns to its legacy form. Previews already created stop accepting new actions; leads already converted are unaffected.

## 60-day review

Compare leads per 100 campaign visitor-days, saved reports, and lead quality (contact rate, consultation requests) against the baseline. Record the outcome in the spec, then schedule the legacy-form cleanup (plan Task 12) if the flow stays.
