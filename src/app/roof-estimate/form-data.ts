import { z } from "zod";
import { campaignSlugs, type CampaignSlug } from "@/config/campaigns";
import type { CampaignAttribution } from "@/modules/leads/accept-all-season-campaign-estimate";

export const publicRoofEstimateInputSchema = z.object({
  campaign: z.enum(campaignSlugs),
  name: z.string().trim().min(2, "Enter your full name"),
  phone: z.string().trim().min(7, "Enter a valid phone number"),
  email: z.email("Enter a valid email address"),
  addressMode: z.enum(["google", "manual"]),
  googlePlaceId: z.string().trim().min(1).optional(),
  selectedAddress: z.string().trim().min(3).optional(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.literal("NJ").optional(),
  postalCode: z.string().trim().optional(),
  consentEstimate: z.literal("on", { error: "Consent is required to create the estimate" }),
  consentEmail: z.literal("on", { error: "Email consent is required" }),
  consentSms: z.literal("on", { error: "SMS consent is required" }),
}).superRefine((input, context) => {
  if (input.addressMode === "google") {
    if (!input.googlePlaceId || !input.selectedAddress) {
      context.addIssue({ code: "custom", path: ["selectedAddress"], message: "Choose an address from Google" });
    }
    return;
  }
  if (!input.addressLine1 || input.addressLine1.length < 3) {
    context.addIssue({ code: "custom", path: ["addressLine1"], message: "Enter the street address" });
  }
  if (!input.city || input.city.length < 2) {
    context.addIssue({ code: "custom", path: ["city"], message: "Enter the city" });
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(input.postalCode ?? "")) {
    context.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a valid New Jersey ZIP code" });
  }
});

export type PublicRoofEstimateInput = z.infer<typeof publicRoofEstimateInputSchema>;

export function resolveRoofEstimateEntryContext(
  referrer: string | null,
  campaign: CampaignSlug,
) {
  try {
    if (referrer && new URL(referrer).pathname === `/campaigns/${campaign}`) {
      return {
        campaign,
        presentationKey: campaign,
        entryPoint: `campaign:${campaign}` as const,
      };
    }
  } catch {
    // Invalid or unavailable referrers use the non-campaign assessment frame.
  }

  return {
    campaign: null,
    presentationKey: "all-season-main" as const,
    entryPoint: "roof-estimate" as const,
  };
}

export function readRoofEstimateAttribution(referrer: string | null): CampaignAttribution {
  let params: URLSearchParams | null = null;
  try {
    params = referrer ? new URL(referrer).searchParams : null;
  } catch {
    params = null;
  }
  const value = (key: string) => params?.get(key)?.trim() || null;
  return {
    utm_source: value("utm_source"),
    utm_medium: value("utm_medium"),
    utm_campaign: value("utm_campaign"),
    utm_term: value("utm_term"),
    utm_content: value("utm_content"),
    fbclid: value("fbclid"),
    fbp: value("fbp"),
    fbc: value("fbc"),
  };
}

export function parsePublicRoofEstimateFormData(formData: FormData) {
  return publicRoofEstimateInputSchema.parse({
    campaign: formData.get("campaign"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    addressMode: formData.get("addressMode") ?? "manual",
    googlePlaceId: formData.get("googlePlaceId") || undefined,
    selectedAddress: formData.get("selectedAddress") || undefined,
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    consentEstimate: formData.get("consentEstimate"),
    consentEmail: formData.get("consentEmail"),
    consentSms: formData.get("consentSms"),
  });
}

export function formatSubmittedAddress(input: PublicRoofEstimateInput) {
  if (input.addressMode === "google" && input.selectedAddress) return input.selectedAddress;
  return [
    input.addressLine1,
    input.addressLine2,
    input.city,
    input.state,
    input.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}
