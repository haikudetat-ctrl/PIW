# Setter-assisted virtual booking

## Intent and agreed scope

The user approved continuing with setters booking and rescheduling directly against existing virtual capacity after workspace hotfix #104 is green. An enrolled setter should complete the conversation in `/setter-queue`, without opening a homeowner capability link in another tab. PIW remains the appointment record; Google sync and existing email workers follow committed events. Virtual inspections remain the main route.

## Approach

Use an in-queue picker backed by the existing booking service and reservation transactions. The existing link-only workflow remains a fallback. A separate staff calendar/reservation engine would duplicate availability and reminder rules, so it is excluded. The direct picker is the approach approved in the conversation; the implementation choices below are the builder's calls.

An authenticated, claim-scoped context RPC authorizes access to exactly the current task/lead and issues its booking link internally. Server code uses that context to list real slots through the existing Google busy-time and PIW slot engine. The signed capability never needs to reach the picker. Browser forms cannot select a company, lead, account, or arbitrary booking link.

A service-role-only commit RPC repeats enrollment, membership, queue, lead-eligibility, claim-owner/token/expiry checks under the queue company lock. It then uses the existing booking link and virtual-capacity locks and delegates to `book_virtual_consultation` or `reschedule_virtual_consultation`. It is deliberately unavailable to browser roles: authenticated callers must not bypass the server's Google busy-time check. A reschedule names the observed appointment and revision; stale requests cannot move a different or changed booking.

Existing self-service reservation identity stays compatible so homeowner links, uniqueness, calendar sync and email reminders keep working. Set `appointments.created_by` for a new setter booking and append an audit entry for each actual booking/reschedule. The existing `booking_source=self_service` identifies this reservation engine, not proof that the homeowner personally clicked. No call attempt or outcome is invented; the setter still records it explicitly.

## Behavior

- Load available dates/times, show the configured timezone and full appointment date, confirm the homeowner's invite email, and accept optional appointment notes.
- An existing upcoming virtual reservation is shown and can be moved using fresh availability. Preserve the current booking until a replacement commits.
- Slot contention refreshes availability. Missing booking configuration, calendar failure, no capacity, stale claims and changed appointments have clear retry/reload states.
- Every save recomputes Google availability, then rechecks database capacity and claim authorization atomically. Retries cannot create a second active reservation.
- Revisions continue to invalidate old reminders. Keep existing reschedule limits and public booking throttles; use the actual trusted request IP.
- A live claim remains usable until its lease expires, matching existing disposition behavior even if the shift timer has just ended. Disabled enrollment, inactive membership or a paused queue deny access immediately on the next request.

## Limits

No in-home capacity, rep scheduling redesign, SMS automation, new outbound provider, production enablement or live messages. Setters cannot manage unclaimed leads. Managers retain existing appointment administration; this slice does not grant employee CRM access. Cancellation remains in the existing manager/homeowner flow.

## Acceptance

Prove scoped access, stale-claim denial after availability was loaded, same-slot competing reservations, expected-revision rejection, single active booking, audit attribution, existing event/revision behavior, calendar outage denial and picker recovery. Rehearse with synthetic fixtures only. #104 must be merged before this feature is released; keep PR targets explicitly on main and remove the dependency commits after that merge.
