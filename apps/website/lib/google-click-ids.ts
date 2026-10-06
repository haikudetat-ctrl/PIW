/** Google Ads click IDs: gclid for ordinary clicks, gbraid/wbraid where iOS withholds gclid. */
export const googleClickIdKeys = ["gclid", "gbraid", "wbraid"] as const;

export type GoogleClickIdKey = (typeof googleClickIdKeys)[number];

/**
 * Keeps only the click IDs that are present. PIW validates attribution with
 * strict schemas and the two apps deploy separately, so omitting absent keys
 * means a website deploy that runs ahead of PIW can only affect Google-click
 * traffic, never every submission.
 */
export function presentGoogleClickIds(
  input: Partial<Record<GoogleClickIdKey, string | null | undefined>>,
): Partial<Record<GoogleClickIdKey, string>> {
  return Object.fromEntries(
    googleClickIdKeys.flatMap((key) => {
      const value = input[key]?.trim();
      return value ? [[key, value]] : [];
    }),
  );
}
