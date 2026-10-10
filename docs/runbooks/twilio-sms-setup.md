# Twilio SMS setup — AllSeason Solar (All Season Roofing)

Two-way texting for PiW (estimate delivery, inspection scheduling, follow-ups and
staff conversations) on a local 856 number, registered for US A2P 10DLC.

Decisions (Oct 10, 2026):

- Sender of record: **AllSeason Solar** only (direct customer, not ISV). Customers
  see "All Season Roofing".
- Brand: **Low-Volume Standard** (has an EIN, under 6,000 segments/day).
- Number: one **local 856** number.
- Campaign: one **Low-Volume Mixed** campaign: customer care, account
  notifications, conversational. **No marketing** (no seasonal or nurture blasts).

Fees are from Twilio's A2P 10DLC pricing pages as of Oct 2026. Re-check
before paying. Every step marked **$** waits for explicit approval.

## Steps

| # | Step | Cost | Who | Wait |
|---|------|------|-----|------|
| 1 | Fix compliance gaps on the website (below) | free | PiW code | — |
| 2 | Create Primary Customer Profile in Trust Hub for AllSeason Solar | free | Console | up to 72 h review |
| 3 | **$** Buy one local 856 number with SMS capability | ~$1–2/mo per number | Console/API | instant |
| 4 | Create Messaging Service "PiW – All Season"; add the number; enable Advanced Opt-Out; set inbound webhook and status callback to PiW (POST) | free | Console/API | — |
| 5 | **$** Register Low-Volume Standard Brand | $4.50 one-time | Console | minutes; brand contact email 2FA |
| 6 | **$** Register Low-Volume Mixed Campaign on the Messaging Service | $15 vetting (non-refundable) + $1.50/mo | Console | up to 5 business days |
| 7 | Build PiW messaging: send API, inbound webhook, status callbacks, message storage | — | PiW code | — |
| 8 | Test end to end with a staff phone, then enable for leads | per-message + carrier fees | — | — |

Brand registration (step 5) must match IRS records exactly: legal name
**AllSeason Solar**, EIN, and registered address. Enter "All Season Roofing" as the
DBA/brand name. A mismatch is the most common cause of a failed brand.

## Compliance gaps to fix before step 6

Campaign vetting reviews the website and the opt-in flow. Current state:

- The estimate and preview disclosures already say texts are automated,
  frequency varies, message and data rates may apply, and Reply STOP.
- **Missing:** "Reply HELP for help" and links to the Privacy Policy and SMS
  Terms next to the disclosure.
- **Missing:** the privacy policy has no SMS section. Carriers expect a line
  that mobile numbers and opt-in data are not shared with or sold to third
  parties or affiliates for marketing.
- **Missing:** an SMS terms page (program name, what messages are sent,
  frequency, rates, STOP/HELP, support contact).
- **Recommended:** a separate, unchecked, optional SMS checkbox instead of
  consent by clicking Submit. Bundled consent is a frequent vetting rejection.
  Any wording change needs a new `disclosure_version` so stored consent evidence
  stays accurate.

## Campaign registration text (draft)

**Use case:** Low-Volume Mixed — Customer Care, Account Notification,
Conversational.

**Campaign description**

> AllSeason Solar, doing business as All Season Roofing, is a residential roofing
> company in southern New Jersey. We text homeowners who request a roof estimate
> on our website or by phone. Messages deliver their preliminary estimate,
> schedule and remind them of roof inspections, introduce the inspector, follow
> up about the estimate they requested, and let our staff answer their questions
> by two-way text. We do not send promotional or marketing messages.

**How customers opt in**

> Homeowners opt in on our roof estimate form at allseasonroofingquote.com by
> entering their mobile number and checking an optional box that reads: "Text me
> about my estimate and appointment. Msg frequency varies. Msg & data rates may
> apply. Reply HELP for help, STOP to opt out." The box is unchecked by default and
> is not required to get an estimate. Links to our Privacy Policy and SMS Terms
> appear beside it. Customers who call us are asked for verbal consent, which
> staff record in our CRM before any text is sent.

**Sample messages**

1. `All Season Roofing: Hi Maria, your roof estimate is ready: $14,200–$21,300 for about 28 squares. View it: https://allseasonroofingquote.com/roof-estimate/7f3c… Reply STOP to opt out.`
2. `All Season Roofing: Riley Kane will inspect your roof Thu, Oct 15 at 10:30 AM. Reply C to confirm or R to reschedule. Reply STOP to opt out.`
3. `All Season Roofing: Hi Maria, it's Jordan. Following up on your estimate. Any questions I can answer? Reply STOP to opt out.`

**Opt-in confirmation (Advanced Opt-Out, START/opt-in reply)**

> All Season Roofing: You're subscribed to texts about your roof estimate and
> appointments. Msg frequency varies. Msg & data rates may apply. Reply HELP for
> help, STOP to opt out.

**HELP reply**

> All Season Roofing: For help call (856) 835-6022 or visit
> allseasonroofingquote.com. Reply STOP to opt out.

**STOP reply**

> All Season Roofing: You're unsubscribed and won't receive more texts. Reply
> START to resubscribe.

**Message contents:** links yes; phone numbers yes; no age-gated content; no
direct lending.

## PiW configuration (for step 7)

Environment variables the app will read (stored as environment secrets, never in
the repo):

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` (already used by Verify)
- `TWILIO_MESSAGING_SERVICE_SID`

Webhooks on the Messaging Service (POST, signature-validated):

- Inbound: `/api/integrations/twilio/messages/inbound`
- Status callback: `/api/integrations/twilio/messages/status`

Inbound messages carry `OptOutType` (`STOP`, `START`, `HELP`) when Advanced
Opt-Out matched a keyword. PiW records it against `lead_consents` and the
suppression list and sends no extra reply.
