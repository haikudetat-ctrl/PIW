import { z } from "zod";

export const publicRoofEstimateInputSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name"),
  phone: z.string().trim().min(7, "Enter a valid phone number"),
  email: z.email("Enter a valid email address"),
  addressLine1: z.string().trim().min(3, "Enter the property street address"),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(2, "Enter the city"),
  state: z.literal("NJ"),
  postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid New Jersey ZIP code"),
  consentEstimate: z.literal("on", { error: "Consent is required to create the estimate" }),
  consentEmail: z.literal("on", { error: "Email consent is required" }),
  consentSms: z.literal("on", { error: "SMS consent is required" }),
});

export type PublicRoofEstimateInput = z.infer<typeof publicRoofEstimateInputSchema>;

export function parsePublicRoofEstimateFormData(formData: FormData) {
  return publicRoofEstimateInputSchema.parse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
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
