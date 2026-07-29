"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function signIn(formData: FormData) {
  const input = loginInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: "Invalid email or password" };
  redirect("/");
}
