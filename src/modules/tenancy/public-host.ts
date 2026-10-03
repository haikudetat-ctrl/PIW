import { z } from "zod";

// Pure helpers for tenant estimate hosts (e.g. estimate.allseasonroofingquote.com).
// The middleware uses the path and host helpers on every request, so nothing
// here touches the database; resolvePublicHost takes its lookup as a parameter.

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value.trim().toLowerCase().replace(/:\d+$/, "");
  return HOST_PATTERN.test(host) ? host : null;
}

export function parseTenantHosts(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => normalizeHost(entry))
      .filter((host): host is string => host !== null),
  );
}

const TENANT_PUBLIC_PREFIXES = [
  "/roof-estimate",
  "/api/property-preview",
  "/api/roof-estimate",
  "/privacy",
  // Static assets the public estimate pages load (fonts, campaign and brand imagery).
  "/fonts",
  "/campaigns",
  "/brand",
];

/** Routes a tenant host may serve. Everything else, including the staff app, is 404. */
export function isTenantPublicPath(pathname: string) {
  return TENANT_PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const httpsUrl = z.url().refine((value) => value.startsWith("https://"), "Must be an https URL");

export const publicBrandSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  logoUrl: httpsUrl.optional(),
  privacyUrl: httpsUrl,
  termsUrl: httpsUrl.optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

export type PublicBrand = z.infer<typeof publicBrandSchema>;

export type PublicHostRow = {
  company_id: string;
  verified_at: string | null;
  brand: unknown;
};

export type PublicHostLookup = (host: string) => Promise<PublicHostRow | null>;

export type ResolvedPublicHost = {
  companyId: string;
  host: string;
  brand: PublicBrand;
};

/** Resolves the tenant only from a verified host; never from the URL or request body. */
export async function resolvePublicHost(
  hostHeader: string | null,
  lookup: PublicHostLookup,
): Promise<ResolvedPublicHost | null> {
  const host = normalizeHost(hostHeader);
  if (!host) return null;
  const row = await lookup(host);
  if (!row?.verified_at) return null;
  const brand = publicBrandSchema.safeParse(row.brand);
  if (!brand.success) return null;
  return {companyId: row.company_id, host, brand: brand.data};
}
