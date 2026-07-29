"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { loginInputSchema } from "./schema";

export async function signIn(formData: FormData) {
  const input = loginInputSchema.parse(Object.fromEntries(formData));
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) return { error: "Invalid email or password" };
  redirect("/");
}
