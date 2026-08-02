# Roof-Tracing Tool — Brainstorm

*For All Season. Goal: address in, roof planes + sq footage out, feeding a homeowner-facing quote range and an internal sales review record — RoofSnap-equivalent, fit to the existing Next.js / Supabase / n8n stack.*

## Three paths: buy, build manual, build assisted

**Buy an API.** Google's Solar API `buildingInsights` endpoint already does most of this for free up to 10,000 calls/month: given an address it returns `roofSegmentStats` — per-plane pitch, azimuth, and area — with no tracing UI to build at all. Coverage is the catch; it's strong in solar-dense metros but has gaps, and it's a black box (no vertex-level polygon to display or let a rep nudge). EagleView's Assess API sits at the other end — roofing-grade accuracy (EagleView cites ~98.8% vs. field measurement), direct CRM push, but it's priced per report (up in the $80s at premium tiers) and meant for a certified pre-contract measurement, not a fast top-of-funnel estimate. Roofr, GAF QuickMeasure, and Nearmap sit in between on price and polish. None of these give you a trace the homeowner watches happen in real time, which is part of what makes the RoofSnap-style flow feel credible during a sales conversation.

**Build it manual, with a click-to-trace UI.** This is the direct RoofSnap clone: pull a satellite tile (Mapbox Static/GL, Google Maps, or Bing aerial) centered on the parcel, let the rep or homeowner click vertices around each roof plane, close the polygon, repeat per plane. Mapbox GL JS with `mapbox-gl-draw` (or a Konva/Fabric canvas over a static image if you want to avoid map-tile licensing complexity) gets you 80% of the interaction for free. Store each plane as a GeoJSON polygon. This is the cheapest to ship and gives you full control over the UX, but it's manual labor per lead — someone has to actually trace, which is fine for internal sales review but adds friction if you want homeowners self-serving it.

**Build it assisted — auto-suggest, human confirms.** Best of both: pull the tile, run a roof-outline suggestion (Google Solar API's `dataLayers` endpoint returns a roof mask GeoTIFF you can render as a starting polygon; alternatively a hosted segmentation model like Segment Anything via Replicate can outline structures from any satellite image, address-agnostic), then drop that as an editable polygon the user drags into place. This cuts trace time from a couple minutes to a few seconds of correction and is the more scalable path once volume matters. It's more build effort up front — worth treating as a phase 2 on top of the manual tracer rather than a first release.

## Turning a trace into numbers

Once you have polygons, the math is standard: shoelace formula (or PostGIS `ST_Area` after reprojecting to a metric CRS, since Supabase supports PostGIS natively) gives footprint area per plane. Footprint isn't roof surface area, though — you need pitch to correct for slope: `true area = footprint / cos(pitch angle)`. Three ways to get pitch: pull it straight from Google Solar API's `roofSegmentStats` if the address has coverage (best case — free and precise), have the rep eyeball and enter it from the satellite image or a site visit, or default to a regional average (most residential roofs cluster around 4/12–6/12) and flag the estimate as pitch-assumed. Plane count is just the polygon count; a rough complexity multiplier (more planes → more hips/valleys → more labor) is easy to derive from that number and can feed the quote formula alongside total squares (sq ft / 100).

## Where it lives in what you're already building

This slots into Sales Support, upstream of the proposal-follow-up piece already in the architecture doc. Concretely: address comes in from Lead Support → trace UI renders (manual or assisted) → on save, a Postgres function computes total sq ft, adjusted sq ft, plane count, and complexity score, and writes a structured record (GeoJSON + metrics) to Supabase linked to the lead → that record feeds the quote-range formula shown to the homeowner immediately → an n8n workflow flags the same record for a rep to review/adjust before a formal quote goes out, consistent with the human-in-the-loop pattern already used elsewhere in this build. No new system of record needed — it's a new table plus a UI, sitting on the same Supabase backbone as everything else.

## Accuracy is not the bar to clear here

Worth naming explicitly: this tool doesn't need EagleView-grade certification, because it's not the number that goes on a contract — it's the number that gets a homeowner a believable range and gets a rep a head start before the real measurement. Keep the CV/manual trace for range-generation and internal triage, and keep a paid EagleView/HOVER report (or an on-site measurement) as the gate before anything gets signed. That framing also justifies starting with the cheap path (manual tracer, Google Solar API where it has coverage) rather than paying per-report from day one.

## Suggested build order

Ship the manual tracer first — Mapbox tile plus click-to-close polygons plus a Postgres area/pitch function plus the quote formula hookup is a self-contained MVP and doesn't depend on any third-party coverage gaps. Layer in Google Solar API as a pitch/area *source of truth when available*, falling back to manual entry elsewhere — this is a small addition once the manual tool exists. Treat CV-assisted outline suggestion (SAM or similar) as a phase 2 speed-up once you've seen how much rep time the manual version actually costs; it's the highest-effort piece and the one you can most easily defer.

---

Sources:
- [Solar API overview](https://developers.google.com/maps/documentation/solar/overview)
- [Make a building insights request | Solar API](https://developers.google.com/maps/documentation/solar/building-insights)
- [Solar API | Google Maps Platform](https://mapsplatform.google.com/maps-products/solar/)
- [EagleView Property Data API](https://www.eagleview.com/blog/property-data-api/)
- [EagleView WebServices Documentation](https://restdoc.eagleview.com/)
- [EagleView roof measurements accuracy vs. benchmark](https://markets.financialcontent.com/pennwell.elp/article/gnwcq-2025-6-4-eagleview-roof-measurements-confirmed-to-be-9877-accurate-compared-to-independent-benchmark-measurements)
- [Roofr vs EagleView comparison](https://roofingsoftwareguide.com/comparisons/roofr-vs-eagleview/)
- [EagleView Alternatives roundup](https://roofingsoftwareguide.com/roundups/eagleview-alternatives/)
