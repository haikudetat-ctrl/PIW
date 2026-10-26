# Privacy Consent Runbook

## Required configuration

- `PRIVACY_CONSENT_SIGNING_SECRET`: at least 32 random bytes; server-only.
- Policy version: `piw-privacy-v1`.

## Production checks

1. Open a private browser session and verify no `piw_privacy` cookie exists initially.
2. Reject nonessential and verify the signed HttpOnly cookie is created.
3. Reopen Privacy choices, grant Analytics only, and verify Advertising remains off.
4. Enable Global Privacy Control in a fresh session and verify Advertising defaults off.
5. Confirm each change appends one evidence row and browser retries do not duplicate it.

## Opt-out advertising (`NEXT_PUBLIC_ADVERTISING_DEFAULT_ON`)

Set `NEXT_PUBLIC_ADVERTISING_DEFAULT_ON=true` on both Vercel projects (the
website and PIW) and redeploy both; it is inlined at build time and both sides
check it. When set, a visitor on a public page with no saved choice, no Global
Privacy Control signal, and no local advertising denial gets Advertising on by
notice: the page records an unlinked consent row with source
`default_notice`, Meta PageView fires, and only the Privacy choices control
shows. Session recording stays opt-in under its own flag.

Guarantees, each covered by tests on all three surfaces (campaign pages,
static pages, estimate host):

- A notice default only ever starts a new consent identity. The routes return
  409 over a saved choice and the database keeps any existing record, so a
  rejection is never replaced.
- GPC, a local denial, or the flag being off means no default is written and
  the opt-in banner shows as before.
- If the default cannot be recorded, nothing is stored and the opt-in banner
  shows. The website never keeps an unrecorded default cookie, because a later
  sync would otherwise record it as an ordinary preference.
- Conversions API uses the same canonical row, so server events send for these
  leads exactly as for a banner grant.

Lead-linked evidence rows still record `preferences` (or `gpc`), as they did for
banner grants; the unlinked row keyed by the consent ID carries the original
`default_notice` source.

Rollback: set the flag to `false` and redeploy both projects. Existing
`default_notice` grants stay in force until the visitor changes them; to end
them as well, ship a policy-version change.

Production checks after turning it on:

1. Fresh private session on a campaign page: no banner, Privacy choices shows,
   `fbevents.js` loads, and one `default_notice` row appears.
2. Same with GPC on: opt-in banner shows, no row, no Pixel.
3. Reject in Privacy choices, reload: Pixel stays off and no new default row.

