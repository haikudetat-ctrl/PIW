import {z} from "zod";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

/** Trust Vercel's forwarded pair in production; use ordinary local headers only outside it. */
export function trustedWebsiteRequestIp(
  headers: Pick<Headers, "get">,
  nodeEnv: string | undefined,
) {
  const production = nodeEnv === "production";
  const value = production
    ? headers.get("x-vercel-forwarded-for")?.trim()
    : (headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? headers.get("x-real-ip")?.trim());
  if (!value || (production && (!headers.get("x-vercel-id")?.trim() || value.includes(",")))) return null;
  const parsed = ipSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
