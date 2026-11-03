# Setter booking production release

PR #105 merged as `ecd682f3e315c09d9e16aa51ee98ccb92d33de9d`. The production Vercel deployment for that commit is READY.

The exact SQL from reviewed commit `41f17bd`, repository migration `20261101150139_setter_assisted_virtual_booking.sql`, was applied to production PIW (`qituolbocxnoxcmkqrva`) through the Supabase migration connector. Supabase registered it as **`20261102143158 / setter_assisted_virtual_booking`**. All preceding intake/queue/recovery migrations were present.

Verified in production: anonymous roles cannot execute the context or commit functions; authenticated members can execute only the claim-authorized context; only the service role can execute the reservation commit. No live appointment or message was created by verification.

GitHub initially blocked the normal merge pending an approving review. The user then merged #105; no administrator bypass was used by this session.

Automatic approval review rejected rewriting the generated production migration-history version to match the repository timestamp. That metadata was left unchanged. Preserve this source-to-applied mapping when reconciling migration history; do not blindly replay the already-applied SQL or run an unreviewed full production push.
