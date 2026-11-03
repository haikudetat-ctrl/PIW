# Approved texting, confirmations and reminders

## Approved scope

After deploying #105, the user asked to continue with approved texting, confirmations and appointment reminders. Build the next slice inside the existing company-scoped PIW SMS, setter and booking modules. No client template is approved by this development session; no new live sender, message, automation flag or production texting migration is enabled here.

## Approach and choices

Use versioned company templates and one durable delivery ledger for both deliberate setter sends and automatic appointment messages. Reuse the existing per-client Twilio subaccount resolver and conversation records. Reusing the legacy freeform sender alone would not provide template approval, durable duplicate protection or ambiguous-send recovery. Provider-side scheduling would move revision and takeover checks outside PIW; keep scheduling in the database and process due jobs with one bounded Inngest cron.

Template kinds: `first_touch`, `missed_call`, `booking_confirmation`, `booking_rescheduled`, `reminder_day`, `reminder_hour`. Company admins create drafts, approve one immutable version per kind, and retire versions. Draft suggestions are UI conveniences, never approvals. Allowed fields are `{first_name}`, `{company_name}` and, for appointment kinds, `{booking_time}`, `{booking_link}`. Require business identity and STOP wording in approved copy; validate substitutions and SMS segment limits before sending.

New per-company automatic messaging settings start disabled, with an explicit IANA timezone. Existing company sender enablement and server subaccount readiness remain independent. Automatic scheduling starts only for new virtual bookings or changed revisions while enabled; enabling does not backfill historical appointments. Send confirmation/reschedule shortly after the change, a day-before reminder only with at least an hour of lead time, and an hour-before reminder only with at least fifteen minutes of lead time. Each intent has a bounded deadline; quiet hours defer only while the message is still useful.

## Delivery boundary

Jobs move queued → preparing (expiring safe lease) → sending (network attempt started) → accepted/failed/unknown/skipped. Only the service role reserves and starts sends. Before starting, recheck client readiness, approved version, company sender, current destination, consent, suppression, test/external/terminal lead exclusion, pause state, appointment identity/revision/status/time and manual claim authorization. Freeze rendered body and insert one conversation record in the same transaction that starts the attempt.

Only a definitely rejected HTTP request is failed. Network timeouts, malformed success responses, server errors and crashes after starting become unknown; never automatically repeat that POST. Late signed delivery callbacks can correlate the exact company/job/attempt and reconcile an unknown send. Callback and HTTP-response updates preserve monotonic conversation status. A stale preparing lease can be reclaimed; a sending lease cannot.

An unresolved send for the same company/phone holds later messages until reconciled. Company admins can record an explicit Twilio-log verification with a required explanation, optionally attaching the verified SID, or confirm the attempt was not accepted. Reconciliation is audited and never resends. Operator verification is labeled as an attestation, not provider delivery proof.

## Setter and reply behavior

An enrolled setter sees approved manual templates and a rendered preview only for their current claim. The browser submits template identity, never arbitrary message body, company, destination or provider identity. One deliberate approved text per claim prevents refresh/retry duplication; recording a call outcome remains separate. Existing manager freeform conversation tools stay unchanged.

An inbound reply pauses automatic texts for that company/phone and creates one eligible queue handoff for human review. STOP suppression and START handling remain active independently of outbound switches; START does not silently resume automation. Claimed setters and company admins can explicitly pause/resume automatic texts. Resume affects still-current pending jobs, never resurrects expired or skipped messages.

## UI

`/settings/texting`: sender readiness, automatic switch/timezone, template draft/approve/retire with exact body preview, recent delivery states, unknown-send reconciliation and pause visibility. Setter queue: approved template picker/preview/send state plus pause/resume. Keep product language about homeowners, sending and delivery; credentials remain server-only.

## Acceptance

Prove tenant boundaries, immutable approvals, one send on duplicate/retried work, STOP and reply pause, quiet hours across DST, stale reminder rejection after move/cancel/held/no-show, membership/claim revocation, provider ambiguity with no blind retry, callback-before-response recovery and safe explicit reconciliation. All network tests use synthetic transports. Full application/SQL/type parity/CI and independent review are release gates. Full multi-step outreach cadences, AI replies, in-home reminders and bulk reactivation remain subsequent slices.

References: [Twilio message callbacks](https://www.twilio.com/docs/messaging/api/message-resource), [Twilio warns retries after 500 can duplicate messages](https://www.twilio.com/docs/api/errors/20500), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
