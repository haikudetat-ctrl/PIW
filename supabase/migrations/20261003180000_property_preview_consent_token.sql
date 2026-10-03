-- The website's signed privacy-consent token captured when the preview is
-- created. Conversion happens on the tenant estimate host, where the website's
-- consent cookie isn't present, so the conversion route uses this token as a
-- fallback; current consent is still resolved canonically by consent ID, so a
-- later revocation is honored.

alter table public.property_previews
  add column privacy_consent_token text
    check (privacy_consent_token is null or pg_catalog.length(privacy_consent_token) between 1 and 4096);
