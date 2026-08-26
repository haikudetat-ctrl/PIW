# All Season website

Standalone Next.js App Router website for campaign and content work. Vercel
should use `apps/website` as this project's root directory. PR branches produce
preview deployments; `main` is production.

The `/api/intake` route validates public form submissions, captures `fbclid`,
`_fbp`, and `_fbc`, and forwards the normalized payload to PIW's authenticated
All Season intake endpoint. It never exposes the PIW URL or shared secret to
browsers. Configure `INTAKE_WEBHOOK_URL` and `INTAKE_ADDRESS_SUGGESTIONS_URL`
to the matching PIW environment and use the same secret as PIW's
`ALL_SEASON_INTAKE_SHARED_SECRET`. PIW uses its server-side
`GOOGLE_MAPS_API_KEY` for Quick Quote address suggestions and canonicalization.

Campaign landing pages submit to `/api/campaign-estimate`. This route accepts
the four approved campaign slugs, requires either a Google-normalized address
or a complete New Jersey manual address, captures UTM and Meta attribution,
and forwards the request to PIW over the same authenticated server-to-server
connection. Configure `CAMPAIGN_ESTIMATE_WEBHOOK_URL` to PIW's matching
campaign-estimate endpoint and `PIW_PUBLIC_APP_URL` to the public PIW origin.
After PIW accepts a request, the route returns a safe estimate URL beneath that
configured origin so the browser can continue to the live estimate.

`/api/address-autocomplete` keeps `GOOGLE_PLACES_API_KEY` on the server while
returning only normalized `{placeId, address}` suggestions to campaign forms.
Autocomplete requests are restricted to the United States and biased toward
New Jersey; campaign forms retain a manual New Jersey address fallback.

`/api/google-reviews` uses the same server-only Places API (New) key together
with `GOOGLE_PLACES_PLACE_ID`. It returns a normalized, non-cacheable review
feed for the homepage while keeping provider credentials off the browser.

```bash
cp .env.example .env.local
npm install
npm run dev
```
