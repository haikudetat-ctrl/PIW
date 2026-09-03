export function trustedPiwOidcHeaders(headers: Headers): Record<string, string> {
  const token = headers.get("x-vercel-oidc-token")?.trim();
  return token ? {"x-vercel-trusted-oidc-idp-token": token} : {};
}
