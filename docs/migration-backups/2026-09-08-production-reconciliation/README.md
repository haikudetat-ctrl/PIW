# Migration reconciliation — 2026-09-08

The runnable `supabase/migrations` directory was reconciled to production commit `eb89d57ca3a9218be3bb5f996f5dd49be8c22ea3`. Its 50 migration versions and names match the recorded migration history of PIW (`qituolbocxnoxcmkqrva`). This is file/history reconciliation, not a full live-schema drift audit.

Changes: restored 16 missing production files, replaced two older local versions, and removed one conflicting local-only migration from the runnable directory. No SQL was executed to modify the database, no migration history was repaired, and no unrelated application files were changed. The older local branch and its unrelated work remain intact; this is not a whole-codebase merge or a new deployment.

## Preserved local originals

- `20260824172620_all_season_campaign_estimate_transaction.sql.bak`: prior local version lacked the deployed Google Place ID parameter/storage and roof-estimate creation.
- `20260826182910_canonical_roof_assessment_journey.sql.bak`: prior local version contained an additional unique-constraint declaration.
- `20260904125658_meta_event_deliveries.sql.bak`: untracked local-only migration whose table creation conflicts with the existing production privacy/Meta migration chain. Archived, not applied.

These backups are outside the migration directory and use `.bak` extensions so migration tooling will not execute them. Preserve them for reference; do not copy them back into the runnable directory without reviewing their differences against the complete production chain.
