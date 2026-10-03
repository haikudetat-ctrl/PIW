// Actions behind the signed links in preview report emails.

/**
 * Resume: issue a fresh preview capability (the emailed link never contains
 * one) and send the homeowner to it. Anything invalid starts over.
 */
export async function resumePreviewFromEmail(
  input: {link: string; companyId: string},
  dependencies: {
    verify(link: string): string | null;
    issueToken(): {token: string; tokenHash: string};
    rotate(input: {companyId: string; previewId: string; tokenHash: string}): Promise<boolean>;
  },
) {
  const previewId = dependencies.verify(input.link);
  if (!previewId) return "/roof-estimate";
  const {token, tokenHash} = dependencies.issueToken();
  const rotated = await dependencies.rotate({companyId: input.companyId, previewId, tokenHash});
  return rotated ? `/roof-estimate/p/${token}` : "/roof-estimate";
}

/** Unsubscribe: stop this preview's reminders and suppress the address for the company. */
export async function unsubscribePreviewEmail(
  input: {link: string; companyId: string},
  dependencies: {
    verify(link: string): string | null;
    unsubscribe(input: {companyId: string; previewId: string}): Promise<boolean>;
  },
) {
  const previewId = dependencies.verify(input.link);
  if (!previewId) return false;
  return dependencies.unsubscribe({companyId: input.companyId, previewId});
}
