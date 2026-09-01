# Marketing landing page drafts

First-pass landing pages built on the front/back-door strategy in
[the go-to-market plan](../2026-08-29-piw-multi-tenant-go-to-market-plan.md)
and [the deck audit](../2026-08-29-rake-deck-positioning-audit.md).

| File | Audience | Lead message |
| --- | --- | --- |
| `rake-landing.html` | Established contractors already spending on ads | "Your CRM runs your jobs. We run your front door and your back door." |
| `launch-system-landing.html` | Sales reps preparing to start their own company (GTM plan §5.3) | "You can sell. That was never the question." |

These are standalone HTML drafts for review, not part of the deployed
`apps/website` build. They share one token system — asphalt ground, chalk-line
blue accent, Barlow Condensed / Barlow / IBM Plex Mono — so the two offers read
as one company.

## Before either goes live

- **Wire the CTAs.** Both use in-page anchors; they need a real booking link.
- **Re-verify the build-status section** in `rake-landing.html` against the
  codebase on every publish. It claims what is live, next, and never, and it is
  the page's main credibility asset — a stale claim there is more damaging than
  anywhere else on the page.
- **Keep them claim-free.** Neither page carries testimonials, customer logos,
  or results figures, because none can be substantiated until All Season is live
  and the case study publishes. Do not add them ahead of the evidence.
- **Do not add a data-collecting form** without a backend and a privacy notice.
