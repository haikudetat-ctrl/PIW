// Supabase email links (password recovery, invitations) land on this page,
// which verifies the token and sends the person on to set a password.
// Moves to app.rake.2-stack.com in step 4 of the roof-quote merge.
export const PRODUCTION_AUTH_CONFIRM_URL =
  "https://piw-sepia.vercel.app/auth/confirm?next=/reset-password";
