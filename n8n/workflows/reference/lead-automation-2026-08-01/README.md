# Lead automation workflow references

These files preserve the exact hand-built workflow skeletons supplied on
2026-08-01. All have `active: false`; none is a tested n8n export.

- `roof-lookup-workflow.superseded.json` duplicates the existing Inngest roof
  pipeline and must not be deployed.
- `speed-to-lead-workflow.inactive.json` requires provider, authentication,
  timezone, branch-join, alert, and after-hours queue work.
- `meta-capi-workflow.inactive.json` requires authenticated triggers, payload
  validation, durable attempt state, real failure alerts, and Meta test-event
  verification.

Use the repository audit and implementation plan before adapting either active
candidate in staging. Credentials and environment values must never be added to
these exports.
