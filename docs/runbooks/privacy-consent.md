# Privacy Consent Runbook

## Required configuration

- `PRIVACY_CONSENT_SIGNING_SECRET`: at least 32 random bytes; server-only.
- Policy version: `piw-privacy-v1`.

## Production checks

1. Open a private browser session and verify no `piw_privacy` cookie exists initially.
2. Reject nonessential and verify the signed HttpOnly cookie is created.
3. Reopen Privacy choices, grant Analytics only, and verify Advertising remains off.
4. Enable Global Privacy Control in a fresh session and verify Advertising defaults off.
5. Confirm each change appends one evidence row and browser retries do not duplicate it.
