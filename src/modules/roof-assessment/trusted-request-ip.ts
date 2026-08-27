import {z} from "zod";

const ipSchema = z.union([z.ipv4(), z.ipv6()]);
export type DeploymentEnvironment = "development" | "test" | "preview" | "production";

/** The production contract trusts only Vercel's overwritten forwarding pair. */
export function trustedRequestIp(
  headers: Pick<Headers, "get">,
  deploymentEnv: DeploymentEnvironment,
) {
  if (deploymentEnv === "production") {
    const marker = headers.get("x-vercel-id")?.trim();
    const value = headers.get("x-vercel-forwarded-for")?.trim();
    if (!marker || marker.length > 512 || !value || value.includes(",")) return null;
    const parsed = ipSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = headers.get("x-real-ip")?.trim();
  const parsed = ipSchema.safeParse(forwarded || direct);
  return parsed.success ? parsed.data : null;
}
