import "server-only";
import { hashPreviewToken, isPreviewTokenShape } from "./preview-token";

// Public preview routes resolve the tenant only from the request host and the
// preview only from the hash of the URL token.
export async function resolvePreviewScope(
  hostHeader: string | null,
  token: string,
  resolveCompany: (host: string | null) => Promise<string | null>,
) {
  if (!isPreviewTokenShape(token)) return null;
  const companyId = await resolveCompany(hostHeader);
  if (!companyId) return null;
  return {companyId, tokenHash: hashPreviewToken(token)};
}
