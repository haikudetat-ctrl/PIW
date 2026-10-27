# 2Stack booking product

## Intent and approved direction

Replace Booking-Bot with a configurable 2Stack product inside PIW. AllSeason is the first customer; the product name is forthcoming. PIW owns the complete lead, conversation, appointment, and outcome record. ActiveProspect remains intake; JobNimbus remains production. LeadMaster is not a launch dependency.

The owner proof must show the complete journey: ActiveProspect lead → approved first text → setter involvement → real appointment → reminders → cancellation/no-show recovery → held appointment → outcome. Virtual inspections are the main route, with separate virtual and in-home intake flows. Report held virtual and in-home appointments separately, using unique leads for sits per 100 leads.

## Architecture and alternatives

Extend PIW's company-scoped Next.js, Supabase, and Inngest modules rather than building a separate service. Existing virtual reservation transactions, calendar synchronization, email reminders, and SMS consent/suppression guards are reused. A standalone service duplicates those boundaries; an AllSeason-only implementation prevents reuse. The user approved configurable operation and explicitly authorized starting implementation.

2Stack operates the parent Twilio account and pays consolidated usage. Each client has one dedicated subaccount, its own API key, webhook auth token, Messaging Service, number, and client-specific A2P brand/campaign. Homeowner texts identify the client. Registration and consent belong to that client; they are not covered by a generic 2Stack campaign.

Initial credential storage is a server-only deployment secret, TWILIO_SMS_CLIENTS_JSON, containing an explicit company → subaccount binding. No parent credentials are used for customer messaging; no fallback to the old global SMS identity. Existing company_sms_settings retains enabled state, number, and Messaging Service. Credentials never reach browser props or database rows readable by members. Subsequent onboarding can replace deployment-secret configuration with managed secret references without changing the account boundary.

## Behavior and boundaries

- Resolve outbound credentials only from the authorized lead's company, never from a submitted company/account identifier.
- Resolve incoming AccountSid only as a candidate; validate the signature using its mapped subaccount auth token before any database access. Every webhook lookup and mutation is also company-scoped.
- Reject malformed or ambiguous bindings without logging secret values. One subaccount cannot serve two companies. Missing configuration disables messaging; it never selects parent credentials.
- Twilio Verify remains independent of managed SMS. Existing consent, suppression, quiet-hour and per-company enable guards continue to apply.
- Approved templates and narrow automatic responses launch first. Setters own ambiguous replies and may suspend automation. Full CallTools integration is desired; manual calling is acceptable initially.
- Capacity must be real for virtual and in-home appointments. Setters use the same atomic reservation rules as homeowners.
- A cancellation is not automatically a no-show. Setters record attendance before recovery outreach. Message revisions prevent stale reminders after changes.
- No AI voice, outside caller bench, unrestricted AI, billing portal, or old-quote reactivation in the initial replacement release.

## Launch dependencies

Client confirms setter coverage/languages, escalation ownership, rep/territory capacity, consent evidence and message templates. 2Stack provisions the subaccount and subaccount-level API key, completes customer registration, and configures the sender. Live credentials, registration, message sending, production migrations, and traffic cutover are distinct from local implementation and verification.

## Acceptance

First slice: two companies send through separate Twilio account endpoints; signed inbound messages and status callbacks cannot read or change another company's records. Unmapped/malformed configuration and forged signatures fail closed; no live messages are needed to prove this.

Full product: demonstrate the continuous journey to the owner, pilot an exclusively owned cohort, fix operational friction, and expand using sits per 100 leads. All intake retries, booking races, opt-outs, manual takeover, provider outages, and reschedules must have tested recovery behavior.
