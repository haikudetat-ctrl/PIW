# All Season website

Standalone Next.js App Router website for campaign and content work. Vercel
should use `apps/website` as this project's root directory. PR branches produce
preview deployments; `main` is production.

Main-site and campaign lead forms submit to `/api/campaign-estimate`. This route accepts
the three canonical campaign slugs, requires either a Google-normalized address
or a complete New Jersey manual address, captures UTM and Meta attribution,
and forwards the request to PIW over the same authenticated server-to-server
connection. Configure `CAMPAIGN_ESTIMATE_WEBHOOK_URL` to PIW's matching
campaign-estimate endpoint and `PIW_PUBLIC_APP_URL` to the public PIW origin.
After PIW accepts a request, the route returns a safe `estimateUrl` beneath
that configured origin so the browser can continue to the live estimate.

Source framing is literal and transport-validated: homepage uses
`main-home` / `all-season-main`, contact uses `main-contact` /
`all-season-main`, the quote drawer uses `main-drawer` / `all-season-main`,
and each campaign uses `campaign:<slug>` / `<slug>`. The retired
`do-it-right-once` route is rejected by canonical estimate intake.

`/api/address-autocomplete` keeps `GOOGLE_PLACES_API_KEY` on the server while
returning only normalized `{placeId, address}` suggestions to campaign forms.
Autocomplete requests are restricted to the United States and biased toward
New Jersey; campaign forms retain a manual New Jersey address fallback.

```bash
cp .env.example .env.local
npm install
npm run dev
```
