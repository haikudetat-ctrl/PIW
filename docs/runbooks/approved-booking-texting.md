# Approved booking texting

PIW owns the delivery record. Each client uses its own 2Stack-managed Twilio subaccount and Messaging Service. No parent account fallback is used.

## Before launch

1. Apply the reviewed `20261102144726_approved_booking_sms.sql` migration; confirm SQL/security checks on staging first. This feature PR does not apply it to production.
2. Verify the client's A2P registration, consent language and Twilio sender/service membership. Configure that client's existing private `TWILIO_SMS_CLIENTS_JSON` entry and enabled `company_sms_settings` row. Keep credentials out of browser settings.
3. Set the canonical HTTPS `VERCEL_PROJECT_PRODUCTION_URL` and a valid `BOOKING_LINK_SIGNING_SECRET`. Configure signed inbound/status webhooks as in the managed texting runbook. `approved-booking-sms` (every minute) is only served while `TWILIO_SMS_CLIENTS_JSON` holds a valid registry, so redeploy after configuring it and confirm Inngest lists the function.
4. In **Settings → Texting**, the client's company admin saves and approves exact wording. First touch and missed call are setter templates; confirmation, reschedule, day-before and hour-before are the four required appointment templates. Suggested drafts are never automatically approved. New versions retire earlier approved versions; retirements block prepared sends.
5. Leave `SMS_ENABLED=false` and `SMS_AUTOMATION_ENABLED=false` until controlled client testing is authorized. `SMS_ENABLED` controls all outbound transport. `SMS_AUTOMATION_ENABLED` controls automatic appointment delivery; deliberate setter sends and their permitted-hour deferrals are separate. Disabling either does not disable signed inbound/status processing.
6. For a client-authorized test, enable transport, confirm approved templates and contact-hours timezone, enable company appointment texts, then enable global automation. Use an explicitly consented, non-test, eligible fixture under supervision. The normal test-lead guard intentionally prevents production-style sends to `is_test` records. Never create a fake real homeowner to bypass consent.

## Daily operation

A setter holding the active queue claim can load two approved template kinds, preview completed wording and request one text per claim. Only template ID plus claim identity are submitted. PIW chooses company, destination, sender and body. Texting does not record or replace the required call outcome. A later conversation needs an explicit new queue claim or the existing manager conversation workflow.

Automatic intents are created only when a future virtual booking is actually inserted or revised while the company setting is enabled. Enabling settings never backfills existing appointments. Confirmation/reschedule waits 20 seconds. Day-before reminders need at least an hour of planning notice; hour-before reminders need at least 15 minutes. Quiet hours use the company's texting timezone; appointment wording uses its booking timezone. Every intent has a deadline; an obsolete reminder closes instead of sending late. Reschedule/cancel/no-show closes outstanding old-revision intents.

The worker rechecks active claim or appointment revision, approved template, eligibility, consent, STOP/suppression, phone and sender immediately before networking. A signed inbound text pauses automatic messaging for its company/phone and creates one pending `sms_reply` setter task when the queue is enabled. START can remove the Twilio opt-out but does not resume automation. A setter or company admin can explicitly resume future eligible texts. Already skipped intents remain closed. Deliberate setter replies still require consent and suppression checks.

## Delivery and uncertainty

- **Queued / Preparing:** no network-started attempt yet. Safe leases can be reclaimed; quiet-hour deferrals stay within the deadline.
- **Waiting for provider response:** one POST started. Never automatically repeat it.
- **Accepted by Twilio:** Twilio returned a message SID or a verified callback bound the exact company, delivery and attempt. This is not proof the homeowner received it; read the conversation's message status separately.
- **Needs verification:** response was lost, ambiguous, or the send remained in progress for two minutes. Automatic retries never send again. Other approved sends to that phone wait while this is unresolved.
- **Rejected / Closed:** definitive rejection or a pre-send blocker. No automatic retry.

For **Needs verification**, use the client's Twilio console logs to verify destination, sender, time and exact text. In Settings → Texting, record either acceptance with the exact SID or confirmed non-acceptance with an evidence note and explicit verification checkbox. PIW records an operator attestation in `audit_log`, not provider delivery proof, and never resends from reconciliation. A later matching signed callback can still establish acceptance. If logs are inconclusive, leave it unknown. Do not copy a SID from another message.

Status callbacks include signed delivery/attempt query parameters. Account SID chooses the company before DB access; the SQL handler requires matching company, attempt, recipient and sender and never regresses delivery progress. A callback arriving before the HTTP response is supported. Callbacks and inbound STOP remain active while outbound is paused.

## Rollback

Turn off the company automation setting or `SMS_AUTOMATION_ENABLED`, and use `SMS_ENABLED=false` to stop all outbound transport if needed. Leave webhook verification configured. Do not delete jobs, reset unknown records, requeue network-started attempts, approve templates on the client's behalf, or backfill bookings during rollback. Retain migration/ledger/audit data.

## References

[Twilio message parameters and status callbacks](https://www.twilio.com/docs/messaging/api/message-resource) describe explicit sender selection with a Messaging Service and per-message status callback URLs.

The previous setter-booking release's [production migration version mapping](releases/2026-11-02-setter-booking-production.md) must be reconciled through the release process before a generic production `db push`; do not reapply an already-applied function migration blindly.
