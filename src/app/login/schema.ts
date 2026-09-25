import { z } from "zod";

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const recoveryEmailSchema = z.object({
  email: z.email(),
});

export const passwordUpdateSchema = z.object({
  password: z.string().min(8),
  passwordConfirmation: z.string().min(8),
});
