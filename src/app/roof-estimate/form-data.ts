import { z } from "zod";

export const publicRoofEstimateInputSchema = z.object({
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

export function parsePublicRoofEstimateFormData(formData: FormData) {
  return publicRoofEstimateInputSchema.parse({
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
