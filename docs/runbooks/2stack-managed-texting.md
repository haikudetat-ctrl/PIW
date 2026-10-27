# 2Stack-managed texting

2Stack operates the Twilio parent account and pays consolidated usage. Each
customer has a dedicated subaccount, customer-specific A2P brand/campaign,
Messaging Service and phone number. Customer texts identify that business.
The parent account's messaging registration does not cover customer traffic.

## Provision a client

1. Create a subaccount under the 2Stack parent account, labeled with the client.
2. In that subaccount, register the customer's legal business profile, A2P brand
   and campaign using its own business details, consent flow and sample texts.
   Include the actual appointment-follow-up use cases in the campaign.
3. Provision a dedicated number and Messaging Service in that same subaccount;
   attach the approved campaign and enable Advanced Opt-Out.
4. Create a subaccount-level API key for outbound messaging. Obtain that
   subaccount's auth token for validating webhook signatures. Never substitute
   a parent API key or parent auth token.
5. Add the client to the server-only `TWILIO_SMS_CLIENTS_JSON` deployment secret.
   Its value is an array with this shape (all values below are placeholders):

   ```json
   [{
     "companyId": "<PIW company UUID>",
     "accountSid": "<client subaccount AC SID>",
     "apiKeySid": "<API key SK SID created in that subaccount>",
     "apiKeySecret": "<subaccount API key secret>",
     "authToken": "<subaccount auth token>"
   }]
   ```

   Each company, Account SID and API key SID must appear only once. Malformed
   entries or duplicates invalidate the registry. Store this only in the
   deployment's secret configuration; never commit real values, log the JSON,
   or pass it to browser components. No `NEXT_PUBLIC_` prefix.
6. Using a privileged operator session, configure `company_sms_settings` for
   that PIW company with its `messaging_service_sid` and `from_e164` from the
   subaccount. Start with `enabled=false`. There is no client onboarding UI yet.
7. Configure the Messaging Service inbound POST webhook as
   `https://<canonical PIW host>/api/twilio/sms`. Delivery callbacks use
   `/api/twilio/sms/status`; set `VERCEL_PROJECT_PRODUCTION_URL` to the canonical
   host so outbound sends include that callback. Twilio supplies `AccountSid`;
   PIW resolves its candidate client, validates the signature with the
   subaccount token, and only then accesses company-scoped records.
8. Rehearse with a separate test company/number and an explicitly opted-in
   internal recipient. Check inbound replies, STOP suppression and delivery
   status before enabling customer traffic. Verify the configured Messaging
   Service and number belong to the intended subaccount in Twilio.
9. Enable `SMS_ENABLED=true` and the company's `enabled` setting only after
   registration, templates and consent evidence are ready. Missing registration
   is not a reason to bypass the consent/suppression checks.

## Disable and rotate

- `SMS_ENABLED=false` stops outbound sends globally. The company `enabled`
  setting stops outbound sends for that company. Inbound replies, opt-outs and
  delivery callbacks still work while outbound is off, provided the registry
  binding remains present.
- Remove a registry binding to reject all that account's callbacks; ordinarily
  keep it while delayed callbacks and opt-outs may arrive.
- Rotate an outbound API key by updating its SID and secret together in the
  deployment secret and redeploying. Auth-token rotation must be coordinated
  with Twilio webhook signing; dual-token overlap is not implemented yet.
- Customer messaging never falls back to global `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` or `TWILIO_API_KEY_*`. The global API key settings remain
  available for the separate Twilio Verify integration.

## Migration and verification

This slice has no database migration. Existing SMS settings, consent,
suppression and message tables remain in use. Populate the client registry
before enabling the new code for a company; older global SMS credentials
alone no longer authorize sending or webhooks. If rollback to old application
code is necessary, disable outbound first: old code uses the old global SMS
identity and stops callbacks while outbound is off.

Run `npx vitest run src/modules/sms src/app/api/twilio src/lib/env/server.test.ts`,
`npm run lint`, `npm run typecheck`, `npm run test:run` and `npm run build`.
The transport tests replace network fetch with synthetic Twilio responses;
they send no live messages. Subaccount creation, A2P approval, live delivery,
and customer traffic cutover require separate operational verification.

Sources: [Twilio ISV onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv),
[subaccount credential boundaries](https://www.twilio.com/docs/iam/api/subaccounts),
[webhook validation](https://www.twilio.com/docs/usage/security).
