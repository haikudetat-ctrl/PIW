# All Season campaign landing pages

Campaign originals and working files live in the [Campaigns Masters Drive folder](https://drive.google.com/drive/folders/1QApOTe-HrGiJSFyiV76x9RhqMQBicD0Y). Drive is the creative source of truth; the repository contains only optimized WebP derivatives needed by the All Season deployment.

## Current campaign routes

| Campaign | All Season route | Drive source | Web asset status |
| --- | --- | --- | --- |
| Do It Right. Once. | `/campaigns/do-it-right-once` | `20Y_HERO_4.5.png` | Ready |
| Weather Report | `/campaigns/weather-report` | `WR_HERO_Master.png` | Ready |
| Seasonal Shield | `/campaigns/seasonal-shield` | `SH_HERO_Master.png` | Ready |
| For Every Season | `/campaigns/for-every-season` | `FES_HERO_4.5.png` | Ready |

The public registry in `apps/website/app/campaigns/campaigns.ts` controls route slugs, page copy, theme, and asset paths. Each form submits its durable campaign slug plus UTM and Meta attribution to the All Season server. The All Season server forwards the request to PIW over the authenticated campaign-estimate endpoint, then redirects the homeowner to the PIW estimate result.

## Add or update a campaign

1. Confirm the campaign folder and approved variant in Drive. Static creative is currently organized by concept (`Hero`, `Weather`, `Trust`, `Warranty`, `Workmanship`, and `Minimal`) and aspect ratio (`1.1`, `4.5`, `9.16`, and `16.9`).
2. Export a web-safe JPG, PNG, WebP, or AVIF. Do not serve a production page directly from a Drive URL.
3. Put the optimized derivative in `apps/website/public/campaigns/<campaign-slug>/`. Use stable, descriptive file names; keep PNG/PSD source files in Drive.
4. Add or update the definition and slug in `apps/website/app/campaigns/campaigns.ts`, the All Season proxy whitelist, and the PIW campaign intake whitelist.
5. Verify the page at `/campaigns/<campaign-slug>` on mobile and desktop, submit a test lead, and confirm the `campaign` field in PIW.
6. Use UTM parameters in ad URLs for channel/ad-set reporting. The campaign slug is the durable landing-page identifier.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The website requires `GOOGLE_PLACES_API_KEY`, `CAMPAIGN_ESTIMATE_WEBHOOK_URL`, `INTAKE_WEBHOOK_SHARED_SECRET`, and `PIW_PUBLIC_APP_URL`. PIW requires the matching `ALL_SEASON_INTAKE_SHARED_SECRET` plus `ALL_SEASON_INTAKE_COMPANY_ID`. Run tests, typechecking, linting, and both production builds before deployment.
