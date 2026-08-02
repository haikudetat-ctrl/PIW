# n8n workflows

Commit exported, credential-free workflow JSON here. Staging is the authoring
environment; production only receives reviewed exports from `main`.

The previously missing roof lookup, speed-to-lead, and Meta CAPI artifacts were
supplied and audited on 2026-08-01. Their hand-built JSON skeletons are retained
under `reference/lead-automation-2026-08-01`; they are not reviewed staging
exports and must not be imported into production. See the
[artifact audit](../../docs/audits/2026-08-01-lead-automation-artifacts.md) and
[implementation plan](../../docs/plans/2026-08-01-lead-automation-integration.md).
