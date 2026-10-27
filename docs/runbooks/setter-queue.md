# Setter queue and callback SLA

## What this release does

`/setter-queue` gives enrolled members a company-scoped calling workflow without granting the manager CRM role. A manager can supervise, configure the queue and enroll existing active members. Enrollment does not create logins or change company roles. The employee landing notice and manager sidebar link to the queue.

PIW records manual call attempts and outcomes. CallTools remains a separate calling tool; the `tel:` link uses the user's configured phone application. PIW does not claim that a call was connected or verified by a telephony provider.

Priority is call requests, scheduled callbacks, fresh new leads (under fifteen minutes), handoffs, then due follow-up. Within a bucket, earlier due time wins, then higher quote value. Older new leads join follow-up. Future tasks and another setter's assigned callbacks are not claimable. Test leads, won/lost leads, externally owned contacts and leads with a stop outcome are excluded. New-lead/follow-up calls are also excluded while a future scheduled/confirmed appointment exists.

## Enable a company deliberately

1. Deploy the reviewed migrations and application together through the normal release path. Every company starts paused; no migration enrolls users or enables live calling.
2. A manager opens `/setter-queue`, sets the company's IANA timezone (for example `America/New_York`), confirms coverage and enables the queue. This adopts open system-created ActiveProspect intake tasks, immediate estimate-call tasks and homeowner callback requests. Staff-created manual tasks stay unchanged. Old callback requests can already be overdue and will enter recovery when the clock runs.
3. Enroll existing active company members. Enroll the manager too if they make calls. A setter clicks **Go on shift**; it lasts eight hours and must be renewed when it expires.
4. Enable `SETTER_CALLBACK_SLA_ENABLED=true` in the server environment when the client has agreed escalation coverage. Confirm Inngest registers `setter-callback-sla` and runs its one-minute cron. With the flag off, claims/outcomes still work but timed release and recovery do not run.
5. Optionally set the server-only secret `SETTER_SLACK_CLIENTS_JSON` to an array of `{companyId, webhookUrl}`. Use a distinct Slack incoming webhook for each company. Only HTTPS `hooks.slack.com/services/...` URLs are accepted. Duplicate company IDs, duplicate webhooks, invalid entries or malformed JSON disable all Slack delivery. Maximum twenty clients per registry. Never place this secret in `NEXT_PUBLIC_*`.
6. Rehearse with an isolated tenant before routing live traffic. Check employees cannot read `/pipeline` or another company's lead data; one claim hides homeowner details from competing setters.

## Work a lead

Click **Claim next lead**. A database transaction grants one task to one setter and prevents another task on that same lead being claimed concurrently. A setter cannot claim a second lead before recording an outcome. Reloading or trying again resumes their unfinished claim.

Claims last fifteen minutes. **Extend current claim** renews an active claim during a long conversation. An expired claim can be recovered by another setter; old tokens then fail, and the previous setter must reload. Do not keep calling from a stale screen. The page refreshes every thirty seconds while visible and when returning to the tab.

Click **Record call attempt** when starting to dial, then use CallTools or the phone link. Save an outcome even for no answer. Manual attempts are retained in history; repeating the same request does not add a second attempt for that claim. Saving a call outcome also records the attempt if needed. A non-call handoff does not invent an attempt.

- **No answer / voicemail:** complete the current task and create one follow-up due in two hours. This is an internal task, not an automatic text. Later cadence work will add approved hours and cadence configuration.
- **Callback scheduled:** choose the agreed wall-clock time in the displayed company timezone, within ninety days. The callback is assigned to that setter. Invalid dates, daylight-saving gaps and repeated fall-back times are refused; choose another unambiguous time.
- **Booked virtual:** use the existing homeowner booking link with real virtual capacity, refresh, then select the actual future appointment. An outcome cannot create a booking or mark an arbitrary slot booked.
- **Booked in-home:** available only when an explicit future `in_person` appointment already exists in PIW. This screen does not offer in-home slots or write to LeadMaster/JobNimbus. Real in-home capacity is a later slice.
- **Not interested / disqualified:** cancel pending queue tasks and record a durable stop. Disqualification needs a reason. These stops must be honored by the future cadence system; they do not rewrite SMS consent or an SMS opt-out.
- **Human handoff:** a reason is required; create one unassigned handoff for team review. An unresolved in-home capacity request can use this route.

Generic task completion cannot complete, edit or erase a queued task. The lead task list links back to the queue. Ordinary manual tasks keep their existing completion behavior. Outcome replays are idempotent; a changed outcome on a completed task is rejected rather than silently rewritten.

## Callback clock

The clock applies to call requests and scheduled callbacks with a due time, only in enabled companies:

- At due +10 minutes without an attempt, release the claim, flag the task for any on-shift setter and create one manager notification plus a durable Slack alert.
- At due +30 minutes without an attempt, close that callback window and create one human recovery handoff plus manager notification/alert. A cancellation here means the callback task closed, not that an appointment was cancelled.
- A recorded attempt, including no answer or voicemail, prevents escalation. The setter still owes an outcome.
- A homeowner changing the pending callback time invalidates its old claim, resets its clock and gives it a new revision. Queued alerts for the old revision cannot be delivered.

The manager view reports missed windows over the last seven days, attributed to the original assigned setter, or **Unassigned**. Attendance/no-show recovery, approved apology texts, proposed new times and weekly digest delivery remain later slices. No AI voice or outside caller bench is launched.

## Slack reliability and reconciliation

`setter_callback_alerts` is the durable ledger. It contains company/task/revision, stage, due time, original assignee and delivery state. Slack text contains the alert ID and due time, never homeowner name, phone, email or text history. In-app notifications work without Slack configuration; alerts remain queued until a matching binding is configured.

The worker claims at most twenty-five alerts per company per workflow step. It records `sending` before the request and uses a five-second timeout. A successful HTTP response records `sent`; a non-success response records `failed`; an exception/timeout records `uncertain`. An abandoned sending lease older than five minutes also becomes uncertain. There is no automatic re-send after an ambiguous response. In-app notifications remain available if Slack fails.

A service operator should inspect failed/uncertain rows and the client's Slack channel using the alert ID. Verify the binding and whether the alert posted. If it posted, mark it sent. If it definitely did not post and still applies to the current callback revision, explicitly reset that single row to queued through the normal administrative SQL process. Never bulk reset uncertain sends or move an alert to another company. Manager reports flag delivery issues on missed-window rows; the ledger also contains escalation-only issues.

## Pause and rollback

Pause the company from queue settings to stop new claims, scoped lead access and SLA processing. The global environment flag stops the cron for all companies. Removing a Slack binding stops only that company's Slack delivery, not in-app coverage alerts. Removing a setter releases their active claim; deactivating membership immediately denies future reads and actions. If a company is paused mid-call, resolve ownership with the manager before resuming.

Keep schema/history when rolling back application code. Queued tasks require the queue RPCs, so either restore the compatible application or keep the company paused until it is available. Never drop call outcomes or mark queued tasks complete through an older client.

## Verification boundaries

Use the isolated local Supabase project and fake network transport. The SQL race tests use the CI harness port `56322`; copy them with the isolated project's published port when running locally. Do not run the unmodified race fixtures against another user's development database. CI checks pgTAP, application integration tests and exact generated type parity.

The claimed card includes the latest 200 messages, 100 attempts, 100 outcomes, estimate range/squares and future appointments. Managers can open the existing full property/dialer workspace. Scoped aerial media and identity-linked JobNimbus context for employees are not included yet. Setter staffing/hours/languages, future cadence timing, in-home capacity and approved messaging remain client/product configuration work.
