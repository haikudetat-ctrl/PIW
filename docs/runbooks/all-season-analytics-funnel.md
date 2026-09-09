# All Season opt-in measurement release

Release scope: the public All Season website's static pages, campaign forms, and quote drawer. This release preserves the production canonical consent verification and lead intake contracts. No database migrations or PIW workflow changes are included.

The notice is in normal page flow, with equal Allow analytics & advertising and Reject all controls. Visitors can use the page without making a choice. The explicit combined Allow choice requests both permissions; Customize / Privacy choices still offers independent analytics and advertising choices. Existing analytics-only choices are not upgraded automatically. Reject applies immediately, with local denial storage in addition to the signed server preference; failed persistence cannot silently restore tracking on reload. GPC continues to override advertising, including when the combined Allow button is used.

`NEXT_PUBLIC_ANALYTICS_DEFAULT_ON` is false when unset and must stay false pending All Season's legal interpretation and analytics-provider sign-off. Both the React campaign provider and injected static runtime use this flag. This release has analytics and advertising off for new visitors. Existing valid saved choices remain effective unless locally rejected. Do not enable this flag as part of deployment.

PostHog autocapture and session recording are disabled, including after re-enabling analytics. Custom event properties are allowlisted and exclude form contents and telephone numbers.

| Event | Trigger |
| --- | --- |
| `form_view` | A campaign or embedded form is visible with analytics enabled, or the quote drawer opens |
| `address_selected` | A campaign suggestion is selected or a valid manual address advances |
| `step2_reached` | A valid campaign address advances to contact details |
| `lead_submitted` | The server accepts a campaign, embedded, or drawer lead |
| `phone_clicked` | A website telephone link is clicked; this measures call intent, not completed calls |

The existing Meta dispatcher already forwards calls to the loaded SDK. This release adds SDK consent grant/revoke handling while preserving fresh canonical authorization before conversions. Production Meta configuration remains `NEXT_PUBLIC_META_TRACKING_ENABLED=true`, `NEXT_PUBLIC_META_PIXEL_ID=3142520615938086`, and the existing server privacy signing secret. This release does not change those environment variables or enable unconsented Meta tracking.

Before production: run website tests, lint, typecheck and build; verify the mobile campaign and static-page flows with intercepted vendor/lead requests. After deployment: confirm the notice no longer covers the page, the default-on flag is false, no tracker loads before consent, and opted-in dispatch works. A browser request is evidence of delivery to the vendor endpoint, not confirmation that the vendor reporting dashboard has processed it.
